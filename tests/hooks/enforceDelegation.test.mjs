import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK_PATH = join(REPO_ROOT, "hooks", "enforce-delegation.mjs");

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function runHook(event, options = {}) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    input: `${JSON.stringify(event)}\n`,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: REPO_ROOT
    }
  });
}

async function writeProjectProviderConfig(root, providers) {
  await mkdir(join(root, ".crew"), { recursive: true });
  await writeFile(
    join(root, ".crew", "config.json"),
    `${JSON.stringify({ providers }, null, 2)}\n`,
    "utf8"
  );
}

describe("enforce-delegation hook", () => {
  test("blocks direct Agent calls for Codex provider roles before execution", async () => {
    tmpDir = await mkTmpDir();
    await writeProjectProviderConfig(tmpDir, {
      techlead: { provider: "codex", model: "gpt-5.5", reasoning: "medium" }
    });

    const result = runHook(
      {
        tool_name: "Agent",
        tool_input: { subagent_type: "techlead", prompt: "analyze" }
      },
      { cwd: tmpDir }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      continue: true,
      decision: "block"
    });
    expect(payload.reason).toContain(
      "Role 'techlead' is configured for Codex provider"
    );
    expect(payload.reason).toContain("crew-agent-runner.mjs\" prepare");
  });

  test("allows Claude provider roles and injects the resolved model", async () => {
    tmpDir = await mkTmpDir();
    await writeProjectProviderConfig(tmpDir, {
      planner: { provider: "claude", model: "sonnet" }
    });

    const result = runHook(
      {
        tool_name: "Agent",
        tool_input: { subagent_type: "planner", prompt: "plan" }
      },
      { cwd: tmpDir }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      continue: true,
      modifiedInput: {
        subagent_type: "planner",
        prompt: "plan",
        model: "sonnet"
      }
    });
  });

  test("passes through non-Agent tools", () => {
    const result = runHook({
      tool_name: "Read",
      tool_input: { file_path: "README.md" }
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
  });
});
