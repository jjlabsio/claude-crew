# 요구사항: self-test-sandbox

## 목표
claude-crew 플러그인 레포 안에서 별도 레포 없이 전체 스킬 파이프라인을 E2E smoke test할 수 있는 자체 테스트 구조를 만든다.

## 스코프 경계
- In:
  - sandbox 디렉토리 셋업 자동화 (fixture 프로젝트 + 플러그인 등록)
  - 핵심 파이프라인 전체 순환 자동 실행 (crew-setup → crew-interview → crew-plan → crew-dev)
  - crew-agent-runner sub-command 검증 (resolve, render, validate)
  - 각 단계별 exit code + 산출물 존재 + 산출물 내용 검증
  - `npm run smoke` 단일 명령으로 전체 실행
- Out:
  - task/tasks 스킬 검증 (v2)
  - CI 자동화 연동 (v2)

## 유저 플로우

### 정상 플로우
1. 개발자가 `npm run smoke` 실행
2. 스크립트가 sandbox 디렉토리(`test-sandbox/`)를 생성 또는 초기화
3. 최소 fixture 프로젝트(package.json + index.js + README)를 sandbox에 배치
4. `claude plugin add <플러그인 source repo 로컬 경로>`로 sandbox에 플러그인 등록
5. crew-agent-runner sub-command 검증: `resolve --role dev --json`, `render --role dev`, `validate` 실행 및 결과 확인
6. `claude -p --dir test-sandbox/` 로 crew-setup 실행 → exit code + 설정 파일 생성 확인
7. `claude -p --dir test-sandbox/` 로 crew-interview 실행 (Claude 자동 응답) → exit code + spec.md 생성 + 필수 섹션(목표, 스코프 경계, 수용 기준) 포함 확인
8. `claude -p --dir test-sandbox/` 로 crew-plan 실행 → exit code + plan.md 생성 + 필수 섹션 포함 확인
9. `claude -p --dir test-sandbox/` 로 crew-dev 실행 → exit code + 코드 변경 또는 dev-log.md 생성 확인
10. 전체 결과를 요약 보고 (PASS/FAIL per skill)

### 예외 플로우
- sandbox 디렉토리가 이미 존재: 기존 내용을 정리(clean)하고 재생성
- `claude -p` 실행 중 타임아웃: 해당 스킬을 TIMEOUT으로 보고하고 다음 스킬로 진행
- 플러그인 등록 실패: 에러 메시지와 함께 전체 smoke test 중단
- 특정 스킬 실패: 해당 스킬을 FAIL로 보고하되, 후속 스킬이 선행 산출물에 의존하면 SKIP 처리

## 비즈니스 규칙
- sandbox 디렉토리 위치: 프로젝트 루트의 `test-sandbox/`
- fixture 프로젝트: 최소 구성 (package.json + index.js + README.md). 실제 프로젝트처럼 git init 되어야 함
- 플러그인 설치: `claude plugin add <로컬경로>` 사용. 플러그인 source repo의 현재 파일 상태를 그대로 테스트
- 스킬 실행: `claude -p` (print mode)로 비대화형 실행. Claude가 인터랙티브 질문에 자동 응답
- 각 스킬 실행 간 sandbox의 .crew/ 디렉토리 상태가 누적되어야 함 (interview 결과물을 plan이 사용)
- `test-sandbox/`는 .gitignore에 추가하여 레포에 포함하지 않음
- fixture 파일은 `tests/fixtures/smoke/` 등 레포 내 고정 위치에 보관

## 수용 기준
- [ ] `npm run smoke` 한 번으로 셋업부터 전체 파이프라인 실행 + 결과 보고까지 완료된다
- [ ] crew-agent-runner의 resolve, render, validate sub-command가 정상 실행된다 (exit code 0)
- [ ] crew-setup, crew-interview, crew-plan, crew-dev 각각의 실행 결과가 PASS/FAIL/TIMEOUT/SKIP으로 보고된다
- [ ] 각 스킬의 산출물(spec.md, plan.md, dev-log.md 등)이 생성되고 필수 섹션을 포함한다
- [ ] sandbox 디렉토리가 반복 실행 시 정상적으로 초기화된다 (idempotent)
- [ ] 기존 vitest 단위 테스트(`npm run test:run`)에 영향을 주지 않는다

## 전제 조건
- Claude Code CLI가 시스템에 설치되어 있어야 한다 (`claude` 명령 사용 가능)
- 유효한 Claude API 키가 설정되어 있어야 한다 (`claude -p` 실행 가능)
