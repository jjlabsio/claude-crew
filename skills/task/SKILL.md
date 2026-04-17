---
name: task
description: 태스크 관리 — 추가, 작업 시작, 완료, 우선순위 변경, 메모
---

## 역할

프로젝트의 `.crew/tasks/` 디렉토리에서 개별 태스크를 관리한다.
태스크 1개 = 파일 1개. 각 파일이 상태, 순서, 컨텍스트를 포함한다.

---

## 서브커맨드 라우팅

인자를 파싱하여 서브커맨드를 결정한다:

| 패턴 | 서브커맨드 |
|------|-----------|
| `add "설명"` | add |
| `work {id}` | work |
| `start` | start |
| `done` | done |
| `bump {id}` | bump |
| `top {id}` | top |
| `note {id} "내용"` | note |
| `drop {id}` | drop |

인자 없이 `/task`만 실행하면 사용법을 안내한다.

---

## 공통: 태스크 디렉토리 및 ID 관리

### 디렉토리

```
{projectRoot}/.crew/tasks/
```

디렉토리가 없으면 생성한다.

### ID 채번

새 태스크 생성 시 `.crew/tasks/` 내 기존 파일명에서 가장 큰 숫자를 찾아 +1 한다.
파일이 없으면 1부터 시작. ID는 3자리 zero-pad (001, 002, ...).

### 태스크 파일 포맷

```markdown
---
id: 3
title: API rate limit 구현
status: active
order: 1
created: 2026-04-16
due: 2026-04-20
---

## Context
Redis 기반 sliding window rate limiter.
IP당 100req/min, 인증 유저 1000req/min.

## Files
- src/middleware/auth.ts
- src/lib/redis.ts

## Criteria
- [ ] sliding window 알고리즘 구현
- [ ] IP별/유저별 차등 limit

## Log
- 2026-04-17: 태스크 생성
```

---

## add — 태스크 추가

### 인자

```
/task add "설명"
/task add "설명" --next
/task add "설명" --due 4/20
```

- `--next`: queue 맨 위에 삽입 (order를 가장 낮은 값으로 설정)
- `--due`: 기한 설정 (날짜 파싱: `4/20` → 현재 연도 기준 `2026-04-20`)

### 동작

1. ID를 채번한다.
2. 현재 대화에서 컨텍스트를 자동 추출한다:
   - **Context**: 대화에서 이 태스크와 관련된 핵심 내용을 2-5문장으로 요약
   - **Files**: 대화에서 언급된 파일 경로 목록
   - **Criteria**: 대화에서 언급된 완료 조건이 있으면 체크리스트로 작성, 없으면 섹션 비움
3. order를 설정한다:
   - `--next` 없음: 기존 queue 태스크 중 가장 큰 order + 1
   - `--next` 있음: 기존 queue 태스크 중 가장 작은 order - 1
4. 태스크 파일을 `.crew/tasks/{id}.md`에 생성한다 (status: queue).
5. 결과를 출력한다:

```
✓ Task #{id} 추가: {title}
  순서: queue {위치} / 기한: {due 또는 없음}
```

---

## work — 태스크 작업 시작 + 컨텍스트 로드

### 인자

```
/task work {id}
```

### 동작

1. `.crew/tasks/{id}.md`를 읽는다. 파일이 없으면 에러.
2. status를 `active`로 변경한다.
   - 이미 다른 active 태스크가 있으면: "이미 #{기존id}이 active입니다. 먼저 done 처리하거나, 이 태스크를 강제로 active로 전환할까요?" 확인.
3. **Files 섹션의 파일들을 Read**한다:
   - 각 파일의 존재 여부 확인
   - 존재하는 파일은 Read하여 컨텍스트에 로드
4. **브리핑을 출력**한다:

```
━━━ Task #{id}: {title} ━━━━━━━━━━━━━━━━
Due: {due} ({D-day})

Context:
  {Context 섹션 내용}

관련 코드:
  ✓ src/middleware/auth.ts — {파일 내용 기반 한 줄 요약}
  ✓ src/lib/redis.ts — {파일 내용 기반 한 줄 요약}
  ✗ src/types/rate-limit.ts — 파일 없음

Criteria:
  {Criteria 섹션 내용}

Log:
  {최근 3개 항목}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

5. 파일 변경사항을 저장한다 (status 변경).

---

## start — queue 최상단 태스크 작업 시작

### 인자

```
/task start
```

### 동작

1. `.crew/tasks/` 내 `status: queue`인 파일들을 읽는다.
2. order가 가장 작은(= 우선순위 가장 높은) 태스크를 선택한다.
3. 해당 태스크로 `work` 서브커맨드를 실행한다 (동일한 동작).
4. queue가 비어있으면: "queue에 태스크가 없습니다."

---

## done — active 태스크 완료 처리

### 인자

```
/task done
/task done {id}
```

id 생략 시 현재 active 태스크를 대상으로 한다.

### 동작

1. 대상 태스크 파일을 읽는다.
   - id 생략: `status: active`인 태스크를 찾는다. 없으면 에러.
   - id 지정: 해당 파일을 읽는다.
2. status를 `done`으로 변경한다.
3. frontmatter에 `completed: {오늘 날짜}`를 추가한다.
4. Log에 완료 기록을 추가한다: `- {날짜}: 태스크 완료`
5. 파일을 저장한다.
6. 결과 출력:

```
✓ Task #{id} 완료: {title}
```

---

## bump — 우선순위 한 칸 올리기

### 인자

```
/task bump {id}
```

### 동작

1. 대상 태스크 파일을 읽는다. status가 `queue`가 아니면 에러.
2. queue 태스크들을 order 기준으로 정렬한다.
3. 대상 태스크 바로 위의 태스크와 order 값을 스왑한다.
4. 이미 최상단이면: "이미 queue 최상단입니다."
5. 두 파일을 저장한다.
6. 결과 출력:

```
✓ Task #{id} 우선순위 올림: {이전 순위} → {새 순위}
```

---

## top — queue 맨 위로 이동

### 인자

```
/task top {id}
```

### 동작

1. 대상 태스크 파일을 읽는다. status가 `queue`가 아니면 에러.
2. queue 태스크 중 가장 작은 order 값 - 1로 대상의 order를 설정한다.
3. 파일을 저장한다.
4. 결과 출력:

```
✓ Task #{id} → queue 최상단으로 이동
```

---

## note — 태스크에 메모 추가

### 인자

```
/task note {id} "메모 내용"
```

### 동작

1. 대상 태스크 파일을 읽는다.
2. Log 섹션 맨 아래에 추가: `- {날짜}: {메모 내용}`
3. 파일을 저장한다.
4. 결과 출력:

```
✓ Task #{id}에 메모 추가
```

---

## drop — 태스크 삭제

### 인자

```
/task drop {id}
```

### 동작

1. 대상 태스크 파일을 읽는다.
2. 확인: "Task #{id} '{title}'을 삭제합니다. 계속할까요?"
3. 확인 시 파일을 삭제한다.
4. 관련 plan 디렉토리(`.crew/plans/task-{id}/`)가 있으면 함께 삭제한다.
5. 결과 출력:

```
✓ Task #{id} 삭제: {title}
```
