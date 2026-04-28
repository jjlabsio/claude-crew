---
name: crew-dev
description: contract.md를 입력으로 받아 Dev + CodeReviewer + QA 파이프라인으로 구현을 완료한다
---

## 역할

오케스트레이터로부터 task-id를 받아 `contract.md` 기반으로 구현을 완료하고 PR을 생성한다.
`contract.md`가 ACTIVE 상태여야 시작할 수 있다.

에이전트 간 소통은 파일 산출물과 중앙 `crew-agent-runner` 스킬의 dispatch 계약을 통해서만 이루어진다.
이 문서는 역할, 입력, 기대 산출물, 검증 기준, 실패 처리만 정의한다. provider 선택, 런타임 호출, 후속 요청 처리, 사용자 질문 처리는 중앙 runner 계약을 따른다.

**v1 대비 변경**: Critic(DevAuditor) 제거. 오케스트레이터가 CodeReviewer + QA 결과로 직접 판정한다.

---

## 공통 실행 원칙

각 에이전트 단계는 중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.
오케스트레이터는 Phase 1에서 provider 설정을 해석하고, 이후 모든 역할 실행은 runner의 정규화된 AgentResult 응답 처리 규칙을 따른다.

에이전트가 사용자 입력이 필요하다고 반환하면 오케스트레이터가 사용자에게 질문한다.
에이전트가 추가 역할 실행이나 허용 도구 실행을 요청하면 오케스트레이터가 runner 정책에 따라 처리하고 같은 역할 실행에 후속 입력으로 주입한다.

---

## 절대 금지

- 오케스트레이터가 코드를 직접 작성하지 않는다.
- CodeReviewer 또는 QA가 FAIL을 냈을 때 합리화하여 통과시키지 않는다.
- `brief.md`를 어떤 에이전트에게도 전달하지 않는다.
- `contract.md`를 CodeReviewer에게 전달하지 않는다. 가드레일만 인라인 주입한다.
- `plan.md`를 CodeReviewer에게 전달하지 않는다.
- git commit 시 `--no-verify`를 생략하지 않는다. 호스트 프로젝트의 pre-commit hook 중복 실행을 방지하기 위함이다.
- Dev가 자체 검증을 통과하지 못한 상태에서 검증 단계로 넘기지 않는다.
- 에이전트가 허용된 산출물 범위를 넘어 `.crew/` 메타 파일을 탐색하거나 읽게 하지 않는다.

---

## 파일 구조

```text
.crew/plans/{task-id}/
  brief.md              # crew-interview: 유저 원본 요청
  spec.md               # crew-interview: 인터뷰 완료 후 결정화된 스펙
  analysis.md           # TechLead 출력
  plan.md               # Planner 출력
  contract.md           # 스프린트 계약

  dev-log.md                # Dev: 구현 진행 로그, US별 섹션 누적
  review-report.md          # CodeReviewer: US 단위 리뷰 결과, 최신
  qa-report.md              # QA: US 단위 검증 결과, 최신
  review-report-{n}.md      # US 단위 FAIL 시 아카이브
  qa-report-{n}.md          # US 단위 FAIL 시 아카이브
  final-review-report.md    # CodeReviewer: 최종 전체 리뷰 결과
  final-qa-report.md        # QA: 최종 전체 검증 결과
  .dev_loop_count           # US별 개발 루프 카운터, US PASS 시 리셋
  .dev_crash_count          # US별 구현 crash 카운터, US PASS 시 리셋
  .dev_crash_provider       # crash 발생 시 현재 사용 중인 provider 기록
```

---

## 에이전트 정보 차단 정책

| 에이전트 | 역할 | 볼 수 있는 것 | 차단 | 차단 근거 |
|----------|------|---------------|------|----------|
| Dev | 구현 | `plan.md`, `contract.md`, retry 피드백 산출물 | `brief.md`, `spec.md`, `analysis.md` | 의도 추측 방지, plan+contract에 필요 정보 포함 |
| CodeReviewer | 코드 리뷰 | 코드 변경분, contract 가드레일 인라인 요약 | `contract.md`, `plan.md`, `brief.md`, `spec.md`, `dev-log.md`, `.crew/` 메타 변경분 | 수용 기준 체리피킹 방지 |
| QA | 검증 | `plan.md`, 코드베이스, 실행 결과 | `contract.md`, `brief.md`, `spec.md` | 검증 편향 방지 |

---

## 실행 순서

### Phase 1 — 환경 준비

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: orchestrator

inputs:
- task-id
- `data/provider-catalog.json`
- 유저 레벨 및 프로젝트 레벨 provider 설정
- `contract.md`
- 현재 작업 디렉토리와 git 상태

output:
- 해석된 역할별 provider/model/runtime 정책
- 유효성이 확인된 ACTIVE `contract.md`
- 신규 또는 기존 워크트리 선택 결과
- `contract.md` 상태 갱신

role instructions:
- **Phase 1a — provider 설정 해석**: 오케스트레이터는 provider 설정을 해석한다. 프로젝트 설정, 유저 설정, catalog 기본값 순으로 역할별 실행 정책을 결정하고 Phase 2, Phase 3에서 사용할 런타임 제약을 기록한다.
- **Phase 1b — contract.md 검증**: `contract.md` 산출물을 읽는다. 파일 존재, `## 상태`의 ACTIVE 여부, `## 수용 기준`의 비어 있지 않음, `## 검증 시나리오` 존재를 확인한다.
- **Phase 1c — 워크트리 결정**: `contract.md`의 `## 워크트리` 섹션을 우선 적용한다. 없으면 현재 디렉토리가 해당 task-id의 워크트리인지 확인한다. 신규 워크트리는 기준 브랜치에서 준비하고, 기존 워크트리는 reset 없이 이어간다.
- **Phase 1d — 상태 갱신**: `contract.md`의 `## 상태` 섹션을 `IN_PROGRESS`로 갱신한다.

success gate:
- provider 정책이 역할별로 해석되었다.
- `contract.md`가 ACTIVE이며 필수 섹션을 가진다.
- 이후 모든 작업이 수행될 워크트리가 결정되었다.
- 상태가 `IN_PROGRESS`로 갱신되었다.

failure handling:
- `contract.md` 검증 실패 시 구체적 사유와 함께 사용자에게 선택지를 제시한다.
- 워크트리 준비 실패 시 상태를 BLOCKED로 갱신하고 작업을 중단한다.
- provider 해석 중 특정 provider를 사용할 수 없으면 runner 정책에 따라 fallback 또는 escalation을 적용한다.

### Phase 2 — US 단위 증분 루프

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: orchestrator, Dev, CodeReviewer, QA

inputs:
- `plan.md`
- `contract.md`의 수용 기준과 가드레일
- 현재 US의 구현 범위
- retry 시 `review-report-{n}.md`, `qa-report-{n}.md` 피드백 산출물
- git diff와 실행 가능한 검증 명령

output:
- US별 구현 변경분
- `dev-log.md`의 US별 진행 기록
- `review-report.md`, `qa-report.md`
- FAIL 시 아카이브된 feedback 산출물
- PASS 시 US 단위 체크포인트 commit

role instructions:
- **Phase 2a — US 목록 파싱**: 오케스트레이터는 `plan.md`에서 `US-{N}` 목록을 순서대로 파싱한다. 현재 US 인덱스를 관리하며 한 번에 하나의 US만 진행한다.
- **Phase 2b Step 1 — Dev 실행**: Dev는 현재 US 하나만 구현한다. `plan.md` 산출물에서 해당 US와 테스트 전략을 확인하고, `contract.md` 산출물에서 수용 기준을 확인한다. TDD 전략이면 RED, GREEN, REFACTOR 순서를 지키고, tests-after 전략이면 구현 후 명시된 테스트를 작성한다. 완료 전 빌드, 린트, 타입 체크, 테스트, 적용 가능한 lint-staged 검증을 수행한다. `dev-log.md`에는 해당 US 섹션만 추가하거나 retry 이력을 갱신한다.
- **Phase 2b Step 1a — crash 감지 + retry**: Dev 실행이 비정상 종료되거나 자체 검증 결과가 불명확하면 crash로 판정한다. 오케스트레이터는 부분 변경을 마지막 체크포인트로 되돌리고 crash 카운터를 갱신한다. 동일 provider 재시도, provider fallback, 사용자 escalation은 runner 정책과 phase 카운터 규칙을 함께 적용한다.
- **Phase 2b Step 2 — CodeReviewer + QA 병렬 검증**: CodeReviewer와 QA는 동시에 실행한다. CodeReviewer는 `.crew/` 메타 변경을 제외한 코드 변경분과 인라인 가드레일만 보고 품질을 판정한다. QA는 `plan.md` 산출물에서 현재 US의 테스트 시나리오를 확인하고 빌드, 린트, 타입 체크, 전체 테스트, 테스트 전략 준수, US 시나리오 검증을 직접 실행한다. 두 역할은 파일을 직접 작성하지 않고 결과 텍스트를 반환하며, 오케스트레이터가 각 보고서 산출물로 저장한다.
- **Phase 2b Step 3 — 판정**: 오케스트레이터는 CodeReviewer PASS와 QA PASS가 모두 충족될 때만 US PASS로 판정한다. 하나라도 FAIL이면 US FAIL로 판정한다.
- **Phase 2b Step 4 — 체크포인트 commit**: US PASS 즉시 전체 변경을 stage하고 `--no-verify` 옵션으로 `feat({task-id}): US-{k} {US 제목}` 커밋을 만든다. US 루프 카운터와 crash 카운터 산출물이 있으면 삭제한다.
- **Phase 2b Step 5 — FAIL 처리**: 오케스트레이터는 루프 카운터를 읽고, 상한 초과 또는 같은 기준 3회 연속 실패를 확인한다. 계속 진행 가능하면 최신 review/qa 보고서를 번호가 붙은 산출물로 아카이브하고 카운터를 증가시킨 뒤 Dev retry로 돌아간다. Dev retry에는 해당 US의 피드백만 전달한다.

success gate:
- 현재 US의 Dev 자체 검증이 모두 PASS다.
- CodeReviewer와 QA가 모두 PASS를 반환했다.
- PASS한 US가 체크포인트 commit으로 보존되었다.
- 모든 US가 순차적으로 PASS하면 Phase 3으로 이동한다.

failure handling:
- crash 반복 시 provider fallback 또는 사용자 escalation을 적용하고, 필요하면 상태를 `BLOCKED — US-{k} 구현 crash`로 갱신한다.
- 검증 FAIL 반복 시 피드백 보존 루프를 유지한다.
- 루프 상한 초과 또는 같은 항목 3회 연속 FAIL이면 상태를 `BLOCKED — US-{k}에서 중단`으로 갱신하고 사용자에게 선택지를 제시한다.

### Phase 3 — 최종 통합 검증

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: orchestrator, CodeReviewer, QA

inputs:
- 모든 US 체크포인트 이후의 전체 코드 변경분
- `contract.md`의 가드레일 인라인 요약
- `plan.md`의 모든 US, 테스트 시나리오, 검증 시나리오, 실행 검증 절차

output:
- `final-review-report.md`
- `final-qa-report.md`
- 최종 PASS 또는 FAIL 판정 입력

role instructions:
- CodeReviewer와 QA를 동시에 실행한다.
- CodeReviewer는 전체 코드 변경분을 대상으로 가드레일 위반, 컨벤션, 보안, 복잡도, 잠재 버그, 에러 처리, 모듈 간 정합성을 검토한다. `contract.md`, `plan.md`, `brief.md`, `spec.md`, `dev-log.md` 산출물은 읽지 않는다.
- QA는 전체 구현에 대해 빌드, 린트, 타입 체크, 전체 테스트, 테스트 전략 준수, 전체 E2E 또는 통합 검증, `plan.md`의 실행 검증 절차를 직접 실행한다. 실행 검증 절차가 없으면 FAIL로 판정한다.
- 두 역할은 파일을 직접 작성하지 않고 결과 텍스트를 반환한다. 오케스트레이터가 최종 보고서 산출물로 저장한다.

success gate:
- 최종 CodeReviewer 결과가 PASS다.
- 최종 QA 결과가 PASS다.
- 최종 보고서 산출물이 모두 저장되었다.

failure handling:
- 최종 전체 검증 FAIL 시 자동 retry하지 않는다.
- 상태를 `BLOCKED — 최종 전체 검증 FAIL`로 갱신한다.
- 개별 US는 통과했지만 통합 단계에서 실패했음을 사용자에게 알리고, 원인 특정 후 수동 수정, plan 재설계, 보류 중 하나를 선택하게 한다.

### Phase 4 — PR + 완료

중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.

role: orchestrator

inputs:
- Phase 3 최종 보고서
- 현재 브랜치와 git 상태
- task-id와 PR 제목/본문에 필요한 요약

output:
- 원격 브랜치 push 결과
- 생성된 PR 링크
- `contract.md` 완료 상태

role instructions:
- **4a. 최종 판정**: CodeReviewer PASS와 QA PASS가 모두 충족될 때만 완료 처리한다. 하나라도 FAIL이면 Phase 3 failure handling을 적용한다.
- **4b. PR 생성**: US 단위 커밋은 Phase 2에서 이미 완료되었으므로 추가 커밋은 만들지 않는다. 현재 브랜치를 push하고 PR을 생성한다.
- PR 본문에는 구현 요약, 완료한 US 목록, 검증 결과, 최종 보고서 위치를 포함한다.
- PR 생성 후 `contract.md` 상태를 `DONE`으로 갱신한다.

success gate:
- 원격 브랜치가 push되었다.
- PR이 생성되었다.
- `contract.md` 상태가 완료로 갱신되었다.

failure handling:
- push 또는 PR 생성 실패 시 상태를 BLOCKED로 갱신하지 않는다. 코드 구현은 완료된 상태이므로 실패 원인과 재시도 명령을 사용자에게 제시한다.
- 최종 판정이 FAIL이면 PR을 생성하지 않는다.
