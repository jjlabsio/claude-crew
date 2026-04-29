import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { validateWorkflowSkillDispatchContract } from "../../scripts/lib/skillDispatchContract.mjs";

const SKILL_PATH = join(process.cwd(), "skills", "crew-plan", "SKILL.md");

const FORBIDDEN_PATTERNS = [
  /Agent\(/,
  /Bash\(/,
  new RegExp(["crew", "codex", "companion"].join("-")),
  /runAgent\(/,
  new RegExp(["AskUser", "Question"].join("")),
  new RegExp(`<${["crew", "agent", "result"].join("-")}>`)
];

const REQUIRED_ABSTRACT_FIELDS = [
  "role:",
  "inputs:",
  "output:",
  "role instructions:",
  "success gate:",
  "failure handling:"
];

const REQUIRED_PHASES = [
  "### Step 2 — TechLead 실행",
  "### Step 3 — Planner 실행",
  "### Step 4 — PlanEvaluator 실행"
];

function validateCrewPlanSkill(text) {
  expect(validateWorkflowSkillDispatchContract(text, SKILL_PATH)).toEqual([]);

  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(text, `${pattern} must not appear`).not.toMatch(pattern);
  }

  for (const phase of REQUIRED_PHASES) {
    const start = text.indexOf(phase);
    expect(start, `${phase} section is required`).toBeGreaterThanOrEqual(0);

    const next = text.indexOf("\n### Step ", start + phase.length);
    const section = text.slice(start, next === -1 ? undefined : next);
    expect(section, `${phase} must use central runner dispatch`).toContain(
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다."
    );

    for (const field of REQUIRED_ABSTRACT_FIELDS) {
      expect(section, `${phase} must include ${field}`).toContain(field);
    }
  }

  expect(text, "crew-agent-runner reference is required").toContain(
    "crew-agent-runner"
  );
}

describe("crew-plan skill", () => {
  test("uses phase-level abstract specs without direct dispatch patterns", async () => {
    const text = await readFile(SKILL_PATH, "utf8");

    validateCrewPlanSkill(text);
  });

  test("detects a fixture with a direct bash call", () => {
    const fixture = [
      "### Step 2 — TechLead 실행",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: techlead",
      "inputs:",
      "- spec.md",
      "output:",
      "- complete.artifact → analysis.md",
      "role instructions:",
      "- analyze",
      "success gate:",
      "- analysis exists",
      "failure handling:",
      "- contract.policy",
      ["Ba", "sh("].join(""),
      "### Step 3 — Planner 실행",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: planner",
      "inputs:",
      "- spec.md",
      "output:",
      "- complete.artifact → plan.md",
      "role instructions:",
      "- plan",
      "success gate:",
      "- plan exists",
      "failure handling:",
      "- contract.policy",
      "### Step 4 — PlanEvaluator 실행",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: plan-evaluator",
      "inputs:",
      "- plan.md",
      "output:",
      "- complete.artifact → review.md",
      "role instructions:",
      "- evaluate",
      "success gate:",
      "- review exists",
      "failure handling:",
      "- contract.policy"
    ].join("\n");

    expect(validateWorkflowSkillDispatchContract(fixture, SKILL_PATH)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/direct agent dispatch is forbidden/)
      ])
    );
    expect(() => validateCrewPlanSkill(fixture)).toThrow();
  });
});
