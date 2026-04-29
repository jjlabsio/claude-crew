---
name: crew-plan
description: TechLead + Planner + PlanEvaluator 계획 파이프라인 — contract.md를 생성한다
---

## 역할

crew-interview가 생성한 spec.md를 입력으로 받아 **HOW(어떻게 만드는가)**를 결정하고 `contract.md`를 생성한다.
`contract.md`가 생성되어야 crew-dev가 시작할 수 있다.

에이전트 간 소통은 파일 산출물과 중앙 `crew-agent-runner` 스킬의 dispatch 계약을 통해서만 이루어진다. 에이전트의 추론 과정은 다른 에이전트에게 전달되지 않는다.

---

## 절대 금지

- 코드를 작성하지 않는다.
- PlanEvaluator가 FAIL을 냈을 때 합리화하여 통과시키지 않는다.
- brief.md를 Planner, PlanEvaluator에게 전달하지 않는다.
- 오케스트레이터가 요구사항을 판단하거나 보완하지 않는다.

---

## 파일 구조

```
.crew/plans/{task-id}/
  brief.md          # crew-interview: 유저 원본 요청
  spec.md           # crew-interview: 인터뷰 완료 후 결정화된 스펙
  analysis.md       # TechLead: 사전 분석 결과
  plan.md           # Planner: 구현 계획 (항상 최신)
  review.md         # PlanEvaluator: 검증 결과 (항상 최신)
  plan-{n}.md       # 실패한 계획 아카이브
  review-{n}.md     # 실패한 리뷰 아카이브
  contract.md       # 최종 계약 (PASS 시만 생성)
  .loop_count       # 계획 루프 카운터
```

---

## 실행 순서

각 에이전트 단계는 중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다. 이 문서는 역할, 입력, 기대 산출물, 검증 기준만 정의하며 실행 방식은 runner 계약을 따른다.

## 공통 에이전트 실행 인터페이스

crew-plan의 모든 에이전트 실행은 역할이나 step과 무관하게 아래 인터페이스만 사용한다.
오케스트레이터는 `techlead`, `planner`, `plan-evaluator`, 후속 요청 role을 실행할 때마다 이 순서를 반복한다.

1. `{ role, taskId, inputs, instruction, successGate, failureHandling }` 형태의 `request-file`을 작성한다.
2. `node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" prepare --role <role> --request-file <request-file> --json`을 실행한다.
3. `action == dispatch`이면 prepare가 반환한 command를 실행하고 AgentResult를 처리한다.
4. `action == agent`이면 prepare가 반환한 `subagent_type`, `model`, `prompt`로 runner 계약의 Claude 경로를 실행하고 AgentResult로 정규화한다.

이 순서를 생략하고 직접 하위 에이전트를 호출하지 않는다.
provider 선택, 런타임 선택, AgentResult 반환 형식, 후속 입력 주입, retry/fallback/escalate 판단은 모두 중앙 runner 계약을 따른다.

### Step 1 — spec.md 검증

role: orchestrator

inputs:
- `.crew/plans/{task-id}/spec.md`

output:
- spec gate result → continue 또는 ESCALATE

role instructions:
- spec.md가 존재하고 비어 있지 않은지 확인한다.
- WHAT(무엇을 만드는가)은 spec.md에 이미 정의되어 있어야 한다.
- spec.md가 없거나 비어 있으면 crew-interview 실행, spec.md 직접 보완, 태스크 보류 중 하나를 선택하도록 에스컬레이션한다.

success gate:
- spec.md가 존재한다.
- spec.md가 비어 있지 않다.

failure handling:
- spec gate 실패 시 즉시 ESCALATE.
- retry/escalate 규칙은 contract.policy에 따른다.

---

### Step 2 — TechLead 실행

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: techlead

inputs:
- `.crew/plans/{task-id}/spec.md`

output:
- complete.artifact → `.crew/plans/{task-id}/analysis.md`

role instructions:
- 사전 분석을 수행하고 아키텍처 방향을 판단한다.
- WHAT은 이미 정의되어 있으므로 HOW에 집중한다.
- 코드베이스 맥락, 관련 파일, 기존 패턴, 테스트 구조를 확인한다.
- Explorer 역할의 탐색이 필요한 경우 runner 계약의 후속 요청 형식으로 코드베이스 탐색을 요청한다.
- 테스트 인프라 탐색은 필수다. 프레임워크 설정, 대표 테스트 파일, 커버리지 설정, 테스트 실행 스크립트를 확인한다.
- 외부 API/서비스가 관련된 경우 Researcher 역할의 조사가 필요한 항목을 분리해 요청한다.
- 외부 대상마다 문서와 인터페이스를 개별 확인하고, 확인되지 않은 대상은 "미검증 인터페이스"로 명시한다.
- 요구사항에 빈틈이 있으면 blocked user 상태로 질문과 선택지를 반환한다.
- 필수 섹션: 요구사항 보완, 코드베이스 맥락, 아키텍처 방향, 엣지 케이스/리스크, 가드레일(Must/Must NOT), 테스트 인프라, 외부 인터페이스 검증(해당 시), 외부 리서치(해당 시).

success gate:
- analysis.md 산출물이 생성될 수 있는 complete.artifact가 있다.
- 가드레일 섹션이 비어 있지 않다.
- 테스트 인프라 섹션이 프레임워크/패턴/유무를 명시한다.

failure handling:
- analysis 산출물이 없거나 가드레일이 비어 있으면 ESCALATE.
- retry/escalate 규칙은 contract.policy에 따른다.

---

### Step 2.5 — 테스트 전략 결정

role: orchestrator

inputs:
- `.crew/plans/{task-id}/analysis.md`

output:
- selected test strategy → `.crew/plans/{task-id}/analysis.md`의 `## 테스트 전략` 섹션

role instructions:
- TechLead의 테스트 인프라 섹션을 기준으로 유저에게 테스트 전략을 선택하게 한다.
- 테스트 인프라가 있으면 TDD, Tests-after, None 중 하나를 선택하게 한다.
- 테스트 인프라가 없고 TDD 또는 Tests-after를 선택하면 vitest, jest, bun test, pytest, 기타 중 하나를 선택하게 한다.
- 선택 결과를 analysis.md 하단의 `## 테스트 전략` 섹션으로 기록한다.

success gate:
- 결정 값이 TDD, Tests-after, None 중 하나다.
- 프레임워크 값이 기존 감지 결과 또는 유저 선택으로 명시된다.
- 인프라 셋업 필요 여부가 YES 또는 NO로 명시된다.

failure handling:
- 유저 선택이 없으면 blocked user 상태로 보류한다.
- retry/escalate 규칙은 contract.policy에 따른다.

---

### Step 3 — Planner 실행

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: planner

inputs:
- `.crew/plans/{task-id}/spec.md`
- `.crew/plans/{task-id}/analysis.md`
- retry 시 `.crew/plans/{task-id}/review-{n}.md`

output:
- complete.artifact → `.crew/plans/{task-id}/plan.md`

role instructions:
- 구현 계획을 유저 스토리(US-N) 단위로 작성한다.
- brief.md는 입력으로 사용하지 않는다.
- 각 유저 스토리에 구현 태스크와 테스트 시나리오를 포함한다. 테스트 시나리오는 최소 정상 1개와 에러 1개를 포함한다.
- 위험 요소 섹션, 검증 시나리오 섹션, 실행 검증 섹션을 포함한다.
- plan.md 최상단에 `## 테스트 전략` 섹션을 두고 analysis.md의 결정을 반영한다.
- TDD인 경우 각 구현 태스크를 RED, GREEN, REFACTOR 순서로 구성하고 테스트 파일 경로와 테스트 실행 결과 기준을 명시한다.
- Tests-after인 경우 구현 태스크 뒤에 별도 테스트 작성 태스크를 추가하고 테스트 파일 경로와 테스트 실행 결과 기준을 명시한다.
- None인 경우 자동화 테스트 태스크 없이 검증 시나리오와 실행 검증을 유지한다.
- 테스트 인프라 셋업이 필요하면 첫 번째 태스크로 테스트 인프라 셋업을 추가한다.
- 외부 인터페이스 검증 섹션에 미검증 대상이 있으면 구현 태스크 앞에 스파이크 태스크를 배치한다.
- 실행 검증은 사용자 관점에서 실제 기능을 동작시키는 절차여야 하며, 테스트 파일 실행만으로 대체하지 않는다.
- retry 시 review-{n}.md의 FAIL 사유를 먼저 반영하고, 최상단에 이전 피드백 반영 섹션을 추가한다.
- 코드를 작성하지 않는다.
- analysis.md의 아키텍처 방향과 가드레일을 따른다.
- spec.md에 없는 비즈니스 결정을 추가하지 않는다.
- 태스크 하나가 4시간을 초과하면 분해한다.
- "나중에 결정"을 쓰지 않는다. 모르면 위험 요소에 기록한다.

success gate:
- plan.md 산출물이 생성될 수 있는 complete.artifact가 있다.
- 유저 스토리 단위 태스크 목록이 비어 있지 않다.
- `## 테스트 전략`, 위험 요소, 검증 시나리오, 실행 검증 섹션이 있다.
- 선택된 테스트 전략과 태스크 구조가 일치한다.

failure handling:
- plan 산출물이 없거나 태스크 목록이 비어 있으면 ESCALATE.
- PlanEvaluator FAIL 이후에는 Step 6의 피드백 보존 루프를 따른다.
- retry/escalate 규칙은 contract.policy에 따른다.

---

### Step 4 — PlanEvaluator 실행

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: plan-evaluator

inputs:
- `.crew/plans/{task-id}/spec.md`
- `.crew/plans/{task-id}/analysis.md`
- `.crew/plans/{task-id}/plan.md`

output:
- complete.artifact → `.crew/plans/{task-id}/review.md`

role instructions:
- 계획을 검증하고 PASS 또는 FAIL을 판정한다.
- brief.md는 입력으로 사용하지 않는다.
- 아래 8개 항목을 YES 또는 NO로만 판정한다. 부분 점수는 없다.
- E1. 검증 시나리오 완성도: 모든 태스크에 검증 방법이 명시되어 있는가?
- E2. spec 전체 커버리지: spec.md의 수용 기준, 유저 플로우, UI 구조, 비즈니스 규칙이 전부 태스크로 커버되는가?
- E3. 코드 참조 사실 여부: 언급한 파일/모듈이 존재하는가?
- E4. 실행 가능성: 구현자가 바로 시작할 수 있는 수준인가?
- E5. 테스트 전략 정합성: analysis.md의 테스트 전략 결정과 plan.md의 태스크 구조가 일치하는가?
- E6. 비즈니스 가정 0개: plan.md가 spec.md에 없는 비즈니스 로직을 임의로 추가하지 않았는가?
- E7. 실행 검증 포함: 실제 기능을 사용자 관점에서 동작시키는 구체 절차가 있는가?
- E8. 외부 인터페이스 가정 검증: 미검증 외부 대상에 대한 검증 상태와 스파이크 태스크가 있는가?
- 8개 항목 모두 YES이면 PASS, 하나라도 NO이면 FAIL이다.
- 모호하면 NO로 판정한다.
- FAIL 시 근본 원인을 spec 결함 또는 plan 결함으로 분류한다.
- 출력 형식: 판정(PASS/FAIL), 항목별 결과(E1-E8 YES/NO + 근거), FAIL 상세, 근본 원인 분류(FAIL 시).

success gate:
- review.md 산출물이 생성될 수 있는 complete.artifact가 있다.
- 판정이 PASS 또는 FAIL로 명시된다.
- E1-E8의 YES/NO와 근거가 모두 포함된다.
- FAIL이면 근본 원인 분류가 포함된다.

failure handling:
- review 산출물이 없거나 판정이 없으면 ESCALATE.
- FAIL이면 Step 6의 피드백 보존 루프를 따른다.
- retry/escalate 규칙은 contract.policy에 따른다.

---

### Step 5 — PASS 처리

role: orchestrator

inputs:
- `.crew/plans/{task-id}/spec.md`
- `.crew/plans/{task-id}/analysis.md`
- `.crew/plans/{task-id}/plan.md`
- `.crew/plans/{task-id}/review.md`

output:
- contract artifact → `.crew/plans/{task-id}/contract.md`
- COMPLETE response

role instructions:
- review.md의 판정이 PASS인지 확인한다.
- contract.md에는 목표, 수용 기준, 유저 플로우, UI 구조 및 주요 콘텐츠, 비즈니스 규칙, 가드레일, 테스트 전략, 검증 시나리오, 실행 검증, 참조 문서, 검증 이력, 워크트리, 상태를 포함한다.
- 목표와 수용 기준은 spec.md의 내용을 기준으로 한다.
- 가드레일은 analysis.md의 Must/Must NOT을 기준으로 한다.
- 검증 시나리오와 실행 검증은 plan.md의 해당 섹션을 기준으로 한다.
- 상태는 ACTIVE로 둔다.
- `.loop_count`가 있으면 정리한다.

success gate:
- review.md 판정이 PASS다.
- contract.md 산출물이 생성된다.
- contract.md 상태가 ACTIVE다.

failure handling:
- PASS 확인 또는 contract 생성에 실패하면 ESCALATE.
- retry/escalate 규칙은 contract.policy에 따른다.

완료 반환:

```json
{
  "status": "COMPLETE",
  "task_id": "{task-id}",
  "contract_path": ".crew/plans/{task-id}/contract.md"
}
```

---

### Step 6 — FAIL 처리

role: orchestrator

inputs:
- `.crew/plans/{task-id}/plan.md`
- `.crew/plans/{task-id}/review.md`
- `.crew/plans/{task-id}/.loop_count`

output:
- archived feedback → `.crew/plans/{task-id}/plan-{n}.md`, `.crew/plans/{task-id}/review-{n}.md`
- updated loop counter → `.crew/plans/{task-id}/.loop_count`
- retry route → Step 3
- 또는 ESCALATE response

role instructions:
- PlanEvaluator가 기록한 근본 원인 분류를 확인한다.
- spec 결함이면 Planner 재시도로 해결할 수 없으므로 즉시 에스컬레이션한다.
- plan 결함이면 피드백 보존 루프를 진행한다.
- 루프 카운터가 없으면 0으로 본다.
- 루프 카운터가 4 이상이면 5회 반복 후 미수렴으로 에스컬레이션하고 카운터를 정리한다.
- 이번 회차 번호 n은 카운터 + 1이다.
- 현재 plan.md와 review.md를 각각 plan-{n}.md, review-{n}.md로 보존한다.
- 카운터를 n으로 갱신한다.
- TechLead는 재실행하지 않고 Step 3 retry로 돌아간다.

success gate:
- spec 결함이면 ESCALATE가 반환된다.
- plan 결함이고 카운터가 4 미만이면 실패 계획과 리뷰가 보존된다.
- retry에 사용할 review-{n}.md가 존재한다.

failure handling:
- 아카이브 또는 카운터 갱신에 실패하면 ESCALATE.
- retry/escalate 규칙은 contract.policy에 따른다.

---

## 루프 카운터 (.loop_count) 생명주기

| 이벤트 | 동작 |
|--------|------|
| 첫 번째 진입 | 파일 없음 (카운터 = 0) |
| 첫 번째 FAIL 처리 후 | 파일 생성, 내용: `1` |
| n번째 FAIL 처리 후 | 파일 갱신, 내용: `n` |
| PASS | 파일 삭제 |
| 에스컬레이션 | 파일 삭제 |

Planner + PlanEvaluator 사이클은 최대 5회 (초기 1회 + retry 최대 4회).

---

## 에이전트 실행 컨텍스트 규칙

중앙 `crew-agent-runner` 스킬의 dispatch 절차를 단일 실행 경로로 사용한다. crew-plan은 실행 방식, 런타임 선택, 후속 요청 처리, 사용자 질문 처리의 세부 절차를 정의하지 않는다.

| 단계 | role | 입력 | 차단할 입력 | 기대 산출물 |
|------|------|------|-------------|-------------|
| Step 2 | techlead | spec.md | — | analysis.md |
| Step 3 | planner | spec.md + analysis.md | brief.md | plan.md |
| Step 3 retry | planner | spec.md + analysis.md + review-{n}.md | brief.md | plan.md |
| Step 4 | plan-evaluator | spec.md + analysis.md + plan.md | brief.md | review.md |

후속 탐색, 외부 조사, 사용자 질문, 재개 흐름은 runner가 정의한 상태 처리와 followup 계약을 따른다. 각 역할은 complete 상태의 artifact로 산출물 본문을 반환해야 한다.

---

## 오케스트레이터 반환 스키마

**COMPLETE**:
```json
{
  "status": "COMPLETE",
  "task_id": "{task-id}",
  "contract_path": ".crew/plans/{task-id}/contract.md"
}
```

**ESCALATE**:
```json
{
  "status": "ESCALATE",
  "phase": "spec-gate | techlead-fail | planner-fail | evaluator-spec-defect | loop-overflow",
  "reason": "자유형 텍스트"
}
```
