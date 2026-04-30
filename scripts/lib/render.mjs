export function renderPrompt(input) {
  const { role, request = {}, contract = {} } = input;
  const parts = [
    `# ${titleCase(role)}`,
    section("Capability", renderCapability(contract)),
    section("Inputs", renderInputs(request.inputs, contract.inputs?.denied)),
    section("Outputs", renderJson(contract.outputs)),
    section("Instructions", request.instruction, { required: true }),
    section("Success Gate", request.successGate),
    section("Failure Handling", request.failureHandling),
    section("AgentResult Contract", renderAgentResultContract(contract))
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

export function fenceBlock(body, fence = "---") {
  return `${fence}\n${normalizeBlockBody(body)}\n${fence}`;
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
    `canReturnCrewArtifact: ${String(canReturnCrewArtifact(outputs, contract.capabilities?.workspaceAccess))}`
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

function renderAgentResultContract(contract = {}) {
  const outputs = Array.isArray(contract.outputs) ? contract.outputs : [];
  const workspaceAccess = contract.capabilities?.workspaceAccess;
  const returnArtifact = canReturnCrewArtifact(outputs, workspaceAccess);

  const lines = [
    "Return exactly one final AgentResult JSON object wrapped in these tags:",
    "",
    "```text",
    "<crew-agent-result>",
    "{",
    '  "status": "complete | blocked_on_user | needs_agent | needs_tool | failed",',
    `  "artifact": ${returnArtifact ? '"full Markdown content of the artifact"' : "null"},`,
    '  "questions": [],',
    '  "requests": [],',
    '  "summary": "short summary",',
    '  "error": null',
    "}",
    "</crew-agent-result>",
    "```",
    "",
    "Rules:",
    "- The wrapper tags are mandatory.",
    "- The JSON inside the tags must be valid JSON.",
    "- Use complete when the requested artifact is ready.",
    "- Use blocked_on_user only with a non-empty questions array.",
    "- Use needs_agent or needs_tool only with a non-empty requests array.",
    "- Use failed with an error string when the task cannot continue."
  ];

  if (returnArtifact) {
    lines.push(
      "- Do NOT write the artifact file yourself. Instead, put the full Markdown content into the artifact field as a string. The runner will validate and save it to the target path."
    );
  }

  return lines.join("\n");
}

function normalizeBody(body) {
  if (body === undefined || body === null) {
    return "";
  }

  return String(body).trim();
}

function normalizeBlockBody(body) {
  if (body === undefined || body === null) {
    return "";
  }

  return String(body)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "");
}

function titleCase(value) {
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("-");
}

export function canReturnCrewArtifact(outputs, workspaceAccess) {
  if (workspaceAccess !== "read-only") {
    return false;
  }

  return outputs.some((output) => {
    return (
      output?.type === "artifact" &&
      typeof output.target === "string" &&
      output.target.startsWith(".crew/")
    );
  });
}
