# Dev Log

## Task

GitHub issue #44: replace `AUTO_GIT_DIFF` request input placeholders with the current git diff before Codex dispatch prompt rendering.

## Changes

- Added `resolveAutoGitDiffInputs`, `hasAutoGitDiffInput`, and `generateAutoGitDiff` in `scripts/lib/dispatch.mjs`.
- Wired placeholder resolution into the shared `dispatch()` path before `renderPrompt()`, so CLI dispatch and direct library dispatch calls use the same replacement behavior.
- `generateAutoGitDiff()` now prefers staged and unstaged diffs, and falls back to `git diff HEAD~1` when the working tree has no staged/unstaged diff.
- Added dispatch tests for exact placeholder replacement and prompt expansion.
- Made the dispatch CLI provider-guard test self-contained by using a temporary project config instead of relying on current catalog defaults.

## Validation

- `npm test -- tests/runner/dispatch.test.mjs --configLoader runner` passed: 11 tests.
- `npm test -- --configLoader runner` ran 108 tests: 107 passed, 1 failed.

## Known Residual Risk

- Full suite failure is unrelated to this change: `tests/runner/prepare.test.mjs` expects `plan-evaluator` to resolve to Claude, but current `data/provider-catalog.json` defaults `plan-evaluator` to Codex.
