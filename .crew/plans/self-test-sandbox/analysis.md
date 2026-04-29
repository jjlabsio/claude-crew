# 사전 분석: self-test-sandbox

## 요구사항 보완

- spec.md가 명확히 정의한 스코프: sandbox 디렉토리 자동화, 4 스킬 파이프라인 순환, crew-agent-runner sub-command 검증, `npm run smoke` 단일 진입점
- **crew-setup과 crew-interview는 대화형(interactive) 스킬**: `claude -p` (print mode, non-interactive)에서 사용자 입력 없이 실행하려면 각 스킬에 "미리 결정된 답변"을 프롬프트에 주입하거나, 최소한의 자동 응답 경로를 설계해야 한다. crew-interview는 PM이 사용자에게 질문을 던지는 루프가 핵심이고, crew-setup은 provider 설정에서 사용자 선택을 요구한다. 이 대화형 스킬을 비대화형 smoke test로 어떻게 검증할지가 핵심 설계 결정이다.
- **crew-dev는 실제 코드 구현을 수행하는 스킬**: smoke test에서 실제 코드 생성까지 할지, 아니면 "호출 가능하고 산출물 경로가 생성되는가" 수준으로 제한할지 결정 필요
- `claude -p` 호출 시 각 스킬의 타임아웃 기본값이 불명확 -- spec에서는 TIMEOUT 보고를 요구하므로 스크립트 레벨에서 타임아웃을 제어해야 함
- `.crew/` 상태 누적 의존성: interview가 생성한 spec.md를 plan이 소비하므로, 중간 단계 실패 시 후속 스킬 SKIP 로직 필요

## 코드베이스 맥락

### 관련 파일

| 경로 | 역할 |
|------|------|
| `package.json` | scripts에 `test`, `test:run`, `test:watch` 존재. `smoke` 없음. devDeps: vitest, changelogen |
| `vitest.config.mjs` | `tests/**/*.test.mjs` 패턴, node 환경, custom snapshot resolver |
| `scripts/crew-agent-runner.mjs` | CLI 진입점. sub-commands: resolve, render, dispatch, render-followup, build, validate, install-hooks |
| `scripts/lib/pluginRoot.mjs` | `import.meta.url` 기반 PLUGIN_ROOT 결정. 사용 환경에서도 올바르게 동작 |
| `scripts/lib/config.mjs` | `loadCatalog()` - pluginPath 기반, `loadUserConfig()` - homedir 기반, `loadProjectConfig()` - cwd 기반 |
| `scripts/lib/resolve.mjs` | role config cascade: catalog defaults -> userConfig -> projectConfig |
| `scripts/lib/validate.mjs` | build output drift 검증. `resolveBuildInputs()` + `deriveBuildOutput()` 비교 |
| `scripts/lib/contracts.mjs` | `loadContracts()` - pluginPath 기반 또는 명시적 filePath |
| `.claude-plugin/plugin.json` | 플러그인 메타. agents 배열 + skills 배열 |
| `data/agent-contracts.json` | 9개 role contract 정의 |
| `data/provider-catalog.json` | provider/model 카탈로그 + agent_defaults + agent_runtime |
| `CLAUDE.md` | 두 환경 인식(CRITICAL) + build 동기화 규칙 |

### 기존 패턴

- **단위 테스트**: `tests/runner/*.test.mjs` 패턴. `spawnSync`로 CLI를 subprocess로 실행. `tests/_helpers/fs.mjs`에 `mkTmpDir`/`cleanupTmpDir` 헬퍼
- **fixture 구성**: 테스트 내에서 programmatically 생성 (별도 fixture 파일이 아닌 함수로 구성)
- **cwd 주의**: `crew-agent-runner.mjs`의 build/validate는 `--root` flag로 cwd 대신 특정 경로를 지정 가능. resolve/render는 pluginPath 기반으로 자체 데이터 접근

## 아키텍처 방향

### 권장: Node.js 단일 스크립트 (`tests/smoke/run.mjs`)

이유:
1. macOS에 `timeout` 명령이 기본 없음. Node.js의 `AbortSignal.timeout(ms)`으로 타임아웃 제어 가능
2. 산출물 검증(필수 섹션 포함 여부)을 같은 프로세스에서 수행 가능
3. `child_process.spawn`으로 `claude` CLI와 crew-agent-runner sub-command 호출
4. `npm run smoke`는 `"smoke": "node tests/smoke/run.mjs"` 추가

### sandbox 생성 흐름
1. `test-sandbox/` 존재하면 rm -rf 후 재생성
2. fixture 파일 복사: `tests/fixtures/smoke/` → `test-sandbox/`
3. `git init && git add -A && git commit -m "initial"` (sandbox 내부)
4. `claude plugin add <PLUGIN_ROOT 절대경로>` (로컬 source 경로)

### 스킬 실행 흐름
1. crew-agent-runner sub-command 검증 (resolve, render, validate)
2. crew-setup: 프롬프트에 "provider 설정은 모두 기본값, HUD 설치 안 함" 미리 지시
3. crew-interview: 프롬프트에 "모든 질문에 기본 선택지 선택, 최소 스코프로 진행" 미리 지시
4. crew-plan: "테스트 전략은 None" 미리 지시
5. crew-dev: 실행 후 산출물 확인

### 고려한 대안

1. **Bash 스크립트**: macOS `timeout` 부재로 이식성 문제
2. **vitest 통합**: `vitest run` 시 항상 API 호출 발생. 수용 기준 "기존 vitest에 영향 없음" 위반
3. **Makefile**: npm 생태계에서 비표준

## 엣지 케이스 / 리스크

1. **대화형 스킬의 비대화형 실행**: `claude -p`에서 AskUserQuestion 호출 시 동작 불확실
2. **API 비용**: 매 실행마다 4 스킬 Claude API 호출 (상당한 토큰 소비)
3. **타임아웃**: crew-dev는 수 분 이상 소요 가능
4. **sandbox 클린업 실패**: git lock 파일 등으로 rm -rf 실패 가능
5. **plugin add 후 정리**: `~/.claude/plugins/installed_plugins.json`에 sandbox가 등록됨. smoke test 후 정리 필요 여부
6. **crew-agent-runner sub-command cwd**: resolve는 `loadProjectConfig()`에서 cwd 사용. sandbox에서는 `.crew/config.json` 없으므로 빈 객체 반환 (allowMissing=true → OK)
7. **글로벌 설정 오염**: crew-setup이 `~/.claude/settings.json`의 statusLine을 수정할 수 있음

## 가드레일

### Must

- smoke 스크립트는 **dev 환경 전용 도구**. 시작 시 `.claude-plugin/plugin.json` 존재 + `package.json.name` 가드 추가
- `test-sandbox/`를 .gitignore에 추가
- 기존 vitest와 분리: `tests/smoke/` 경로 사용, `*.test.mjs` 패턴에 포함되지 않는 진입점
- fixture 파일은 `tests/fixtures/smoke/`에 보관
- 매 실행 시 clean start (rm -rf 후 재생성)
- 결과 요약 형식 통일: 각 단계별 `PASS | FAIL | TIMEOUT | SKIP` + 실패 사유 1줄
- 타임아웃 제어: sub-command 30s, crew-setup 120s, crew-interview 300s, crew-plan 600s, crew-dev 900s
- 경로는 절대경로 사용 (PLUGIN_ROOT 기준). CLAUDE.md 두 환경 인식 원칙 준수
- plugin add는 로컬 절대경로로: `claude plugin add "$PLUGIN_ROOT"`

### Must NOT

- `npm run test` / `vitest run`에서 smoke test가 실행되면 안 됨
- smoke 스크립트가 plugin source repo 외부 파일을 수정하면 안 됨 (`~/.claude/settings.json` 등)
- sandbox를 git push하면 안 됨
- API 키를 스크립트에 하드코딩하면 안 됨
- sandbox 정리를 사용자에게 맡기면 안 됨
- crew-agent-runner의 `--root` flag 없이 cwd 의존으로 sub-command를 테스트하면 안 됨

## 테스트 인프라

### 기존 인프라

| 항목 | 상태 |
|------|------|
| 프레임워크 | vitest 3.x |
| 테스트 패턴 | `tests/**/*.test.mjs` |
| 실행 | `npm run test:run` (vitest run) |
| 헬퍼 | `tests/_helpers/fs.mjs` (mkTmpDir, cleanupTmpDir) |
| 커버리지 | 비활성화 |
| CI | 없음 |

### 새로 추가할 인프라

| 항목 | 계획 |
|------|------|
| smoke 진입점 | `tests/smoke/run.mjs` (Node.js) |
| npm script | `"smoke": "node tests/smoke/run.mjs"` |
| fixture | `tests/fixtures/smoke/{package.json, index.js, README.md}` |
| 검증 헬퍼 | `tests/smoke/lib/verify.mjs` — 산출물 존재 + 필수 섹션 포함 검증 |
| 타임아웃 | `AbortSignal.timeout(ms)` (Node.js native) |

## 테스트 전략

- 결정: **None**
- 프레임워크: vitest 3.x (기존, smoke와 분리)
- 인프라 셋업 필요: NO
- 사유: smoke 스크립트(`tests/smoke/run.mjs`) 자체가 E2E 검증 도구. 별도 단위 테스트 불필요.

## 환경 매트릭스 검토

| 질문 | 답변 |
|------|------|
| 이 변경이 새로 cwd 또는 상대 경로 의존성을 도입하는가? | smoke 스크립트는 `PLUGIN_ROOT/test-sandbox`로 참조하므로 새 cwd 의존성 없음. sandbox 안에서 `claude -p --dir`로 실행할 때 sandbox가 cwd가 됨 — 의도된 동작 |
| base가 plugin root / cwd / home 중 어느 것이 맞는가? | plugin root 기반 |
| 사용자 환경에서 동작 검증을 어떻게 할 것인가? | sandbox가 사용자 환경을 시뮬레이션 |
| 이 명령/기능이 사용자용인가, 개발자용인가? | **개발자 전용** |
