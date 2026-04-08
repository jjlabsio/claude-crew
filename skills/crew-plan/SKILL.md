---
name: crew-plan
description: PM + TechLead + Planner + PlanEvaluator 계획 파이프라인 — contract.md를 생성한다
---

## 역할

오케스트레이터로부터 task-id, brief, 의도 유형(유저 가치/엔지니어링)을 받아 `contract.md`를 생성한다.
`contract.md`가 생성되어야 crew-dev가 시작할 수 있다.

에이전트 간 소통은 파일을 통해서만 이루어진다. 에이전트의 추론 과정은 다른 에이전트에게 전달되지 않는다.

---

## 절대 금지

- 코드를 작성하지 않는다.
- PlanEvaluator가 FAIL을 냈을 때 합리화하여 통과시키지 않는다.
- brief.md를 Planner, PlanEvaluator에게 전달하지 않는다 (유저 가치 유형 시).
- 오케스트레이터가 요구사항을 판단하거나 보완하지 않는다.

---

## 파일 구조

```
.crew/plans/{task-id}/
  brief.md          # 오케스트레이터: 유저 원본 요청
  spec.md           # PM: 수용 기준, 스코프 (유저 가치 유형만)
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

### Step 1 — brief.md 작성 (오케스트레이터 직접)

`.crew/plans/{task-id}/brief.md`를 작성한다.

- 유저 요청 원문 + 관련 컨텍스트만 기록한다.
- 요구사항 판단/보완/해석 금지. 원문 그대로.

**게이트**: brief.md 작성 완료 후 파일이 존재하고 비어 있지 않음을 확인한다.
실패 시 즉시 에스컬레이션:

```
brief.md가 없거나 비어 있습니다. 계획 파이프라인을 시작할 수 없습니다.
[1] brief.md를 직접 작성하여 재시도
[2] 이 태스크를 보류
```

---

### Step 2 — PM 에이전트 실행 (유저 가치 유형만)

**모델**: opus
**건너뛰기 조건**: 엔지니어링 유형이면 이 단계를 건너뛴다.

에이전트 호출 시 반드시 `subagent_type: "pm"`을 지정한다.

에이전트 프롬프트:

```
당신은 PM 에이전트다. 유저와 직접 대화하여 요구사항을 확정한다.

## 입력
.crew/plans/{task-id}/brief.md 를 읽어라.

## 출력
.crew/plans/{task-id}/spec.md 를 작성하라.

spec.md 필수 섹션: 목표, 스코프 경계(In/Out), 수용 기준(3-7개, 테스트 가능한 구체적 행동), 전제 조건, 미결사항.

## 규칙
- 정보가 부족하면 AskUserQuestion으로 유저에게 직접 질문하라.
- 추측으로 빈칸을 채우지 않는다.
- 수용 기준에 모호한 표현("잘 작동한다", "빠르다") 금지.
- 스코프가 "하루 작업"을 초과하면 분리를 권고하라.
```

**실패 조건**: spec.md가 없거나 수용 기준이 비어 있으면 즉시 에스컬레이션.

```
PM 에이전트가 요구사항 정의에 실패했습니다.
[1] brief.md를 보완하여 재시도
[2] spec.md를 직접 작성
[3] 이 태스크를 보류
```

---

### Step 3 — TechLead 에이전트 실행

**모델**: opus
**실행 조건**: 항상 (양쪽 유형 모두)

에이전트 호출 시 반드시 `subagent_type: "techlead"`를 지정한다.

에이전트 프롬프트:

```
당신은 TechLead 에이전트다. 사전 분석을 수행하고 아키텍처 방향을 판단한다.

## 입력
{유저 가치 유형}: .crew/plans/{task-id}/spec.md 를 읽어라.
{엔지니어링 유형}: .crew/plans/{task-id}/brief.md 를 읽어라.

## 서브에이전트 호출
- Explorer (Haiku): 코드베이스 탐색. 항상 호출. 병렬 2-3개로 호출하라.
  Agent(description="코드베이스 탐색", model="haiku", prompt="...")
- Researcher (Sonnet): 외부 리서치. 필요시만 호출.
  Agent(description="외부 리서치", model="sonnet", prompt="...")

## 출력
.crew/plans/{task-id}/analysis.md 를 작성하라.

analysis.md 필수 섹션: 요구사항 보완, 코드베이스 맥락(관련 파일/기존 패턴/테스트 구조), 아키텍처 방향(권장+대안), 엣지 케이스/리스크, 가드레일(Must/Must NOT), 외부 리서치(해당 시).

## 규칙
- 요구사항에 빈틈이 있으면 AskUserQuestion으로 유저에게 직접 질문하라.
- 탐색(양)은 서브에이전트에게, 판단(질)은 직접.
```

**실패 조건**: analysis.md가 없거나 가드레일 섹션이 비어 있으면 즉시 에스컬레이션.

---

### Step 4 — Planner 에이전트 실행

**모델**: opus

에이전트 호출 시 반드시 `subagent_type: "planner"`를 지정한다.

**첫 번째 실행 시 에이전트 프롬프트**:

```
당신은 Planner 에이전트다. 구현 계획을 작성한다.

## 입력
.crew/plans/{task-id}/analysis.md 를 읽어라.
{유저 가치 유형 시}: .crew/plans/{task-id}/spec.md 도 읽어라.
brief.md는 읽지 않는다.

## 출력
.crew/plans/{task-id}/plan.md 를 작성하라.

plan.md 필수 구조: 유저 스토리(US-N) 단위. 각 유저 스토리에 구현 태스크 + 테스트 시나리오(최소 2개: 정상+에러). 위험 요소 섹션. 검증 시나리오 섹션(조건/행위/기대 결과 — contract.md에 그대로 포함됨).

## 규칙
- 코드를 작성하지 않는다.
- analysis.md의 아키텍처 방향과 가드레일을 따른다.
- 태스크 하나가 4시간 초과 시 분해한다.
- "나중에 결정" 금지. 모르면 위험 요소에 기록.
- 필요시 Explorer 서브에이전트를 호출할 수 있다.
```

**retry 시 에이전트 프롬프트**:

```
이번은 이전 계획이 리뷰에서 FAIL을 받은 후 재작성하는 것이다.

## 입력
.crew/plans/{task-id}/analysis.md 를 읽어라.
{유저 가치 유형 시}: .crew/plans/{task-id}/spec.md 도 읽어라.
.crew/plans/{task-id}/review-{n}.md 를 읽어라.
brief.md는 읽지 않는다.

## 필수 선행 작업
review-{n}.md를 먼저 읽어라. 이전 plan이 왜 FAIL을 받았는지 확인하고, 지적된 항목을 명시적으로 수정하라.

## 출력
.crew/plans/{task-id}/plan.md 를 새로 작성하라.
plan.md 최상단에 "이전 피드백 반영" 섹션을 추가한다.

## 규칙
- analysis.md의 아키텍처 방향과 가드레일을 따른다.
- 피드백을 무시하거나 같은 내용으로 작성하지 않는다.
```

**실패 조건**: plan.md가 없거나 태스크 목록이 비어 있으면 즉시 에스컬레이션.

---

### Step 5 — PlanEvaluator 에이전트 실행

**모델**: sonnet (하드 임계값 판정에서 Opus 합리화 방지)

에이전트 호출 시 반드시 `subagent_type: "plan-evaluator"`를 지정한다.

에이전트 프롬프트:

```
당신은 PlanEvaluator 에이전트다. 계획을 검증한다.

## 입력
{유저 가치 유형}: .crew/plans/{task-id}/spec.md + .crew/plans/{task-id}/analysis.md + .crew/plans/{task-id}/plan.md
{엔지니어링 유형}: .crew/plans/{task-id}/brief.md + .crew/plans/{task-id}/analysis.md + .crew/plans/{task-id}/plan.md
이 파일만 읽는다. 유저 가치 유형에서 brief.md는 읽지 않는다.

## 검증 항목 (하드 임계값)
아래 각 항목에 YES 또는 NO로만 답한다. 부분 점수 없음.

[ ] E1. 검증 시나리오 완성도 — 모든 태스크에 검증 방법이 명시되어 있는가?
[ ] E2. 요구사항 정합성 — 수용 기준이 전부 태스크로 커버되는가?
[ ] E3. 코드 참조 사실 여부 — 언급한 파일/모듈이 존재하는가? (Explorer 서브에이전트 호출)
[ ] E4. 실행 가능성 — 구현자가 바로 시작할 수 있는 수준인가?

## 판정 규칙
- 4개 항목 모두 YES → PASS
- 하나라도 NO → FAIL
- "아마 의도했을 것"이라고 추측하지 않는다. 모호하면 NO.

## FAIL 시 근본 원인 분류 (필수)
- spec 결함 (수용 기준 자체가 문제) → 오케스트레이터에 알린다
- plan 결함 (계획 구성/표현 문제) → Planner 재시도 가능

## E3 코드 참조 확인
Explorer 서브에이전트를 호출하여 plan.md에서 참조하는 파일/모듈이 존재하는지 확인하라.
Agent(description="코드 참조 확인", model="haiku", prompt="plan.md에서 참조하는 다음 파일/모듈이 존재하는지 확인하라: {파일 목록}")

## 출력
.crew/plans/{task-id}/review.md 를 작성하라.
review.md 형식: 판정(PASS/FAIL), 항목별 결과(E1-E4 YES/NO + 근거), FAIL 상세(NO 항목의 문제+수정 방향), 근본 원인 분류(FAIL 시).
```

---

### Step 6 — PASS 처리

PlanEvaluator PASS이면:

**6a. review.md 확인**

review.md가 정상적으로 작성되었고 판정이 PASS임을 확인한다.

**6b. contract.md 작성 (오케스트레이터 직접)**

```markdown
# 스프린트 계약: {task-id}

생성일: {date}
유형: {유저 가치 | 엔지니어링}

## 목표
{spec.md 또는 brief.md에서 추출한 한 문장}

## 수용 기준
- [ ] {spec.md의 수용 기준을 그대로 복사 (유저 가치) 또는 brief.md에서 도출 (엔지니어링)}

## 가드레일
### Must
- {analysis.md에서 추출}

### Must NOT
- {analysis.md에서 추출}

## 검증 시나리오
{plan.md의 검증 시나리오 섹션을 그대로 복사}

### {시나리오 1 제목}
- 조건: {사전 상태}
- 행위: {실행할 것}
- 기대 결과: {검증할 것}

## 참조 문서
- 사전 분석: .crew/plans/{task-id}/analysis.md
- 구현 계획: .crew/plans/{task-id}/plan.md

## 검증 이력
PlanEvaluator PASS — review.md 참조

## 상태
ACTIVE
```

**6c. .loop_count 정리**

`.loop_count` 파일이 존재하면 삭제한다.

**6d. 완료 반환**

```
상태: COMPLETE
task-id: {task-id}
contract.md 경로: .crew/plans/{task-id}/contract.md
```

---

### Step 7 — FAIL 처리 (피드백 보존 루프)

PlanEvaluator FAIL이면:

**7a. FAIL 원인 분류**

PlanEvaluator가 review.md에 기록한 근본 원인 분류를 확인한다.

- **spec 결함** (수용 기준 자체가 문제):
  - Planner를 재시도해도 고칠 수 없다.
  - 즉시 에스컬레이션:

```
PlanEvaluator가 spec 결함을 이유로 FAIL을 냈습니다.
Planner 재시도로는 해결할 수 없습니다.
[1] PM 에이전트를 재실행하여 spec.md를 재작성
[2] spec.md를 직접 수정
[3] 이 태스크를 보류
```

- **plan 결함** (계획 구성/표현 문제):
  - 피드백 보존 루프를 진행한다.

**7b. 루프 카운터 읽기**

`.crew/plans/{task-id}/.loop_count` 파일을 읽는다.
- 파일이 없으면 카운터 = 0 (첫 번째 FAIL)
- 파일이 있으면 파일 내용(정수)이 카운터 값

**7c. 에스컬레이션 판단**

카운터 값 >= 4이면 즉시 에스컬레이션:

```
계획 파이프라인이 5회 반복 후에도 수렴하지 않았습니다.
현재 review.md의 FAIL 사유를 첨부합니다.
[1] 스코프를 좁혀서 재시도
[2] 수용 기준을 직접 수정
[3] 이 태스크를 보류
```

에스컬레이션 시 `.loop_count` 파일을 삭제한다.

**7d. 피드백 아카이브**

`n = 카운터 + 1` (이번 회차 번호)

```
plan.md → plan-{n}.md 로 이름 변경
review.md → review-{n}.md 로 이름 변경
```

**7e. 루프 카운터 증가 저장**

`카운터 + 1`을 `.loop_count` 파일에 저장한다.

**7f. Step 4로 돌아감 (retry)**

Step 4(Planner)로 돌아간다. retry 프롬프트의 `{n}`에 Step 7d에서 계산한 값을 대입한다.
TechLead는 재실행하지 않는다 — 기술적 사실은 변하지 않으므로 analysis.md를 재사용한다.

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

## 에이전트 호출 컨텍스트 규칙

| 에이전트 | subagent_type | 모델 | 주입할 파일 | 차단할 파일 |
|----------|--------------|------|------------|------------|
| PM | pm | opus | brief.md | — |
| TechLead | techlead | opus | spec.md (유저 가치) 또는 brief.md (엔지니어링) | — |
| Planner (첫 번째) | planner | opus | spec.md (유저 가치 시) + analysis.md | brief.md |
| Planner (retry) | planner | opus | spec.md (유저 가치 시) + analysis.md + review-{n}.md | brief.md |
| PlanEvaluator | plan-evaluator | sonnet | spec.md/brief.md + analysis.md + plan.md | brief.md (유저 가치 시) |

**중요**: 모든 에이전트 호출 시 반드시 `subagent_type` 파라미터를 지정해야 한다. HUD에서 에이전트 타입을 식별하는 데 사용된다.

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
  "phase": "brief-gate" | "pm-fail" | "techlead-fail" | "planner-fail" | "evaluator-spec-defect" | "loop-overflow",
  "reason": "자유형 텍스트"
}
```
