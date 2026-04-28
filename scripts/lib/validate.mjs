import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { deriveBuildOutput, resolveBuildInputs } from "./build.mjs";
import { loadContracts } from "./contracts.mjs";

export async function validate({ root = process.cwd() } = {}) {
  const projectRoot = resolve(root);
  const inputs = resolveBuildInputs(projectRoot);
  const errors = [];

  const contracts = loadContracts(inputs.contractsPath);
  const catalog = JSON.parse(await readFile(inputs.catalogPath, "utf8"));
  const derived = await deriveBuildOutput({
    root: projectRoot,
    contracts,
    catalog,
    instructionsDir: inputs.instructionsDir,
    pluginPath: inputs.pluginPath
  });

  errors.push(
    ...(await compareDerived({
      root: projectRoot,
      pluginPath: inputs.pluginPath,
      derived
    }))
  );
  errors.push(...compareSandboxConsistency({ contracts, catalog }));

  return { ok: errors.length === 0, errors };
}

export async function compareDerived({ root, pluginPath, derived }) {
  const errors = [];

  for (const [role, expected] of derived.agents.entries()) {
    const relPath = `agents/${role}.md`;
    const actual = await readUtf8OrNull(join(root, relPath));
    if (actual !== expected) {
      errors.push(`drift: ${relPath}`);
    }
  }

  const actualPlugin = await readUtf8OrNull(pluginPath);
  if (actualPlugin !== derived.pluginJson) {
    errors.push(await pluginDriftMessage({ root, pluginPath, actualPlugin }));
  }

  return errors;
}

export function compareSandboxConsistency({ contracts, catalog }) {
  const errors = [];

  for (const contract of contracts.roles) {
    const role = contract.role;
    const workspaceAccess = contract.capabilities?.workspaceAccess;
    const codexSandbox = catalog.agent_runtime?.[role]?.codex_sandbox;
    if (workspaceAccess !== codexSandbox) {
      errors.push(
        `mismatch: ${role} workspaceAccess=${workspaceAccess} but codex_sandbox=${codexSandbox}`
      );
    }
  }

  return errors;
}

async function pluginDriftMessage({ root, pluginPath, actualPlugin }) {
  const label = pluginLabel(root, pluginPath);
  if (actualPlugin === null) {
    return `drift: ${label}`;
  }

  try {
    const plugin = JSON.parse(actualPlugin);
    if (!Array.isArray(plugin.agents)) {
      return `drift: ${label} agents`;
    }
    return `drift: ${label} agents`;
  } catch {
    return `drift: ${label}`;
  }
}

function pluginLabel(root, pluginPath) {
  const relPath = relative(root, pluginPath);
  return relPath === ".claude-plugin/plugin.json" ? "plugin.json" : relPath;
}

async function readUtf8OrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
