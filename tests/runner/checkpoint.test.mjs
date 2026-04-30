import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";
import { checkpoint } from "../../scripts/lib/checkpoint.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function initGitRepo(dir) {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
}

function gitLog(dir) {
  return execFileSync("git", ["log", "--oneline", "--no-decorate"], {
    cwd: dir,
    encoding: "utf8"
  }).trim();
}

describe("checkpoint", () => {
  test("commits all changes and returns hash", async () => {
    tmpDir = await mkTmpDir();
    initGitRepo(tmpDir);

    await writeFile(join(tmpDir, "file.txt"), "hello", "utf8");

    const result = await checkpoint({ message: "test: initial", cwd: tmpDir });

    expect(result.committed).toBe(true);
    expect(result.hash).toMatch(/^[0-9a-f]+$/);
    expect(result.message).toBe("test: initial");

    const log = gitLog(tmpDir);
    expect(log).toContain("test: initial");
  });

  test("returns committed:false when nothing to commit", async () => {
    tmpDir = await mkTmpDir();
    initGitRepo(tmpDir);

    await writeFile(join(tmpDir, "file.txt"), "hello", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "seed"], { cwd: tmpDir, stdio: "ignore" });

    const result = await checkpoint({ message: "test: empty", cwd: tmpDir });

    expect(result.committed).toBe(false);
    expect(result.hash).toBeNull();
  });

  test("commits untracked .crew/ artifacts", async () => {
    tmpDir = await mkTmpDir();
    initGitRepo(tmpDir);

    await writeFile(join(tmpDir, "seed.txt"), "seed", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "seed"], { cwd: tmpDir, stdio: "ignore" });

    const crewDir = join(tmpDir, ".crew", "runs", "direct-001");
    execFileSync("mkdir", ["-p", crewDir]);
    await writeFile(join(crewDir, "request.md"), "# Request", "utf8");
    await writeFile(join(crewDir, "result.md"), "# Result", "utf8");

    const result = await checkpoint({ message: "chore(crew): artifacts", cwd: tmpDir });

    expect(result.committed).toBe(true);

    const log = gitLog(tmpDir);
    expect(log).toContain("chore(crew): artifacts");
  });
});

describe("checkpoint CLI", () => {
  test("commits via CLI and outputs JSON", async () => {
    tmpDir = await mkTmpDir();
    initGitRepo(tmpDir);

    await writeFile(join(tmpDir, "file.txt"), "hello", "utf8");

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts/crew-agent-runner.mjs"), "checkpoint", "--message", "test: cli", "--json"],
      { cwd: tmpDir, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload.committed).toBe(true);
    expect(payload.hash).toMatch(/^[0-9a-f]+$/);
  });

  test("exits 0 with nothing-to-commit message when clean", async () => {
    tmpDir = await mkTmpDir();
    initGitRepo(tmpDir);

    await writeFile(join(tmpDir, "file.txt"), "hello", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "seed"], { cwd: tmpDir, stdio: "ignore" });

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts/crew-agent-runner.mjs"), "checkpoint", "--message", "test: noop", "--json"],
      { cwd: tmpDir, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.committed).toBe(false);
  });

  test("exits 1 when --message is missing", () => {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts/crew-agent-runner.mjs"), "checkpoint"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required --message");
  });
});
