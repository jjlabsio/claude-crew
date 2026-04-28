import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const SKILL_PATH = join(process.cwd(), "skills", "crew-setup", "SKILL.md");
const CONTRACTS_PATH = join(process.cwd(), "data", "agent-contracts.json");

async function loadExpectedRoles() {
  const contracts = JSON.parse(await readFile(CONTRACTS_PATH, "utf8"));
  return contracts.roles.map((contract) => contract.role);
}

function extractRoleTableRoles(text) {
  const header = "### 3c. Role 목록";
  const start = text.indexOf(header);
  expect(start, `${header} section is required`).toBeGreaterThanOrEqual(0);

  const next = text.indexOf("\n### ", start + header.length);
  const section = text.slice(start, next === -1 ? undefined : next);
  const rows = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\| `[^`]+` \|/.test(line));

  return rows.map((line) => line.match(/^\| `([^`]+)` \|/)?.[1]);
}

function validateCrewSetupSkill(text, expectedRoles) {
  expect(text, "role list source must be agent contracts").toContain(
    "role 목록의 source는 `data/agent-contracts.json`이다"
  );

  expect(extractRoleTableRoles(text), "role table must follow contract order").toEqual(
    expectedRoles
  );

  expect(text, "Claude provider branch must remain documented").toContain(
    "claude provider일 때"
  );
  expect(text, "Codex provider branch must remain documented").toContain(
    "codex provider일 때"
  );
}

describe("crew-setup skill", () => {
  test("uses agent contracts as the role-list source and preserves provider setup branches", async () => {
    const [text, expectedRoles] = await Promise.all([
      readFile(SKILL_PATH, "utf8"),
      loadExpectedRoles()
    ]);

    validateCrewSetupSkill(text, expectedRoles);
  });

  test("detects a fixture missing one contracted role", () => {
    const expectedRoles = [
      "pm",
      "techlead",
      "planner",
      "plan-evaluator",
      "explorer",
      "researcher",
      "dev",
      "code-reviewer",
      "qa"
    ];
    const fixture = `---
name: crew-setup
description: fixture
---

### 3c. Role 목록

role 목록의 source는 \`data/agent-contracts.json\`이다.

| role | provider 설정 대상 |
|---|---|
| \`pm\` | yes |
| \`techlead\` | yes |
| \`planner\` | yes |
| \`plan-evaluator\` | yes |
| \`explorer\` | yes |
| \`researcher\` | yes |
| \`dev\` | yes |
| \`code-reviewer\` | yes |

claude provider일 때
codex provider일 때
`;

    expect(() => validateCrewSetupSkill(fixture, expectedRoles)).toThrow(
      /role table must follow contract order/
    );
  });
});
