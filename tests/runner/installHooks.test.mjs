import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";

import { afterEach, describe, expect, test } from "vitest";

import { build } from "../../scripts/lib/build.mjs";
import {
  installHooks,
  MANAGED_BLOCK,
  upsertManagedBlock
} from "../../scripts/lib/installHooks.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

describe("installHooks", () => {
  test("creates a missing pre-commit hook with managed validate block and executable mode", async () => {
    tmpDir = await mkTmpDir();
    await setupPluginSourceRoot(tmpDir);
    await mkdir(join(tmpDir, ".git"), { recursive: true });

    await installHooks({ root: tmpDir });

    const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
    const content = await readFile(hookPath, "utf8");
    expect(content.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(content).toContain("# >>> crew-agent-runner managed >>>");
    expect(content).toContain("node scripts/crew-agent-runner.mjs validate");
    expect(content).toContain("# <<< crew-agent-runner managed <<<");
    expect((await stat(hookPath)).mode & 0o777).toBe(0o755);
  });

  test("preserves existing hook content, appends once, and stays idempotent", async () => {
    tmpDir = await mkTmpDir();
    await setupPluginSourceRoot(tmpDir);
    const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
    await mkdir(dirname(hookPath), { recursive: true });
    const existing = "#!/usr/bin/env bash\necho existing\n";
    await writeFile(hookPath, existing, "utf8");

    await installHooks({ root: tmpDir });
    const first = await readFile(hookPath, "utf8");
    await installHooks({ root: tmpDir });
    const second = await readFile(hookPath, "utf8");

    expect(first.startsWith(existing)).toBe(true);
    expect(first.match(/crew-agent-runner managed >>>/g)).toHaveLength(1);
    expect(second).toBe(first);
  });

  test("adds a shebang when an existing pre-commit hook is missing one", async () => {
    tmpDir = await mkTmpDir();
    await setupPluginSourceRoot(tmpDir);
    const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
    await mkdir(dirname(hookPath), { recursive: true });
    const existing = "echo existing\n";
    await writeFile(hookPath, existing, "utf8");

    await installHooks({ root: tmpDir });
    const content = await readFile(hookPath, "utf8");

    expect(content.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(content).toContain(`${existing}# >>> crew-agent-runner managed >>>`);
    expect(content.match(/^#!/gm)).toHaveLength(1);
  });

  test("respects core.hooksPath when set", async () => {
    tmpDir = await mkTmpDir();
    await setupPluginSourceRoot(tmpDir);
    const hooksDir = join(tmpDir, "custom-hooks");
    const initResult = spawnSync("git", ["init"], {
      cwd: tmpDir,
      encoding: "utf8"
    });
    expect(initResult.status).toBe(0);
    const configResult = spawnSync(
      "git",
      ["-C", tmpDir, "config", "core.hooksPath", hooksDir],
      { encoding: "utf8" }
    );
    expect(configResult.status).toBe(0);

    await installHooks({ root: tmpDir });

    const hookPath = join(hooksDir, "pre-commit");
    const content = await readFile(hookPath, "utf8");
    expect(content).toContain(MANAGED_BLOCK);
  });

  test("updates only an existing managed block when its content differs", () => {
    const before = [
      "#!/usr/bin/env bash",
      "echo before",
      "# >>> crew-agent-runner managed >>>",
      "echo stale",
      "# <<< crew-agent-runner managed <<<",
      "echo after",
      ""
    ].join("\n");

    const next = upsertManagedBlock(before, MANAGED_BLOCK);

    expect(next).toContain("echo before\n# >>> crew-agent-runner managed >>>");
    expect(next).toContain("# <<< crew-agent-runner managed <<<\necho after");
    expect(next).not.toContain("echo stale");
    expect(next.match(/crew-agent-runner managed >>>/g)).toHaveLength(1);
    expect(next).toContain("node scripts/crew-agent-runner.mjs validate");
  });

  test("blocks a direct pre-commit hook run when derived files drift", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await linkRunnerScripts(tmpDir);
    await build({ root: tmpDir });
    await installHooks({ root: tmpDir });

    const devPath = join(tmpDir, "agents", "dev.md");
    const dev = await readFile(devPath, "utf8");
    await writeFile(devPath, `${dev.slice(0, -2)}X\n`, "utf8");

    const result = spawnSync(join(tmpDir, ".git", "hooks", "pre-commit"), {
      cwd: tmpDir,
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("drift: agents/dev.md");
    expect(result.stderr).toContain("crew-agent-runner: validate failed");
  });

  test("installs through the CLI", async () => {
    tmpDir = await mkTmpDir();
    await setupPluginSourceRoot(tmpDir);
    await mkdir(join(tmpDir, ".git"), { recursive: true });

    const result = spawnSync(
      process.execPath,
      ["scripts/crew-agent-runner.mjs", "install-hooks", "--root", tmpDir],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(await readFile(join(tmpDir, ".git", "hooks", "pre-commit"), "utf8"))
      .toContain(MANAGED_BLOCK);
  });

  test("rejects when not plugin source repo", async () => {
    tmpDir = await mkTmpDir();
    await mkdir(join(tmpDir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(tmpDir, ".claude-plugin", "plugin.json"),
      "{}\n",
      "utf8"
    );
    await writeFile(
      join(tmpDir, "package.json"),
      `${JSON.stringify({ name: "other" }, null, 2)}\n`,
      "utf8"
    );

    await expect(installHooks({ root: tmpDir })).rejects.toThrow(
      /install-hooks is for claude-crew plugin developers only/
    );
  });

  test("CLI rejects when not plugin source repo", async () => {
    tmpDir = await mkTmpDir();

    const result = spawnSync(
      process.execPath,
      ["scripts/crew-agent-runner.mjs", "install-hooks", "--root", tmpDir],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "install-hooks is for claude-crew plugin developers only"
    );
  });

  test("rejects when no .claude-plugin/plugin.json", async () => {
    tmpDir = await mkTmpDir();

    await expect(installHooks({ root: tmpDir })).rejects.toThrow(
      /install-hooks is for claude-crew plugin developers only/
    );
  });
});

async function linkRunnerScripts(root) {
  const scriptsDir = join(root, "scripts");
  await mkdir(scriptsDir, { recursive: true });
  await symlink(
    join(REPO_ROOT, "scripts", "crew-agent-runner.mjs"),
    join(scriptsDir, "crew-agent-runner.mjs")
  );
  await symlink(join(REPO_ROOT, "scripts", "lib"), join(scriptsDir, "lib"));
}

async function setupPluginSourceRoot(root) {
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(root, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "fixture-plugin" }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "@jjlabsio/claude-crew" }, null, 2)}\n`,
    "utf8"
  );
}

async function setupValidateRoot(root) {
  const roles = [
    "pm",
    "techlead",
    "planner",
    "plan-evaluator",
    "explorer",
    "researcher",
    "qa",
    "dev",
    "code-reviewer"
  ];
  const contracts = {
    version: 1,
    roles: roles.map((role) => ({
      role,
      inputs: { allowed: [], denied: [] },
      outputs: [{ type: "artifact", target: `.crew/${role}.md` }],
      capabilities: {
        workspaceAccess: role === "dev" ? "workspace-write" : "read-only"
      },
      policy: {
        maxAttempts: 1,
        fallbackProvider: null,
        escalateAfterAttempts: 1,
        consecutiveSameFailureLimit: 1
      },
      claudeSubagent: {
        name: role,
        model: "ignored-by-build",
        description: `${role} description`,
        tools: ["Read", "Glob", "Grep"]
      }
    }))
  };
  const catalog = {
    agent_defaults: Object.fromEntries(
      roles.map((role) => [
        role,
        { provider: role === "dev" ? "codex" : "claude", model: `${role}-model` }
      ])
    ),
    agent_runtime: Object.fromEntries(
      roles.map((role) => [
        role,
        { codex_sandbox: role === "dev" ? "workspace-write" : "read-only" }
      ])
    )
  };

  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "data", "agent-instructions"), { recursive: true });
  await mkdir(join(root, "agents"), { recursive: true });
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(root, "data", "agent-contracts.json"),
    `${JSON.stringify(contracts, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "data", "provider-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(root, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(
      {
        name: "fixture-plugin",
        version: "0.0.0",
        agents: ["./agents/old.md"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "@jjlabsio/claude-crew" }, null, 2)}\n`,
    "utf8"
  );

  for (const role of roles) {
    await writeFile(
      join(root, "data", "agent-instructions", `${role}.md`),
      `# ${role}\n\nInstruction body for ${role}.\n`,
      "utf8"
    );
  }
}
