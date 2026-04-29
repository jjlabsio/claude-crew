import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { renderPrompt } from "../../scripts/lib/render.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function plannerContract() {
  return {
    role: "planner",
    inputs: {
      allowed: [
        ".crew/plans/{task-id}/spec.md",
        ".crew/plans/{task-id}/analysis.md",
        ".crew/plans/{task-id}/review-{n}.md"
      ],
      denied: [".crew/plans/{task-id}/brief.md"]
    },
    outputs: [
      {
        type: "artifact",
        target: ".crew/plans/{task-id}/plan.md"
      }
    ],
    capabilities: {
      workspaceAccess: "read-only"
    },
    policy: {
      maxAttempts: 5,
      fallbackProvider: null,
      escalateAfterAttempts: 5,
      consecutiveSameFailureLimit: 3
    },
    claudeSubagent: {
      name: "planner",
      model: "opus",
      description: "analysis.md 기반으로 구현 계획(plan.md)을 작성한다",
      tools: ["Read", "Write", "Agent"]
    }
  };
}

function plannerRequest(extra = {}) {
  return {
    taskId: "task-123",
    inputs: [
      {
        path: ".crew/plans/task-123/spec.md",
        content: "# Spec\nBuild the runner render command."
      },
      {
        path: ".crew/plans/task-123/analysis.md",
        content: "# Analysis\nKeep provider dispatch out of rendering."
      }
    ],
    instruction: "Create a concrete implementation plan from the provided spec and analysis.",
    successGate: "The plan is actionable and names the files to change.",
    ...extra
  };
}

describe("renderPrompt", () => {
  test("renders a planner prompt with capability, inputs, instructions and success gate", () => {
    const prompt = renderPrompt({
      role: "planner",
      request: plannerRequest(),
      contract: plannerContract()
    });

    expect(prompt).toMatchSnapshot();
    expect(prompt.endsWith("\n")).toBe(true);
    expect(prompt.endsWith("\n\n")).toBe(false);
  });

  test("ignores previousResult because followup rendering is separate", () => {
    const fresh = renderPrompt({
      role: "planner",
      request: plannerRequest(),
      contract: plannerContract()
    });
    const withPreviousResult = renderPrompt({
      role: "planner",
      request: plannerRequest({ previousResult: "old attempt output" }),
      contract: plannerContract()
    });

    expect(withPreviousResult).toBe(fresh);
    expect(withPreviousResult).not.toContain("old attempt output");
  });

  test("is byte-identical for identical input", () => {
    const input = {
      role: "planner",
      request: plannerRequest(),
      contract: plannerContract()
    };

    const first = renderPrompt(input);
    const second = renderPrompt(input);

    expect(second).toBe(first);
    expect(sha256(second)).toBe(sha256(first));
  });
});

describe("crew-agent-runner render CLI", () => {
  test("prints prompt for planner request", async () => {
    tmpDir = await mkTmpDir();
    const requestPath = join(tmpDir, "request.json");
    await writeFile(requestPath, JSON.stringify(plannerRequest()), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "scripts/crew-agent-runner.mjs",
        "render",
        "--role",
        "planner",
        "--request-file",
        requestPath
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("# Planner\n");
    expect(result.stdout).toContain("## Capability\n");
    expect(result.stdout).toContain("## Inputs\n");
    expect(result.stdout).toContain("## Instructions\n");
  });

  test("exits non-zero when request-file is missing", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/crew-agent-runner.mjs", "render", "--role", "planner"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Missing required --request-file <path>/);
  });

  test("exits non-zero when request JSON cannot be parsed", async () => {
    tmpDir = await mkTmpDir();
    const requestPath = join(tmpDir, "request.json");
    await writeFile(requestPath, "{", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "scripts/crew-agent-runner.mjs",
        "render",
        "--role",
        "planner",
        "--request-file",
        requestPath
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/JSON/);
  });
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
