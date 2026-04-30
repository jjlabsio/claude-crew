# GitHub Issue #46: 컨텍스트 한계 도달 시 crew 워크플로우 상태 보존/복구

## 요약

claude-crew 워크플로우 진행 중 컨텍스트가 가득 차면 현재 phase/pending agent result/artifact 위치 등이 유실된다.
PreCompact/Stop/SessionStart 훅을 추가하여 상태를 보존하고 복구할 수 있게 한다.

## 구현 항목

### 1. crew run state 저장 (`lib/crew-state.mjs`)

`.crew/state/current-run.json` 스키마와 read/write helper를 추가한다.

최소 필드:
```json
{
  "version": 1,
  "active": true,
  "workflow": "crew-dev",
  "phase": "qa",
  "taskId": "TASK-123",
  "taskFile": ".crew/tasks/TASK-123.md",
  "activeRole": "qa",
  "pendingStatus": "needs_agent",
  "pendingAgentResultPath": ".crew/artifacts/qa-result.json",
  "artifactPaths": [".crew/artifacts/dev-result.json"],
  "agentHandles": { "dev": "thread-or-agent-id" },
  "codexThreadIds": { "dev": "thread-id" },
  "lastUpdatedAt": "2026-04-30T00:00:00.000Z"
}
```

helper 함수:
- `readRunState(crewDir)` — current-run.json을 읽어 반환 (없으면 null)
- `writeRunState(crewDir, state)` — state를 current-run.json에 atomic write (immutable — 새 객체 반환)
- `createCheckpoint(crewDir)` — current-run.json을 `.crew/state/checkpoints/checkpoint-<ISO timestamp>.json`에 복사
- `getLatestCheckpoint(crewDir)` — 최신 checkpoint 파일 경로 반환 (없으면 null)

### 2. PreCompact hook (`scripts/crew-pre-compact.mjs`)

hooks/hooks.json에 PreCompact hook을 추가한다.

```json
{
  "type": "command",
  "command": "node \"$CLAUDE_PLUGIN_ROOT/scripts/crew-pre-compact.mjs\"",
  "timeout": 10
}
```

스크립트 동작:
- hook stdin JSON 파싱
- current run state 읽기 (없으면 빈 systemMessage 반환)
- `.crew/state/checkpoints/checkpoint-<timestamp>.json` 저장
- compact 이후 보존할 요약 systemMessage 반환

systemMessage 형식:
```markdown
# Crew PreCompact Checkpoint

Workflow: crew-dev
Phase: qa
Task: .crew/tasks/TASK-123.md
Active role: qa
Pending: qa verification
Artifacts:
- .crew/artifacts/dev-result.json
Resume handles:
- dev: thread-or-agent-id

After compaction, inspect the checkpoint and continue from the pending phase unless the user's newest request overrides it.
```

### 3. Stop context guard (`scripts/crew-context-guard-stop.mjs`)

hooks/hooks.json에 Stop hook을 추가한다.

```json
{
  "type": "command",
  "command": "node \"$CLAUDE_PLUGIN_ROOT/scripts/crew-context-guard-stop.mjs\"",
  "timeout": 5
}
```

스크립트 동작:
- stdin에서 stop_hook_input JSON 파싱
- transcript tail에서 context_window, input_tokens 추정
- 75% 이상이면 `/compact` 실행을 요구하는 systemMessage와 함께 `{ "decision": "block" }` 반환
- 다음은 절대 block하지 않음:
  - context_limit, context_window, context_full, max_tokens, conversation_too_long 등의 stop reason
  - user abort/cancel/interrupt
  - auth error
- session별 block 횟수 제한 (최대 2회). 임시 파일로 카운트 관리 (`/tmp/crew-stop-guard-{session-id}.json`)
- 95% 이상 critical 구간도 block하지 않음

### 4. SessionStart restore (`scripts/crew-session-restore.mjs`)

기존 SessionStart hook에 restore 스크립트를 추가한다.

스크립트 동작:
- `.crew/state/current-run.json` 또는 최신 checkpoint 읽기
- active run이 있으면 restore context systemMessage 반환
- 없으면 빈 응답

restore message 형식:
```markdown
<crew-session-restore>
Active crew workflow detected.

Workflow: crew-dev
Phase: qa
Task: .crew/tasks/TASK-123.md
Pending: qa verification
Last artifact: .crew/artifacts/dev-result.json
Checkpoint: .crew/state/checkpoints/checkpoint-2026-04-30T00-00-00.json

Treat this as prior-session context. Prioritize the user's newest request. Resume the crew workflow only if the user asks to continue.
</crew-session-restore>
```

### 5. hooks/hooks.json 연결

기존 hooks.json에 PreCompact, Stop, SessionStart restore 항목을 추가한다.

### 6. 기존 resume 규약 재사용

Checkpoint에 기존 runner가 필요로 하는 값을 보존:
- Codex: agent_handle / thread id, previous AgentResult path, followup input path, role
- Claude: sub-agent handle, previous result, followup prompt 생성 입력

복구 시 기존 `render-followup` / `dispatch --resume-handle` 재사용.

### 7. 테스트 추가

- checkpoint 생성 테스트
- context guard block 테스트
- context_limit bypass 테스트
- restore message 생성 테스트
- run state read/write 테스트

## 파일 구조

plugin 자체 데이터이므로 `import.meta.url` 또는 `$CLAUDE_PLUGIN_ROOT` 기반 경로 사용.
사용자 데이터(`.crew/state/`)는 cwd 기준.

## 참고

- 유저 대신 `/compact`를 자동 실행하지 않음
- OMC 전체 구조를 복제하지 않음
- 기존 provider dispatch/resume 규약을 새로 설계하지 않음
