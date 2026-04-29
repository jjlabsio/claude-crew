import { renderPrompt } from "./render.mjs";
import { pluginPath } from "./pluginRoot.mjs";

export function prepareDispatch({ role, requestFile, request, resolved }) {
  if (resolved.provider === "codex") {
    return {
      role,
      provider: "codex",
      action: "dispatch",
      command: [
        "node",
        pluginPath("scripts", "crew-agent-runner.mjs"),
        "dispatch",
        "--role",
        role,
        "--request-file",
        requestFile,
        "--json"
      ],
      resolved
    };
  }

  return {
    role,
    provider: "claude",
    action: "agent",
    subagent_type: role,
    model: resolved.model,
    prompt: renderPrompt({
      role,
      request,
      contract: resolved.contract
    }),
    resolved
  };
}
