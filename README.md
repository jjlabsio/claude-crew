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

HUD statusline이 설정되어 세션 중 레포, 브랜치, 모델, 컨텍스트 사용률, 에이전트 상태를 실시간으로 확인할 수 있다.

## 사용

```
/crew
```

오케스트레이터가 시작되고 현황을 브리핑합니다.

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

## 상태 파일

프로젝트 로컬 `.crew/` 디렉토리에 마크다운 파일로 상태를 관리합니다. 플러그인 업데이트 시에도 학습 내용과 상태는 보존됩니다.

## 설계 철학

**역할별 관점은 유지하되, 정보는 제한하지 않는다.**

각 에이전트는 특정 관점(기획/기술/구현)에서 사고하지만, 활용할 수 있는 정보(코드 포함)는 제한하지 않는다. 실제 회사의 역할 분리를 모방하는 것이 아니라, 빠뜨리는 관점이 없도록 구조화된 사고를 강제하는 것이 목적이다.

### 기타 원칙

- [Anthropic 하네스 설계 아티클](https://www.anthropic.com/engineering/harness-design)을 최우선 레퍼런스로 따름
- 가능한 단순하게 시작하고 필요할 때만 복잡성을 높임
- 모델이 발전하면 불필요해진 구성 요소를 제거

## License

MIT
