import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

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

function runPrepare(args) {
  return spawnSync(
    process.execPath,
    ["scripts/crew-agent-runner.mjs", "prepare", ...args],
    { encoding: "utf8" }
  );
}

describe("crew-agent-runner prepare CLI", () => {
  test("returns an agent action with rendered prompt for Claude provider roles", async () => {
    const requestPath = await writeRequest();

    const result = runPrepare([
      "--role",
      "planner",
      "--request-file",
      requestPath,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      role: "planner",
      provider: "claude",
      action: "agent",
      subagent_type: "planner",
      model: "opus"
    });
    expect(payload.prompt).toContain("# Planner\n");
    expect(payload.prompt).toContain("## AgentResult Contract\n");
  });

  test("returns a dispatch action for Codex provider roles", async () => {
    const requestPath = await writeRequest();

    const result = runPrepare([
      "--role",
      "dev",
      "--request-file",
      requestPath,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      role: "dev",
      provider: "codex",
      action: "dispatch",
      command: [
        "node",
        join(process.cwd(), "scripts", "crew-agent-runner.mjs"),
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

    const result = runPrepare(["--role", "dev", "--request-file", requestPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `node ${join(process.cwd(), "scripts", "crew-agent-runner.mjs")} dispatch --role dev --request-file ${requestPath} --json\n`
    );
  });
});
