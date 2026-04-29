# 두 환경 인식 (CRITICAL)

claude-crew는 **다른 프로젝트에 설치되어 사용되는 플러그인**이다. 코드를 작성/수정할 때 항상 두 환경을 구분해서 생각한다.

## 환경 매트릭스

- **dev 환경**: plugin source repo 안 (= 지금 작업 중인 디렉토리). cwd가 plugin root와 일치.
- **사용 환경**: 사용자가 자기 프로젝트(임의 cwd)에서 plugin script 실행. cwd ≠ plugin root.

dev 환경에서 작성한 코드가 사용 환경에서 깨지는 패턴이 매우 빈번하다. 단위 테스트는 모두 dev 환경에서 실행되므로 cwd 의존성을 invisible하게 통과시킨다. 이 함정을 시스템적으로 막아야 한다.

## Must

- plugin 자체 데이터(`data/*`, `agents/*`, `skills/*`, `scripts/*`) 접근은 **항상 `import.meta.url` 또는 `$CLAUDE_PLUGIN_ROOT` 기반**의 plugin root 기준 path 사용.
- 사용자 데이터(`~/.claude/crew/config.json`, `{cwd}/.crew/config.json`) 접근만 home/cwd 기준.
- 새 명령(sub-command)을 추가할 때 "이 명령은 사용자가 호출하는가, plugin 개발자가 호출하는가?"를 먼저 명시.
- 사용자 호출 명령은 외부 cwd에서 정상 동작하는지 수동 또는 자동으로 검증.
- 개발자 전용 명령은 plugin source repo 감지 가드(`.claude-plugin/plugin.json` + `package.json.name === "@jjlabsio/claude-crew"`)로 사용자 환경 호출을 차단.

## Must NOT

- `process.cwd()` 또는 상대 경로로 plugin 자체 파일 read/write 가정.
- 단위 테스트(temp dir 기반 포함)만으로 cwd 의존성이 없다고 결론.
- 사용자 환경에 plugin source 디렉토리 구조가 있다고 가정 (예: 사용자 프로젝트에 `scripts/crew-agent-runner.mjs`가 있다고 가정).
- pre-commit hook 같은 사용자 git에 박히는 자동화 산출물에 상대 경로 plugin script 호출 (사용자 cwd가 plugin root가 아님).

## TechLead 분석 시 환경 매트릭스 검토 (필수)

새 변경에 대해 TechLead 분석은 다음을 명시한다:

- 이 변경이 새로 cwd 또는 상대 경로 의존성을 도입하는가?
- 도입한다면 base가 plugin root / cwd / home 중 어느 것이 맞는가?
- 사용자 환경(외부 cwd)에서 동작 검증을 어떻게 할 것인가?
- 이 명령/기능이 사용자용인가, 개발자용인가?

# 에이전트/스킬/명령 추가 시 build 동기화

`agents/` 디렉토리의 `.md` 파일과 `.claude-plugin/plugin.json`의 `agents` 배열은 **build 산출물**이다. 직접 수정하지 말 것.

- 변경 source는 `data/agent-contracts.json` + `data/agent-instructions/{role}.md`.
- source 수정 후 `node scripts/crew-agent-runner.mjs build` 실행하여 `agents/{role}.md`와 `plugin.json` agents 배열을 derive.
- pre-commit hook(`install-hooks` 명령으로 설치, plugin 개발자 전용)이 `validate`로 drift를 차단.
- skills 배열은 build 대상이 아니다. 새 skill 추가 시 `plugin.json` skills 배열을 직접 편집.
