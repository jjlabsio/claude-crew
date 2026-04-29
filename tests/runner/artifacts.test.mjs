import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";
import {
  persistCrewArtifact,
  ArtifactPersistError
} from "../../scripts/lib/artifacts.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function readOnlyContract(target = ".crew/plans/{task-id}/analysis.md") {
  return {
    role: "techlead",
    outputs: [{ type: "artifact", target }],
    capabilities: { workspaceAccess: "read-only" }
  };
}

function writeContract() {
  return {
    role: "dev",
    outputs: [
      { type: "artifact", target: ".crew/plans/{task-id}/dev-log.md" },
      { type: "code", target: "<workspace files>" }
    ],
    capabilities: { workspaceAccess: "workspace-write" }
  };
}

function completeResult(artifact = "# Analysis\nContent here.") {
  return {
    status: "complete",
    artifact,
    questions: [],
    requests: [],
    summary: "done",
    error: null
  };
}

describe("persistCrewArtifact", () => {
  test("saves artifact for read-only role with .crew/ target and complete status", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract(),
      request: { taskId: "task-42" },
      agentResult: completeResult()
    });

    expect(result).toBe(join(tmpDir, ".crew/plans/task-42/analysis.md"));
    const content = await readFile(result, "utf8");
    expect(content).toBe("# Analysis\nContent here.");
  });

  test("replaces {task-id} in target path", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract(".crew/plans/{task-id}/review.md"),
      request: { taskId: "plan-evaluator-99" },
      agentResult: completeResult("# Review\nPASS")
    });

    expect(result).toBe(join(tmpDir, ".crew/plans/plan-evaluator-99/review.md"));
    const content = await readFile(result, "utf8");
    expect(content).toBe("# Review\nPASS");
  });

  test("returns null for workspace-write role (no-op)", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: writeContract(),
      request: { taskId: "task-42" },
      agentResult: completeResult()
    });

    expect(result).toBeNull();
  });

  test("returns null for dev role even with artifact string", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: writeContract(),
      request: { taskId: "task-42" },
      agentResult: completeResult("# Dev log content")
    });

    expect(result).toBeNull();
  });

  test("returns null when status is not complete", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract(),
      request: { taskId: "task-42" },
      agentResult: { ...completeResult(), status: "failed" }
    });

    expect(result).toBeNull();
  });

  test("returns null when artifact is null", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract(),
      request: { taskId: "task-42" },
      agentResult: completeResult(null)
    });

    expect(result).toBeNull();
  });

  test("returns null when artifact is empty string", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract(),
      request: { taskId: "task-42" },
      agentResult: completeResult("")
    });

    expect(result).toBeNull();
  });

  test("returns null when no .crew/ artifact output exists", async () => {
    tmpDir = await mkTmpDir();

    const contract = {
      role: "explorer",
      outputs: [{ type: "report", target: "stdout" }],
      capabilities: { workspaceAccess: "read-only" }
    };

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract,
      request: { taskId: "task-42" },
      agentResult: completeResult()
    });

    expect(result).toBeNull();
  });

  test("rejects path traversal via ../", async () => {
    tmpDir = await mkTmpDir();

    await expect(
      persistCrewArtifact({
        workspaceRoot: tmpDir,
        contract: readOnlyContract(".crew/../../../etc/passwd"),
        request: { taskId: "task-42" },
        agentResult: completeResult("malicious")
      })
    ).rejects.toThrow(ArtifactPersistError);
  });

  test("absolute path target is rejected by .crew/ prefix check (returns null)", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract("/etc/passwd"),
      request: {},
      agentResult: completeResult("malicious")
    });

    expect(result).toBeNull();
  });

  test("rejects target that resolves outside .crew/", async () => {
    tmpDir = await mkTmpDir();

    await expect(
      persistCrewArtifact({
        workspaceRoot: tmpDir,
        contract: readOnlyContract(".crew/plans/../../outside.md"),
        request: { taskId: "task-42" },
        agentResult: completeResult("malicious")
      })
    ).rejects.toThrow(ArtifactPersistError);
  });

  test("rejects when workspaceRoot is missing", async () => {
    await expect(
      persistCrewArtifact({
        workspaceRoot: "",
        contract: readOnlyContract(),
        request: { taskId: "task-42" },
        agentResult: completeResult()
      })
    ).rejects.toThrow(ArtifactPersistError);
  });

  test("handles artifact with non-string type as no-op", async () => {
    tmpDir = await mkTmpDir();

    const result = await persistCrewArtifact({
      workspaceRoot: tmpDir,
      contract: readOnlyContract(),
      request: { taskId: "task-42" },
      agentResult: completeResult({ path: ".crew/plans/task-42/analysis.md" })
    });

    expect(result).toBeNull();
  });
});
