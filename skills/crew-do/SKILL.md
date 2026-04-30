---
name: crew-do
description: 간단한 작업을 기존 Dev 에이전트 direct mode로 즉시 위임한다
---

# crew-do

간단하고 범위가 명확한 작업을 기존 `dev` 에이전트에 바로 위임한다.
정식 `crew-interview → crew-plan → crew-dev` 파이프라인을 대체하지 않고, 작은 수정/버그픽스/테스트 실패 수정/명확한 리팩터링을 빠르게 처리하는 direct lane이다.

개발 실행자는 항상 기존 `dev` role 하나만 사용한다. 별도 worker role을 만들지 않는다.

## 역할 분리

- `/task`: 기억과 queue 관리 전용. 실행 옵션을 추가하지 않는다.
- `/crew-do`: 지금 실행할 작업을 기존 `dev` 에이전트에 direct mode로 위임한다.
- `/crew-dev`: `plan.md` + `contract.md` 기반 정식 개발 파이프라인을 수행한다.

## 입력 선택

### 인자가 있는 경우

사용자가 `/crew-do "작업 설명"` 형태로 요청하면 인자 내용을 primary task로 사용한다.
현재 active task가 있으면 해당 task 파일은 보조 context로만 전달한다.

### 인자가 없는 경우

1. `.crew/tasks/`에서 `status: active`인 task를 찾는다.
2. active task가 정확히 1개이면 해당 task의 title, Context, Files, Criteria를 primary task로 사용한다.
3. active task가 없으면 사용자에게 실행할 작업을 알려달라고 요청한다.
4. active task가 여러 개이면 어떤 task를 실행할지 사용자에게 확인한다.

## Direct Mode 적합성 판단

오케스트레이터는 무거운 인터뷰를 시작하지 않고 아래 기준만 빠르게 확인한다.

direct mode로 진행 가능:
- 버그 수정
- 테스트/타입/린트 실패 수정
- 단일 기능의 작은 변경
- 문구, 스타일, 설정, 문서의 명확한 수정
- 범위가 명시된 리팩터링

정식 파이프라인 권장:
- 새 제품 기능 설계
- DB schema 또는 데이터 마이그레이션
- 결제, 권한, 보안처럼 실패 비용이 큰 변경
- 아키텍처 변경
- 요구사항이 여러 갈래로 열려 있는 작업

사용자가 direct 실행을 명시하면 우선 `dev`에 위임하되, `dev`가 위험하거나 불명확하다고 판단하면 `blocked_on_user`를 반환하게 한다.

## 실행 절차

항상 중앙 `crew-agent-runner` 스킬의 dispatch 절차를 따른다.
오케스트레이터는 provider별 호출 세부사항을 직접 구현하지 않는다.

## 공통 에이전트 실행 인터페이스

crew-do의 에이전트 실행은 항상 기존 `dev` role 하나만 사용하되, runner 인터페이스는 모든 workflow skill과 동일하게 유지한다.

1. `{ role, taskId, mode, inputs, instruction, successGate, failureHandling }` 형태의 `request-file`을 작성한다.
2. `node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" prepare --role <role> --request-file <request-file> --json`을 실행한다.
3. `action == dispatch`이면 prepare가 반환한 command를 실행하고 AgentResult를 처리한다.
4. `action == agent`이면 prepare가 반환한 `subagent_type`, `model`, `prompt`로 runner 계약의 Claude 경로를 실행하고 AgentResult로 정규화한다.

이 순서를 생략하고 직접 하위 에이전트를 호출하지 않는다.

## crew-do 세부 절차

1. run-id를 생성한다. active task 기반이면 `task-{id}`, 즉석 작업이면 `direct-{YYYYMMDD-HHMMSS}` 형식을 사용한다.
2. 필요하면 `.crew/runs/{run-id}/request.md`를 작성한다. active task 기반 실행은 task 파일 자체를 입력으로 전달하고, 즉석 작업은 request.md를 사용한다.
3. 아래 형태의 request-file을 작성한다.
4. `node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" prepare --role dev --request-file <request-file> --json`을 실행한다.
5. `action == dispatch`이면 prepare가 반환한 command를 실행하고 AgentResult를 처리한다.
6. `action == agent`이면 prepare가 반환한 `subagent_type`, `model`, `prompt`로 runner 계약의 Claude 경로를 실행하고 AgentResult로 정규화한다.

이 순서를 생략하고 직접 하위 에이전트를 호출하지 않는다.

## Dev Request

request-file은 항상 기존 `dev` role을 사용하고 `mode: direct`를 명시한다.

```json
{
  "role": "dev",
  "mode": "direct",
  "taskId": "task-012",
  "inputs": [
    {
      "path": ".crew/tasks/012.md",
      "content": "<active task file>"
    },
    {
      "path": "request.mode",
      "content": "direct"
    },
    {
      "path": "request.task",
      "content": "active task를 수행하라"
    }
  ],
  "instruction": "Direct mode로 수행하라. task 파일의 Context, Files, Criteria를 작업 계약으로 사용한다.",
  "successGate": [
    "요청된 작업이 완료되었다",
    "관련 검증 명령을 실행했다",
    "변경 파일, 검증 결과, 남은 리스크를 AgentResult artifact에 보고했다"
  ],
  "failureHandling": "요구사항이 불명확하거나 범위가 커지면 blocked_on_user를 반환한다. 실행 중 실패가 있으면 수정 후 재검증하고, 계속 진행할 수 없을 때 failed를 반환한다."
}
```

즉석 작업이면 `taskId`와 입력만 바뀐다.

```json
{
  "role": "dev",
  "mode": "direct",
  "taskId": "direct-20260430-153012",
  "inputs": [
    {
      "path": ".crew/runs/direct-20260430-153012/request.md",
      "content": "<user request>"
    },
    {
      "path": "request.mode",
      "content": "direct"
    },
    {
      "path": "request.task",
      "content": "<user request>"
    }
  ],
  "instruction": "Direct mode로 수행하라. 사용자 요청을 작은 작업 계약으로 보고 직접 탐색, 수정, 검증한다.",
  "successGate": [
    "요청된 작업이 완료되었다",
    "관련 검증 명령을 실행했다",
    "변경 파일, 검증 결과, 남은 리스크를 AgentResult artifact에 보고했다"
  ],
  "failureHandling": "요구사항이 불명확하거나 범위가 커지면 blocked_on_user를 반환한다. 실행 중 실패가 있으면 수정 후 재검증하고, 계속 진행할 수 없을 때 failed를 반환한다."
}
```

## 결과 처리

`complete`이면 오케스트레이터가 AgentResult artifact를 요약한다.

active task와 연결된 경우:
- `.crew/tasks/{id}.md`의 `## Log`에 crew-do 실행 결과를 append한다.
- task 상태는 자동으로 `done` 처리하지 않는다. 사용자가 `/task done`으로 명시적으로 완료한다.

active task가 없는 경우:
- `.crew/runs/{run-id}/result.md`에 결과를 저장한다.

dispatch가 `complete`로 완료되면 자동으로 checkpoint 커밋을 생성한다. 오케스트레이터의 후처리(result.md 저장, task log 업데이트) 후에도 커밋되지 않은 변경이 남아 있으면 `node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" checkpoint --message "chore(crew-do): {run-id} result"` 로 추가 checkpoint를 실행한다.

`blocked_on_user`이면 questions를 사용자에게 전달하고, 답변을 받은 뒤 runner의 followup 절차로 같은 dev 실행에 주입한다.

`needs_agent` 또는 `needs_tool`이면 중앙 runner 계약에 따라 오케스트레이터가 처리한다.

`failed`이면 에러, 변경 여부, 재시도 가능성을 사용자에게 보고한다.

## Direct Mode 가드레일

- 오케스트레이터가 코드를 직접 작성하지 않는다.
- `dev`는 필요한 탐색, 수정, 검증을 직접 수행한다.
- 요청 범위를 넘는 리팩터링을 하지 않는다.
- `dev` 에이전트는 의존성 추가, 마이그레이션, 대규모 삭제, commit, push, PR 생성을 하지 않는다. 완료 시 checkpoint 커밋은 오케스트레이터의 워크플로우 동작이며 별도 승인이 필요하지 않다.
- 검증 가능한 명령을 실행하고, 실행하지 못한 검증은 이유를 보고한다.
- `plan.md` 또는 `contract.md`가 없다는 이유로 direct mode를 실패 처리하지 않는다.
- 위험하거나 되돌리기 어려운 변경은 `blocked_on_user`로 중단한다.
