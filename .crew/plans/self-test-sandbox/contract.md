# Contract: self-test-sandbox

## 목표
claude-crew 플러그인 레포 안에서 별도 레포 없이 전체 스킬 파이프라인을 E2E smoke test할 수 있는 자체 테스트 구조를 만든다.

## 수용 기준
- [ ] `npm run smoke` 한 번으로 셋업부터 전체 파이프라인 실행 + 결과 보고까지 완료된다
- [ ] crew-agent-runner의 resolve, render, validate sub-command가 정상 실행된다 (exit code 0)
- [ ] crew-setup, crew-interview, crew-plan, crew-dev 각각의 실행 결과가 PASS/FAIL/TIMEOUT/SKIP으로 보고된다
- [ ] 각 스킬의 산출물(spec.md, plan.md, dev-log.md 등)이 생성되고 필수 섹션을 포함한다
- [ ] sandbox 디렉토리가 반복 실행 시 정상적으로 초기화된다 (idempotent)
- [ ] 기존 vitest 단위 테스트(`npm run test:run`)에 영향을 주지 않는다

## 유저 플로우

### 정상 플로우
1. `npm run smoke` 실행
2. sandbox(`test-sandbox/`) 생성/초기화
3. fixture 배치 + git init + `claude plugin add`
4. crew-agent-runner sub-command 검증 (resolve, render, validate)
5. crew-setup → crew-interview → crew-plan → crew-dev 순차 실행
6. 각 단계별 exit code + 산출물 존재 + 필수 섹션 검증
7. 결과 요약 보고

### 예외 플로우
- sandbox 이미 존재: rm -rf 후 재생성
- 타임아웃: TIMEOUT 보고, 다음 스킬 또는 SKIP
- 플러그인 등록 실패: 전체 중단
- 중간 스킬 실패: FAIL 보고, 의존 스킬 SKIP

## 비즈니스 규칙
- sandbox: `test-sandbox/`, git init 필수
- fixture: `tests/fixtures/smoke/{package.json, index.js, README.md}`
- 플러그인: `claude plugin add <PLUGIN_ROOT 절대경로>`
- 실행: `claude -p --dir` print mode
- .crew/ 상태 누적 (interview→plan 의존)
- test-sandbox/ .gitignore 추가

## 가드레일

### Must
- smoke 스크립트는 dev 환경 전용 도구 (plugin.json + package.json name 가드)
- test-sandbox/를 .gitignore에 추가
- 기존 vitest와 분리 (tests/smoke/ 경로, *.test.mjs 패턴에 미포함)
- 매 실행 시 clean start (rm -rf 후 재생성)
- 결과 형식: PASS | FAIL | TIMEOUT | SKIP + 실패 사유 1줄
- 타임아웃: sub-command 30s, crew-setup 120s, crew-interview 300s, crew-plan 600s, crew-dev 900s
- 경로는 PLUGIN_ROOT 기반 절대경로

### Must NOT
- npm run test / vitest run에서 smoke가 실행되면 안 됨
- plugin source repo 외부 파일(~/.claude/settings.json 등) 수정 안 됨
- sandbox git push 안 됨
- API 키 하드코딩 안 됨
- crew-agent-runner --root flag 없이 cwd 의존 테스트 안 됨

## 테스트 전략
None — smoke 스크립트 자체가 E2E 검증 도구. 별도 단위 테스트 없음.

## 검증 시나리오
1. 전체 파이프라인 정상 순환
2. sandbox 반복 실행 idempotent
3. 플러그인 등록 실패 시 조기 중단
4. 중간 스킬 실패 시 의존 스킬 SKIP
5. 타임아웃 처리
6. 기존 vitest와 격리
7. dev 환경 가드

## 실행 검증
1. `npm run smoke` → sandbox 생성 → sub-command PASS → 스킬별 결과 → 요약 확인
2. 반복 실행 → garbage 파일 부재 확인 (clean start)
3. `npm run test:run` → smoke 미실행 확인
4. `git status` → test-sandbox/ untracked 미표시 확인

## 참조 문서
- spec: `.crew/plans/self-test-sandbox/spec.md`
- analysis: `.crew/plans/self-test-sandbox/analysis.md`
- plan: `.crew/plans/self-test-sandbox/plan.md`
- review: `.crew/plans/self-test-sandbox/review.md`

## 검증 이력
| 회차 | 판정 | 사유 |
|------|------|------|
| 1 | PASS | E1-E8 전부 YES |

## 워크트리
worktree-feat-self-test-sandbox

## 상태
DONE
