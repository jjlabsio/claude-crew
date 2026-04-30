# 카탈로그 기본값에 암묵적으로 의존하는 CLI 테스트에 project config override 적용

## 배경

`provider-catalog.json`의 `agent_defaults`가 변경되면 CLI 테스트가 깨진다.
방금 `plan-evaluator`(claude→codex)와 `qa`(claude→codex) 테스트를 project config override 패턴으로 수정했다.
이 패턴을 나머지 카탈로그 의존 CLI 테스트에도 적용한다.

## 패턴

각 CLI 테스트에서 tmpDir에 `.crew/config.json`을 생성하여 테스트할 role의 provider를 명시적으로 선언하고, `cwd: tmpDir`로 실행한다.

이미 적용된 예시 (prepare.test.mjs의 Claude 테스트):
```js
await mkdir(join(tmpDir, ".crew"), { recursive: true });
await writeFile(
  join(tmpDir, ".crew", "config.json"),
  JSON.stringify({
    providers: { "plan-evaluator": { provider: "claude", model: "sonnet" } }
  }),
  "utf8"
);
const result = runPrepare([...args], { cwd: tmpDir });
```

## 수정 대상

### prepare.test.mjs
- "returns a dispatch action for Codex provider roles" — `dev`가 codex라고 가정. project config로 `dev: codex/gpt-5.5/medium` 명시 + `cwd: tmpDir`
- "prints the dispatch command in text mode" — 동일

### dispatch.test.mjs  
- "runs companion with a prompt file..." — `dev`가 codex라고 가정. override 필요
- "adds --write for workspace-write..." — 동일
- "uses --resume-last only when..." — 동일
- "rejects a resume handle..." — 동일
- "exits non-zero with a diagnostic..." — 동일

### resolve.test.mjs
- "prints JSON for planner role" — `planner`가 codex라고 가정. override 필요

## 주의사항

- lib 레벨 테스트 (dispatch.mjs의 `dispatch()` 직접 호출)는 이미 explicit `resolved` 객체를 전달하므로 수정 불필요
- resolve.test.mjs의 `resolveRole` 단위 테스트도 explicit fixture catalog를 사용하므로 수정 불필요
- runPrepare, runDispatch 함수는 이미 options 파라미터와 REPO_ROOT 기반 절대 경로를 지원함 (이전 커밋에서 수정)
- dispatch 테스트의 command 기대값에서 script 경로가 REPO_ROOT 기반인지 확인
- prepare 테스트의 codex command 기대값에 `join(process.cwd(), ...)` → `join(REPO_ROOT, ...)` 변경 필요할 수 있음
- 수정 후 `npx vitest run` 전체 통과 확인
