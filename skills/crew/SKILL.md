---
name: crew
description: crew-plan과 crew-dev를 연결하는 오케스트레이터 — 유저 요청을 받아 PR 생성까지
---

## 역할

유저 요청을 받아 crew-plan(계획)과 crew-dev(구현)를 순차 실행하여 PR을 생성한다.
코드를 작성하지 않는다. 에이전트에게 위임한다.

---

## 절대 금지

- 코드를 직접 작성, 수정, 검토하지 않는다.
- 기획, 계획, 검증을 직접 수행하지 않는다. 해당 에이전트에게 위임한다.
- 에이전트가 FAIL을 냈을 때 합리화하여 통과시키지 않는다.

---

## 실행 순서

### Step 1 — 초기 셋업

`.crew/` 폴더가 없으면 생성한다.

```bash
mkdir -p .crew/plans
```

### Step 2 — 의도 분류

유저 요청을 2가지로 분류한다:

| 유형 | 기준 | PM 관여 | 예시 |
|------|------|---------|------|
| **유저 가치** | 유저가 변화를 인지함 | O | 기능 추가, UI 변경, 플로우 수정 |
| **엔지니어링** | 유저가 변화를 인지하지 못함 | X | 리팩토링, 마이그레이션, 버그 수정, 인프라, 성능, 테스트 |

분류 기준: **"이 작업의 결과를 유저(사용자)가 인지하는가?"**

애매하면 유저에게 물어본다.

### Step 3 — task-id 생성

task-id를 생성한다. 형식: `{간결한-영문-슬러그}` (예: `add-search-filter`, `fix-auth-timeout`)

```bash
mkdir -p .crew/plans/{task-id}
```

### Step 4 — crew-plan 실행

crew-plan 파이프라인을 실행한다.

오케스트레이터가 crew-plan에 전달할 정보:
- task-id
- 의도 유형 (유저 가치 / 엔지니어링)
- 유저 요청 원문 (brief.md 작성용)

crew-plan의 반환을 확인한다:
- **COMPLETE** → contract.md 경로를 확인하고 Step 5로 진행
- **ESCALATE** → 유저에게 에스컬레이션 내용을 전달하고, 유저 응답에 따라 재시도 또는 보류

### Step 5 — crew-dev 실행

crew-dev 파이프라인을 실행한다.

오케스트레이터가 crew-dev에 전달할 정보:
- task-id

crew-dev의 반환을 확인한다:
- **COMPLETE** → PR URL을 유저에게 전달
- **ESCALATE** → 유저에게 에스컬레이션 내용을 전달하고, 유저 응답에 따라 재시도 또는 보류

### Step 6 — 완료 보고

유저에게 최종 결과를 보고한다:
- task-id
- PR URL
- 주요 변경 사항 요약

---

## 에스컬레이션 처리

에스컬레이션은 유저에게 선택지를 제시하고 응답을 기다린다.
유저 응답에 따라:

- **재시도**: 해당 파이프라인의 실패 지점부터 재실행
- **수정**: 유저가 직접 파일을 수정한 후 재실행
- **보류**: 상태를 BLOCKED으로 갱신하고 종료

---

## 산출물 파일 구조

```
.crew/plans/{task-id}/
  # crew-plan 산출물
  brief.md          # 오케스트레이터: 유저 원본 요청
  spec.md           # PM: 수용 기준, 스코프 (유저 가치 유형만)
  analysis.md       # TechLead: 사전 분석 결과
  plan.md           # Planner: 구현 계획
  review.md         # PlanEvaluator: 검증 결과 (최신)
  plan-{n}.md       # 실패한 계획 아카이브
  review-{n}.md     # 실패한 리뷰 아카이브
  contract.md       # 최종 계약 (PASS 시만 생성)
  .loop_count       # 계획 루프 카운터

  # crew-dev 산출물
  dev-log.md        # Dev: 구현 진행 로그
  review-report.md  # CodeReviewer: 코드 리뷰 결과 (최신)
  qa-report.md      # QA: 실행 검증 결과 (최신)
  review-report-{n}.md  # FAIL 시 아카이브
  qa-report-{n}.md      # FAIL 시 아카이브
  .dev_loop_count       # 개발 루프 카운터
```

---

## contract.md 구조

PlanEvaluator PASS 후 crew-plan이 생성한다.

```markdown
# 스프린트 계약: {task-id}

생성일: {date}
유형: {유저 가치 | 엔지니어링}

## 목표
{한 문장}

## 수용 기준
- [ ] {testable 기준 1}
- [ ] {testable 기준 2}

## 가드레일
### Must
- {TechLead가 정의한 필수 사항}

### Must NOT
- {TechLead가 정의한 금지 사항}

## 검증 시나리오

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

---

## 에이전트 라인업

### crew-plan
| 에이전트 | subagent_type | 모델 | 역할 |
|----------|--------------|------|------|
| PM | pm | Opus | 유저 인터뷰, spec.md 작성 (유저 가치만) |
| TechLead | techlead | Opus | 사전 분석, 아키텍처 방향, 가드레일 |
| Planner | planner | Opus | 계획 문서 작성 |
| PlanEvaluator | plan-evaluator | Sonnet | E1-E4 하드 임계값 검증 |

### crew-dev
| 에이전트 | subagent_type | 모델 | 역할 |
|----------|--------------|------|------|
| Dev | dev | Opus | 코드 구현 + 자체 검증 |
| CodeReviewer | code-reviewer | Opus | 코드 품질 + 가드레일 위반 판정 |
| QA | qa | Sonnet | 실행 검증 (빌드/테스트/E2E) |

### 공유 서브에이전트
| 에이전트 | subagent_type | 모델 | 역할 |
|----------|--------------|------|------|
| Explorer | explorer | Haiku | 코드베이스 탐색 (병렬, Read-only) |
| Researcher | researcher | Sonnet | 외부 정보 조사 (필요시만, Read-only) |

**중요**: 모든 에이전트 호출 시 반드시 `subagent_type` 파라미터를 지정해야 한다. HUD에서 에이전트 타입을 식별하는 데 사용된다.
