# Claude Crew

1인 SaaS 개발자를 위한 Claude Code 멀티 에이전트 오케스트레이션 플러그인.

## 파이프라인

```
crew-interview → crew-plan → crew-dev
   WHAT            HOW         DO
```

| 단계 | 역할 | 산출물 |
|------|------|--------|
| **crew-interview** | 무엇을 만드는가 — 요구사항 인터뷰, 제품 설계 | spec.md |
| **crew-plan** | 어떻게 만드는가 — 기술 분석, 태스크 분해 | contract.md |
| **crew-dev** | 만든다 — 구현, 코드 리뷰, QA | 동작하는 코드 + PR |

## 설치

Claude Code에서:

```
/plugin marketplace add jjlabsio/claude-crew
/plugin install claude-crew
```

또는 로컬에서 직접:

```
/plugin install /path/to/claude-crew
```

## 초기 설정

설치 후 반드시 한 번 실행:

```
/crew-setup
```

- `.gitignore` / `.gitattributes` 마이그레이션 (`.crew/` git tracked 전환)
- HUD statusline 설치
- 에이전트별 provider/model 설정

## 사용

### 개발 파이프라인

```
/crew
```

오케스트레이터가 시작되고 현황을 브리핑합니다.

### 간단 작업 즉시 위임

```
/crew-do "로그인 에러 메시지 정리"
/crew-do                         # active task가 있으면 해당 task를 실행
```

`/crew-do`는 기존 Dev 에이전트를 `direct` 모드로 호출해 작은 수정, 버그픽스, 테스트 실패 수정처럼 범위가 명확한 작업을 바로 위임합니다. Dev 기본 provider가 Codex이면 실제 코드 탐색, 수정, 검증은 Codex runtime에서 수행되고 Claude는 결과 요약과 후속 조율만 담당합니다.

`/task`는 계속 기억/queue 관리 전용입니다. 저장된 태스크를 실행하려면 `/task work {id}`로 active 상태로 만든 뒤 `/crew-do`를 실행합니다.

### 태스크 관리

```
/task add "설명"          # 태스크 추가 (대화 컨텍스트 자동 캡처)
/task add "설명" --next   # 긴급 — queue 맨 위 삽입
/task work 3              # 태스크 #3 작업 시작 (관련 파일 Read + 브리핑)
/task start               # queue 최상단 태스크 작업 시작
/task done                # active 태스크 완료 처리
/task bump 4              # 우선순위 한 칸 올리기
/task top 7               # queue 맨 위로 이동
/task note 3 "메모"       # 태스크에 메모 추가
/task drop 3              # 태스크 삭제

/tasks                    # 프로젝트 태스크 보드
/tasks stale              # 30일+ 방치 태스크 리뷰
/tasks clean              # 완료 후 7일 경과 태스크 정리
```

태스크는 `.crew/tasks/` 디렉토리에 개별 파일로 관리된다. 각 파일이 상태, 우선순위, 컨텍스트를 포함하여 세션 간 작업 재개 시 컨텍스트 재입력이 불필요하다.

## 에이전트 팀

| 에이전트 | 역할 | 소속 스킬 |
|---------|------|----------|
| **오케스트레이터** | 유저와 대화, 위임 판단, 파이프라인 진행 | 전체 |
| **Explorer** | 코드베이스 탐색 (read-only) | interview, plan |
| **Researcher** | 외부 리서치 (WebSearch) | interview, plan |
| **TechLead** | 기술 분석, 아키텍처 방향 판단 | plan |
| **Planner** | 태스크 분해, 구현 계획 | plan |
| **PlanEvaluator** | 계획 검증 (하드 임계값) | plan |
| **Dev** | 코드 구현 | dev |
| **CodeReviewer** | 코드 리뷰 | dev |
| **QA** | 실행 검증 | dev |

## 두 가지 사용 모드

claude-crew는 **다른 프로젝트에 설치되어 사용되는 플러그인**이다. 두 가지 모드로 구분된다.

### 사용자 모드

이 plugin을 자기 프로젝트에 설치해서 SaaS 개발에 활용하는 일반 사용자.

- 직접 호출하는 슬래시 명령: `/crew`, `/crew-setup`, `/crew-do`, `/task`, `/tasks`, `/crew-interview`, `/crew-plan`, `/crew-dev`.
- 디버그용 직접 호출 가능 명령: `node scripts/crew-agent-runner.mjs resolve --role <role> --json` (provider/model/contract 통합 표 확인).
- plugin이 설치된 위치(`~/.claude/plugins/...` 등)에 무관하게 동작 — plugin script가 자기 위치를 자동으로 인식.

### 개발자 모드

claude-crew 자체를 개발하는 사람 (이 repo 안에서 작업).

- `node scripts/crew-agent-runner.mjs build`: contracts/instructions에서 `agents/{role}.md` + `plugin.json` agents 배열 derive.
- `node scripts/crew-agent-runner.mjs validate`: build 결과와 현재 파일 정합성 검사 + sandbox 정합성 검증.
- `node scripts/crew-agent-runner.mjs install-hooks`: pre-commit hook 설치 (drift 차단).

위 세 명령은 **plugin source repo 안에서만 동작**한다. 사용자 환경에서 호출하면 가드로 차단된다 (`.claude-plugin/plugin.json` + `package.json.name === "@jjlabsio/claude-crew"` 감지). 사용자에게는 의미 없는 명령이므로 정상이다.

## 모델 설정

`/crew-setup`에서 에이전트별 provider/model을 설정합니다. 설정하지 않은 에이전트는 `data/provider-catalog.json`의 `agent_defaults`를 따릅니다.

권장 기본값은 에이전트 역할의 성격에 따라 세 그룹으로 구분됩니다.

| 에이전트 | provider | model | reasoning | 역할 성격 |
|----------|----------|-------|-----------|---------|
| `techlead` | codex | gpt-5.5 | high | 판단/평가 — 아키텍처 방향 결정 |
| `code-reviewer` | codex | gpt-5.5 | high | 판단/평가 — 코드 품질 판정 |
| `pm` | codex | gpt-5.5 | medium | 계획/분석 — 요구사항 수집 |
| `planner` | codex | gpt-5.5 | medium | 계획/분석 — 구현 계획 작성 |
| `dev` | codex | gpt-5.5 | medium | 계획/분석 — 코드 구현 |
| `plan-evaluator` | codex | gpt-5.4-mini | high | 실행/검증 — 계획 기준 충족 판정 |
| `qa` | codex | gpt-5.4-mini | high | 실행/검증 — 빌드/테스트 실행 |
| `researcher` | codex | gpt-5.4-mini | high | 실행/검증 — 외부 정보 조사 |
| `explorer` | codex | gpt-5.3-codex-spark | low | 탐색 전용 — 코드베이스 검색 |

Claude 모델은 `opus`, `sonnet`, `haiku` latest alias와 `claude-opus-4-7` 같은 버전 고정 ID를 모두 선택할 수 있습니다.

Claude provider는 Claude Code `Agent`로 실행하고, Codex provider는 플러그인에 내장된 `scripts/crew-codex-companion.mjs` app-server runtime으로 실행합니다. 에이전트가 유저 질문이나 다른 에이전트 호출이 필요하면 직접 처리하지 않고 오케스트레이터가 이어받아 실행합니다.

Provider와 무관하게 에이전트 결과는 `complete`, `blocked_on_user`, `needs_agent`, `needs_tool`, `failed` 상태 중 하나로 해석합니다. Claude Code 전용 도구가 필요한 경우에도 Codex provider는 요청 상태를 반환하고, 실제 도구 실행은 오케스트레이터가 담당합니다.

## 상태 파일

프로젝트 로컬 `.crew/` 디렉토리에 마크다운 파일로 상태를 관리합니다 (git tracked). 플러그인 업데이트 시에도 학습 내용과 상태는 보존됩니다.

```
.crew/
  config.json          # provider 설정 (gitignored)
  tasks/               # 태스크 파일 (1개 = 1파일)
  plans/               # 파이프라인 산출물 (spec, contract, dev-log, review)
```

## 설계 철학

**역할별 관점은 유지하되, 정보는 제한하지 않는다.**

각 에이전트는 특정 관점(기획/기술/구현)에서 사고하지만, 활용할 수 있는 정보(코드 포함)는 제한하지 않는다. 실제 회사의 역할 분리를 모방하는 것이 아니라, 빠뜨리는 관점이 없도록 구조화된 사고를 강제하는 것이 목적이다.

### 기타 원칙

- [Anthropic 하네스 설계 아티클](https://www.anthropic.com/engineering/harness-design)을 최우선 레퍼런스로 따름
- 가능한 단순하게 시작하고 필요할 때만 복잡성을 높임
- 모델이 발전하면 불필요해진 구성 요소를 제거

## License

MIT. This project also includes Apache-2.0 third-party components under `scripts/crew-codex/`; see `THIRD_PARTY_NOTICES.md`.
