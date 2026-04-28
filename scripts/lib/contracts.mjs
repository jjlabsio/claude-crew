import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONTRACTS_PATH = "data/agent-contracts.json";
const WORKSPACE_ACCESS_VALUES = new Set(["read-only", "workspace-write"]);

export function loadContracts(filePath = DEFAULT_CONTRACTS_PATH) {
  const resolvedPath = resolve(process.cwd(), filePath);
  const contracts = JSON.parse(readFileSync(resolvedPath, "utf8"));
  validateContracts(contracts);
  return contracts;
}

export function validateContracts(obj) {
  const diagnostics = [];

  if (!isPlainObject(obj)) {
    throw new Error("Invalid agent contracts:\n- <root>: expected object");
  }

  if (typeof obj.version !== "number") {
    diagnostics.push("<root>: version must be a number");
  }

  if (!Array.isArray(obj.roles)) {
    diagnostics.push("<root>: roles must be an array");
    throwContractsError(diagnostics);
  }

  if (obj.roles.length === 0) {
    diagnostics.push("<root>: roles must not be empty");
  }

  const seenRoles = new Set();
  for (const [index, contract] of obj.roles.entries()) {
    if (isPlainObject(contract) && typeof contract.role === "string") {
      if (seenRoles.has(contract.role)) {
        diagnostics.push(`${contract.role}: duplicate role name`);
      }
      seenRoles.add(contract.role);
    }
    validateRole(contract, index, diagnostics);
  }

  if (diagnostics.length > 0) {
    throwContractsError(diagnostics);
  }
}

function validateRole(contract, index, diagnostics) {
  const role = getRoleLabel(contract, index);

  if (!isPlainObject(contract)) {
    diagnostics.push(`${role}: role contract must be an object`);
    return;
  }

  requireField(contract, "role", role, diagnostics);
  requireField(contract, "inputs", role, diagnostics);
  requireField(contract, "outputs", role, diagnostics);
  requireField(contract, "capabilities", role, diagnostics);
  requireField(contract, "policy", role, diagnostics);
  requireField(contract, "claudeSubagent", role, diagnostics);

  if (typeof contract.role !== "string") {
    diagnostics.push(`${role}: role must be a string`);
  }
  validateCapabilities(contract.capabilities, role, diagnostics);
  validatePolicy(contract.policy, role, diagnostics);
  validateClaudeSubagent(contract.claudeSubagent, role, diagnostics);
}

function validateCapabilities(capabilities, role, diagnostics) {
  if (!isPlainObject(capabilities)) {
    diagnostics.push(`${role}: capabilities must be an object`);
    return;
  }

  if (!WORKSPACE_ACCESS_VALUES.has(capabilities.workspaceAccess)) {
    diagnostics.push(
      `${role}: capabilities.workspaceAccess must be one of ${Array.from(WORKSPACE_ACCESS_VALUES).join(", ")}`
    );
  }
}

function validatePolicy(policy, role, diagnostics) {
  if (!isPlainObject(policy)) {
    diagnostics.push(`${role}: policy must be an object`);
    return;
  }

  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    diagnostics.push(`${role}: policy.maxAttempts must be an integer >= 1`);
  }
}

function validateClaudeSubagent(claudeSubagent, role, diagnostics) {
  if (!isPlainObject(claudeSubagent)) {
    diagnostics.push(`${role}: claudeSubagent must be an object`);
    return;
  }

  validateStringArray(
    claudeSubagent.tools,
    `${role}: claudeSubagent.tools`,
    diagnostics
  );
}

function validateStringArray(value, field, diagnostics) {
  if (!Array.isArray(value)) {
    diagnostics.push(`${field} must be a string array`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      diagnostics.push(`${field}[${index}] must be a string`);
    }
  }
}

function requireField(contract, field, role, diagnostics) {
  if (!Object.hasOwn(contract, field)) {
    diagnostics.push(`${role}: missing required field ${field}`);
  }
}

function throwContractsError(diagnostics) {
  throw new Error(`Invalid agent contracts:\n- ${diagnostics.join("\n- ")}`);
}

function getRoleLabel(contract, index) {
  if (isPlainObject(contract) && typeof contract.role === "string") {
    return contract.role;
  }
  return `<role-${index}>`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
