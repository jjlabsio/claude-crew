import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { persistCrewArtifact, ArtifactPersistError } from "./artifacts.mjs";
import { checkpoint } from "./checkpoint.mjs";
import { renderPrompt } from "./render.mjs";

const DEFAULT_COMPANION = fileURLToPath(
  new URL("../crew-codex-companion.mjs", import.meta.url)
);
const execFileAsync = promisify(execFile);
const AUTO_GIT_DIFF = "AUTO_GIT_DIFF";
const AGENT_RESULT_STATUSES = new Set([
  "complete",
  "blocked_on_user",
  "needs_agent",
  "needs_tool",
  "failed"
]);

export class DispatchError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DispatchError";
    this.agentResult = options.agentResult ?? null;
    this.companionPayload = options.companionPayload ?? null;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function formatDispatchProviderGuardMessage(role, provider) {
  return `dispatch is for Codex provider only. Resolved provider for role '${role}' is '${provider}'. Use 'render' + Agent tool for Claude provider (see crew-agent-runner SKILL.md).`;
}

export async function resolveAutoGitDiffInputs(request, options = {}) {
  if (!hasAutoGitDiffInput(request)) {
    return request;
  }

  const diff =
    options.diff ??
    (await generateAutoGitDiff({ cwd: options.cwd ?? process.cwd() }));

  return {
    ...request,
    inputs: request.inputs.map((item) => {
      if (item?.content !== AUTO_GIT_DIFF) {
        return item;
      }

      return {
        ...item,
        content: diff
      };
    })
  };
}

export function hasAutoGitDiffInput(request) {
  return Array.isArray(request?.inputs)
    ? request.inputs.some((item) => item?.content === AUTO_GIT_DIFF)
    : false;
}

export async function generateAutoGitDiff({ cwd = process.cwd() } = {}) {
  await git(["rev-parse", "--is-inside-work-tree"], cwd);

  const [staged, unstaged] = await Promise.all([
    git(["diff", "--no-ext-diff", "--staged"], cwd),
    git(["diff", "--no-ext-diff"], cwd)
  ]);

  const sections = [
    ["staged", staged],
    ["unstaged", unstaged]
  ]
    .filter(([, content]) => content.trim().length > 0)
    .map(([label, content]) => `# git diff (${label})\n${content.trimEnd()}`);

  if (sections.length > 0) {
    return sections.join("\n\n");
  }

  try {
    const previousCommitDiff = await git(
      ["diff", "--no-ext-diff", "HEAD~1"],
      cwd
    );
    if (previousCommitDiff.trim().length > 0) {
      return `# git diff (HEAD~1)\n${previousCommitDiff.trimEnd()}`;
    }
  } catch {
    // Repositories with fewer than two commits have no HEAD~1 fallback.
  }

  return "# git diff\nNo git diff available.";
}

export async function dispatch(input) {
  if (input.resolved?.provider !== "codex") {
    throw new DispatchError(
      formatDispatchProviderGuardMessage(
        input.role,
        input.resolved?.provider ?? "unknown"
      ),
      { exitCode: 2 }
    );
  }

  const companion = resolveCompanion(input);
  await assertResumeCandidate(input.resumeHandle, companion);
  const request = await resolveAutoGitDiffInputs(input.request);

  const tmpDir = await mkdtemp(join(tmpdir(), "claude-crew-dispatch-"));
  const promptFile = join(tmpDir, `${input.role}-prompt.md`);

  try {
    await writeFile(
      promptFile,
      renderPrompt({
        role: input.role,
        request,
        contract: input.contract
      }),
      "utf8"
    );

    const args = buildTaskArgs(input, promptFile);
    const execution = await runCompanion(companion, args);
    const payload = parseCompanionJson(execution.stdout, "task");

    if (payload.crewAgentResultError) {
      throw new DispatchError(
        `Companion returned crewAgentResultError: ${payload.crewAgentResultError}`,
        { companionPayload: payload }
      );
    }

    const agentResult = normalizeAgentResult(payload.crewAgentResult, payload.threadId);
    if (!agentResult) {
      throw new DispatchError("Companion did not return crewAgentResult.", {
        companionPayload: payload
      });
    }

    if (execution.status !== 0 && agentResult.status !== "failed") {
      throw new DispatchError(`Companion exited with status ${execution.status}.`, {
        agentResult,
        companionPayload: payload
      });
    }

    const artifactPath = await persistArtifactSafe(input, agentResult);
    const result = artifactPath ? { ...agentResult, artifact_path: artifactPath } : agentResult;

    if (!input.noCheckpoint && agentResult.status === "complete") {
      const taskId = input.request?.taskId ?? input.request?.["task-id"] ?? input.request?.task_id ?? null;
      const label = [input.role, taskId].filter(Boolean).join(" ");
      const ckpt = await checkpointSafe(
        `chore(crew): ${label} checkpoint`
      );
      if (ckpt) {
        return { ...result, checkpoint: ckpt };
      }
    }

    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function runCompanion(companion, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(companion.command, [...companion.prefixArgs, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({
        status: status ?? 1,
        signal,
        stdout,
        stderr
      });
    });
  });
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  return stdout;
}

async function assertResumeCandidate(resumeHandle, companion) {
  if (!resumeHandle) {
    return;
  }

  const execution = await runCompanion(companion, [
    "task-resume-candidate",
    "--json"
  ]);
  const payload = parseCompanionJson(execution.stdout, "task-resume-candidate");
  const candidateThreadId = payload?.candidate?.threadId ?? null;

  if (execution.status !== 0) {
    throw new DispatchError(
      `Companion resume candidate lookup failed with status ${execution.status}.`,
      { companionPayload: payload }
    );
  }

  if (!candidateThreadId) {
    throw new DispatchError(`No resume candidate found for ${resumeHandle}.`, {
      companionPayload: payload
    });
  }

  if (candidateThreadId !== resumeHandle) {
    throw new DispatchError(
      `Resume handle ${resumeHandle} does not match candidate ${candidateThreadId}.`,
      { companionPayload: payload }
    );
  }
}

function buildTaskArgs(input, promptFile) {
  const args = [
    "task",
    "--json",
    "--expect-crew-result",
    "--prompt-file",
    promptFile
  ];

  if (input.resumeHandle) {
    args.push("--resume-last");
  }

  if (input.resolved?.codex_sandbox === "workspace-write") {
    args.push("--write");
  }

  if (input.resolved?.codex_network_access) {
    args.push("--network-access");
  }

  if (input.resolved?.model) {
    args.push("--model", input.resolved.model);
  }

  if (input.resolved?.reasoning) {
    args.push("--effort", input.resolved.reasoning);
  }

  return args;
}

function normalizeAgentResult(value, threadId) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (!AGENT_RESULT_STATUSES.has(value.status)) {
    return null;
  }

  return {
    ...value,
    questions: Array.isArray(value.questions) ? value.questions : [],
    requests: Array.isArray(value.requests) ? value.requests : [],
    error: value.error ?? null,
    agent_handle: threadId ?? value.agent_handle ?? null
  };
}

function parseCompanionJson(stdout, command) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new DispatchError(
      `Companion ${command} did not return JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function resolveCompanion(input = {}) {
  const nodeScript =
    input.companionBin ?? process.env.CREW_COMPANION_NODE_BIN ?? null;
  if (nodeScript) {
    return {
      command: process.execPath,
      prefixArgs: [nodeScript]
    };
  }

  const binary = process.env.CREW_COMPANION_BIN ?? DEFAULT_COMPANION;
  if (isNodeScript(binary)) {
    return {
      command: process.execPath,
      prefixArgs: [binary]
    };
  }

  return {
    command: binary,
    prefixArgs: []
  };
}

async function persistArtifactSafe(input, agentResult) {
  try {
    return await persistCrewArtifact({
      workspaceRoot: process.cwd(),
      contract: input.contract,
      request: input.request,
      agentResult
    });
  } catch (error) {
    if (error instanceof ArtifactPersistError) {
      throw new DispatchError(`Artifact persist failed: ${error.message}`, {
        agentResult
      });
    }
    throw error;
  }
}

async function checkpointSafe(message) {
  try {
    return await checkpoint({ message });
  } catch {
    return null;
  }
}

function isNodeScript(value) {
  const name = basename(String(value));
  return name.endsWith(".mjs") || name.endsWith(".js");
}
