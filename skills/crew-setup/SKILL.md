---
name: crew-setup
description: claude-crew 플러그인 초기 설정 — HUD statusline 설치
---

## 역할

claude-crew 플러그인의 HUD statusline을 사용자 환경에 설치한다.

## 절차

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

## 주의

- `settings.json`의 다른 필드는 절대 수정하지 않는다.
- statusLine만 교체한다.
