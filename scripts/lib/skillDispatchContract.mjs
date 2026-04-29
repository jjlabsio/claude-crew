import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const RUNNER_DISPATCH_MARKER =
  "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.";

export const COMMON_AGENT_INTERFACE_HEADING =
  "## 공통 에이전트 실행 인터페이스";

export const REQUIRED_INTERFACE_MARKERS = [
  COMMON_AGENT_INTERFACE_HEADING,
  'node "$CLAUDE_PLUGIN_ROOT/scripts/crew-agent-runner.mjs" prepare --role <role> --request-file <request-file> --json',
  "request-file",
  "action == dispatch",
  "action == agent",
  "직접 하위 에이전트를 호출하지 않는다",
  "AgentResult"
];

const FORBIDDEN_DIRECT_DISPATCH_PATTERNS = [
  /Agent\(/,
  /Bash\(/,
  new RegExp(["crew", "codex", "companion"].join("-")),
  /runAgent\(/,
  new RegExp(["AskUser", "Question"].join("")),
  new RegExp(`<${["crew", "agent", "result"].join("-")}>`)
];

export async function validateWorkflowSkillDispatchContracts({
  root = process.cwd()
} = {}) {
  const skillsDir = join(root, "skills");
  const errors = [];
  let entries = [];

  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return errors;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const relPath = `skills/${entry.name}/SKILL.md`;
    const text = await readUtf8OrNull(join(root, relPath));
    if (!text || entry.name === "crew-agent-runner") {
      continue;
    }

    if (!text.includes(RUNNER_DISPATCH_MARKER)) {
      continue;
    }

    errors.push(...validateWorkflowSkillDispatchContract(text, relPath));
  }

  return errors;
}

export function validateWorkflowSkillDispatchContract(text, relPath = "SKILL.md") {
  const errors = [];

  for (const pattern of FORBIDDEN_DIRECT_DISPATCH_PATTERNS) {
    if (pattern.test(text)) {
      errors.push(`${relPath}: direct agent dispatch is forbidden: ${pattern}`);
    }
  }

  for (const marker of REQUIRED_INTERFACE_MARKERS) {
    if (!text.includes(marker)) {
      errors.push(`${relPath}: missing runner dispatch interface marker: ${marker}`);
    }
  }

  return errors;
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
