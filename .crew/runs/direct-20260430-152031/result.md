# Result

Status: complete

## Summary

Implemented `AUTO_GIT_DIFF` expansion in the shared Codex dispatch path. When any `request.inputs[].content` is exactly `AUTO_GIT_DIFF`, the runner now replaces it with generated git diff content before rendering the prompt sent to the Codex companion.

## Changed Files

- `scripts/lib/dispatch.mjs`
- `tests/runner/dispatch.test.mjs`
- `.crew/plans/direct-20260430-152031/dev-log.md`
- `.crew/runs/direct-20260430-152031/result.md`

## Verification

- Passed: `npm test -- tests/runner/dispatch.test.mjs --configLoader runner`
- Full suite: `npm test -- --configLoader runner` produced 107 passing tests and 1 unrelated failure in `tests/runner/prepare.test.mjs`, where the test expects `plan-evaluator` to be a Claude provider role while the current catalog resolves it as Codex.

## Remaining Risk

- Diff generation requires running inside a git worktree. If neither staged/unstaged changes nor `HEAD~1` diff are available, the placeholder is replaced with a clear `No git diff available` message.
