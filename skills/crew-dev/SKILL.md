---
name: crew-dev
description: contract.md를 입력으로 받아 Dev + CodeReviewer + QA 파이프라인으로 구현을 완료한다
---

## 역할

오케스트레이터로부터 task-id를 받아 `contract.md` 기반으로 구현을 완료하고 PR을 생성한다.
`contract.md`가 ACTIVE 상태여야 시작할 수 있다.

에이전트 간 소통은 파일을 통해서만 이루어진다. 각 에이전트는 자신의 역할에 필요한 파일만 본다.

**v1 대비 변경**: Critic(DevAuditor) 제거. 오케스트레이터가 CodeReviewer + QA 결과로 직접 판정한다.

---

## Multi-Provider 지원

에이전트별로 claude 또는 codex provider를 사용할 수 있다. `/crew-setup`에서 설정한 config를 기반으로 디스패치한다.

### Provider 설정 해석

오케스트레이터는 Phase 1에서 config 파일과 `data/provider-catalog.json`을 읽어 각 에이전트의 provider 설정을 결정한다.

**config 해석 우선순위 (cascading):**
1. `{projectRoot}/.crew/config.json`의 `providers.{role}` — 프로젝트 오버라이드 (최우선)
2. `~/.claude/crew/config.json`의 `providers.{role}` — 유저 레벨 기본값
3. `data/provider-catalog.json`의 `agent_defaults.{role}` — 하드코딩 폴백

**해석된 설정 예시:**
```json
{ "provider": "codex", "model": "gpt-5.4", "reasoning": "xhigh" }
{ "provider": "claude", "model": "opus" }
```

### 디스패치 규칙

**claude provider:**
```
Agent(subagent_type="{role}", model="{model}", description="...", prompt="...")
```
기존과 동일. `model` 파라미터를 설정값으로 전달한다.

**codex provider:**
```
Bash("codex exec --model {model} -c model_reasoning_effort=\"{reasoning}\" --dangerously-bypass-approvals-and-sandbox \"{prompt}\"")
```
- 프롬프트가 길면 임시 파일에 저장 후 `cat`으로 전달한다.
- Codex는 CWD 기준으로 작업하므로 워크트리 안에서 실행한다.
- Codex의 stdout에서 결과를 캡처한다.

**codex provider 제약:**
- Codex는 Claude Code의 Read/Edit/Glob 도구가 아닌 자체 도구를 사용한다.
- Codex 에이전트는 `.crew/` 파일에 직접 접근할 수 없으므로, 프롬프트에 필요한 내용을 인라인으로 주입해야 한다.
- Codex dev-log.md 작성: Codex stdout을 오케스트레이터가 파싱하여 dev-log.md를 생성한다.

---

## 절대 금지

- 오케스트레이터가 코드를 직접 작성하지 않는다.
- CodeReviewer 또는 QA가 FAIL을 냈을 때 합리화하여 통과시키지 않는다.
- brief.md를 어떤 에이전트에게도 전달하지 않는다.
- contract.md를 CodeReviewer에게 전달하지 않는다 (가드레일만 인라인 주입).
- plan.md를 CodeReviewer에게 전달하지 않는다.
- git commit 시 `--no-verify`를 생략하지 않는다 (호스트 프로젝트의 pre-commit hook 중복 실행 방지).
- Dev가 자체 검증을 통과하지 못한 상태에서 검증 단계로 넘기지 않는다.

---

## 파일 구조

```
.crew/plans/{task-id}/
  # crew-plan 산출물 (입력, 이미 존재)
  brief.md              # crew-interview: 유저 원본 요청
  spec.md               # crew-interview: 인터뷰 완료 후 결정화된 스펙
  analysis.md           # TechLead 출력
  plan.md               # Planner 출력
  contract.md           # 스프린트 계약

  # crew-dev 산출물 (신규 생성)
  dev-log.md            # Dev: 구현 진행 로그
  review-report.md      # CodeReviewer: 코드 리뷰 결과 (최신)
  qa-report.md          # QA: 실행 검증 결과 (최신)
  review-report-{n}.md  # FAIL 시 아카이브
  qa-report-{n}.md      # FAIL 시 아카이브
  .dev_loop_count       # 개발 루프 카운터
```

---

## 에이전트 정보 차단 정책

| 에이전트 | subagent_type | 볼 수 있는 것 | 차단 | 차단 근거 |
|----------|--------------|-------------|------|----------|
| **Dev** | dev | plan.md, contract.md | brief.md, spec.md, analysis.md | 의도 추측 방지, plan+contract에 필요 정보 포함 |
| **CodeReviewer** | code-reviewer | git diff(직접 실행), 가드레일(인라인) | contract.md, plan.md, brief.md, spec.md, dev-log.md | 수용 기준 체리피킹 방지 (.crew/는 .gitignore 대상이므로 diff에 노출되지 않음) |
| **QA** | qa | plan.md | contract.md, brief.md, spec.md | 검증 편향 방지 |

**중요**: 모든 에이전트 호출 시 반드시 `subagent_type` 파라미터를 지정해야 한다. `subagent_type`이 없으면 PreToolUse hook이 호출을 차단한다. `model` 파라미터는 생략 가능 — hook이 에이전트 정의에서 자동 주입한다.

---

## 실행 순서

### Phase 1 — 환경 준비 (오케스트레이터 직접)

**1a. Provider 설정 로드**

1. `data/provider-catalog.json`을 읽어 `agent_defaults`를 로드한다.
2. `~/.claude/crew/config.json`이 있으면 `providers` 필드를 읽어 `agent_defaults`를 오버라이드한다 (유저 레벨).
3. `{projectRoot}/.crew/config.json`이 있으면 `providers` 필드를 읽어 다시 오버라이드한다 (프로젝트 레벨, 최우선).
4. codex provider가 하나라도 설정되어 있으면 `which codex`로 가용성을 확인한다.
   - codex가 없으면 경고를 출력하고 해당 에이전트를 기본값(claude)으로 폴백한다.

해석된 설정을 Phase 2, 3에서 ��용한다.

**1b. contract.md 유효성 검사**

`.crew/plans/{task-id}/contract.md`를 읽는다.
- 파일이 존재하는가?
- `## 상태` 섹션이 `ACTIVE`인가?
- `## 수용 기준` 섹션이 비어 있지 않은가?
- `## 검증 시나리오` 섹션이 존재하는가?

하나라도 실패하면 즉시 에스컬레이션:

```
contract.md 유효성 검사에 실패했습니다.
실패 사유: {구체적 사유}
[1] crew-plan을 먼저 실행하여 contract.md를 생성
[2] contract.md를 직접 수정
[3] 이 태스크를 보류
```

**1c. 워크트리 생성**

Claude Code의 `EnterWorktree` 도구를 사용한다:

```
EnterWorktree(name="feat/{task-id}")
```

워크트리 진입 후 브랜치를 `origin/main` 기준으로 리셋한다:

```bash
git fetch origin main
git reset --hard origin/main
```

이후 모든 작업은 워크트리에서 수행한다.
환경 파일(`.env*` 등)이 원본 프로젝트에 있으면 복사한다.

**1d. 상태 갱신**

contract.md의 `## 상태` 섹션을 갱신한다:

```markdown
## 상태
IN_PROGRESS — Dev 에이전트가 구현 중이다.
```

---

### Phase 2 — 구현 (Dev 에이전트)

Phase 1a에서 해석된 dev 설정에 따라 디스패치한다.

#### Phase 2 — claude provider인 경우

호출:

```
Agent(subagent_type="dev", model="{설정된 모델}", description="Dev: {task-id} 구현", prompt="...")
```

**첫 번째 실행 시 에이전트 프롬프트**:

```
당신은 Dev 에이전트다. plan.md를 기반으로 코드를 구현한다.

## 입력
.crew/plans/{task-id}/plan.md 를 읽어라.
.crew/plans/{task-id}/contract.md 를 읽어라 (수용 기준 = 완료 기준).
brief.md, spec.md, analysis.md는 읽지 않는다.

## 작업 순서
1. plan.md의 유저 스토리와 태스크 목록을 확인한다.
2. plan.md의 `## 테스트 전략` 섹션을 확인한다.
3. 코드베이스를 탐색한다 (Glob, Grep, Read로 관련 파일 파악).
4. 유저 스토리 단위로 순차 구현한다.
   - **TDD인 경우**: 각 태스크에서 반드시 RED→GREEN→REFACTOR 순서를 따른다.
     1. RED: 실패하는 테스트를 먼저 작성하고 실행하여 FAIL을 확인한다.
     2. GREEN: 테스트를 통과하는 최소한의 코드를 작성한다.
     3. REFACTOR: 코드 품질을 개선한다 (필요시).
   - **Tests-after인 경우**: 구현을 먼저 완료한 후, plan.md에 명시된 테스트 태스크를 수행한다.
   - **None인 경우**: 현재와 동일하게 구현한다.
5. 각 유저 스토리 완료 후 dev-log.md에 진행상황을 기록한다.
6. 모든 구현 완료 후 자체 검증을 실행한다:
   - 빌드 성공 확인
   - 린트 통과 확인
   - 타입 체크 통과 확인
   - 기존 테스트 스위트 통과 확인
   - lint-staged 검증: `npx lint-staged --dry-run` 실행 (설정이 있는 경우에만)
   - 실행 검증: plan.md의 `## 실행 검증` 절차를 직접 실행하여 기능이 실제로 동작하는지 확인. 이것은 유닛 테스트와 별개로, 구현한 기능을 사용자 관점에서 직접 실행하는 것이다.
7. 자체 검증이 모두 통과하면 완료를 선언한다.
   자체 검증이 실패하면 직접 수정하여 통과시킨다.

## 출력
.crew/plans/{task-id}/dev-log.md 를 작성하라.

## 규칙
- plan.md에 없는 것을 구현하지 않는다 (스코프 크리프 금지).
- 자체 검증 6개(빌드/린트/타입/테스트/lint-staged/실행 검증) 모두 PASS 해야 완료를 선언할 수 있다.
- 기존 코드베이스의 컨벤션을 따른다.
- TDD 전략인 경우, 테스트를 먼저 작성하지 않고 프로덕션 코드를 작성하지 않는다.
```

**retry 시 에이전트 프롬프트**:

```
이번은 이전 구현이 검증에서 FAIL을 받은 후 수정하는 것이다.

## 입력
.crew/plans/{task-id}/plan.md 를 읽어라.
.crew/plans/{task-id}/contract.md 를 읽어라.
.crew/plans/{task-id}/review-report-{n}.md 를 읽어라. (CodeReviewer 피드백)
.crew/plans/{task-id}/qa-report-{n}.md 를 읽어라. (QA 피드백)
brief.md, spec.md, analysis.md는 읽지 않는다.

## 필수 선행 작업
피드백 파일을 먼저 읽어라. 어떤 항목이 FAIL인지 확인하고 해당 부분을 수정하라.

## 작업 순서
1. 피드백에서 FAIL 항목을 모두 파악한다.
2. 각 FAIL 항목에 대해 수정을 수행한다.
3. dev-log.md를 갱신한다 (최상단에 "수정 이력 (retry {n})" 섹션 추가).
4. 자체 검증 6개를 모두 다시 실행한다 (빌드/린트/타입/테스트/lint-staged/실행 검증).

## 규칙
- 피드백에서 지적하지 않은 부분을 추가로 변경하지 않는다.
- 자체 검증 6개 모두 PASS 해야 완료를 선언할 수 있다.
```

#### Phase 2 — codex provider인 경우

오케스트레이터가 다음을 수행한다:

1. plan.md와 contract.md의 내용을 읽어 프롬프트에 인라인으로 주입한다.
2. Codex를 실행한다:

```bash
codex exec --model {model} -c model_reasoning_effort="{reasoning}" --dangerously-bypass-approvals-and-sandbox "$(cat <<'PROMPT'
당신은 Dev 에이전트다. 아래 plan.md를 기반으로 코드를 구현한다.

## plan.md
{오케스트레이터가 plan.md 내용을 여기에 인라인 삽입}

## contract.md (수용 기준)
{오케스트레이터가 contract.md의 수용 기준 섹션을 여기에 인라인 삽입}

## 작업 순서
1. 코드베이스를 탐색하여 관련 파일을 파악한다.
2. 유저 스토리 단위로 순차 구현한다.
3. 모든 구현 완료 후 자체 검증을 실행한다:
   - 빌드 성공 확인
   - 린트 통과 확인
   - 타입 체크 통과 확인
   - 기존 테스트 스위트 통과 확인
4. 자체 검증이 실패하면 직접 수정하여 통과시킨다.

## 규칙
- plan.md에 없는 것을 구현하지 않는다.
- 자체 검증 모두 PASS 해야 완료를 선언할 수 있다.
- 기존 코드베이스의 컨벤션을 따른다.

## 완료 시 출력
구현 요약을 마지막에 출력하라:
- 변경한 파일 목록
- 각 유저 스토리별 구현 내용 1줄 요약
- 자체 검증 결과 (각 항목별 PASS/FAIL + 명령어 + 출력)
PROMPT
)"
```

3. Codex stdout을 캡처하여 `.crew/plans/{task-id}/dev-log.md`를 생성한다.

**retry 시 (codex provider)**:

동일한 패턴으로, 프롬프트에 review-report-{n}.md와 qa-report-{n}.md 내용을 인라인 삽입한다.

**Phase 2 실패 조건**: Dev 에이전트가 자체 검증을 통과하지 못한 채 완료를 선언하면 에스컬레이션.

---

### Phase 3 — 병렬 검증 (CodeReviewer + QA)

CodeReviewer와 QA를 **동시에** Agent tool 2개로 호출한다.

#### Phase 3a — CodeReviewer

Phase 1a에서 해석된 code-reviewer 설정에 따라 디스패치한다.

**claude provider 호출:**

```
Agent(subagent_type="code-reviewer", model="{설정된 모델}", description="CodeReviewer: {task-id} 코드 리뷰", prompt="...")
```

**codex provider 호출:**

오케스트레이터가 `git diff main...HEAD`를 실행하여 diff를 캡처한 뒤, diff와 가드레일을 프롬프트에 인라인 삽입하여 Codex를 실행한다.

```bash
codex exec --model {model} -c model_reasoning_effort="{reasoning}" --dangerously-bypass-approvals-and-sandbox "$(cat <<'PROMPT'
당신은 CodeReviewer다. 아래 코드 변경 사항의 품질을 판단하라.

## 변경 사항 (git diff)
{오케스트레이터가 git diff 결과를 인라인 삽입}

## 가드레일
### Must
{contract.md에서 추출한 Must 항목}
### Must NOT
{contract.md에서 추출한 Must NOT 항목}

## 검토 항목 / 판정 규칙 / 출력 형식
(claude provider 프롬프트와 동일)
PROMPT
)"
```

Codex stdout을 캡처하여 review-report.md 내용으로 사용한다.

**공통 사전 작업 (provider 무관):**

오케스트레이터가 해야 할 사전 작업:
1. contract.md에서 가드레일 섹션(Must/Must NOT)만 추출한다.
2. 가드레일을 CodeReviewer 프롬프트에 인라인으로 주입한다.

에이전트 프롬프트:

```
당신은 CodeReviewer 에이전트다. 코드 변경 사항의 품질을 판단한다.

## 입력
`git diff main...HEAD`를 직접 실행하여 변경 사항을 확인하라.
contract.md, plan.md, brief.md, spec.md, dev-log.md는 읽지 않는다.
코드만 보고 판단한다.

### 가드레일 (contract.md에서 추출)
#### Must
- {오케스트레이터가 contract.md에서 복사한 내용}
#### Must NOT
- {오케스트레이터가 contract.md에서 복사한 내용}

위 가드레일을 위반하는 변경이 있으면 critical로 지적하라.

## 검토 항목
1. 가드레일 위반 (위반 시 critical)
2. 코드베이스 컨벤션 준수 (기존 코드를 Glob/Grep/Read로 탐색하여 확인)
3. 보안 취약점
4. 불필요한 복잡도
5. 잠재적 버그
6. 에러 처리 적절성

## 출력
아래 형식으로 리뷰 결과를 텍스트로 반환하라. 파일을 직접 작성하지 않는다.

## 판정 규칙
- 가드레일 위반 → critical
- critical 또는 major가 1개 이상 → FAIL
- minor만 있거나 지적 없음 → PASS
```

#### Phase 3b — QA

Phase 1a에서 해석된 qa 설정에 따라 디스패치한다.

**claude provider 호출:**

```
Agent(subagent_type="qa", model="{설정된 모델}", description="QA: {task-id} 검증", prompt="...")
```

**codex provider 호출:**

오케스트레이터가 plan.md 내용을 읽어 프롬프트에 인라인 삽입하여 Codex를 실행한다. Codex stdout을 캡처하여 qa-report.md 내용으로 사용한다.

```bash
codex exec --model {model} -c model_reasoning_effort="{reasoning}" --dangerously-bypass-approvals-and-sandbox "{QA 프롬프트 + plan.md 인라인}"
```

에이전트 프롬프트:

```
당신은 QA 에이전트다. 구현이 실제로 동작하는지 검증한다.

## 입력
.crew/plans/{task-id}/plan.md 를 읽어라.
plan.md의 유저 스토리와 테스트 시나리오를 확인하라.
contract.md, brief.md, spec.md는 읽지 않는다.

## 검증 항목 (순서대로 실행)
1. 빌드 검증 — FAIL이면 이후 항목 실행 없이 즉시 FAIL
2. 린트 검증
3. 타입 체크 검증
4. 테스트 스위트 검증
5. 테스트 전략 준수 검증 (TDD 또는 Tests-after인 경우)
   - plan.md에 명시된 테스트 파일이 실제로 존재하는가?
   - 해당 테스트가 실행되고 통과하는가?
   - None인 경우 이 항목을 PASS로 처리한다.
6. E2E / 통합 검증 — plan.md의 테스트 시나리오 기반
7. 실행 검증 — plan.md의 `## 실행 검증` 절차를 직접 실행한다.
   - 자동화 테스트와 별개로, 구현된 기능을 사용자 관점에서 직접 실행한다.
   - 백엔드: 실제 API 호출, 스크립트 실행 등
   - UI: 개발 서버에서 브라우저 조작
   - 각 항목의 기대 결과와 실제 결과를 비교하여 판정한다.
   - 실행 검증 섹션이 plan.md에 없으면 즉시 FAIL.

## 출력
아래 형식으로 검증 결과를 텍스트로 반환하라. 파일을 직접 작성하지 않는다.

## 판정 규칙
- 항목 1-7 중 하나라도 FAIL → 전체 FAIL
- 모든 항목 PASS → 전체 PASS

## 규칙
- 모든 검증은 직접 실행한다. "통과할 것이다"는 증거가 아니다.
- 실행 출력을 반드시 캡처하여 기록한다.
- 코드를 수정하지 않는다. 검증만 한다.
```

**Phase 3 결과 저장 (오케스트레이터 직접)**:

CodeReviewer와 QA 에이전트는 read-only이므로 파일을 직접 작성하지 않는다.
오케스트레이터가 각 에이전트의 반환 텍스트를 파일로 저장한다:
- CodeReviewer 결과 → `.crew/plans/{task-id}/review-report.md`
- QA 결과 → `.crew/plans/{task-id}/qa-report.md`

**Phase 3 병렬 실행 방법**:

오케스트레이터는 CodeReviewer와 QA를 **동시에** 호출한다. provider 조합에 따라:

- 둘 다 claude → Agent tool 2개를 한 번에 호출
- 둘 다 codex → Bash tool 2개를 한 번에 호출
- 혼합 → Agent + Bash를 한 번에 호출

```
# 예: code-reviewer=claude, qa=codex
Agent(subagent_type="code-reviewer", model="opus", description="CodeReviewer: {task-id}", prompt="...")
Bash("codex exec --model gpt-5.4 ... '{QA 프롬프트}'")
```

---

### Phase 4 — 오케스트레이터 직접 판정

**Critic(DevAuditor)을 사용하지 않는다.** 오케스트레이터가 CodeReviewer + QA 결과로 직접 판정한다.

판정 규칙:
- CodeReviewer PASS + QA PASS → **PASS** → Phase 5로
- 하나라도 FAIL → **FAIL** → Step 6으로

---

### Phase 5 — 완료 (오케스트레이터 직접)

**5a. 커밋 + PR**

```bash
git add -A
git commit --no-verify -m "feat({task-id}): {contract.md 목표 1줄 요약}"
git push -u origin feat/{task-id}
```

> `--no-verify`: crew-dev가 이미 빌드/린트/타입/테스트 + lint-staged 검증을 완료했으므로 호스트 프로젝트의 pre-commit hook을 중복 실행하지 않는다.

PR을 생성한다 (머지하지 않는다).

**5b. 상태 갱신**

contract.md의 `## 수용 기준` 섹션에서 모든 `- [ ]`를 `- [x]`로 변경한다.

contract.md의 `## 상태` 섹션을 갱신한다:

```markdown
## 상태
COMPLETED — 모든 수용 기준이 검증을 통과했다.
PR: {PR URL}
```

**5c. .dev_loop_count 정리**

`.dev_loop_count` 파일이 존재하면 삭제한다.

**5d. 워크트리 종료**

```
ExitWorktree(action="remove")
```

PR push가 완료되었으므로 로컬 워크트리를 제거하고 원본 프로젝트 디렉토리로 복귀한다.

**5e. 완료 반환**

```
상태: COMPLETE
task-id: {task-id}
PR: {PR URL}
```

---

### Step 6 — FAIL 처리 (검증 루프)

Phase 4에서 FAIL이면:

**6a. 루프 카운터 읽기**

`.crew/plans/{task-id}/.dev_loop_count` 파일을 읽는다.
- 파일이 없으면 카운터 = 0
- 파일이 있으면 파일 내용(정수)이 카운터 값

**6b. 에스컬레이션 판단**

두 가지 에스컬레이션 조건:

**조건 1 — 루프 상한 초과**:

카운터 값 >= 4이면 즉시 에스컬레이션:

```
검증 루프가 5회 반복 후에도 통과하지 못했습니다.
최종 FAIL 사유를 첨부합니다.
[1] 수용 기준을 좁혀서 재시도
[2] contract.md를 수정
[3] 이 태스크를 보류
```

에스컬레이션 시:
- `.dev_loop_count` 파일을 삭제한다.
- contract.md 상태를 `BLOCKED`으로 갱신한다.
- `ExitWorktree(action="keep")`으로 원본 프로젝트 디렉토리로 복귀한다.

**조건 2 — 같은 기준 3회 연속 실패**:

review-report.md와 qa-report.md에서 FAIL 항목을 확인한다.
이전 아카이브와 비교하여 같은 항목이 3회 연속 FAIL이면 즉시 에스컬레이션:

```
{항목}이 3회 연속 FAIL입니다. 구조적 문제로 판단합니다.
[1] contract.md를 수정 (기준 자체의 문제)
[2] plan.md를 수정 (구현 전략의 문제)
[3] 이 태스크를 보류
```

에스컬레이션 시 `ExitWorktree(action="keep")`으로 원본 프로젝트 디렉토리로 복귀한다.

**6c. 피드백 아카이브**

`n = 카운터 + 1`

```
review-report.md → review-report-{n}.md
qa-report.md → qa-report-{n}.md
```

**6d. 루프 카운터 증가 저장**

`카운터 + 1`을 `.dev_loop_count` 파일에 저장한다.

**6e. Phase 2로 돌아감 (retry)**

Phase 2(Dev)로 돌아간다. Dev retry 프롬프트에 아카이브된 피드백 파일을 주입한다.
Dev 수정 완료 후 Phase 3(CodeReviewer + QA)을 **둘 다** 재실행한다.

---

## 루프 카운터 (.dev_loop_count) 생명주기

| 이벤트 | 동작 |
|--------|------|
| 첫 번째 진입 | 파일 없음 (카운터 = 0) |
| n번째 FAIL 처리 후 | 파일 갱신, 내용: `n` |
| PASS (Phase 5) | 파일 삭제 |
| 에스컬레이션 | 파일 삭제 |

검증 사이클은 최대 5회 (초기 1회 + retry 최대 4회).

---

## 오케스트레이터 반환 스키마

**COMPLETE**:
```json
{
  "status": "COMPLETE",
  "task_id": "{task-id}",
  "pr_url": "{PR URL}"
}
```

**ESCALATE**:
```json
{
  "status": "ESCALATE",
  "phase": "invalid-contract" | "dev-fail" | "verify-fail" | "criterion-stuck" | "loop-overflow",
  "reason": "자유형 텍스트",
  "loop_count": 0
}
```
