---
name: crew-plan
description: PM + Planner + Architect + Critic 계획 파이프라인 — 코드 작성 전 "무엇을 만들고 어떻게 검증할지"를 파일로 확정한다
---

## 역할

오케스트레이터로부터 task-id와 brief를 받아 `contract.md`를 생성한다.
`contract.md`가 생성되어야 Dev 에이전트가 시작할 수 있다. 이 파일이 없으면 Dev/QA를 시작하지 않는다.

네 에이전트(PM, Planner, Architect, Critic)는 파일을 통해서만 소통한다.
Architect와 Critic은 Plan을 만든 에이전트의 추론 과정을 보지 않는다.

리뷰는 2단계로 진행된다:
1. **Architect** — 코드 현실 검증: plan.md가 참조하는 파일/함수/패턴이 실제 코드와 일치하는지 확인
2. **Critic** — 계획 품질 평가: plan.md가 spec.md의 요구사항을 빠짐없이, 구체적으로, 실현 가능하게 다루는지 확인

두 리뷰어는 순차 실행한다 (Architect 먼저, Critic 다음). Architect가 FAIL이면 Critic을 실행하지 않는다.

---

## 절대 금지

- 코드를 작성하지 않는다.
- Architect 또는 Critic이 FAIL을 냈을 때 합리화하여 통과시키지 않는다.
- brief.md를 Architect 또는 Critic에게 전달하지 않는다.
- 오케스트레이터가 요구사항을 판단하거나 보완하지 않는다. brief.md에는 유저 원문과 컨텍스트만 기록한다.
- Critic 체크리스트 C1-C2(spec.md 결함)가 FAIL 원인이면 Planner를 재시도시키지 않는다. spec.md를 고칠 수 없으므로 즉시 에스컬레이션한다.

---

## 파일 구조

```
.crew/plans/{task-id}/
  brief.md          # 오케스트레이터 작성: 유저 요청 원문 + 컨텍스트
  spec.md           # PM 에이전트 출력: 요구사항 + 수용 기준
  plan.md           # Planner 에이전트 출력: 구현 계획 (항상 최신)
  review.md         # 리뷰 결과 (항상 최신 — Architect + Critic 결합)
  plan-1.md         # 1회차 FAIL plan 아카이브 (1회차 실패 시 생성)
  review-1.md       # 1회차 FAIL review 아카이브 (1회차 실패 시 생성)
  plan-2.md         # 2회차 FAIL plan 아카이브 (2회차 실패 시 생성)
  review-2.md       # 2회차 FAIL review 아카이브 (2회차 실패 시 생성)
  contract.md       # 최종 합의 산출물 (PASS 시에만 생성)
  .loop_count       # 루프 카운터 파일 (숫자 하나, Phase 2-4 루프 관리)
```

---

## 실행 순서

### Step 1 — brief.md 작성 (오케스트레이터 직접)

`.crew/plans/{task-id}/brief.md`를 작성한다.

- 유저 요청 원문 + 관련 컨텍스트만 기록한다.
- 요구사항 판단·보완·해석 금지. 원문 그대로.

**Pre-Step 1 게이트**: brief.md 작성 완료 후 파일이 존재하고 비어 있지 않음을 확인한다.  
실패 시 즉시 에스컬레이션:

```
brief.md가 없거나 비어 있습니다. 계획 파이프라인을 시작할 수 없습니다.
[1] brief.md를 직접 작성하여 재시도하십시오
[2] 오케스트레이터 설정을 확인하십시오
[3] 이 태스크를 보류하십시오
```

---

### Step 2 — PM 에이전트 실행 (Phase 1)

**모델**: opus  
**입력**: `brief.md`  
**출력**: `spec.md`

**에이전트 프롬프트**:

```
당신은 PM 에이전트다. 1인 SaaS 개발자의 요청을 받아 요구사항을 확정한다.

## 입력
.crew/plans/{task-id}/brief.md 를 읽어라.

## 출력
.crew/plans/{task-id}/spec.md 를 작성하라.

## spec.md 필수 섹션

### 목표
한 문장으로: 이 기능이 해결하는 문제.

### 스코프 경계
- In: 반드시 구현되어야 하는 것
- Out: 이번에 구현하지 않는 것 (명시적으로 제외)

### 수용 기준
체크리스트 형식. 각 항목은 테스트 가능한 구체적 행동으로 서술한다.
모호한 표현("잘 작동한다", "빠르다") 금지.
최소 3개, 최대 7개.

### 전제 조건
이 태스크가 시작되기 전에 완료되어야 하는 것.

### 미결사항
정보 부족으로 확정하지 못한 항목. (없으면 "없음"이라고 명시)

## 규칙
- 인터랙티브 모드: 정보가 부족하면 AskUserQuestion 도구로 유저에게 직접 질문하라. 답변을 받은 후 spec.md를 작성하라.
- 비인터랙티브 모드: 정보가 부족하면 '미결사항' 섹션에 기록하고 Phase 1 실패 에스컬레이션을 트리거하라.
- 추측으로 빈칸을 채우지 않는다.
- 스코프 크기가 "하루 작업"을 초과하면 분리를 권고하라.
```

**Phase 1 실패 조건**: spec.md를 작성하지 못했거나, 수용 기준이 비어 있으면 즉시 에스컬레이션. 재시도 없음.

```
PM 에이전트가 요구사항 정의에 실패했습니다.
현재 brief.md의 내용과 실패 사유를 첨부합니다.
[1] brief.md를 보완하여 다시 시도하시겠습니까?
[2] 요구사항을 직접 작성하시겠습니까? (spec.md 수동 작성)
[3] 이 태스크를 보류하겠습니까?
```

---

### Step 3 — Planner 에이전트 실행 (Phase 2)

**모델**: opus  
**입력 (첫 번째 실행)**: `spec.md`만  
**입력 (retry 시)**: `spec.md` + `review-{n}.md`  
**출력**: `plan.md`

Planner 에이전트(`agents/planner.md`)를 호출한다. 코드베이스 탐색 도구(Glob, Grep, Read, LSP)를 허용한다.

**첫 번째 실행 시 주입할 지시**:

```
## 입력
.crew/plans/{task-id}/spec.md 를 읽어라. brief.md는 읽지 않는다.

## 출력
.crew/plans/{task-id}/plan.md 를 작성하라.

## plan.md 필수 구조

plan.md는 유저 스토리 단위로 구성한다. 각 유저 스토리는 구현 태스크와 테스트 시나리오를 포함한다.

### 유저 스토리

#### US-1: {스토리 제목}
{사용자가 무엇을 할 수 있는지 행위 수준으로 서술}

##### 구현 태스크
- [ ] {파일 경로}: {변경 내용}
- [ ] {파일 경로}: {변경 내용}

##### 테스트 시나리오
- TS-1.1: {정상 경로} — 기대 결과: {구체적 결과}
- TS-1.2: {에러 경로} — 기대 결과: {구체적 결과}
- TS-1.3: {엣지 케이스} — 기대 결과: {구체적 결과}

#### US-2: ...

### 위험 요소
{위험 요소 목록 또는 "없음"}

### 검증 방법
{spec.md의 수용 기준 번호를 인용하며 검증 방법을 기술}

테스트 시나리오는 유저 스토리당 최소 2개(정상 경로 + 에러 경로)를 작성한다.
이 테스트 시나리오는 QA 에이전트가 E2E 검증 시 사용하는 유일한 테스트 기준이 된다.

## 규칙
- 코드를 작성하지 않는다.
- 태스크 하나가 4시간을 초과하면 더 작게 분해한다.
- "나중에 결정"은 허용하지 않는다. 모르면 위험 요소에 기록한다.
```

**retry 시 주입할 지시**:

```
이번은 이전 계획이 리뷰에서 FAIL을 받은 후 재작성하는 것이다.

## 입력
.crew/plans/{task-id}/spec.md 를 읽어라.
.crew/plans/{task-id}/review-{n}.md 를 읽어라.
이 두 파일만 읽는다. brief.md는 읽지 않는다.

## 필수 선행 작업
review-{n}.md를 먼저 읽어라. 이전 plan이 왜 FAIL을 받았는지 확인하고,
지적된 항목을 명시적으로 수정하라.

## 출력
.crew/plans/{task-id}/plan.md 를 새로 작성하라.
plan.md 최상단에 "이전 피드백 반영" 섹션을 추가한다.
plan.md는 유저 스토리 단위 구조(US-N + 구현 태스크 + 테스트 시나리오)를 따른다.
테스트 시나리오는 유저 스토리당 최소 2개(정상 경로 + 에러 경로)를 작성한다.

## 규칙
- 코드를 작성하지 않는다.
- 태스크 하나가 4시간을 초과하면 더 작게 분해한다.
- "나중에 결정"은 허용하지 않는다. 모르면 위험 요소에 기록한다.
- 피드백을 무시하거나 같은 내용으로 작성하지 말 것.
- "이전 피드백 반영" 섹션을 생략하면 안 된다.
```

**Phase 2 실패 조건**: plan.md를 작성하지 못했거나, 태스크 목록이 비어 있으면 즉시 에스컬레이션. 재시도 없음.

```
Planner 에이전트가 plan.md 생성에 실패했습니다.
현재 spec.md의 내용과 실패 사유를 첨부합니다.
[1] spec.md를 수정하여 재시도하시겠습니까?
[2] plan.md를 직접 작성하시겠습니까?
[3] 이 태스크를 보류하겠습니까?
```

---

### Step 4 — Architect 에이전트 실행 (Phase 3a)

**모델**: sonnet (코드 검증은 규칙 기반이므로 opus 불필요)  
**입력**: `spec.md`, `plan.md`  
**접근 금지**: `brief.md` — 프롬프트로 강제한다. (주: Claude Code Agent 도구에 파일 허용 경로 API가 없으므로 프롬프트 지시가 유일한 강제 수단이다. 향후 API 지원 시 컨텍스트 주입 제한으로 이중 강제 가능)  
**허용 도구**: Glob, Grep, Read, LSP, Bash(git blame/log만)  
**출력**: 오케스트레이터가 수집 (review.md에 통합)

Architect 에이전트(`agents/architect.md`)를 호출한다.

**주입할 체크리스트**:

```
## 입력
.crew/plans/{task-id}/spec.md
.crew/plans/{task-id}/plan.md
이 두 파일만 읽어라. brief.md는 읽지 않는다.

## 체크리스트 (하드 임계값)

아래 각 항목에 YES 또는 NO로만 답한다. 부분 점수 없음.
코드에서 확인할 수 없으면 NO로 처리한다.

[ ] A1. plan.md에서 참조하는 파일/모듈이 실제로 존재하는가?
[ ] A2. 참조하는 함수/API가 현재 코드와 일치하는가?
[ ] A3a. plan.md가 도입하는 라이브러리/프레임워크가 모두 프로젝트에서 이미 사용 중이거나, 새 도입에 정당한 이유가 plan.md에 명시되어 있는가?
[ ] A3b. plan.md가 프로젝트의 기존 디렉토리/모듈 구조 규칙을 따르는가?
[ ] A4. 전제 조건/의존성이 현재 코드 상태에서 충족 가능한가?

## 판정 규칙
- 5개 항목 모두 YES → PASS
- 하나라도 NO → FAIL

## A4 근본 원인 분류 (A4가 NO인 경우 필수)
A4가 NO이면 반드시 근본 원인을 다음 중 하나로 분류하여 출력하라:
- (a) plan 결함: plan.md가 전제 조건을 잘못 설정함
- (b) spec 결함: spec.md의 전제 조건이 현재 코드에서 불가능함
출력 형식: "### A4 근본 원인: plan 결함" 또는 "### A4 근본 원인: spec 결함"

## 출력 형식
architect.md의 체크리스트 산출물 형식을 따른다.
각 NO 항목에 반드시 `파일:라인` 근거를 첨부하라.
```

**Phase 3a 실패 조건**: Architect가 결과를 생성하지 못했거나 비어 있으면 즉시 에스컬레이션. 재시도 없음.

```
Architect 에이전트가 코드 검증 결과 생성에 실패했습니다. (에이전트 오류 또는 빈 출력)
[1] Architect를 재실행하십시오
[2] 코드 검증을 수동으로 수행하십시오
[3] 이 태스크를 보류하십시오
```

Architect가 **PASS**이면 Step 5(Critic)로 진행한다.
Architect가 **FAIL**이면 Step 7(FAIL 처리)로 진행한다. Critic은 실행하지 않는다.

---

### Step 5 — Critic 에이전트 실행 (Phase 3b)

**모델**: sonnet (이진 임계값 — opus는 합리화할 위험이 있으므로 사용하지 않는다)  
**입력 (첫 번째 실행)**: `spec.md`, `plan.md`  
**입력 (retry 시)**: `spec.md`, `plan.md`, `review-{n}.md`  
**접근 금지**: `brief.md` — 프롬프트로 강제한다.  
**출력**: 오케스트레이터가 수집 (review.md에 통합)

Critic 에이전트(`agents/critic.md`)를 호출한다.

**주입할 체크리스트 (첫 번째 실행)**:

```
## 입력
.crew/plans/{task-id}/spec.md
.crew/plans/{task-id}/plan.md
이 두 파일만 읽어라. brief.md는 읽지 않는다.

## 체크리스트 (하드 임계값)

아래 각 항목에 YES 또는 NO로만 답한다. 부분 점수 없음.
모호한 표현을 발견하면 NO로 처리한다. "아마 의도했을 것"이라고 추측하지 않는다.

[ ] C1. spec.md의 수용 기준이 모두 테스트 가능한 구체적 행동으로 서술되어 있는가?
[ ] C2. spec.md에 "Out" 스코프가 명시적으로 열거되어 있는가?
[ ] C3. 의미적 커버리지: spec.md의 수용 기준 각각에 대해, plan.md의 태스크 목록에서 최소 하나의 태스크가 해당 기준을 직접 다루는가?
[ ] C4. 구조적 추적성: plan.md의 검증 방법 섹션이 존재하고, 각 검증 항목이 spec.md의 수용 기준 번호를 명시적으로 인용하는가?
[ ] C5. plan.md에 "나중에 결정" 또는 미결 사항이 없는가?
[ ] C6. 단일 태스크 중 4시간 초과 항목이 없는가?
[ ] C7. 위험 요소 섹션이 존재하는가? (내용이 "없음"이어도 명시적으로 기재되어 있으면 YES)
[ ] C8. plan.md의 모든 유저 스토리에 테스트 시나리오가 최소 2개 이상 존재하는가? (정상 경로 + 에러 경로)

### retry 전용 항목 (review-{n}.md가 입력에 포함된 경우에만 추가)
[ ] CR1. plan.md에 "이전 피드백 반영" 섹션이 존재하고, 이전 review-{n}.md의 모든 NO 항목을 명시적으로 다루고 있는가?

## 판정 규칙
- 모든 항목 YES → PASS (retry 시 CR1 포함)
- 하나라도 NO → FAIL

## 출력 형식
critic.md의 체크리스트 산출물 형식을 따른다.
```

**주입할 체크리스트 (retry 시)**:

```
## 입력
.crew/plans/{task-id}/spec.md
.crew/plans/{task-id}/plan.md
.crew/plans/{task-id}/review-{n}.md
이 세 파일만 읽어라. brief.md는 읽지 않는다.

review-{n}.md를 먼저 읽어라. 이전 리뷰에서 어떤 항목이 NO였는지 확인한 후 체크리스트를 평가하라.

## 체크리스트 (하드 임계값)

아래 각 항목에 YES 또는 NO로만 답한다. 부분 점수 없음.
모호한 표현을 발견하면 NO로 처리한다. "아마 의도했을 것"이라고 추측하지 않는다.

[ ] C1. spec.md의 수용 기준이 모두 테스트 가능한 구체적 행동으로 서술되어 있는가?
[ ] C2. spec.md에 "Out" 스코프가 명시적으로 열거되어 있는가?
[ ] C3. 의미적 커버리지: spec.md의 수용 기준 각각에 대해, plan.md의 태스크 목록에서 최소 하나의 태스크가 해당 기준을 직접 다루는가?
[ ] C4. 구조적 추적성: plan.md의 검증 방법 섹션이 존재하고, 각 검증 항목이 spec.md의 수용 기준 번호를 명시적으로 인용하는가?
[ ] C5. plan.md에 "나중에 결정" 또는 미결 사항이 없는가?
[ ] C6. 단일 태스크 중 4시간 초과 항목이 없는가?
[ ] C7. 위험 요소 섹션이 존재하는가? (내용이 "없음"이어도 명시적으로 기재되어 있으면 YES)
[ ] C8. plan.md의 모든 유저 스토리에 테스트 시나리오가 최소 2개 이상 존재하는가? (정상 경로 + 에러 경로)
[ ] CR1. plan.md에 "이전 피드백 반영" 섹션이 존재하고, review-{n}.md의 모든 NO 항목을 명시적으로 다루고 있는가?

## 판정 규칙
- 모든 항목 YES (CR1 포함) → PASS
- 하나라도 NO → FAIL

## 출력 형식
critic.md의 체크리스트 산출물 형식을 따른다.
```

**Phase 3b 실패 조건**: Critic이 결과를 생성하지 못했거나 비어 있으면 즉시 에스컬레이션. 재시도 없음.

```
Critic 에이전트가 품질 평가 결과 생성에 실패했습니다. (에이전트 오류 또는 빈 출력)
[1] Critic을 재실행하십시오
[2] 품질 평가를 수동으로 수행하십시오
[3] 이 태스크를 보류하십시오
```

---

### Step 6 — PASS 처리

Architect PASS + Critic PASS이면:

1. 오케스트레이터가 `review.md`를 작성한다 (Architect 결과 + Critic 결과 통합).

```markdown
# Review — {task-id}

## 판정: PASS

## Architect 결과
{Architect 출력 전문}

## Critic 결과
{Critic 출력 전문}
```

2. 오케스트레이터가 Architect/Critic 출력에 `### 학습 메모` 섹션이 있으면 해당 내용을 `.crew/architect-memory.md` 또는 `.crew/critic-memory.md`에 기록한다.

3. 오케스트레이터가 `contract.md`를 직접 작성한다.

```markdown
# 스프린트 계약: {task-id}

생성일: {날짜}

## 수용 기준 (검증 기준)
[spec.md의 수용 기준을 그대로 복사]

## 구현 계획 참조
.crew/plans/{task-id}/plan.md

## 검증자 확인
Architect PASS + Critic PASS. review.md 참조.

## 상태
ACTIVE — Dev 에이전트가 이 계약을 기준으로 구현한다.
QA 에이전트가 이 계약의 수용 기준을 기준으로 검증한다.
```

4. `.loop_count` 파일이 존재하면 삭제한다.
5. 오케스트레이터에게 완료 반환:

```
상태: COMPLETE
task-id: {task-id}
contract.md 경로: .crew/plans/{task-id}/contract.md
```

**contract.md 쓰기 실패 시**:

```
PASS 판정 후 contract.md 생성에 실패했습니다.
[1] 재시도하십시오
[2] 경로를 수동으로 지정하여 재시도하십시오 (.crew/plans/{task-id}/contract.md)
[3] 보류하십시오
```

---

### Step 7 — FAIL 처리 (피드백 보존 루프)

Architect FAIL 또는 Critic FAIL이면:

**7a. FAIL 원인 분류**

- **Critic FAIL이고 NO 항목이 C1 또는 C2만인 경우** (spec.md 결함):
  - Planner를 재시도해도 spec.md를 고칠 수 없다.
  - 즉시 에스컬레이션:

```
Critic이 spec.md 결함을 이유로 FAIL을 냈습니다. (항목 {번호})
Planner 재시도로는 해결할 수 없습니다. spec.md를 수정해야 합니다.
[1] PM 에이전트를 재실행하여 spec.md를 재작성하시겠습니까?
[2] spec.md를 직접 수정하시겠습니까?
[3] 이 태스크를 보류하겠습니까?
```

- **Architect FAIL이고 NO 항목이 A4만이며, Architect 출력의 "A4 근본 원인" 분류가 "spec 결함"인 경우** (spec.md 결함):
  - Planner를 재시도해도 spec.md의 전제 조건을 고칠 수 없다.
  - 즉시 에스컬레이션:

```
Architect가 A4(전제 조건) 실패를 냈으며, Architect가 근본 원인을 "spec 결함"으로 분류했습니다. spec.md의 전제 조건이 현재 코드 상태에서 불가능합니다.
Planner 재시도로는 해결할 수 없습니다. spec.md를 수정해야 합니다.
[1] PM 에이전트를 재실행하여 spec.md를 재작성하시겠습니까?
[2] spec.md를 직접 수정하시겠습니까?
[3] 이 태스크를 보류하겠습니까?
```

- **Architect FAIL(위 경우 제외) 또는 Critic FAIL(C3-C7 포함)인 경우** (plan.md 결함):
  - 피드백 보존 루프를 진행한다.

**7b. 학습 메모 기록 + review.md 통합 작성**

오케스트레이터가 Architect/Critic 출력에 `### 학습 메모` 섹션이 있으면 해당 내용을 `.crew/architect-memory.md` 또는 `.crew/critic-memory.md`에 기록한다.

오케스트레이터가 `review.md`를 작성한다. Architect 결과와 Critic 결과(실행된 경우)를 모두 포함한다.

```markdown
# Review — {task-id}

## 판정: FAIL

## Architect 결과
{Architect 출력 전문}

## Critic 결과
{Critic 출력 전문 또는 "Architect FAIL로 미실행"}
```

**7c. 루프 카운터 읽기**

`.crew/plans/{task-id}/.loop_count` 파일을 읽는다.
- 파일이 없으면 카운터 = 0 (첫 번째 FAIL)
- 파일이 있으면 파일 내용(정수)이 카운터 값

**7d. 에스컬레이션 판단**

카운터 값 >= 4 이면 즉시 에스컬레이션:

```
계획 파이프라인이 5회 반복 후에도 수렴하지 않았습니다.
현재 review.md의 FAIL 사유를 첨부합니다.
[1] 스코프를 좁혀서 재시도하시겠습니까?
[2] 수용 기준을 직접 수정하시겠습니까?
[3] 이 태스크를 보류하겠습니까?
```

에스컬레이션 시 `.loop_count` 파일을 삭제한다.

**7e. 피드백 아카이브**

`n = 카운터 + 1` (이번 회차 번호)

```
plan.md → plan-{n}.md 로 이름 변경
review.md → review-{n}.md 로 이름 변경
```

예시:
- 첫 번째 FAIL (카운터 = 0): `plan.md` → `plan-1.md`, `review.md` → `review-1.md`, n=1
- 두 번째 FAIL (카운터 = 1): `plan.md` → `plan-2.md`, `review.md` → `review-2.md`, n=2
- 세 번째 FAIL (카운터 = 2): `plan.md` → `plan-3.md`, `review.md` → `review-3.md`, n=3
- 네 번째 FAIL (카운터 = 3): `plan.md` → `plan-4.md`, `review.md` → `review-4.md`, n=4

**7f. 루프 카운터 증가 저장**

`카운터 + 1`을 `.loop_count` 파일에 저장한다.

**7g. Step 3으로 돌아감 (retry)**

Step 3으로 돌아간다. Planner retry 프롬프트의 `{n}`에 Step 7e에서 계산한 값(= 카운터 + 1)을 대입한다. 입력에 `review-{n}.md`를 포함한다.

---

## 루프 카운터 (.loop_count) 생명주기

| 이벤트 | 동작 |
|--------|------|
| Phase 2 첫 번째 진입 | 파일 없음 (카운터 = 0으로 간주) |
| 첫 번째 FAIL 처리 후 | 파일 생성, 내용: `1` |
| 두 번째 FAIL 처리 후 | 파일 갱신, 내용: `2` |
| 세 번째 FAIL 처리 후 | 파일 갱신, 내용: `3` |
| 네 번째 FAIL 처리 후 | 파일 갱신, 내용: `4` |
| PASS | 파일 삭제 |
| 에스컬레이션 (any) | 파일 삭제 |

에스컬레이션 조건: 카운터 값 >= 4 (`.loop_count` 파일이 존재하고 내용이 4 이상)

Planner+Reviewer 사이클은 최대 5회 실행된다 (초기 1회 + retry 최대 4회). 4차 retry 후에도 FAIL이면 에스컬레이션한다.

---

## 루프 구조 요약

| 단계 | 실패 시 | 총 실행 횟수 |
|------|---------|------------|
| Pre-Step 1 게이트 (brief.md) | 즉시 에스컬레이션 | — |
| Phase 1 (PM) | 즉시 에스컬레이션 | 1회 |
| Phase 2 (Planner) standalone 실패 | 즉시 에스컬레이션 | 1회 |
| Phase 3a (Architect) 에이전트 실패 | 즉시 에스컬레이션 | 1회 |
| Phase 3a Architect spec.md 전제조건 결함 FAIL (A4만, Architect "spec 결함" 분류) | 즉시 에스컬레이션 | 1회 |
| Phase 3b (Critic) 에이전트 실패 | 즉시 에스컬레이션 | 1회 |
| Phase 3b Critic spec.md 결함 FAIL (C1-C2만) | 즉시 에스컬레이션 | 1회 |
| Phase 2-3 루프 (plan.md 결함) | 피드백 보존 + Phase 2 retry | 최대 5회 (초기 1 + retry 4) |
| 루프 상한 초과 (카운터 >= 4) | 유저에게 에스컬레이션 | — |

---

## 에이전트 호출 컨텍스트 규칙

| 에이전트 | 모델 | 주입할 파일 | 차단할 파일 | 허용 도구 |
|----------|------|------------|------------|----------|
| PM | opus | brief.md | — | AskUserQuestion, 파일 읽기/쓰기 |
| Planner (첫 번째) | opus | spec.md | brief.md | Glob, Grep, Read, LSP, 파일 쓰기 |
| Planner (retry) | opus | spec.md + review-{n}.md | brief.md | Glob, Grep, Read, LSP, 파일 쓰기 |
| Architect | sonnet | spec.md + plan.md | brief.md | Glob, Grep, Read, LSP, Bash(git) |
| Critic (첫 번째) | sonnet | spec.md + plan.md | brief.md | 파일 읽기 |
| Critic (retry) | sonnet | spec.md + plan.md + review-{n}.md | brief.md | 파일 읽기 |

**brief.md 차단에 대한 참고**: Claude Code Agent 도구에 파일 허용 경로 API가 없으므로 프롬프트 지시("brief.md는 읽지 않는다")가 유일한 강제 수단이다. 이는 프롬프트 레벨 강제이며, 기술적으로 에이전트가 파일을 읽는 것을 물리적으로 차단하지는 않는다. 향후 API 지원 시 컨텍스트 주입 제한으로 이중 강제가 가능하다.

---

## 완료 조건

`.crew/plans/{task-id}/contract.md` 가 존재한다.

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
  "phase": "pre-1" | "1" | "2" | "3a-agent-fail" | "3a-arch-fail" | "3a-spec-defect" | "3b-agent-fail" | "3b-spec-defect" | "3-overflow",
  "reason": "자유형 텍스트",
  "attached_file": "경로 | null"
}
```
