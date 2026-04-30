# GitHub 이슈 #44 수정: AUTO_GIT_DIFF 플레이스홀더 치환 로직 구현

## 문제

crew-dev Phase 2에서 CodeReviewer를 codex dispatch로 실행할 때, request 파일의 `content` 필드에 `"AUTO_GIT_DIFF"` 값을 설정하면 이 값이 실제 git diff로 치환되지 않고 리터럴 문자열 그대로 codex 에이전트에게 전달된다.

## 기대 동작

request 파일의 content에 `"AUTO_GIT_DIFF"`를 넣으면, runner가 현재 git diff를 생성하여 해당 값을 실제 diff 내용으로 치환한 후 codex 에이전트에게 전달해야 한다.

## 수정 대상

- `scripts/crew-agent-runner.mjs` — dispatch 경로에서 AUTO_GIT_DIFF 플레이스홀더 감지 및 치환 로직 추가
- codex provider 경로 포함 모든 dispatch 경로에서 동작해야 함

## 참고

- request-file의 `inputs[].content` 필드에서 `"AUTO_GIT_DIFF"` 값을 감지
- `git diff HEAD~1` 또는 staged/unstaged diff를 생성하여 치환
- 치환은 runner의 prepare 또는 dispatch 단계에서 수행
