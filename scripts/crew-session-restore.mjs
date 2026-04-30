#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { getLatestCheckpoint, readRunState } from "../lib/crew-state.mjs";

async function readStdin(timeoutMs = 3000) {
  if (process.stdin.isTTY) return null;
  return new Promise((resolveInput) => {
    let data = "";
    const timer = setTimeout(() => resolveInput(data || null), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolveInput(data || null);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolveInput(null);
    });
  });
}

function emptyResponse() {
  return { continue: true };
}

function hookResponse(message) {
  return {
    continue: true,
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: message
    }
  };
}

function formatPath(cwd, path) {
  if (!path) return null;
  if (!path.startsWith("/")) return path;
  return relative(cwd, path) || ".";
}

function pendingText(state) {
  return state.pendingStatus || state.pending || "none";
}

function lastArtifact(state) {
  if (state.pendingAgentResultPath) return state.pendingAgentResultPath;
  if (Array.isArray(state.artifactPaths) && state.artifactPaths.length > 0) {
    return state.artifactPaths.at(-1);
  }
  return "none";
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function findActiveState(crewDir) {
  const current = await readRunState(crewDir);
  if (current?.active) {
    return { state: current, checkpointPath: await getLatestCheckpoint(crewDir) };
  }

  const checkpointPath = await getLatestCheckpoint(crewDir);
  if (!checkpointPath || !existsSync(checkpointPath)) return null;

  const checkpoint = await readJson(checkpointPath);
  if (!checkpoint?.active) return null;
  return { state: checkpoint, checkpointPath };
}

function buildMessage({ state, checkpointPath, cwd }) {
  const checkpointLine = checkpointPath
    ? formatPath(cwd, checkpointPath)
    : "none";

  return [
    "<crew-session-restore>",
    "Active crew workflow detected.",
    "",
    `Workflow: ${state.workflow || "unknown"}`,
    `Phase: ${state.phase || "unknown"}`,
    `Task: ${state.taskFile || state.taskId || "unknown"}`,
    `Pending: ${pendingText(state)}`,
    `Last artifact: ${lastArtifact(state)}`,
    `Checkpoint: ${checkpointLine}`,
    "",
    "Treat this as prior-session context. Prioritize the user's newest request. Resume the crew workflow only if the user asks to continue.",
    "</crew-session-restore>"
  ].join("\n");
}

async function main() {
  const raw = await readStdin();
  let event = {};
  if (raw) {
    try { event = JSON.parse(raw); } catch { /* ignore */ }
  }

  const cwd = resolve(event.cwd || process.cwd());
  const crewDir = resolve(cwd, ".crew");

  try {
    const active = await findActiveState(crewDir);
    if (!active) {
      console.log(JSON.stringify(emptyResponse()));
      return;
    }

    console.log(JSON.stringify(hookResponse(buildMessage({ ...active, cwd }))));
  } catch (error) {
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `CREW restore failed: ${error.message}`
      }
    }));
  }
}

main();
