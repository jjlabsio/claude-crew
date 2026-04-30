# Result: direct-20260430-134322

Status: complete

Fixed Issue #43 by hardening artifact target template resolution and updating the crew-dev checkpoint contract so untracked pipeline artifacts under `.crew/plans/{task-id}/` are staged and audited before checkpoint commits.

Changed files:

- `scripts/lib/artifacts.mjs`
- `tests/runner/artifacts.test.mjs`
- `skills/crew-dev/SKILL.md`
- `.crew/plans/direct-20260430-134322/dev-log.md`
- `.crew/runs/direct-20260430-134322/result.md`

Verification:

- `npm test -- --run tests/runner/artifacts.test.mjs tests/skills/crewDev.test.mjs` passed.
- `npm test -- --run` passed.

Remaining risk:

- No separate checkpoint commit helper exists in code; the checkpoint behavior lives in the `crew-dev` workflow contract, which now explicitly stages all changes and checks for missed untracked plan artifacts.
