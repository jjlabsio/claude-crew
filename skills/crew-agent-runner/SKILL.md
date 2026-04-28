---
name: crew-agent-runner
description: 모든 crew 에이전트 dispatch의 중앙 규약 — provider별 호출법 캡슐화
---

# crew-agent-runner

crew 업무 스킬은 에이전트 provider별 호출 세부사항을 직접 구현하지 않고 이 중앙 규약을 따른다. 본 스킬은 resolve, dispatch, resume, followup 주입, retry/fallback/escalate 판단의 공통 표면을 정의한다.

설치 후 drift 차단용 pre-commit hook은 `node scripts/crew-agent-runner.mjs install-hooks`로 설치한다.

## Dispatch 절차

업무 스킬(crew-plan/crew-interview/crew-dev)이 role을 실행해야 할 때 본 절차를 따른다.

### 1. resolve

오케스트레이터는 먼저 `node scripts/crew-agent-runner.mjs resolve --role <role> --json`을 실행하여 provider/model/contract 통합 표를 받는다.

### 2. request 객체 작성

`{ role, inputs (path+content), instruction, successGate, failureHandling, taskId }` 형태의 임시 JSON 파일을 작성한다.

### 3a. Codex 경로

`provider == codex`이면 `node scripts/crew-agent-runner.mjs dispatch --role <role> --request-file <path> --json`을 실행한다. 이 명령은 AgentResult JSON을 즉시 반환한다.

### 3b. Claude 경로

`provider == claude`이면 다음 순서로 실행한다.

1. `node scripts/crew-agent-runner.mjs render --role <role> --request-file <path>`를 실행하여 prompt 문자열을 받는다.
2. 메인 오케스트레이터(Claude conversation)가 `Agent(subagent_type=<role>, model=<model>, prompt=<rendered>)`를 호출한다.
3. sub-agent 결과를 AgentResult JSON 형식으로 정규화한다.

## AgentResult 상태 처리

AgentResult 5상태:

### complete

`artifact`를 `outputs.target`에 저장한다. 이후 다음 phase로 진행한다.

### blocked_on_user

`questions`를 메인 오케스트레이터의 사용자 질문 도구로 사용자에게 전달한다. 답변 수신 후 followup을 주입한다. 절차는 아래 Resume 섹션을 따른다.

### needs_agent

`requests`의 `role`을 새 dispatch 사이클로 실행한다. 결과를 followup으로 원래 에이전트에 주입한다.

### needs_tool

capability를 넘어선 도구 요청이다. 오케스트레이터가 `contract.policy`에 따라 직접 도구 실행 후 결과를 주입하거나, 실행할 수 없으면 `failed`로 escalate한다.

### failed

`contract.policy`의 `maxAttempts`, `fallbackProvider`, `escalateAfterAttempts`, `consecutiveSameFailureLimit`에 따라 처리한다.

- retry: `maxAttempts` 미만이면 재시도한다.
- fallbackProvider 전환: fallback provider가 있으면 provider를 전환한다.
- 사용자 escalate: 한도에 도달했거나 같은 사유가 반복되면 사용자에게 에스컬레이션한다.

## Resume

`needs_agent` / `blocked_on_user` 상태에서 같은 sub-agent context를 이어가는 표준 절차.

### Codex 경로

1. `node scripts/crew-agent-runner.mjs render-followup --previous-result <file> --new-input <file>` 실행 → followup prompt 문자열 → 임시 파일에 저장.
2. `node scripts/crew-agent-runner.mjs dispatch --role <role> --request-file <new-request-with-followup-prompt> --resume-handle <agent_handle> --json` 실행.
   - 내부적으로 runner가 `crew-codex-companion.mjs task-resume-candidate`로 thread 일치 검증 후 `task --resume-last`를 호출하고 AgentResult를 정규화한다.
3. AgentResult JSON을 받아 다음 상태 처리.

주의: 직접 `crew-codex-companion.mjs task --resume-last`를 호출하지 말 것. runner의 candidate guard와 AgentResult 정규화를 건너뛴다.

### Claude 경로

1. `Agent` spawn으로 받은 sub-agent handle을 보존한다.
2. `render-followup`을 사용하여 followup prompt를 생성한다.
3. 메인 conversation에서 `SendMessage(to: <agent-handle>, message: <followup-prompt>)`로 같은 sub-agent에 후속 turn을 전달한다.

## Followup 주입

Followup prompt 형식은 양 provider에서 동일하다.

```markdown
## 이전 결과
status: <status>
summary: <summary>
artifact:
---
<artifact>
---

## 추가 입력
<new-input>

## 지시
계속 진행해라.
```

이 형식은 `runner.mjs render-followup`이 결정론적으로 생성한다.

## Retry / Fallback / Escalate

`contract.policy`:

- `maxAttempts`: retry 횟수 한도
- `fallbackProvider`: `claude`/`codex` 전환
- `escalateAfterAttempts`: 한도 도달 시 사용자 escalate
- `consecutiveSameFailureLimit`: 같은 사유 연속 fail 한도
