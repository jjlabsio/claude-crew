# Direct Request: Fix Issue #43 — persist-artifact 산출물 누락

## 문제

crew-dev Phase 2에서 체크포인트 커밋 시 파이프라인 산출물이 누락되는 버그 (GitHub Issue #43)

## 두 가지 원인

### (1) persist-artifact의 artifact_path에서 `{task-id}` 미치환

`crew-agent-runner.mjs`의 persist-artifact 로직에서 `{task-id}` 템플릿 변수가 실제 task-id로 치환되지 않음.
- 반환값: `".crew/plans/{task-id}/review-report.md"`
- 기대값: `".crew/plans/overview-fe/review-report.md"`

### (2) requests/, runs/ 디렉토리가 체크포인트 커밋에 자동 포함되지 않음

Dev/CR/QA 에이전트 실행 시 `.crew/plans/{task-id}/requests/`와 `.crew/plans/{task-id}/runs/`에 파일이 생성되지만 untracked 상태로 남아 체크포인트 커밋에서 누락됨. 경고 없음.

## 작업 범위

1. `crew-agent-runner.mjs`에서 persist-artifact 로직의 `{task-id}` 치환 누락 원인을 찾아 수정
2. 체크포인트 커밋 시 `.crew/plans/{task-id}/` 하위 untracked 파일(requests/, runs/ 등)이 포함되도록 수정하거나 경고 추가
3. 관련 테스트가 있으면 업데이트, 없으면 추가 고려
4. 그 외 누락 가능한 산출물 경로가 있는지 전수 점검

## 관련 컴포넌트

- `scripts/crew-agent-runner.mjs` (persist-artifact, dispatch)
- crew-dev 스킬 (Phase 2 체크포인트 커밋)
