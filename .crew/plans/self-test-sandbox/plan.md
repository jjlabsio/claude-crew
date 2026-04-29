# 구현 계획: self-test-sandbox

## 테스트 전략

None -- analysis.md 결정 반영. smoke 스크립트(`tests/smoke/run.mjs`) 자체가 E2E 검증 도구이므로 별도 단위 테스트를 작성하지 않는다. 기존 vitest 인프라(`npm run test:run`)와 완전히 분리한다.

---

## 유저 스토리

### US-1: 개발자가 `npm run smoke` 한 번으로 전체 smoke test를 실행한다

개발자가 터미널에서 `npm run smoke`를 입력하면, sandbox 생성부터 플러그인 등록, crew-agent-runner sub-command 검증, 4개 스킬 파이프라인 순환 실행, 결과 보고까지 자동으로 완료된다.

#### 구현 태스크

- [ ] `package.json`: `scripts`에 `"smoke": "node tests/smoke/run.mjs"` 추가
- [ ] `tests/smoke/run.mjs`: 메인 진입점 스크립트 생성. 아래 흐름을 순차 실행:
  1. dev 환경 가드 (`.claude-plugin/plugin.json` 존재 + `package.json` name 일치 확인)
  2. sandbox 초기화 호출
  3. crew-agent-runner sub-command 검증 호출
  4. 스킬 파이프라인 순차 실행 호출
  5. 결과 요약 출력 (각 단계별 PASS/FAIL/TIMEOUT/SKIP + 실패 사유 1줄)
  6. 전체 성공 시 exit code 0, 하나라도 FAIL 시 exit code 1
- [ ] `.gitignore`: `test-sandbox/` 항목 추가

#### 테스트 시나리오

- TS-1.1: 정상 실행 -- `npm run smoke` 실행 시 모든 단계가 순차 진행되고 결과 요약이 출력된다. 기대 결과: exit code 0 또는 1과 함께 각 단계별 PASS/FAIL/TIMEOUT/SKIP 상태가 표시된다.
- TS-1.2: dev 환경 가드 실패 -- `.claude-plugin/plugin.json`이 없는 디렉토리에서 실행 시. 기대 결과: 즉시 에러 메시지 출력 후 종료 (exit code 1).

---

### US-2: sandbox 디렉토리가 반복 실행 시 항상 clean 상태로 초기화된다

smoke 스크립트 실행 시 `test-sandbox/`가 이미 존재하면 완전히 삭제 후 재생성한다. fixture 파일을 복사하고 git init하여 실제 프로젝트처럼 구성한 뒤, `claude plugin add`로 플러그인을 등록한다.

#### 구현 태스크

- [ ] `tests/fixtures/smoke/package.json`: 최소 fixture 프로젝트의 package.json (name, version 등 최소 필드)
- [ ] `tests/fixtures/smoke/index.js`: 최소 fixture 프로젝트의 진입점 (빈 모듈 또는 최소 코드)
- [ ] `tests/fixtures/smoke/README.md`: 최소 fixture 프로젝트의 README
- [ ] `tests/smoke/lib/sandbox.mjs`: sandbox 초기화 모듈 생성
  - `PLUGIN_ROOT` 기반 절대경로로 `test-sandbox/` 위치 결정
  - 기존 `test-sandbox/` 존재 시 `rm -rf` 후 재생성
  - `tests/fixtures/smoke/` 파일을 `test-sandbox/`로 복사
  - sandbox 내에서 `git init && git add -A && git commit -m "initial"` 실행
  - `claude plugin add <PLUGIN_ROOT 절대경로>` 실행
  - plugin add 실패 시 에러 메시지와 함께 전체 smoke test 중단

#### 테스트 시나리오

- TS-2.1: 첫 실행 (sandbox 미존재) -- `test-sandbox/`가 없는 상태에서 실행. 기대 결과: 디렉토리 생성, fixture 파일 3개 존재, git repo 초기화됨, 플러그인 등록 완료.
- TS-2.2: 반복 실행 (sandbox 이미 존재) -- 이전 실행 잔여물이 있는 상태. 기대 결과: 기존 디렉토리 완전 삭제 후 동일하게 재생성. idempotent 동작.
- TS-2.3: 플러그인 등록 실패 -- `claude` CLI가 없거나 plugin add가 실패. 기대 결과: 에러 메시지 출력 후 smoke test 전체 중단 (후속 단계 미실행).

---

### US-3: crew-agent-runner sub-command(resolve, render, validate)가 정상 동작하는지 검증된다

스킬 파이프라인 실행 전에 crew-agent-runner의 핵심 sub-command 3개가 올바르게 동작하는지 먼저 확인한다. `--root` flag를 사용하여 sandbox 경로를 명시한다.

#### 구현 태스크

- [ ] `tests/smoke/lib/runner-check.mjs`: crew-agent-runner sub-command 검증 모듈 생성
  - `resolve --role dev --json`: exit code 0 + stdout이 유효한 JSON 확인
  - `render --role dev --request-file <임시 request JSON>`: exit code 0 + stdout 비어있지 않음 확인. 임시 request JSON 파일을 생성하여 `--request-file`로 전달
  - `validate --root <PLUGIN_ROOT>`: exit code 0 + stdout에 "OK" 포함 확인
  - 각 sub-command 타임아웃: 30초 (`AbortSignal.timeout(30_000)`)
  - 모든 경로는 PLUGIN_ROOT 기반 절대경로 사용

#### 테스트 시나리오

- TS-3.1: 정상 실행 -- 3개 sub-command 모두 exit code 0 반환. 기대 결과: resolve는 유효 JSON 출력, render는 비어있지 않은 프롬프트 출력, validate는 "OK" 출력. 각각 PASS 보고.
- TS-3.2: 타임아웃 -- sub-command가 30초 이내 응답하지 않음. 기대 결과: 해당 sub-command TIMEOUT 보고, 다음 sub-command로 진행.

---

### US-4: 4개 스킬(crew-setup, crew-interview, crew-plan, crew-dev)이 순차 실행되고 산출물이 검증된다

`claude -p --dir test-sandbox/` 형태로 각 스킬을 비대화형 실행한다. 각 스킬에 자동 응답 지시를 프롬프트에 주입하여 대화형 루프를 우회한다. 선행 스킬 실패 시 의존하는 후속 스킬은 SKIP 처리한다.

#### 구현 태스크

- [ ] `tests/smoke/lib/skills.mjs`: 스킬 파이프라인 실행 모듈 생성
  - 공통: `child_process.spawn`으로 `claude -p --dir <sandbox 절대경로>` 실행. 각 스킬별 프롬프트를 stdin으로 전달
  - **crew-setup** (타임아웃 120초): 프롬프트에 "provider 설정은 모두 기본값, HUD 설치 안 함" 지시. 검증: exit code 0 + 설정 파일 생성 확인
  - **crew-interview** (타임아웃 300초): 프롬프트에 task-id를 `smoke-test`로 지정, "모든 질문에 기본 선택지 선택, 최소 스코프로 진행, fixture 프로젝트에 간단한 기능 추가 요청" 지시. 검증: exit code 0 + `.crew/plans/smoke-test/spec.md` 존재 + 필수 섹션(목표, 스코프 경계, 수용 기준) 포함
  - **crew-plan** (타임아웃 600초): 프롬프트에 "테스트 전략은 None" 지시. 검증: exit code 0 + `.crew/plans/smoke-test/plan.md` 존재 + 필수 섹션 포함
  - **crew-dev** (타임아웃 900초): 검증: exit code 0 + 코드 변경 또는 `.crew/plans/smoke-test/` 하위에 dev-log.md 등 산출물 생성
  - 의존성 SKIP 로직: crew-interview FAIL 시 crew-plan, crew-dev SKIP. crew-plan FAIL 시 crew-dev SKIP

- [ ] `tests/smoke/lib/verify.mjs`: 산출물 검증 헬퍼 모듈 생성
  - `assertFileExists(path)`: 파일 존재 확인
  - `assertContainsSections(path, sections)`: 파일 내용에 지정된 섹션 헤딩들이 포함되는지 확인
  - 검증 실패 시 구체적 실패 사유 반환 (어떤 파일의 어떤 섹션이 누락되었는지)

#### 테스트 시나리오

- TS-4.1: 전체 파이프라인 정상 -- 4개 스킬 모두 성공. 기대 결과: 모든 스킬 PASS, spec.md/plan.md 등 산출물이 필수 섹션을 포함.
- TS-4.2: 타임아웃 발생 -- 특정 스킬이 타임아웃 초과. 기대 결과: 해당 스킬 TIMEOUT 보고, 의존 스킬 SKIP 처리, 비의존 스킬은 계속 진행.
- TS-4.3: 중간 단계 실패 -- crew-interview가 FAIL. 기대 결과: crew-plan과 crew-dev가 SKIP으로 보고되고, 결과 요약에 SKIP 사유 표시.
- TS-4.4: 산출물 내용 검증 실패 -- spec.md가 생성되었지만 "목표" 섹션이 누락. 기대 결과: crew-interview가 FAIL로 보고, 실패 사유에 "missing section: 목표" 표시.

---

### US-5: 결과가 일관된 형식으로 요약 보고된다

모든 단계 실행 후, 각 단계별 상태(PASS/FAIL/TIMEOUT/SKIP)와 실패 사유를 1줄씩 표 형태로 출력한다.

#### 구현 태스크

- [ ] `tests/smoke/lib/report.mjs`: 결과 보고 모듈 생성
  - 각 단계의 결과를 `{ name, status, reason? }` 형태로 수집
  - 출력 형식: `[PASS] crew-setup`, `[FAIL] crew-interview -- missing section: 목표`, `[SKIP] crew-plan -- dependency failed: crew-interview`, `[TIMEOUT] crew-dev -- exceeded 900s`
  - 전체 성공(모든 PASS) 시 최종 메시지 "All smoke tests passed" 출력
  - 하나라도 FAIL/TIMEOUT 시 "Smoke tests failed: N/M passed" 출력

#### 테스트 시나리오

- TS-5.1: 전체 성공 -- 모든 단계 PASS. 기대 결과: 각 단계 `[PASS]` 표시, 최종 "All smoke tests passed" 메시지, exit code 0.
- TS-5.2: 부분 실패 -- 일부 단계 FAIL/TIMEOUT. 기대 결과: 실패 단계에 1줄 사유 표시, 최종 "Smoke tests failed: N/M passed" 메시지, exit code 1.

---

## 위험 요소

| # | 위험 | 영향 | 완화 방안 |
|---|------|------|----------|
| R1 | 대화형 스킬(crew-setup, crew-interview)의 비대화형 실행 시 `AskUserQuestion` 호출 동작 불확실 | `claude -p`에서 대화형 질문이 발생하면 스킬이 멈추거나 실패할 수 있음 | 프롬프트에 "모든 결정을 자체적으로 내려라, 사용자에게 질문하지 말라" 지시를 강하게 주입. 타임아웃으로 무한 대기 방지 |
| R2 | API 비용 -- 매 실행마다 4개 스킬 Claude API 호출로 상당한 토큰 소비 | 빈번한 실행 시 비용 누적 | 개발자가 의도적으로 `npm run smoke`를 실행할 때만 동작. CI 자동화는 v2 스코프 |
| R3 | crew-dev 실행 시간이 900초를 초과할 수 있음 | TIMEOUT 보고되나, 실제로는 정상 수행 중일 수 있음 | 타임아웃 값은 analysis.md 권장값(900s) 적용. 필요 시 환경변수로 오버라이드 가능하게 할 수 있으나 v1에서는 고정값 사용 |
| R4 | sandbox 클린업 실패 -- git lock 파일 등으로 `rm -rf` 실패 | 반복 실행 시 이전 상태가 오염된 채로 남음 | `fs.rm`의 `force: true` 옵션 사용. 실패 시 명시적 에러 메시지 출력 |
| R5 | `claude plugin add` 후 `~/.claude/plugins/installed_plugins.json`에 sandbox 등록 잔류 | 반복 실행 시 중복 등록 가능, 사용자 환경 오염 | smoke 스크립트는 plugin source repo 외부 파일을 수정하지 않는다는 가드레일에 의해, 별도 정리하지 않음. `claude plugin add`가 이미 등록된 경우 덮어쓰는지 확인 필요 (R6) |
| R6 | `claude plugin add`의 중복 등록 동작이 불명확 | 이미 등록된 플러그인을 다시 add하면 에러인지, 덮어쓰기인지 문서화되지 않음 | 첫 구현 후 수동 확인. 에러 발생 시 기존 등록 제거 후 재등록하는 방어 로직 추가 |
| R7 | 글로벌 설정 오염 -- crew-setup이 `~/.claude/settings.json`의 statusLine을 수정할 수 있음 | 사용자의 기존 Claude 설정이 변경됨 | 프롬프트에 "HUD 설치 안 함" 명시 지시로 완화. 가드레일 "smoke 스크립트가 plugin source repo 외부 파일을 수정하면 안 됨" 준수 |

---

## 외부 인터페이스 가정 (해당 시)

| 대상 | 가정하는 인터페이스 | 근거 | 검증 상태 |
|------|------------------|------|----------|
| `claude -p` (print mode) | stdin으로 프롬프트를 전달하면 비대화형으로 실행되고, 스킬이 자동 인식됨 | Claude Code CLI 공식 동작 | 검증됨 |
| `claude -p --dir <path>` | 지정된 디렉토리를 작업 디렉토리로 사용 | Claude Code CLI `--dir` flag | 검증됨 |
| `claude plugin add <path>` | 로컬 절대경로로 플러그인을 등록하고, 해당 디렉토리의 현재 파일 상태를 사용 | Claude Code 플러그인 시스템 | 검증됨 |
| `claude plugin add` 중복 실행 | 이미 등록된 경로를 다시 add하면 덮어쓰거나 무시 (에러 아님) | 문서 없음 | 미검증 |
| `AbortSignal.timeout(ms)` | Node.js spawn에서 프로세스 타임아웃 제어 가능 | Node.js 18+ 공식 API | 검증됨 |

---

## 검증 시나리오 (contract.md용)

### 시나리오 1: 전체 파이프라인 정상 순환

- 조건: Claude CLI 설치됨, 유효한 API 키 설정됨, `test-sandbox/` 미존재
- 행위: `npm run smoke` 실행
- 기대 결과:
  - `test-sandbox/` 디렉토리가 생성되고 fixture 파일(package.json, index.js, README.md)이 존재
  - `test-sandbox/`가 git repo로 초기화됨
  - crew-agent-runner sub-command 3개(resolve, render, validate) 각각 PASS 보고
  - crew-setup, crew-interview, crew-plan, crew-dev 각각 상태가 보고됨 (PASS 또는 TIMEOUT)
  - 결과 요약이 출력됨

### 시나리오 2: sandbox 반복 실행 idempotent

- 조건: 이전 smoke 실행으로 `test-sandbox/`가 이미 존재 (잔여 파일 포함)
- 행위: `npm run smoke` 재실행
- 기대 결과:
  - 기존 `test-sandbox/` 완전 삭제 후 새로 생성
  - 이전 실행의 `.crew/` 상태가 남아있지 않음
  - 모든 단계가 clean 상태에서 시작

### 시나리오 3: 플러그인 등록 실패 시 조기 중단

- 조건: `claude` CLI가 설치되지 않았거나, `claude plugin add`가 실패하는 환경
- 행위: `npm run smoke` 실행
- 기대 결과:
  - 에러 메시지 출력 (plugin add 실패 사유)
  - 후속 단계(sub-command 검증, 스킬 실행) 미실행
  - exit code 1

### 시나리오 4: 중간 스킬 실패 시 의존 스킬 SKIP

- 조건: crew-interview가 FAIL (spec.md 미생성)
- 행위: 후속 스킬 실행 판정
- 기대 결과:
  - crew-plan: SKIP (사유: "dependency failed: crew-interview")
  - crew-dev: SKIP (사유: "dependency failed: crew-plan")
  - 결과 요약에 SKIP 사유 포함

### 시나리오 5: 타임아웃 처리

- 조건: 특정 스킬이 지정된 타임아웃(예: crew-dev 900초)을 초과
- 행위: 타임아웃 발생
- 기대 결과:
  - 해당 스킬 프로세스 종료
  - 해당 스킬 TIMEOUT 보고
  - 후속 의존 스킬 SKIP 처리

### 시나리오 6: 기존 vitest와 격리 확인

- 조건: smoke 스크립트가 `tests/smoke/run.mjs`에 위치
- 행위: `npm run test:run` 실행
- 기대 결과:
  - smoke 스크립트가 vitest에 의해 실행되지 않음
  - vitest 패턴 `tests/**/*.test.mjs`에 `run.mjs`가 매칭되지 않음
  - 기존 단위 테스트만 실행

### 시나리오 7: dev 환경 가드

- 조건: `.claude-plugin/plugin.json`이 존재하지 않는 디렉토리에서 실행
- 행위: `node tests/smoke/run.mjs` 실행
- 기대 결과:
  - "This script must be run from the claude-crew plugin root" 또는 유사 에러 메시지 출력
  - exit code 1
  - sandbox 생성 시도 없음

---

## 실행 검증

사용자(개발자) 관점에서 기능을 동작시키는 구체 절차:

### 절차 1: 기본 실행

1. 프로젝트 루트에서 `npm run smoke` 실행
2. 콘솔에 sandbox 생성 로그가 출력되는지 확인
3. `[PASS] resolve`, `[PASS] render`, `[PASS] validate` 등 sub-command 결과 확인
4. `[PASS] crew-setup` 또는 `[FAIL/TIMEOUT] crew-setup` 등 스킬별 결과 확인
5. 최종 요약 라인 확인: "All smoke tests passed" 또는 "Smoke tests failed: N/M passed"
6. `test-sandbox/` 디렉토리 내부에 fixture 파일과 `.crew/` 디렉토리 확인

### 절차 2: 반복 실행 검증

1. `npm run smoke` 실행 (첫 번째)
2. `test-sandbox/` 내부에 임의 파일 추가 (예: `touch test-sandbox/garbage.txt`)
3. `npm run smoke` 재실행 (두 번째)
4. `test-sandbox/garbage.txt`가 존재하지 않음을 확인 (clean start 검증)

### 절차 3: vitest 격리 검증

1. `npm run test:run` 실행
2. smoke 관련 테스트가 실행되지 않음을 확인 (vitest 출력에 `tests/smoke/` 파일 없음)

### 절차 4: gitignore 검증

1. `npm run smoke` 실행 후 `git status` 확인
2. `test-sandbox/` 디렉토리가 untracked files에 표시되지 않음을 확인
