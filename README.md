# Claude Crew

1인 SaaS 개발자를 위한 Claude Code 멀티 에이전트 오케스트레이션 플러그인.

개발, 마케팅, 일정을 한 대화에서 통합 관리한다.

## 설치

Claude Code에서:

```
/plugin marketplace add https://github.com/jjlabsio/claude-crew
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

HUD statusline이 설정되어 세션 중 레포, 브랜치, 모델, 컨텍스트 사용률, 에이전트 상태를 실시간으로 확인할 수 있다.

## 사용

```
/crew
```

오케스트레이터가 시작되고 현황을 브리핑합니다.

## 에이전트 팀

| 에이전트 | 역할 |
|---------|------|
| **오케스트레이터** | 유저와 대화, 위임 판단, 영역 간 연동 |
| **PM** | 유저와 대화하여 기획 확정 |
| **플래너** | 기획을 명세로 확장, 태스크 분해 |
| **개발** | 코드 구현, QA와 계약 협상 |
| **QA** | 스프린트 계약 기반 회의적 검증 |
| **마케팅** | 콘텐츠 소재, 계획, build in public |

## 상태 파일

프로젝트 로컬 `.crew/` 디렉토리에 마크다운 파일로 상태를 관리합니다. 플러그인 업데이트 시에도 학습 내용과 상태는 보존됩니다.

## 설계 원칙

- [Anthropic 하네스 설계 아티클](https://www.anthropic.com/engineering/harness-design)을 최우선 레퍼런스로 따름
- 가능한 단순하게 시작하고 필요할 때만 복잡성을 높임
- 모델이 발전하면 불필요해진 구성 요소를 제거

## License

MIT
