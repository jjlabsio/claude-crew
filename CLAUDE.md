# 에이전트 추가/수정/삭제 시 plugin.json 동기화 (CRITICAL)

`agents/` 디렉토리의 `.md` 파일을 추가, 수정, 삭제할 때 반드시 `.claude-plugin/plugin.json`의 `agents` 배열도 함께 수정해야 한다.

- **추가**: `agents` 배열에 `"./agents/{name}.md"` 항목 추가
- **삭제**: `agents` 배열에서 해당 항목 제거
- **파일명 변경**: 배열의 경로도 동일하게 수정

`plugin.json`의 `agents` 배열은 다른 레포에서 플러그인 설치 시 Claude Code가 에이전트 타입을 등록하는 기준이다. 누락되면 `subagent_type` 호출 시 "에이전트 타입을 찾을 수 없음" 오류가 발생한다.
