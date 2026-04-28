import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderPrompt } from "./render.mjs";

const DEFAULT_COMPANION = fileURLToPath(
  new URL("../crew-codex-companion.mjs", import.meta.url)
);
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

export async function dispatch(input) {
  const companion = resolveCompanion(input);
  await assertResumeCandidate(input.resumeHandle, companion);

  const tmpDir = await mkdtemp(join(tmpdir(), "claude-crew-dispatch-"));
  const promptFile = join(tmpDir, `${input.role}-prompt.md`);

  try {
    await writeFile(
      promptFile,
      renderPrompt({
        role: input.role,
        request: input.request,
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

    return agentResult;
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

function isNodeScript(value) {
  const name = basename(String(value));
  return name.endsWith(".mjs") || name.endsWith(".js");
}
