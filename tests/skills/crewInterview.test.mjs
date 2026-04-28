import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const SKILL_PATH = join(process.cwd(), "skills", "crew-interview", "SKILL.md");

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
  "### Phase 1 — 초기화",
  "### Phase 2 — 인터뷰 루프",
  "### Phase 3 — Simplifier",
  "### Phase 4 — spec 결정화 + 유저 승인"
];

const REQUIRED_FLOW_MARKERS = [
  "brief.md",
  "Explorer",
  "인터뷰 루프",
  "Simplifier",
  "spec.md",
  "승인"
];

function validateCrewInterviewSkill(text) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(text, `${pattern} must not appear`).not.toMatch(pattern);
  }

  for (const phase of REQUIRED_PHASES) {
    const start = text.indexOf(phase);
    expect(start, `${phase} section is required`).toBeGreaterThanOrEqual(0);

    const next = text.indexOf("\n### Phase ", start + phase.length);
    const section = text.slice(start, next === -1 ? undefined : next);
    expect(section, `${phase} must use central runner dispatch`).toContain(
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다."
    );

    for (const field of REQUIRED_ABSTRACT_FIELDS) {
      expect(section, `${phase} must include ${field}`).toContain(field);
    }
  }

  for (const marker of REQUIRED_FLOW_MARKERS) {
    expect(text, `${marker} flow marker is required`).toContain(marker);
  }

  expect(text, "crew-agent-runner reference is required").toContain(
    "crew-agent-runner"
  );
}

describe("crew-interview skill", () => {
  test("uses phase-level abstract specs without direct dispatch patterns", async () => {
    const text = await readFile(SKILL_PATH, "utf8");

    validateCrewInterviewSkill(text);
  });

  test("detects a fixture with forbidden direct-dispatch patterns", () => {
    const fixture = [
      "### Phase 1 — 초기화",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: pm",
      "inputs:",
      "- user request",
      "output:",
      "- brief.md",
      "role instructions:",
      "- write brief.md and request Explorer context",
      "success gate:",
      "- brief.md exists and Explorer context is available",
      "failure handling:",
      "- report failure",
      "### Phase 2 — 인터뷰 루프",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: pm",
      "inputs:",
      "- brief.md and Explorer context",
      "output:",
      "- interview decisions",
      "role instructions:",
      "- run 인터뷰 루프",
      "success gate:",
      "- checklist resolved",
      "failure handling:",
      "- report failure",
      "### Phase 3 — Simplifier",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: pm",
      "inputs:",
      "- interview decisions",
      "output:",
      "- simplified scope",
      "role instructions:",
      "- simplify",
      "success gate:",
      "- scope confirmed",
      "failure handling:",
      "- report failure",
      "### Phase 4 — spec 결정화 + 유저 승인",
      "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
      "role: pm",
      "inputs:",
      "- simplified scope",
      "output:",
      "- spec.md and 승인",
      "role instructions:",
      "- write spec.md",
      "success gate:",
      "- spec.md approved",
      "failure handling:",
      "- report failure",
      ["run", "Agent("].join("")
    ].join("\n");

    expect(() => validateCrewInterviewSkill(fixture)).toThrow(
      /must not appear/
    );
  });
});
