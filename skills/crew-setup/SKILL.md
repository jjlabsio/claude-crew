---
name: crew-setup
description: claude-crew 플러그인 초기 설정 — HUD statusline 설치 + provider 설정
---

## 역할

claude-crew 플러그인의 초기 설정을 수행한다:
1. HUD statusline 설치
2. 에이전트별 provider/model 설정

---

## Step 1 — HUD statusline 설치

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

## Step 2 — Provider 설정

에이전트별로 어떤 provider(claude/codex)와 model을 사용할지 설정한다.

### 2a. 카탈로그 로드

`data/provider-catalog.json`을 읽어 사용 가능한 provider와 model 목록을 로드한다.

### 2b. Codex CLI 가용성 확인

```bash
which codex
```

- codex가 없으면: "Codex CLI가 설치되어 있지 않습니다. 모든 에이전트가 Claude를 사용합니다." 안내 후 Step 2를 스킵한다.
- codex가 있으면: 계속 진행한다.

### 2c. 기존 설정 표시

`.crew/config.json`이 있으면 현재 설정을 표시한다. 없으면 기본값을 표시한다.

```
현재 에이전트 설정:
  - dev: claude / opus (기본값)
  - code-reviewer: claude / opus (기본값)
  - qa: claude / sonnet (기본값)
```

### 2d. 설정할 에이전트 선택

사용자에게 설정을 변경할 에이전트를 선택하게 한다.

```
설정을 변경할 에이전트를 선택하세요 (쉼표 구분, 엔터 = 스킵):
  dev, code-reviewer, qa
```

- 사용자가 엔터만 누르거나 "없음"/"스킵"을 입력하면 Step 2를 종료한다.
- 예시 입력: `dev`, `dev, code-reviewer`

### 2e. 선택된 에이전트별 설정

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
  [1] Opus 4.6 — 최고 품질, 복잡한 구현 (추천)
  [2] Sonnet 4.6 — 빠르고 저렴, Opus급 성능
  [3] Haiku 4.5 — 최저 비용, 단순 태스크
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

### 2f. 설정 저장

선택 결과를 `.crew/config.json`에 저장한다.

**규칙:**
- 기본값과 동일한 설정은 저장하지 않는다 (기본값은 `agent_defaults` 참조).
- 기본값과 다른 설정만 `providers` 객체에 기록한다.
- 기존 `.crew/config.json`이 있으면 `providers` 필드만 머지한다 (다른 필드 보존).
- `.crew/` 디렉토리가 없으면 생성한다.

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

### 2g. 확인 메시지

```
✓ Provider 설정 완료:
  - dev: codex / gpt-5.4 xhigh
  - code-reviewer: claude / opus (기본값)
  - qa: claude / sonnet (기본값)

설정 파일: .crew/config.json
```
