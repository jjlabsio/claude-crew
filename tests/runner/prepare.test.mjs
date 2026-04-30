import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function requestFixture() {
  return {
    taskId: "task-123",
    inputs: [
      {
        path: ".crew/plans/task-123/spec.md",
        content: "# Spec\nPrepare runner dispatch."
      }
    ],
    instruction: "Return a plan.",
    successGate: "Prepared action is executable.",
    failureHandling: "Return failed AgentResult."
  };
}

async function writeRequest() {
  tmpDir = await mkTmpDir();
  const requestPath = join(tmpDir, "request.json");
  await writeFile(requestPath, JSON.stringify(requestFixture()), "utf8");
  return requestPath;
}

async function writeProjectConfig(config) {
  await mkdir(join(tmpDir, ".crew"), { recursive: true });
  await writeFile(join(tmpDir, ".crew", "config.json"), JSON.stringify(config), "utf8");
}

function runPrepare(args, options = {}) {
  return spawnSync(
    process.execPath,
    [join(REPO_ROOT, "scripts", "crew-agent-runner.mjs"), "prepare", ...args],
    { encoding: "utf8", ...options }
  );
}

describe("crew-agent-runner prepare CLI", () => {
  test("returns an agent action with rendered prompt for Claude provider roles", async () => {
    const requestPath = await writeRequest();
    await writeProjectConfig({
      providers: { "plan-evaluator": { provider: "claude", model: "sonnet" } }
    });

    const result = runPrepare([
      "--role",
      "plan-evaluator",
      "--request-file",
      requestPath,
      "--json"
    ], { cwd: tmpDir });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      role: "plan-evaluator",
      provider: "claude",
      action: "agent",
      subagent_type: "plan-evaluator",
      model: "sonnet"
    });
    expect(payload.prompt).toContain("# Plan-Evaluator\n");
    expect(payload.prompt).toContain("## AgentResult Contract\n");
  });

  test("returns a dispatch action for Codex provider roles", async () => {
    const requestPath = await writeRequest();
    await writeProjectConfig({
      providers: {
        dev: { provider: "codex", model: "gpt-5.5", reasoning: "medium" }
      }
    });

    const result = runPrepare([
      "--role",
      "dev",
      "--request-file",
      requestPath,
      "--json"
    ], { cwd: tmpDir });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      role: "dev",
      provider: "codex",
      action: "dispatch",
      command: [
        "node",
        join(REPO_ROOT, "scripts", "crew-agent-runner.mjs"),
        "dispatch",
        "--role",
        "dev",
        "--request-file",
        requestPath,
        "--json"
      ]
    });
  });

  test("prints the dispatch command in text mode", async () => {
    const requestPath = await writeRequest();
    await writeProjectConfig({
      providers: {
        dev: { provider: "codex", model: "gpt-5.5", reasoning: "medium" }
      }
    });

    const result = runPrepare(["--role", "dev", "--request-file", requestPath], { cwd: tmpDir });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `node ${join(REPO_ROOT, "scripts", "crew-agent-runner.mjs")} dispatch --role dev --request-file ${requestPath} --json\n`
    );
  });
});
