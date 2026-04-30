# Code Review: f533959

대상 커밋: `f533959 feat: codex workspace-write 샌드박스에 네트워크 접근 허용 옵션 추가`

검토 범위:
- `data/provider-catalog.json`
- `scripts/lib/resolve.mjs`
- `scripts/lib/dispatch.mjs`
- `scripts/crew-codex-companion.mjs`
- `scripts/crew-codex/lib/codex.mjs`
- `tests/runner/resolve.test.mjs`

## Findings

### P1: `--network-access`가 실제 Codex thread 생성/재개 요청에 전달되지 않음

- 위치: `scripts/crew-codex/lib/codex.mjs:983`
- 위치: `scripts/crew-codex/lib/codex.mjs:993`

`executeTaskRun()`은 `runAppServerTurn()`에 `networkAccess`를 넘기지만, `runAppServerTurn()` 내부에서 `resumeThread()`와 `startThread()`를 호출할 때 옵션 객체에 `networkAccess: options.networkAccess`를 포함하지 않습니다. 이번 커밋에서 `buildThreadParams()`와 `buildResumeParams()`는 `options.networkAccess`를 받으면 JSON-RPC params에 `networkAccess: true`를 추가하도록 바뀌었지만, 실제 task 실행 경로에서는 그 옵션이 중간에서 끊깁니다.

영향:
- `data/provider-catalog.json`의 `dev.codex_network_access: true`
- `dispatch.mjs`의 `--network-access` 추가
- `crew-codex-companion.mjs`의 CLI 파싱 및 request 저장

위 변경들이 최종적으로 Codex app-server의 `thread/start` 또는 `thread/resume` params에 반영되지 않아 기능이 동작하지 않습니다.

권장 수정:
- `runAppServerTurn()`의 `resumeThread()`와 `startThread()` 호출 옵션에 `networkAccess: options.networkAccess`를 추가하십시오.
- 회귀 테스트는 `runAppServerTurn()` 또는 낮은 레벨의 `startThread` params를 검증할 수 있는 단위 테스트가 필요합니다. 현재 resolve/dispatch 테스트만으로는 이 결함을 잡을 수 없습니다.

## Security Review

`dev` role에 `workspace-write`와 `networkAccess`를 함께 부여하는 것은 보안 영향이 큽니다. 에이전트가 워크스페이스 파일을 읽고 수정할 수 있는 상태에서 네트워크 egress도 가능해지므로, 악성 dependency script, 프롬프트 인젝션, 테스트/빌드 스크립트 실행 중 외부 전송 등의 위험이 증가합니다.

현재 구현은 `dispatch` 경로에서는 catalog의 `codex_network_access`가 true인 경우에만 `--network-access`를 붙입니다. 다만 companion CLI 자체는 `--network-access`를 `--write`와 독립적으로 허용합니다. 직접 CLI 사용을 지원하는 의도라면 괜찮지만, "workspace-write 샌드박스에 네트워크 접근 허용"이라는 기능 범위에 맞추려면 `--network-access`가 `--write` 없이 사용될 때 경고 또는 명시적 validation을 두는 편이 안전합니다.

추가 권장 사항:
- job metadata/result에 network access 사용 여부를 남겨 감사 가능성을 높이십시오.
- `codex_network_access`는 기본 false를 유지하고, role별 allowlist 형태를 유지하십시오.
- 문서/사용법에 네트워크 허용 시 secret, `.env`, credential 파일 유출 위험을 명시하십시오.

## Code Quality / Consistency

- `resolve.mjs`의 `codex_network_access` 기본값 false 처리는 단순하고 기존 `codex_sandbox` catalog 기반 정책과 잘 맞습니다.
- `dispatch.mjs`에서 resolved 값만 보고 CLI arg를 구성하는 방식도 기존 `--write` 처리와 일관됩니다.
- `crew-codex-companion.mjs`는 foreground/background request 모두에 `networkAccess`를 포함해 저장하므로 background worker 경로의 상태 보존은 적절합니다.
- `codex.mjs`의 params 빌더에서 false 값을 생략하는 방식은 기존 params를 불필요하게 바꾸지 않는다는 점에서 호환성에 유리합니다.

## Missing Edge Cases / Tests

- `codex_network_access: true`일 때 dispatch가 `--network-access`를 추가하는 테스트가 없습니다.
- `--network-access --background`가 stored job request에 저장되고 worker 실행에서 유지되는 테스트가 없습니다.
- `runAppServerTurn({ networkAccess: true })`가 `thread/start`와 `thread/resume` params에 `networkAccess: true`를 포함하는 테스트가 없습니다. 이번 커밋의 핵심 결함을 잡으려면 이 테스트가 가장 중요합니다.
- `codex_network_access: true`가 `codex_sandbox: read-only`와 함께 설정된 경우 허용할지, 경고할지, 실패시킬지 정책 테스트가 없습니다.

## Verification

실행한 검증:

```text
npm test -- --run tests/runner/resolve.test.mjs tests/runner/dispatch.test.mjs
```

결과:

```text
2 test files passed, 17 tests passed
```

단, 위 테스트는 실제 app-server thread params 전달 여부를 검증하지 않으므로 P1 finding은 여전히 유효합니다.
