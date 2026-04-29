import { describe, expect, test } from "vitest";

import { loadContracts, validateContracts } from "../../scripts/lib/contracts.mjs";

const EXPECTED_ROLES_ORDER = [
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

const REQUIRED_FIELDS = [
  "inputs",
  "outputs",
  "capabilities",
  "policy",
  "claudeSubagent"
];

describe("agent contracts schema", () => {
  test("loadContracts returns the 9 roles in data order with required schema fields", () => {
    const contracts = loadContracts();

    expect(contracts.roles.map((contract) => contract.role)).toEqual(
      EXPECTED_ROLES_ORDER
    );

    for (const contract of contracts.roles) {
      for (const field of REQUIRED_FIELDS) {
        expect(contract, `${contract.role}.${field}`).toHaveProperty(field);
      }

      expect(["read-only", "workspace-write"]).toContain(
        contract.capabilities.workspaceAccess
      );

      expect(contract.policy.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(
        contract.policy.escalateAfterAttempts === null ||
          contract.policy.escalateAfterAttempts >= contract.policy.maxAttempts
      ).toBe(true);

      expect(Array.isArray(contract.claudeSubagent.tools)).toBe(true);
      for (const tool of contract.claudeSubagent.tools) {
        expect(typeof tool).toBe("string");
      }
    }
  });

  test("validateContracts reports role and field names for invalid fixtures", () => {
    const broken = loadContracts();
    const dev = broken.roles.find((contract) => contract.role === "dev");
    dev.claudeSubagent.tools = "Read, Write";

    expect(() => validateContracts(broken)).toThrow(/dev[\s\S]*claudeSubagent\.tools/);
  });

  test("validateContracts reports missing fields in one diagnostic", () => {
    const broken = loadContracts();
    const qa = broken.roles.find((contract) => contract.role === "qa");
    delete qa.policy;

    expect(() => validateContracts(broken)).toThrow(/qa[\s\S]*policy/);
  });
});
