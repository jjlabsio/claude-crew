# 조사 요청: Codex 샌드박스 네트워크 차단 해결 방법

## 배경
codex 샌드박스의 `workspace-write` 모드에서 외부 네트워크(DNS/HTTP)가 차단되어 `pnpm install`, `npm install` 등 패키지 설치가 `ENOTFOUND`로 실패하는 문제가 있다.

## 조사 항목

1. **codex CLI 네트워크 허용 옵션**: codex CLI에 네트워크 접근을 허용하는 플래그나 설정이 있는지 조사
2. **다른 sandbox 모드**: `workspace-write` 외에 네트워크를 허용하는 sandbox 모드가 있는지 조사
3. **우회 방법**: 패키지 설치가 필요한 작업에서 codex를 사용할 수 있는 우회 방법이 있는지 조사

## 기대 산출물
각 항목에 대한 조사 결과를 정리하고, 실제 적용 가능한 해결 방안을 제시해줘.
