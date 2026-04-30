# Code Review Result: f533959

리뷰 완료. 주요 결함 1건을 발견했습니다.

## Findings

### P1: `--network-access`가 실제 Codex thread params까지 전달되지 않음

- `scripts/crew-codex/lib/codex.mjs:983`
- `scripts/crew-codex/lib/codex.mjs:993`

`executeTaskRun()`은 `runAppServerTurn()`에 `networkAccess`를 넘기지만, `runAppServerTurn()`이 `resumeThread()` / `startThread()`를 호출할 때 `networkAccess`를 옵션에 포함하지 않습니다. 따라서 `buildThreadParams()`와 `buildResumeParams()`에 추가된 `params.networkAccess = true` 분기는 task 실행 경로에서 도달하지 못합니다.

결과적으로 `dev.codex_network_access: true`, dispatch의 `--network-access`, companion CLI 파싱 변경이 있어도 실제 Codex app-server의 `thread/start` 또는 `thread/resume` 요청에는 네트워크 허용이 적용되지 않습니다.

권장:
- `runAppServerTurn()`의 `startThread()`와 `resumeThread()` 호출 옵션에 `networkAccess: options.networkAccess`를 추가하십시오.
- `runAppServerTurn({ networkAccess: true })`가 `thread/start` 및 `thread/resume` params에 `networkAccess: true`를 포함하는 테스트를 추가하십시오.

## Security Notes

`workspace-write`와 network egress를 동시에 허용하면 파일 읽기/수정 권한과 외부 전송 가능성이 결합됩니다. 프롬프트 인젝션, dependency script, 테스트/빌드 실행을 통한 secret 유출 위험을 문서화하고, role allowlist 및 감사 로그를 유지하는 것이 좋습니다.

현재 companion CLI는 `--network-access`를 `--write`와 독립적으로 허용합니다. 의도된 직접 사용 경로가 아니라면 `--network-access`가 `--write` 없이 들어올 때 경고 또는 validation을 추가하는 편이 안전합니다.

## Coverage Gaps

- dispatch가 `codex_network_access: true`에서 `--network-access`를 붙이는 테스트가 없습니다.
- background task request에 `networkAccess`가 저장/재사용되는 테스트가 없습니다.
- 실제 app-server params 전달 테스트가 없습니다.

## Verification

```text
npm test -- --run tests/runner/resolve.test.mjs tests/runner/dispatch.test.mjs
```

결과: 2개 test file, 17개 test 통과.
