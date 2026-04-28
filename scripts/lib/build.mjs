import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadContracts } from "./contracts.mjs";

const DEFAULT_CONTRACTS_PATH = "data/agent-contracts.json";
const FALLBACK_CONTRACTS_PATH = "contracts.json";
const DEFAULT_CATALOG_PATH = "data/provider-catalog.json";
const FALLBACK_CATALOG_PATH = "provider-catalog.json";
const DEFAULT_INSTRUCTIONS_DIR = "data/agent-instructions";
const FALLBACK_INSTRUCTIONS_DIR = "instructions";
const DEFAULT_PLUGIN_PATH = ".claude-plugin/plugin.json";
const FALLBACK_PLUGIN_PATH = "plugin.json";

export async function build({ root = process.cwd() } = {}) {
  const inputs = resolveBuildInputs(resolve(root));
  const contracts = loadContracts(inputs.contractsPath);
  const catalog = JSON.parse(await readFile(inputs.catalogPath, "utf8"));

  await warnOrphanInstructions({
    instructionsDir: inputs.instructionsDir,
    contracts
  });

  const derived = await deriveBuildOutput({
    root,
    contracts,
    catalog,
    instructionsDir: inputs.instructionsDir,
    pluginPath: inputs.pluginPath
  });

  const agentsDir = join(inputs.projectRoot, "agents");
  await mkdir(agentsDir, { recursive: true });

  for (const [role, content] of derived.agents.entries()) {
    await writeFile(join(agentsDir, `${role}.md`), content, "utf8");
  }

  await writeFile(inputs.pluginPath, derived.pluginJson, "utf8");
}

export async function deriveBuildOutput({
  root = process.cwd(),
  contracts,
  catalog,
  instructionsDir,
  pluginPath
} = {}) {
  const inputs = resolveBuildInputs(resolve(root));
  const resolvedContracts =
    contracts ?? loadContracts(inputs.contractsPath);
  const resolvedCatalog =
    catalog ?? JSON.parse(await readFile(inputs.catalogPath, "utf8"));
  const resolvedInstructionsDir = instructionsDir ?? inputs.instructionsDir;
  const resolvedPluginPath = pluginPath ?? inputs.pluginPath;

  const instructionsByRole = new Map();
  const missingInstructions = [];
  for (const contract of resolvedContracts.roles) {
    const role = contract.role;
    const instructionPath = join(resolvedInstructionsDir, `${role}.md`);
    if (!existsSync(instructionPath)) {
      missingInstructions.push(role);
      continue;
    }

    instructionsByRole.set(role, await readFile(instructionPath, "utf8"));
  }

  if (missingInstructions.length > 0) {
    throw new Error(
      `Missing agent instructions: ${missingInstructions.join(", ")}`
    );
  }

  const agents = new Map();
  for (const contract of resolvedContracts.roles) {
    const role = contract.role;

    const model = resolvedCatalog.agent_defaults?.[role]?.model;
    if (typeof model !== "string" || model.length === 0) {
      throw new Error(`Missing provider catalog model for role: ${role}`);
    }

    const agent = renderAgent({
      contract,
      model,
      instructions: instructionsByRole.get(role)
    });
    agents.set(role, agent);
  }

  const plugin = JSON.parse(await readFile(resolvedPluginPath, "utf8"));
  plugin.agents = resolvedContracts.roles.map(
    (contract) => `./agents/${contract.role}.md`
  );

  return {
    agents,
    pluginJson: `${JSON.stringify(plugin, null, 2)}\n`
  };
}

export function serializeFrontmatter({ name, model, description, tools }) {
  return [
    "---",
    `name: ${name}`,
    `model: ${model}`,
    `description: ${description}`,
    `tools: [${tools.join(", ")}]`,
    "---"
  ].join("\n");
}

function renderAgent({ contract, model, instructions }) {
  const frontmatter = serializeFrontmatter({
    name: contract.role,
    model,
    description: contract.claudeSubagent.description,
    tools: contract.claudeSubagent.tools
  });
  const body = [renderCapability(contract), normalizeBlockBody(instructions)]
    .filter(Boolean)
    .join("\n\n");

  return `${frontmatter}\n\n${body}\n`;
}

function renderCapability(contract) {
  const tools = Array.isArray(contract.claudeSubagent?.tools)
    ? contract.claudeSubagent.tools
    : [];
  const outputs = Array.isArray(contract.outputs) ? contract.outputs : [];

  return [
    "## Capability",
    `workspaceAccess: ${contract.capabilities?.workspaceAccess ?? "unknown"}`,
    `canAskUser: ${String(tools.includes("AskUserQuestion"))}`,
    `canRequestAgent: ${String(tools.includes("Agent"))}`,
    `canUseShell: ${String(tools.includes("Bash"))}`,
    `canWriteCrewFiles: ${String(canWriteCrewFiles(outputs))}`
  ].join("\n");
}

async function warnOrphanInstructions({ instructionsDir, contracts }) {
  const roles = new Set(contracts.roles.map((contract) => contract.role));
  const entries = await readdir(instructionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const role = entry.name.slice(0, -".md".length);
    if (!roles.has(role)) {
      console.error(`Warning: instruction file has no contract role: ${role}`);
    }
  }
}

function resolveInput(root, primary, fallback) {
  const primaryPath = join(root, primary);
  if (existsSync(primaryPath)) {
    return primaryPath;
  }

  const fallbackPath = join(root, fallback);
  if (existsSync(fallbackPath)) {
    return fallbackPath;
  }

  return primaryPath;
}

export function resolveBuildInputs(root = process.cwd()) {
  const projectRoot = resolve(root);
  return {
    projectRoot,
    contractsPath: resolveInput(
      projectRoot,
      DEFAULT_CONTRACTS_PATH,
      FALLBACK_CONTRACTS_PATH
    ),
    catalogPath: resolveInput(
      projectRoot,
      DEFAULT_CATALOG_PATH,
      FALLBACK_CATALOG_PATH
    ),
    instructionsDir: resolveInput(
      projectRoot,
      DEFAULT_INSTRUCTIONS_DIR,
      FALLBACK_INSTRUCTIONS_DIR
    ),
    pluginPath: resolveInput(
      projectRoot,
      DEFAULT_PLUGIN_PATH,
      FALLBACK_PLUGIN_PATH
    )
  };
}

function normalizeBlockBody(body) {
  return String(body)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "");
}

function canWriteCrewFiles(outputs) {
  return outputs.some((output) => {
    return (
      output?.type === "artifact" &&
      typeof output.target === "string" &&
      output.target.startsWith(".crew/")
    );
  });
}
