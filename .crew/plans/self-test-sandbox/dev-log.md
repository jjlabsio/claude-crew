# 구현 로그: self-test-sandbox

## 수정 이력 (retry 1)
- stub 함수 시그니처를 plan.md 명세에 맞게 수정 (initSandbox -> setupSandbox, summarizeResults -> printReport 등)
- run.mjs의 import 및 호출 흐름을 plan.md 명세에 맞게 정리
- dev 환경 가드를 plugin.json 존재 확인으로 단순화 (package.json name 매칭은 US-2+ 에서 구현)
- npm install 실행 후 vitest 검증 완료

## 구현 요약
- US-1: package.json에 smoke 스크립트 추가, tests/smoke/run.mjs 진입점 생성, .gitignore에 test-sandbox/ 추가, tests/smoke/lib/ stub 모듈 5개 생성
- US-2: tests/fixtures/smoke/ 에 fixture 3개 생성, sandbox.mjs stub을 실제 구현으로 교체 (rm -rf -> mkdir -> fixture copy -> git init -> plugin marketplace add + install), run.mjs에 setupSandbox 실패 시 후속 단계 SKIP 로직 추가

## 자체 검증 결과
- 빌드: PASS + `node --check tests/smoke/lib/sandbox.mjs` + (no output, exit 0)
- 린트: PASS + `node --check tests/smoke/lib/*.mjs` + 모든 lib 파일 syntax 정상 (exit 0)
- 타입: PASS + N/A (순수 .mjs, TypeScript 미사용)
- 테스트: PASS + `npm run test:run` + 75 passed (16 test files)
- 실행 검증: PASS + `npm run smoke` 실행 + `[PASS] sandbox-init`, `[PASS] plugin-add`, "All smoke tests passed" 출력, exit code 0. test-sandbox/ 내부에 fixture 파일 3개 + .git 디렉토리 + .claude 디렉토리(plugin install 결과) 확인. 반복 실행 시 garbage.txt가 제거됨(idempotent 동작 확인). `git status`에서 test-sandbox/ 미표시(gitignore 정상). vitest 출력에 tests/smoke/ 파일 미포함 확인.

## 변경 파일 목록
- `tests/fixtures/smoke/package.json` + 최소 fixture (name: smoke-fixture, version: 1.0.0, private: true)
- `tests/fixtures/smoke/index.js` + 최소 진입점 (export default {})
- `tests/fixtures/smoke/README.md` + 최소 README (# Smoke Test Fixture)
- `tests/smoke/lib/sandbox.mjs` + stub에서 실제 구현으로 교체: fs.rm으로 기존 sandbox 삭제, mkdir으로 재생성, fixture 복사, git init + add + commit, claude plugin marketplace add + install. 각 단계 결과를 { name, status, reason? } 형태로 반환
- `tests/smoke/run.mjs` + setupSandbox 결과에 FAIL이 있으면 runner-check와 skills를 SKIP으로 처리하는 조건 분기 추가
