const PROVIDERS = new Set(["claude", "codex"]);

export function resolveRole(input) {
  const { role, catalog, userConfig = {}, projectConfig = {}, contracts } = input;
  const contract = findContract(role, contracts);

  if (!contract) {
    throw new Error(`Unknown role: ${role}`);
  }

  const defaults = cascadeRoleConfig(role, catalog, userConfig, projectConfig);
  const provider = defaults.provider;
  if (!PROVIDERS.has(provider)) {
    throw new Error(`Unknown provider for role ${role}: ${provider}`);
  }

  const model = defaults.model;
  if (typeof model !== "string" || model.length === 0) {
    throw new Error(`Missing model for role ${role}`);
  }

  const codexSandbox = catalog?.agent_runtime?.[role]?.codex_sandbox;
  if (!["read-only", "workspace-write"].includes(codexSandbox)) {
    throw new Error(`Missing codex_sandbox for role ${role}`);
  }

  const warnings = [];
  const workspaceAccess = contract?.capabilities?.workspaceAccess;
  if (codexSandbox !== workspaceAccess) {
    warnings.push(
      `${role}: codex_sandbox ${codexSandbox} does not match contract capabilities.workspaceAccess ${workspaceAccess}`
    );
  }

  return {
    role,
    provider,
    model,
    reasoning: provider === "codex" ? defaults.reasoning ?? null : null,
    codex_sandbox: codexSandbox,
    contract,
    dispatch: {
      path: provider === "codex" ? "codex" : "claude",
      write: codexSandbox === "workspace-write"
    },
    warnings
  };
}

function cascadeRoleConfig(role, ...configs) {
  return configs.reduce((merged, config) => {
    return {
      ...merged,
      ...roleConfig(config, role)
    };
  }, {});
}

function roleConfig(config, role) {
  return {
    ...(config?.agent_defaults?.[role] ?? {}),
    ...(config?.providers?.[role] ?? {})
  };
}

function findContract(role, contracts) {
  if (Array.isArray(contracts?.roles)) {
    return contracts.roles.find((contract) => contract.role === role);
  }

  return contracts?.[role];
}
