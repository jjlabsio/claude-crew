# Dev Log: direct-20260430-134322

## Issue #43 - persist-artifact artifact omission

### Changes

- Updated `scripts/lib/artifacts.mjs` so artifact targets resolve `{task-id}` from `taskId`, `task_id`, or `task-id`.
- Added `{run-id}` resolution from `runId`, `run_id`, or `run-id`.
- Added fail-fast validation for unresolved artifact target template variables to prevent literal `{task-id}` or `{run-id}` paths from being written.
- Updated `skills/crew-dev/SKILL.md` Phase 2 checkpoint instructions to stage with `git add -A`, include `.crew/plans/{task-id}/requests/` and `.crew/plans/{task-id}/runs/`, and verify no untracked plan artifacts remain before committing.
- Added focused tests for kebab-case task-id resolution, run-id resolution, unresolved template rejection, and the `persist-artifact` CLI path.

### Verification

- `npm test -- --run tests/runner/artifacts.test.mjs tests/skills/crewDev.test.mjs` passed: 19 tests.
- `npm test -- --run` passed: 100 tests across 20 files.

### Remaining Risk

- There is no standalone checkpoint commit implementation in this repository; Phase 2 checkpoint behavior is governed by the `crew-dev` skill contract. The fix therefore tightens that executable workflow contract rather than changing a separate commit helper.
