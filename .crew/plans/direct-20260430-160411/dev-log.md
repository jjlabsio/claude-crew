# Dev Log

## Summary

- Updated CLI tests that implicitly depended on catalog defaults to write project-level `.crew/config.json` overrides.
- Scoped changes to CLI tests in `prepare.test.mjs`, `dispatch.test.mjs`, and `resolve.test.mjs`.
- Left lib-level tests unchanged.

## Changes

- `tests/runner/prepare.test.mjs`
  - Added a `writeProjectConfig` helper.
  - Added explicit `dev` provider override: `codex` / `gpt-5.5` / `medium`.
  - Ran Codex prepare CLI cases with `cwd: tmpDir`.
  - Updated expected dispatch command path to use `REPO_ROOT`.

- `tests/runner/dispatch.test.mjs`
  - Added project config helpers.
  - Added explicit `dev` provider override for targeted dispatch CLI tests.
  - Ran targeted dispatch CLI invocations with `cwd: tmpDir`.
  - Reused the project config helper for the existing Claude `qa` rejection case.

- `tests/runner/resolve.test.mjs`
  - Added `REPO_ROOT`.
  - Added explicit `planner` provider override: `codex` / `gpt-5.5` / `medium`.
  - Ran the planner resolve CLI case with `cwd: tmpDir` and an absolute runner script path.

## Verification

- `npx vitest run`
- Result: 23 test files passed, 113 tests passed.
