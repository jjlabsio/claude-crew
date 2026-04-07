---
name: crew-dev
description: contract.md를 입력으로 받아 Dev + Code-Reviewer + QA + Critic 파이프라인으로 구현을 완료한다
---

## 역할

오케스트레이터로부터 task-id를 받아 `contract.md` 기반으로 구현을 완료하고 PR을 생성한다.
`contract.md`가 ACTIVE 상태여야 시작할 수 있다. 없거나 상태가 다르면 시작하지 않는다.

네 에이전트(Dev, Code-Reviewer, QA, Critic)는 파일을 통해서만 소통한다.
각 에이전트는 자신의 역할에 필요한 파일만 본다. 다른 에이전트의 추론 과정을 보지 않는다.

파이프라인 구조:
1. **Dev** — 구현: plan.md 기반 코드 작성 + 자체 검증 (빌드/린트/타입/테스트 통과)
2. **Code-Reviewer + QA** — 병렬 검증: 코드 품질(diff 기반) + 실행 검증(빌드/테스트/E2E)
3. **Critic** — 계약 판정: 모든 증거를 contract.md 수용 기준과 대조하여 최종 PASS/FAIL

---

## 절대 금지

- 오케스트레이터가 코드를 직접 작성하지 않는다.
- 검증 에이전트(Code-Reviewer, QA, Critic)가 FAIL을 냈을 때 합리화하여 통과시키지 않는다.
- brief.md를 어떤 에이전트에게도 전달하지 않는다.
- contract.md를 Code-Reviewer나 QA에게 전달하지 않는다.
- plan.md, dev-log.md를 Critic에게 전달하지 않는다.
- Dev가 자체 검증(빌드/린트/타입/테스트)을 통과하지 못한 상태에서 검증 단계로 넘기지 않는다.
- 같은 수용 기준이 3회 연속 FAIL이면 루프를 계속하지 않고 즉시 에스컬레이션한다.

---

## 파일 구조

```
.crew/plans/{task-id}/
  # crew-plan 산출물 (입력, 이미 존재)
  brief.md              # 유저 요청 원문 + 컨텍스트
  spec.md               # PM 출력: 요구사항 + 수용 기준
  plan.md               # Planner 출력: 유저 스토리 + 구현 태스크 + 테스트 시나리오
  contract.md           # 스프린트 계약 (수용 기준 + 상태)

  # crew-dev 산출물 (신규 생성)
  dev-log.md            # Dev 출력: 구현 진행 로그
  review-report.md      # Code-Reviewer 출력: 코드 리뷰 결과 (최신)
  qa-report.md          # QA 출력: 실행 검증 결과 (최신)
  judgment.md           # Critic 출력: 계약 판정 결과 (최신)
  review-report-{n}.md  # FAIL 시 아카이브
  qa-report-{n}.md      # FAIL 시 아카이브
  judgment-{n}.md       # FAIL 시 아카이브
  .dev_loop_count       # 검증 루프 카운터
```

---

## 실행 순서

### Phase 1 — 환경 준비 (오케스트레이터 직접)

**1a. contract.md 유효성 검사**

`.crew/plans/{task-id}/contract.md`를 읽는다.
- 파일이 존재하는가?
- `## 상태` 섹션이 `ACTIVE`인가?
- `## 수용 기준` 섹션이 비어 있지 않은가?
- `## 구현 계획 참조`의 plan.md 경로가 유효한가?

하나라도 실패하면 즉시 에스컬레이션:

```
contract.md 유효성 검사에 실패했습니다.
실패 사유: {구체적 사유}
[1] crew-plan을 먼저 실행하여 contract.md를 생성하십시오
[2] contract.md를 직접 수정하십시오
[3] 이 태스크를 보류하십시오
```

**1b. 워크트리 생성**

```bash
git fetch origin main
git worktree add ../{project}-worktree-feat-{task-id} -b feat/{task-id} origin/main
```

워크트리 디렉토리로 이동한다. 이후 모든 작업은 워크트리에서 수행한다.
환경 파일(`.env*` 등)이 있으면 복사한다.

**1c. 상태 갱신**

contract.md의 `## 상태` 섹션을 갱신한다:

```markdown
## 상태
IN_PROGRESS — Dev 에이전트가 구현 중이다.
```

---

### Phase 2 — 구현 (Dev 에이전트)

**모델**: opus
**입력 (첫 번째 실행)**: `plan.md` + `contract.md`
**입력 (retry 시)**: `plan.md` + `contract.md` + `review-report-{n}.md` + `qa-report-{n}.md` + `judgment-{n}.md` (존재하는 것만)
**접근 금지**: `brief.md`, `spec.md`
**출력**: 구현된 코드 + `dev-log.md`

Dev 에이전트(`agents/dev.md`)를 호출한다.

**첫 번째 실행 시 주입할 지시**:

```
당신은 Dev 에이전트다. plan.md를 기반으로 코드를 구현한다.

## 입력
.crew/plans/{task-id}/plan.md 를 읽어라.
.crew/plans/{task-id}/contract.md 를 읽어라 (수용 기준 = 완료 기준).
brief.md와 spec.md는 읽지 않는다.

## 작업 순서
1. plan.md의 유저 스토리와 태스크 목록을 확인한다.
2. 코드베이스를 탐색한다 (Glob, Grep, Read로 관련 파일 파악).
3. 유저 스토리 단위로 순차 구현한다.
4. 각 유저 스토리 완료 후 dev-log.md에 진행상황을 기록한다.
5. 모든 구현 완료 후 자체 검증을 실행한다:
   - 빌드 성공 확인
   - 린트 통과 확인
   - 타입 체크 통과 확인
   - 기존 테스트 스위트 통과 확인
6. 자체 검증이 모두 통과하면 완료를 선언한다.
   자체 검증이 실패하면 직접 수정하여 통과시킨다.

## 출력
.crew/plans/{task-id}/dev-log.md 를 작성하라.

## dev-log.md 형식
### 구현 요약
- 유저 스토리별 구현 내용 1줄 요약

### 자체 검증 결과
- 빌드: PASS/FAIL + 명령어 + 출력
- 린트: PASS/FAIL + 명령어 + 출력
- 타입: PASS/FAIL + 명령어 + 출력
- 테스트: PASS/FAIL + 명령어 + 출력 (통과/실패 수)

### 변경 파일 목록
- 파일 경로 + 변경 요약

## 규칙
- plan.md에 없는 것을 구현하지 않는다 (스코프 크리프 금지).
- 자체 검증 4개(빌드/린트/타입/테스트) 모두 PASS 해야 완료를 선언할 수 있다.
- 기존 코드베이스의 컨벤션을 따른다.
```

**retry 시 주입할 지시**:

```
이번은 이전 구현이 검증에서 FAIL을 받은 후 수정하는 것이다.

## 입력
.crew/plans/{task-id}/plan.md 를 읽어라.
.crew/plans/{task-id}/contract.md 를 읽어라.
.crew/plans/{task-id}/review-report-{n}.md 를 읽어라. (Code-Reviewer 피드백)
.crew/plans/{task-id}/qa-report-{n}.md 를 읽어라. (QA 피드백)
.crew/plans/{task-id}/judgment-{n}.md 를 읽어라. (Critic 피드백, 존재하는 경우)
brief.md와 spec.md는 읽지 않는다.

## 필수 선행 작업
피드백 파일을 먼저 읽어라. 어떤 항목이 FAIL인지 확인하고 해당 부분을 수정하라.

## 작업 순서
1. 피드백에서 FAIL 항목을 모두 파악한다.
2. 각 FAIL 항목에 대해 수정을 수행한다.
3. dev-log.md를 갱신한다 (수정 내용 + 자체 검증 결과 추가).
4. 자체 검증 4개를 모두 다시 실행한다.

## 출력
.crew/plans/{task-id}/dev-log.md 를 갱신하라.
최상단에 "## 수정 이력 (retry {n})" 섹션을 추가한다.

## 규칙
- 피드백에서 지적하지 않은 부분을 추가로 변경하지 않는다.
- 자체 검증 4개 모두 PASS 해야 완료를 선언할 수 있다.
```

**Phase 2 실패 조건**: Dev 에이전트가 코드를 작성하지 못했거나, 자체 검증을 통과하지 못한 채 완료를 선언하면 에스컬레이션. 재시도 없음.

```
Dev 에이전트가 구현에 실패했습니다.
실패 사유: {자체 검증 실패 항목 또는 에이전트 오류}
[1] Dev 에이전트를 재실행하시겠습니까?
[2] 직접 구현하시겠습니까?
[3] 이 태스크를 보류하겠습니까?
```

---

### Phase 3 — 병렬 검증 (Code-Reviewer + QA)

Code-Reviewer와 QA를 **동시에** Agent tool로 호출한다. 두 에이전트는 독립적이며 서로의 결과를 필요로 하지 않는다.

#### Phase 3a — Code-Reviewer

**모델**: sonnet
**입력**: `git diff main...HEAD` (오케스트레이터가 diff를 생성하여 프롬프트에 포함)
**접근 금지**: `plan.md`, `contract.md`, `brief.md`, `spec.md`, `dev-log.md`
**출력**: `review-report.md`

Code-Reviewer 에이전트(`agents/code-reviewer.md`)를 호출한다.

**주입할 지시**:

```
당신은 Code-Reviewer 에이전트다. 코드 변경 사항의 품질을 판단한다.

## 입력
아래 diff를 검토하라. 이것이 검토 대상의 전부다.
plan.md, contract.md, brief.md, spec.md, dev-log.md는 읽지 않는다.
코드만 보고 판단한다. 구현 의도나 수용 기준을 알 필요가 없다.

{git diff main...HEAD 출력}

## 검토 항목
- 코드베이스 컨벤션 준수 (네이밍, 파일 구조, import 패턴)
- 보안 취약점 (injection, XSS, 인증 우회, 하드코딩된 시크릿)
- 불필요한 복잡도 (과도한 추상화, 죽은 코드, 중복)
- 잠재적 버그 (null 참조, 경쟁 조건, 리소스 누수)
- 에러 처리 적절성

코드베이스 컨벤션 확인을 위해 기존 코드를 Glob/Grep/Read로 탐색할 수 있다.

## 출력 형식
.crew/plans/{task-id}/review-report.md 를 작성하라.

### 판정: PASS / FAIL

### 지적 사항
| # | 심각도 | 파일:라인 | 내용 | 수정 방법 |
|---|--------|----------|------|----------|
| 1 | critical/major/minor | path:line | 문제 설명 | 구체적 수정 제안 |

### 요약
- critical: N개, major: N개, minor: N개
- critical 또는 major가 1개 이상이면 FAIL

## 판정 규칙
- critical 또는 major 지적이 1개 이상 → FAIL
- minor만 있거나 지적 없음 → PASS
- minor 항목은 권고사항으로 기록하되 FAIL 사유가 되지 않는다.
```

#### Phase 3b — QA

**모델**: sonnet
**입력**: `plan.md` + 코드베이스
**접근 금지**: `contract.md`, `brief.md`, `spec.md`
**허용 도구**: Glob, Grep, Read, Bash, LSP
**출력**: `qa-report.md`

QA 에이전트(`agents/qa.md`)를 호출한다.

**주입할 지시**:

```
당신은 QA 에이전트다. 구현이 실제로 동작하는지 검증한다.

## 입력
.crew/plans/{task-id}/plan.md 를 읽어라.
plan.md의 유저 스토리와 테스트 시나리오를 확인하라. 이것이 검증 대상이다.
contract.md, brief.md, spec.md는 읽지 않는다.

## 검증 항목 (순서대로 실행)

### 1. 빌드 검증
빌드 명령어를 실행하고 성공 여부를 기록한다.
FAIL이면 이후 항목 실행 없이 즉시 FAIL을 선언한다.

### 2. 린트 검증
린트 명령어를 실행하고 결과를 기록한다.

### 3. 타입 체크 검증
타입 체크 명령어를 실행하고 결과를 기록한다.

### 4. 테스트 스위트 검증
전체 테스트 스위트를 실행한다.
- 기존 테스트 통과 여부 (회귀 확인)
- 새 테스트 통과 여부
- 실패한 테스트가 있으면 테스트명과 에러 메시지를 기록한다.

### 5. E2E / 통합 검증
plan.md의 테스트 시나리오를 기반으로 E2E 검증을 수행한다.

- Playwright 테스트가 존재하면 실행한다.
- 개발 서버가 필요하면 반드시 tmux 세션으로 기동한다.
  세션명: `qa-{task-id}-{timestamp}`
  검증 완료 후 반드시 세션을 종료한다.
- Playwright 테스트가 없으면 plan.md의 테스트 시나리오를 수동으로 검증한다
  (curl, tmux 기반 CLI 테스트 등 프로젝트에 적합한 방식).

### 6. 테스트 커버리지 갭 식별
구현된 유저 스토리 중 테스트가 없는 핵심 경로를 식별한다.
갭이 있으면 기록하되 FAIL 사유가 되지는 않는다 (권고사항).

## 출력 형식
.crew/plans/{task-id}/qa-report.md 를 작성하라.

### 판정: PASS / FAIL

### 검증 결과
| # | 항목 | 결과 | 명령어 | 출력 (요약) |
|---|------|------|--------|------------|
| 1 | 빌드 | PASS/FAIL | `npm run build` | exit 0 / error msg |
| 2 | 린트 | PASS/FAIL | `npm run lint` | 0 errors / N errors |
| 3 | 타입 | PASS/FAIL | `npx tsc --noEmit` | 0 errors / N errors |
| 4 | 테스트 | PASS/FAIL | `npm test` | X passed, Y failed |
| 5 | E2E | PASS/FAIL | `npx playwright test` | 시나리오별 결과 |

### E2E 시나리오 상세
| # | 시나리오 (plan.md 참조) | 결과 | 증거 |
|---|----------------------|------|------|
| 1 | {시나리오 설명} | PASS/FAIL | {실행 출력 또는 스크린샷 경로} |

### 커버리지 갭 (권고사항)
- {갭 설명} — 위험도: high/medium/low

### tmux 세션 정리
- 세션 생성: {세션명}
- 세션 종료: YES/NO

## 판정 규칙
- 항목 1-5 중 하나라도 FAIL → 전체 FAIL
- 모든 항목 PASS → 전체 PASS
- 커버리지 갭은 FAIL 사유가 되지 않는다.

## 규칙
- 모든 검증은 직접 실행한다. "통과할 것이다"는 증거가 아니다.
- 실행 출력을 반드시 캡처하여 기록한다.
- 개발 서버 tmux 세션은 검증 완료 후 반드시 종료한다. 예외 없음.
- 코드를 수정하지 않는다. 검증만 한다.
```

**Phase 3 병렬 실행 방법**:

오케스트레이터는 한 번의 메시지에서 두 개의 Agent tool 호출을 동시에 수행한다:

```
Agent(name="code-reviewer", subagent_type="claude-crew:code-reviewer", prompt="...", model="sonnet")
Agent(name="qa", subagent_type="claude-crew:qa", prompt="...", model="sonnet")
```

두 에이전트가 모두 완료될 때까지 대기한다.

**Phase 3 에이전트 실패 조건**: Code-Reviewer 또는 QA가 결과를 생성하지 못했거나 비어 있으면 해당 에이전트만 재실행한다. 두 번째 실패 시 에스컬레이션.

```
{에이전트명} 에이전트가 검증 결과 생성에 실패했습니다. (에이전트 오류 또는 빈 출력)
[1] 해당 에이전트를 재실행하십시오
[2] 검증을 수동으로 수행하십시오
[3] 이 태스크를 보류하십시오
```

**Phase 3 결과 처리**:

- Code-Reviewer PASS + QA PASS → Phase 4로 진행
- 하나라도 FAIL → Phase 3 FAIL 처리 (Step 6으로)

---

### Phase 4 — 계약 판정 (Critic 에이전트)

**모델**: sonnet (이진 임계값 — opus는 합리화할 위험이 있으므로 사용하지 않는다)
**입력**: `contract.md` + `review-report.md` + `qa-report.md`
**접근 금지**: `plan.md`, `brief.md`, `spec.md`, `dev-log.md`
**출력**: `judgment.md`

Critic 에이전트(`agents/critic.md`)를 호출한다.

**주입할 지시**:

```
당신은 Critic 에이전트다. 수용 기준이 충족되었는지 최종 판정한다.

## 입력
.crew/plans/{task-id}/contract.md 를 읽어라. (수용 기준)
.crew/plans/{task-id}/review-report.md 를 읽어라. (Code-Reviewer 증거)
.crew/plans/{task-id}/qa-report.md 를 읽어라. (QA 증거)
이 세 파일만 읽는다. plan.md, brief.md, spec.md, dev-log.md는 읽지 않는다.

## 판정 절차

### 1단계: 증거 매핑
contract.md의 수용 기준 각각에 대해:
- review-report.md와 qa-report.md에서 해당 기준을 충족하는 증거를 찾는다.
- 증거가 명확하면 VERIFIED.
- 증거가 부분적이면 PARTIAL (무엇이 부족한지 명시).
- 증거가 없으면 MISSING.

### 2단계: 스코프 크리프 확인
review-report.md의 변경 파일 목록에서 수용 기준과 무관한 변경이 있는지 확인한다.
있으면 기록하되, FAIL 사유가 되지는 않는다 (경고).

### 3단계: 검증 건강성 확인
- review-report.md 판정이 PASS인가?
- qa-report.md 판정이 PASS인가?
- 하나라도 FAIL이면 해당 기준을 MISSING으로 처리한다.

## 출력 형식
.crew/plans/{task-id}/judgment.md 를 작성하라.

### 최종 판정: PASS / FAIL

### 수용 기준 판정
| # | 수용 기준 | 판정 | 증거 출처 | 비고 |
|---|----------|------|----------|------|
| 1 | {기준 텍스트} | VERIFIED/PARTIAL/MISSING | review-report #N / qa-report 항목 N | {부족한 점} |

### 스코프 크리프 경고
- {해당 없음 / 발견된 변경 설명}

### 검증 건강성
- Code-Reviewer: PASS/FAIL
- QA: PASS/FAIL

## 판정 규칙 (하드 임계값)
- 모든 수용 기준 VERIFIED + 검증 건강성 모두 PASS → PASS
- 하나라도 PARTIAL 또는 MISSING → FAIL
- 검증 건강성이 FAIL인 항목이 있으면 → FAIL
- 모호하면 FAIL. "아마 충족했을 것"은 증거가 아니다.

## 규칙
- 직접 코드를 읽거나 명령을 실행하지 않는다. 제출된 증거만으로 판단한다.
- 증거가 불충분하면 MISSING이다. 추측하지 않는다.
```

**Phase 4 에이전트 실패 조건**: Critic이 결과를 생성하지 못했거나 비어 있으면 에스컬레이션.

```
Critic 에이전트가 계약 판정 결과 생성에 실패했습니다. (에이전트 오류 또는 빈 출력)
[1] Critic을 재실행하십시오
[2] 계약 판정을 수동으로 수행하십시오
[3] 이 태스크를 보류하십시오
```

**Phase 4 결과 처리**:

- Critic PASS → Phase 5로 진행
- Critic FAIL → Step 6(FAIL 처리)으로

---

### Phase 5 — 완료 (오케스트레이터 직접)

Critic PASS이면:

**5a. 학습 메모 기록**

각 에이전트 출력에 `### 학습 메모` 섹션이 있으면 해당 내용을 메모리 파일에 기록한다:
- Code-Reviewer → `.crew/code-reviewer-memory.md`
- QA → `.crew/qa-memory.md`
- Critic → `.crew/critic-memory.md`

**5b. 커밋 + PR**

```bash
git add -A
git commit -m "feat({task-id}): {contract.md의 수용 기준 1줄 요약}"
git push -u origin feat/{task-id}
```

PR을 생성한다 (머지하지 않는다).

**5c. 상태 갱신**

contract.md의 `## 상태` 섹션을 갱신한다:

```markdown
## 상태
COMPLETED — 모든 수용 기준이 검증을 통과했다.
PR: {PR URL}
```

**5d. .dev_loop_count 정리**

`.dev_loop_count` 파일이 존재하면 삭제한다.

**5e. 오케스트레이터에게 완료 반환**

```
상태: COMPLETE
task-id: {task-id}
PR: {PR URL}
```

---

### Step 6 — FAIL 처리 (검증 루프)

Phase 3(Code-Reviewer/QA) FAIL 또는 Phase 4(Critic) FAIL이면:

**6a. 루프 카운터 읽기**

`.crew/plans/{task-id}/.dev_loop_count` 파일을 읽는다.
- 파일이 없으면 카운터 = 0 (첫 번째 FAIL)
- 파일이 있으면 파일 내용(정수)이 카운터 값

**6b. 에스컬레이션 판단**

두 가지 에스컬레이션 조건:

조건 1 — 루프 상한 초과:

카운터 값 >= 4 이면 즉시 에스컬레이션:

```
검증 루프가 5회 반복 후에도 통과하지 못했습니다.
최종 FAIL 사유를 첨부합니다.
[1] 수용 기준을 좁혀서 재시도하시겠습니까?
[2] contract.md를 수정하시겠습니까?
[3] 이 태스크를 보류하겠습니까?
```

에스컬레이션 시:
- `.dev_loop_count` 파일을 삭제한다.
- contract.md 상태를 `BLOCKED`으로 갱신한다.

조건 2 — 같은 기준 3회 연속 실패:

Critic judgment.md에서 FAIL인 수용 기준 번호를 확인한다.
이전 아카이브(judgment-{n-1}.md, judgment-{n-2}.md)에서 같은 기준 번호가 연속 3회 FAIL이면 즉시 에스컬레이션:

```
수용 기준 #{번호}가 3회 연속 FAIL입니다. 구조적 문제로 판단합니다.
해당 기준: {기준 텍스트}
[1] spec.md/contract.md를 수정하시겠습니까? (기준 자체의 문제)
[2] plan.md를 수정하시겠습니까? (구현 전략의 문제)
[3] 이 태스크를 보류하겠습니까?
```

**6c. 피드백 아카이브**

`n = 카운터 + 1` (이번 회차 번호)

```
review-report.md → review-report-{n}.md
qa-report.md → qa-report-{n}.md
judgment.md → judgment-{n}.md (존재하는 경우)
```

**6d. 루프 카운터 증가 저장**

`카운터 + 1`을 `.dev_loop_count` 파일에 저장한다.

**6e. Phase 2로 돌아감 (retry)**

Phase 2(Dev)로 돌아간다. Dev retry 프롬프트에 아카이브된 피드백 파일을 주입한다.
Dev 수정 완료 후 Phase 3(Code-Reviewer + QA)을 **둘 다** 재실행한다.
Phase 3 PASS이면 Phase 4(Critic)도 재실행한다.

---

## 루프 카운터 (.dev_loop_count) 생명주기

| 이벤트 | 동작 |
|--------|------|
| Phase 2 첫 번째 진입 | 파일 없음 (카운터 = 0으로 간주) |
| 첫 번째 FAIL 처리 후 | 파일 생성, 내용: `1` |
| 두 번째 FAIL 처리 후 | 파일 갱신, 내용: `2` |
| 세 번째 FAIL 처리 후 | 파일 갱신, 내용: `3` |
| 네 번째 FAIL 처리 후 | 파일 갱신, 내용: `4` |
| PASS (Phase 5) | 파일 삭제 |
| 에스컬레이션 (any) | 파일 삭제 |

검증 사이클은 최대 5회 실행된다 (초기 1회 + retry 최대 4회).

---

## 루프 구조 요약

| 단계 | 실패 시 | 총 실행 횟수 |
|------|---------|------------|
| Phase 1 (환경 준비) | 즉시 에스컬레이션 | 1회 |
| Phase 2 (Dev) standalone 실패 | 즉시 에스컬레이션 | — |
| Phase 3 (Code-Reviewer/QA) 에이전트 실패 | 1회 재시도, 2회차 실패 시 에스컬레이션 | 최대 2회/에이전트 |
| Phase 3 검증 FAIL | Dev 수정 → Phase 3 재실행 | 최대 5회 (루프) |
| Phase 4 (Critic) 에이전트 실패 | 즉시 에스컬레이션 | 1회 |
| Phase 4 계약 판정 FAIL | Dev 수정 → Phase 3 재실행 | 최대 5회 (루프) |
| 같은 기준 3회 연속 FAIL | 즉시 에스컬레이션 | — |
| 루프 상한 초과 (카운터 >= 4) | 유저에게 에스컬레이션 | — |

---

## 에이전트 호출 컨텍스트 규칙

| 에이전트 | 모델 | 주입할 파일 | 차단할 파일 | 허용 도구 |
|----------|------|------------|------------|----------|
| Dev (첫 번째) | opus | plan.md + contract.md | brief.md, spec.md | Glob, Grep, Read, Edit, Write, Bash, LSP |
| Dev (retry) | opus | plan.md + contract.md + review-report-{n}.md + qa-report-{n}.md + judgment-{n}.md | brief.md, spec.md | Glob, Grep, Read, Edit, Write, Bash, LSP |
| Code-Reviewer | sonnet | git diff (프롬프트 내 포함) | plan.md, contract.md, brief.md, spec.md, dev-log.md | Glob, Grep, Read |
| QA | sonnet | plan.md | contract.md, brief.md, spec.md | Glob, Grep, Read, Bash, LSP |
| Critic | sonnet | contract.md + review-report.md + qa-report.md | plan.md, brief.md, spec.md, dev-log.md | 파일 읽기 |

**차단 정책 근거**:
- **brief.md 전체 차단**: 유저 원문을 보면 "의도를 추측"하여 판정을 오염시킬 수 있다.
- **contract.md 차단 (Code-Reviewer, QA)**: 수용 기준을 미리 보면 "맞추려는" 체리피킹 편향이 발생한다. QA는 plan.md의 테스트 시나리오를 기반으로 검증한다.
- **plan.md 차단 (Critic)**: Critic은 "과정"이 아니라 "결과"로 판단한다. 계획이 좋았는지가 아니라 증거가 기준을 충족하는지만 본다.
- **dev-log.md 차단 (Code-Reviewer, Critic)**: Dev의 자체 주장은 증거가 아니다.

---

## crew-plan 수정 사항 (연동)

crew-dev가 정상 동작하려면 crew-plan의 Planner 출력(plan.md)에 다음이 포함되어야 한다:

### plan.md 필수 구조 (추가)

```markdown
## 유저 스토리

### US-1: {스토리 제목}
{사용자가 무엇을 할 수 있는지 행위 수준으로 서술}

#### 구현 태스크
- [ ] {파일 경로}: {변경 내용}
- [ ] {파일 경로}: {변경 내용}

#### 테스트 시나리오
- TS-1.1: {정상 경로} — 기대 결과: {구체적 결과}
- TS-1.2: {에러 경로} — 기대 결과: {구체적 결과}
- TS-1.3: {엣지 케이스} — 기대 결과: {구체적 결과}

### US-2: ...
```

### Critic 체크리스트 (추가 항목)

```
[ ] C8. plan.md의 모든 유저 스토리에 테스트 시나리오가 최소 2개 이상 존재하는가? (정상 경로 + 에러 경로)
```

---

## 완료 조건

다음 세 조건이 모두 충족된다:
1. `.crew/plans/{task-id}/judgment.md`가 존재하고 판정이 PASS이다.
2. PR이 생성되었다.
3. `contract.md`의 상태가 `COMPLETED`이다.

---

## 오케스트레이터 반환 스키마

**COMPLETE**:
```json
{
  "status": "COMPLETE",
  "task_id": "{task-id}",
  "pr_url": "{PR URL}",
  "judgment_path": ".crew/plans/{task-id}/judgment.md"
}
```

**ESCALATE**:
```json
{
  "status": "ESCALATE",
  "phase": "1-invalid-contract" | "2-dev-fail" | "3-agent-fail" | "3-verify-fail" | "4-agent-fail" | "4-judgment-fail" | "criterion-stuck" | "loop-overflow",
  "reason": "자유형 텍스트",
  "loop_count": 0,
  "attached_files": ["경로"]
}
```
