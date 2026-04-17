---
name: crew-setup
description: claude-crew 플러그인 초기 설정 — gitignore 마이그레이션 + HUD statusline 설치 + provider 설정
---

## 역할

claude-crew 플러그인의 초기 설정을 수행한다:
1. .gitignore / .gitattributes 마이그레이션
2. HUD statusline 설치
3. 에이전트별 provider/model 설정

---

## Step 1 — .gitignore / .gitattributes 마이그레이션

`.crew/` 디렉토리를 git tracked로 전환한다. plans, tasks 등의 문서가 git 히스토리에 보존되도록 한다.

### 1a. 현재 상태 확인

프로젝트 루트의 `.gitignore`를 읽는다.

```bash
git rev-parse --show-toplevel
```

### 1b. .gitignore 수정

**`.crew/` 또는 `.crew` 항목이 있는 경우 (마이그레이션 필요):**

1. `.crew/` (또는 `.crew`) 항목을 제거한다.
2. 다음 항목들을 추가한다:
   ```
   .crew/config.json
   .crew/plans/**/.*
   ```
3. 기존 `.gitignore`의 다른 항목은 모두 보존한다.

**이미 세분화된 항목이 있는 경우 (`.crew/config.json`, `.crew/plans/**/.*`):**

스킵한다. 이미 마이그레이션 완료 상태.

**`.gitignore` 파일이 없는 경우:**

`.gitignore`를 생성하고 위 두 항목을 추가한다.

### 1c. .gitattributes 수정

프로젝트 루트의 `.gitattributes`를 읽는다 (없으면 새로 생성).

`.crew/** merge=ours` 항목이 없으면 추가한다. 기존 항목은 보존.

### 1d. 변경사항 커밋

`.gitignore` 또는 `.gitattributes`에 변경이 있었으면:

```bash
git add .gitignore .gitattributes
git commit -m "chore: .crew/ git tracked 전환 — gitignore/gitattributes 마이그레이션"
```

push는 하지 않는다.

### 1e. 사용자 알림

**마이그레이션 수행 시:**
```
✓ .gitignore 업데이트:
  - .crew/ 전체 제외 → .crew/config.json, .crew/plans/**/.* 만 제외로 변경
  - .crew/ 디렉토리가 이제 git tracked됩니다 (plans, tasks 이력 보존)

✓ .gitattributes 추가:
  - .crew/** merge=ours (워크트리 충돌 방지)

변경사항이 현재 브랜치에 커밋되었습니다 (push하지 않음).
```

**이미 마이그레이션 완료 시:**
```
✓ .gitignore/.gitattributes 이미 최신 상태입니다.
```

---

## Step 2 — HUD statusline 설치

1. `~/.claude/settings.json`을 읽는다.
2. `statusLine` 필드를 crew HUD 스크립트로 설정한다:
   ```json
   "statusLine": {
     "type": "command",
     "command": "node \"$CLAUDE_PLUGIN_ROOT/hud/index.mjs\""
   }
   ```
   - `$CLAUDE_PLUGIN_ROOT`는 Claude Code가 플러그인 루트 경로로 자동 치환한다.
   - 기존 statusLine이 있으면 덮어쓴다.
3. 결과를 사용자에게 알린다:
   - 성공 시: "CREW HUD가 설치되었습니다. 다음 세션부터 statusline에 표시됩니다."
   - 실패 시: 에러 내용을 알린다.

**주의**: `settings.json`의 다른 필드는 절대 수정하지 않는다. statusLine만 교체한다.

---

## Step 3 — Provider 설정

에이전트별로 어떤 provider(claude/codex)와 model을 사용할지 설정한다.

### 3a. 설치 스코프 판별

`~/.claude/plugins/installed_plugins.json`을 읽어 현재 프로젝트의 설치 스코프를 판별한다.

```bash
# 현재 프로젝트 루트 (워크트리 대응)
git rev-parse --show-toplevel
```

**판별 로직:**
1. `installed_plugins.json`의 `plugins["claude-crew@claude-crew"]` 배열을 순회한다.
2. `projectPath`가 현재 프로젝트 루트와 일치하는 항목이 있으면 → **프로젝트 레벨 설치**
3. 없으면 `scope === "user"` 항목이 있는지 확인 → **유저 레벨 설치**
4. 둘 다 없으면 → dev 환경 (프로젝트 레벨로 취급)

**스코프별 config 경로:**

| 설치 스코프 | config 경로 | 적용 범위 |
|---|---|---|
| 프로젝트 레벨 | `{projectRoot}/.crew/config.json` | 해당 프로젝트만 |
| 유저 레벨 | `~/.claude/crew/config.json` | 모든 프로젝트 (기본값) |

판별된 스코프를 사용자에게 알린다:
```
설치 스코프: 유저 레벨 → 설정이 ~/.claude/crew/config.json에 저장됩니다 (모든 프로젝트 공유)
```
또는:
```
설치 스코프: 프로젝트 레벨 → 설정이 .crew/config.json에 저장됩니다 (이 프로젝트만)
```

### 3b. 카탈로그 로드

`data/provider-catalog.json`을 읽어 사용 가능한 provider와 model 목록을 로드한다.

### 3c. Codex CLI 가용성 확인

```bash
which codex
```

- codex가 없으면: "Codex CLI가 설치되어 있지 않습니다. 모든 에이전트가 Claude를 사용합니다." 안내 후 Step 3를 스킵한다.
- codex가 있으면: 계속 진행한다.

### 3d. 기존 설정 표시

Step 3a에서 판별된 config 경로의 파일이 있으면 현재 설정을 표시한다. 없으면 기본값을 표시한다.

```
현재 에이전트 설정:
  - dev: claude / opus (기본값)
  - code-reviewer: claude / opus (기본값)
  - qa: claude / sonnet (기본값)
```

### 3e. 설정할 에이전트 선택

사용자에게 설정을 변경할 에이전트를 선택하게 한다.

```
설정을 변경할 에이전트를 선택하세요 (쉼표 구분, 엔터 = 스킵):
  dev, code-reviewer, qa
```

- 사용자가 엔터만 누르거나 "없음"/"스킵"을 입력하면 Step 3를 종료한다.
- 예시 입력: `dev`, `dev, code-reviewer`

### 3f. 선택된 에이전트별 설정

선택된 각 에이전트에 대해 순차적으로:

**Provider 선택:**
```
── {agent} ──
Provider:
  [1] claude
  [2] codex
```

**Model 선택 (provider에 따라 목록이 다름):**

카탈로그에서 해당 provider의 models 배열을 번호 목록으로 표시한다. 1번이 추천.

claude 선택 시:
```
Model:
  [1] Opus — 최고 품질, 복잡한 구현 (추천)
  [2] Sonnet — 빠르고 저렴, Opus급 성능
  [3] Haiku — 최저 비용, 단순 태스크
```

codex 선택 시:
```
Model:
  [1] GPT-5.4 xhigh (추천) — 최고 성능, 토큰 多
  [2] GPT-5.4 high — 고성능, 균형잡힌 비용
  [3] GPT-5.4 medium — 빠르고 저렴
  [4] o3 high — 추론 특화
  [5] o3 medium — 추론 특화, 저비용
  [6] GPT-5.4 Mini — 최저 비용
```

### 3g. 설정 저장

선택 결과를 Step 3a에서 판별된 config 경로에 저장한다.

- 프로젝트 레벨: `{projectRoot}/.crew/config.json`
- 유저 레벨: `~/.claude/crew/config.json`

**규칙:**
- 기본값과 동일한 설정은 저장하지 않는다 (기본값은 `agent_defaults` 참조).
- 기본값과 다른 설정만 `providers` 객체에 기록한다.
- 기존 config 파일이 있으면 `providers` 필드만 머지한다 (다른 필드 보존).
- 디렉토리가 없으면 생성한다 (`.crew/` 또는 `~/.claude/crew/`).

**저장 형식:**

```json
{
  "providers": {
    "dev": { "provider": "codex", "model": "gpt-5.4", "reasoning": "xhigh" }
  }
}
```

- claude provider일 때: `reasoning` 필드 생략
- codex provider일 때: 카탈로그의 `reasoning` 값 포함 (`null`이면 생략)

### 3h. 확인 메시지

```
✓ Provider 설정 완료:
  - dev: codex / gpt-5.4 xhigh
  - code-reviewer: claude / opus (기본값)
  - qa: claude / sonnet (기본값)

설정 파일: ~/.claude/crew/config.json (유저 레벨 — 모든 프로젝트 공유)
```
또는:
```
설정 파일: .crew/config.json (프로젝트 레벨)
```
