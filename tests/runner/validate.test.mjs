import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { build } from "../../scripts/lib/build.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

describe("validate", () => {
  test("exits 0 with OK immediately after build", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await build({ root: tmpDir });

    const result = spawnValidate(tmpDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\bOK\b/);
    expect(result.stderr).toBe("");
  });

  test("reports one-byte agent drift", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await build({ root: tmpDir });
    const devPath = join(tmpDir, "agents", "dev.md");
    const dev = await readFile(devPath, "utf8");
    await writeFile(devPath, `${dev.slice(0, -2)}X\n`, "utf8");

    const result = spawnValidate(tmpDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("drift: agents/dev.md");
  });

  test("reports plugin agents drift", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await build({ root: tmpDir });
    const pluginPath = join(tmpDir, ".claude-plugin", "plugin.json");
    const plugin = JSON.parse(await readFile(pluginPath, "utf8"));
    plugin.agents.pop();
    await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, "utf8");

    const result = spawnValidate(tmpDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("drift: plugin.json agents");
  });

  test("reports workspace access and codex sandbox mismatch", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await build({ root: tmpDir });
    const catalogPath = join(tmpDir, "data", "provider-catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    catalog.agent_runtime.dev.codex_sandbox = "read-only";
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

    const result = spawnValidate(tmpDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "mismatch: dev workspaceAccess=workspace-write but codex_sandbox=read-only"
    );
  });

  test("reports workflow skills that bypass the common runner interface", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await build({ root: tmpDir });
    await mkdir(join(tmpDir, "skills", "bad-workflow"), { recursive: true });
    await writeFile(
      join(tmpDir, "skills", "bad-workflow", "SKILL.md"),
      [
        "---",
        "name: bad-workflow",
        "---",
        "",
        "## 실행 순서",
        "중앙 `crew-agent-runner` 스킬의 dispatch 절차로 실행한다.",
        "",
        "### Phase 1",
        "Agent(subagent_type=\"dev\", prompt=\"...\")"
      ].join("\n"),
      "utf8"
    );

    const result = spawnValidate(tmpDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "skills/bad-workflow/SKILL.md: direct agent dispatch is forbidden"
    );
    expect(result.stderr).toContain(
      "missing runner dispatch interface marker: ## 공통 에이전트 실행 인터페이스"
    );
  });

  test("does not modify files while validating drift", async () => {
    tmpDir = await mkTmpDir();
    await setupValidateRoot(tmpDir);
    await build({ root: tmpDir });
    const devPath = join(tmpDir, "agents", "dev.md");
    const dev = await readFile(devPath, "utf8");
    await writeFile(devPath, `${dev.slice(0, -2)}X\n`, "utf8");
    const before = await hashFiles(tmpDir);

    const result = spawnValidate(tmpDir);
    const after = await hashFiles(tmpDir);

    expect(result.status).toBe(1);
    expect(after).toEqual(before);
  });
});

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

  for (const role of roles) {
    await writeFile(
      join(root, "data", "agent-instructions", `${role}.md`),
      `# ${role}\n\nInstruction body for ${role}.\n`,
      "utf8"
    );
  }
}

function spawnValidate(root) {
  return spawnSync(
    process.execPath,
    ["scripts/crew-agent-runner.mjs", "validate", "--root", root],
    { encoding: "utf8" }
  );
}

async function hashFiles(root) {
  const files = await listFiles(root);
  const hashes = {};
  for (const file of files) {
    const content = await readFile(join(root, file));
    hashes[file] = createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

async function listFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}
