import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { writeRunState } from "../../lib/crew-state.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STOP_HOOK_PATH = join(REPO_ROOT, "scripts", "crew-context-guard-stop.mjs");
const RESTORE_HOOK_PATH = join(REPO_ROOT, "scripts", "crew-session-restore.mjs");
const PRE_COMPACT_HOOK_PATH = join(REPO_ROOT, "scripts", "crew-pre-compact.mjs");

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function runScript(path, event, options = {}) {
  return spawnSync(process.execPath, [path], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    input: `${JSON.stringify(event)}\n`,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: REPO_ROOT
    }
  });
}

describe("crew context checkpoint hooks", () => {
  test("Stop context guard blocks when estimated context usage is above threshold", () => {
    const result = runScript(STOP_HOOK_PATH, {
      session_id: `guard-block-${Date.now()}`,
      usage: {
        input_tokens: 80_000,
        context_window: 100_000
      }
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      continue: true,
      decision: "block"
    });
    expect(payload.systemMessage).toContain("/compact");
  });

  test("Stop context guard bypasses context limit stop reasons", () => {
    const result = runScript(STOP_HOOK_PATH, {
      session_id: `guard-bypass-${Date.now()}`,
      stop_reason: "context_limit",
      usage: {
        input_tokens: 80_000,
        context_window: 100_000
      }
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
  });

  test("SessionStart restore returns active run context", async () => {
    tmpDir = await mkTmpDir();
    const crewDir = join(tmpDir, ".crew");
    await writeRunState(crewDir, {
      active: true,
      workflow: "crew-dev",
      phase: "qa",
      taskFile: ".crew/tasks/TASK-123.md",
      pendingStatus: "qa verification",
      artifactPaths: [".crew/artifacts/dev-result.json"]
    });

    const result = runScript(RESTORE_HOOK_PATH, { cwd: tmpDir }, { cwd: tmpDir });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload.systemMessage).toContain("<crew-session-restore>");
    expect(payload.systemMessage).toContain("Workflow: crew-dev");
    expect(payload.systemMessage).toContain("Phase: qa");
    expect(payload.systemMessage).toContain("Last artifact: .crew/artifacts/dev-result.json");
  });

  test("PreCompact creates checkpoint and returns checkpoint summary", async () => {
    tmpDir = await mkTmpDir();
    const crewDir = join(tmpDir, ".crew");
    await mkdir(join(tmpDir, ".crew", "artifacts"), { recursive: true });
    await writeFile(join(tmpDir, ".crew", "artifacts", "dev-result.json"), "{}\n", "utf8");
    await writeRunState(crewDir, {
      active: true,
      workflow: "crew-dev",
      phase: "qa",
      taskFile: ".crew/tasks/TASK-123.md",
      activeRole: "qa",
      pendingStatus: "qa verification",
      artifactPaths: [".crew/artifacts/dev-result.json"],
      agentHandles: { dev: "thread-or-agent-id" }
    });

    const result = runScript(PRE_COMPACT_HOOK_PATH, { cwd: tmpDir }, { cwd: tmpDir });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload.systemMessage).toContain("# Crew PreCompact Checkpoint");
    expect(payload.systemMessage).toContain("Pending: qa verification");
    expect(payload.systemMessage).toContain("- dev: thread-or-agent-id");
  });
});
