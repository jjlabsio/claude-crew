#!/usr/bin/env node

import { relative, resolve } from "node:path";

import { createCheckpoint, readRunState } from "../lib/crew-state.mjs";

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
      hookEventName: "PreCompact",
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

function buildMessage({ state, checkpointPath, cwd }) {
  const artifacts = Array.isArray(state.artifactPaths) ? state.artifactPaths : [];
  const handles = state.agentHandles && typeof state.agentHandles === "object"
    ? Object.entries(state.agentHandles)
    : [];

  return [
    "# Crew PreCompact Checkpoint",
    "",
    `Workflow: ${state.workflow || "unknown"}`,
    `Phase: ${state.phase || "unknown"}`,
    `Task: ${state.taskFile || state.taskId || "unknown"}`,
    `Active role: ${state.activeRole || "unknown"}`,
    `Pending: ${pendingText(state)}`,
    `Checkpoint: ${formatPath(cwd, checkpointPath)}`,
    "Artifacts:",
    ...(artifacts.length > 0 ? artifacts.map((path) => `- ${path}`) : ["- none"]),
    "Resume handles:",
    ...(handles.length > 0 ? handles.map(([role, handle]) => `- ${role}: ${handle}`) : ["- none"]),
    "",
    "After compaction, inspect the checkpoint and continue from the pending phase unless the user's newest request overrides it."
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
    const state = await readRunState(crewDir);
    if (!state) {
      console.log(JSON.stringify(emptyResponse()));
      return;
    }

    const checkpointPath = await createCheckpoint(crewDir);
    console.log(JSON.stringify(hookResponse(buildMessage({ state, checkpointPath, cwd }))));
  } catch (error) {
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreCompact",
        additionalContext: `CREW checkpoint failed: ${error.message}`
      }
    }));
  }
}

main();
