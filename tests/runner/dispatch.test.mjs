import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";
import {
  dispatch,
  resolveAutoGitDiffInputs
} from "../../scripts/lib/dispatch.mjs";

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
        path: ".crew/plans/task-123/plan.md",
        content: "# Plan\nImplement US-6 only."
      },
      {
        path: ".crew/plans/task-123/contract.md",
        content: "# Contract\nReturn AgentResult JSON."
      }
    ],
    instruction: "Implement the dispatch command.",
    successGate: "Dispatch returns a normalized AgentResult."
  };
}

async function writeRequest(request = requestFixture()) {
  tmpDir = await mkTmpDir();
  const requestPath = join(tmpDir, "request.json");
  await writeFile(requestPath, JSON.stringify(request), "utf8");
  return requestPath;
}

function runDispatch(args, env = {}, options = {}) {
  return spawnSync(
    process.execPath,
    [join(REPO_ROOT, "scripts", "crew-agent-runner.mjs"), "dispatch", ...args],
    {
      cwd: options.cwd ?? process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CREW_COMPANION_NODE_BIN: resolve(REPO_ROOT, "tests/_helpers/fakeCompanion.mjs"),
        ...env
      },
      ...options
    }
  );
}

async function readLog(path) {
  const content = await readFile(path, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("crew-agent-runner dispatch CLI", () => {
  test("replaces exact AUTO_GIT_DIFF input content without mutating other inputs", async () => {
    const request = {
      ...requestFixture(),
      inputs: [
        { path: ".crew/plans/task-123/diff.md", content: "AUTO_GIT_DIFF" },
        { path: ".crew/plans/task-123/notes.md", content: "AUTO_GIT_DIFF plus notes" }
      ]
    };

    const resolved = await resolveAutoGitDiffInputs(request, {
      diff: "diff --git a/file.txt b/file.txt"
    });

    expect(resolved).not.toBe(request);
    expect(resolved.inputs[0].content).toBe("diff --git a/file.txt b/file.txt");
    expect(resolved.inputs[1].content).toBe("AUTO_GIT_DIFF plus notes");
    expect(request.inputs[0].content).toBe("AUTO_GIT_DIFF");
  });

  test("runs companion with a prompt file and returns AgentResult with agent_handle", async () => {
    const requestPath = await writeRequest();
    const logPath = join(tmpDir, "fake-companion.log");

    const result = runDispatch(
      ["--role", "dev", "--request-file", requestPath, "--json", "--no-checkpoint"],
      { FAKE_COMPANION_RESPONSE: "complete", FAKE_COMPANION_LOG: logPath }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      status: "complete",
      artifact: { path: ".crew/plans/task-123/dev-log.md" },
      questions: [],
      requests: [],
      summary: "Fake companion completed",
      error: null,
      agent_handle: "thread-complete-123"
    });

    const [call] = await readLog(logPath);
    expect(call.args).toEqual(
      expect.arrayContaining(["task", "--json", "--expect-crew-result", "--prompt-file"])
    );
    expect(call.args).toContain("--write");
    expect(call.prompt).toContain("# Dev\n");
    expect(call.prompt).toContain("Implement the dispatch command.");
  });

  test("expands AUTO_GIT_DIFF before rendering the Codex dispatch prompt", async () => {
    const requestPath = await writeRequest({
      ...requestFixture(),
      inputs: [
        {
          path: ".crew/plans/task-123/diff.md",
          content: "AUTO_GIT_DIFF"
        }
      ]
    });
    const logPath = join(tmpDir, "fake-companion.log");

    const result = runDispatch(
      ["--role", "dev", "--request-file", requestPath, "--json", "--no-checkpoint"],
      { FAKE_COMPANION_RESPONSE: "complete", FAKE_COMPANION_LOG: logPath }
    );

    expect(result.status).toBe(0);

    const [call] = await readLog(logPath);
    expect(call.prompt).toContain("### .crew/plans/task-123/diff.md");
    expect(call.prompt).toContain("# git diff");
  });

  test("rejects claude provider roles with a dispatch-specific usage error", async () => {
    const requestPath = await writeRequest();
    await mkdir(join(tmpDir, ".crew"), { recursive: true });
    await writeFile(
      join(tmpDir, ".crew", "config.json"),
      JSON.stringify({
        providers: { qa: { provider: "claude", model: "sonnet" } }
      }),
      "utf8"
    );

    const result = runDispatch(
      ["--role", "qa", "--request-file", requestPath, "--json"],
      { FAKE_COMPANION_RESPONSE: "complete" },
      { cwd: tmpDir }
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "dispatch is for Codex provider only. Resolved provider for role 'qa' is 'claude'. Use 'render' + Agent tool for Claude provider (see crew-agent-runner SKILL.md)."
    );
  });

  test("adds --write for workspace-write roles and preserves failed AgentResult on stdout", async () => {
    const requestPath = await writeRequest();
    const logPath = join(tmpDir, "fake-companion.log");

    const result = runDispatch(
      ["--role", "dev", "--request-file", requestPath, "--json"],
      { FAKE_COMPANION_RESPONSE: "failed", FAKE_COMPANION_LOG: logPath }
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "failed",
      summary: "Fake companion failed",
      error: "boom",
      agent_handle: "thread-failed-123"
    });
    expect(result.stderr).toMatch(/Companion returned failed AgentResult/);

    const [call] = await readLog(logPath);
    expect(call.args).toContain("--write");
  });

  test("adds --write from resolved codex_sandbox without using contract workspaceAccess", async () => {
    tmpDir = await mkTmpDir();
    const logPath = join(tmpDir, "fake-companion.log");
    const previousLogPath = process.env.FAKE_COMPANION_LOG;
    const previousResponse = process.env.FAKE_COMPANION_RESPONSE;

    process.env.FAKE_COMPANION_LOG = logPath;
    process.env.FAKE_COMPANION_RESPONSE = "complete";
    try {
      await dispatch({
        role: "dev",
        request: requestFixture(),
        resolved: {
          provider: "codex",
          codex_sandbox: "workspace-write",
          dispatch: { write: true, path: "codex" }
        },
        contract: {
          role: "dev",
          capabilities: { workspaceAccess: "read-only" }
        },
        companionBin: resolve("tests/_helpers/fakeCompanion.mjs"),
        noCheckpoint: true
      });
    } finally {
      if (previousLogPath === undefined) {
        delete process.env.FAKE_COMPANION_LOG;
      } else {
        process.env.FAKE_COMPANION_LOG = previousLogPath;
      }
      if (previousResponse === undefined) {
        delete process.env.FAKE_COMPANION_RESPONSE;
      } else {
        process.env.FAKE_COMPANION_RESPONSE = previousResponse;
      }
    }

    const [call] = await readLog(logPath);
    expect(call.args).toContain("--write");
  });

  test("does not add --write when dispatch.write conflicts with read-only codex_sandbox", async () => {
    tmpDir = await mkTmpDir();
    const logPath = join(tmpDir, "fake-companion.log");
    const previousLogPath = process.env.FAKE_COMPANION_LOG;
    const previousResponse = process.env.FAKE_COMPANION_RESPONSE;

    process.env.FAKE_COMPANION_LOG = logPath;
    process.env.FAKE_COMPANION_RESPONSE = "complete";
    try {
      await dispatch({
        role: "dev",
        request: requestFixture(),
        resolved: {
          provider: "codex",
          codex_sandbox: "read-only",
          dispatch: { write: true, path: "codex" }
        },
        contract: {
          role: "dev",
          capabilities: { workspaceAccess: "workspace-write" }
        },
        companionBin: resolve("tests/_helpers/fakeCompanion.mjs"),
        noCheckpoint: true
      });
    } finally {
      if (previousLogPath === undefined) {
        delete process.env.FAKE_COMPANION_LOG;
      } else {
        process.env.FAKE_COMPANION_LOG = previousLogPath;
      }
      if (previousResponse === undefined) {
        delete process.env.FAKE_COMPANION_RESPONSE;
      } else {
        process.env.FAKE_COMPANION_RESPONSE = previousResponse;
      }
    }

    const [call] = await readLog(logPath);
    expect(call.args).not.toContain("--write");
  });

  test("lib dispatch rejects non-codex providers before invoking companion", async () => {
    await expect(
      dispatch({
        role: "planner",
        request: requestFixture(),
        resolved: {
          provider: "claude",
          codex_sandbox: "read-only",
          dispatch: { write: false, path: "claude" }
        },
        contract: {
          role: "planner",
          capabilities: { workspaceAccess: "read-only" }
        },
        companionBin: resolve("tests/_helpers/fakeCompanion.mjs")
      })
    ).rejects.toThrow(
      "dispatch is for Codex provider only. Resolved provider for role 'planner' is 'claude'. Use 'render' + Agent tool for Claude provider (see crew-agent-runner SKILL.md)."
    );
  });

  test("uses --resume-last only when resume candidate matches requested handle", async () => {
    const requestPath = await writeRequest();
    const logPath = join(tmpDir, "fake-companion.log");

    const result = runDispatch(
      [
        "--role",
        "dev",
        "--request-file",
        requestPath,
        "--resume-handle",
        "thread-resume-123",
        "--json",
        "--no-checkpoint"
      ],
      { FAKE_COMPANION_RESPONSE: "resumeCandidate", FAKE_COMPANION_LOG: logPath }
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).agent_handle).toBe("thread-resume-123");

    const calls = await readLog(logPath);
    expect(calls.map((call) => call.command)).toEqual(["task-resume-candidate", "task"]);
    expect(calls[1].args).toContain("--resume-last");
  });

  test("rejects a resume handle that is not the companion candidate", async () => {
    const requestPath = await writeRequest();

    const result = runDispatch(
      [
        "--role",
        "dev",
        "--request-file",
        requestPath,
        "--resume-handle",
        "thread-other",
        "--json"
      ],
      { FAKE_COMPANION_RESPONSE: "resumeCandidate" }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Resume handle thread-other does not match candidate thread-resume-123/);
  });

  test("exits non-zero with a diagnostic for crewAgentResultError", async () => {
    const requestPath = await writeRequest();

    const result = runDispatch(
      ["--role", "dev", "--request-file", requestPath, "--json"],
      { FAKE_COMPANION_RESPONSE: "crewAgentResultError" }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Companion returned crewAgentResultError/);
    expect(result.stderr).toMatch(/Missing <crew-agent-result> block/);
  });
});
