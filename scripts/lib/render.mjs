export function renderPrompt(input) {
  const { role, request = {}, contract = {} } = input;
  const parts = [
    `# ${titleCase(role)}`,
    section("Capability", renderCapability(contract)),
    section("Inputs", renderInputs(request.inputs, contract.inputs?.denied)),
    section("Outputs", renderJson(contract.outputs)),
    section("Instructions", request.instruction, { required: true }),
    section("Success Gate", request.successGate),
    section("Failure Handling", request.failureHandling)
  ].filter(Boolean);

  return `${parts.join("\n\n")}\n`;
}

export function section(title, body, options = {}) {
  const renderedBody = normalizeBody(body);
  if (renderedBody.length === 0) {
    if (options.required) {
      return `## ${title}`;
    }
    return "";
  }

  return `## ${title}\n${renderedBody}`;
}

function renderCapability(contract) {
  const tools = Array.isArray(contract.claudeSubagent?.tools)
    ? contract.claudeSubagent.tools
    : [];
  const outputs = Array.isArray(contract.outputs) ? contract.outputs : [];

  return [
    `workspaceAccess: ${contract.capabilities?.workspaceAccess ?? "unknown"}`,
    `canAskUser: ${String(tools.includes("AskUserQuestion"))}`,
    `canRequestAgent: ${String(tools.includes("Agent"))}`,
    `canUseShell: ${String(tools.includes("Bash"))}`,
    `canWriteCrewFiles: ${String(canWriteCrewFiles(outputs))}`
  ].join("\n");
}

function renderInputs(inputs, denied) {
  const lines = [];

  if (Array.isArray(inputs) && inputs.length > 0) {
    for (const item of inputs) {
      lines.push(`### ${item.path}`);
      lines.push(item.content ?? "");
    }
  }

  if (Array.isArray(denied) && denied.length > 0) {
    lines.push("### Denied Inputs");
    for (const item of denied) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

function renderJson(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function normalizeBody(body) {
  if (body === undefined || body === null) {
    return "";
  }

  return String(body).trim();
}

function titleCase(value) {
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("-");
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
