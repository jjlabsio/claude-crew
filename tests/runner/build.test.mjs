import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { build, serializeFrontmatter } from "../../scripts/lib/build.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

describe("build", () => {
  test("creates deterministic agent files and rewrites plugin agents in contract order", async () => {
    tmpDir = await mkTmpDir();
    const fixture = await setupBuildRoot(tmpDir);

    await build({ root: tmpDir });

    const firstAgentBytes = new Map();
    for (const role of fixture.roles) {
      const agentPath = join(tmpDir, "agents", `${role}.md`);
      const content = await readFile(agentPath, "utf8");
      firstAgentBytes.set(role, content);

      expect(content).toBe(expectedAgent(fixture, role));
      expect(content.endsWith("\n")).toBe(true);
      expect(content.endsWith("\n\n")).toBe(false);
    }

    const plugin = JSON.parse(
      await readFile(join(tmpDir, ".claude-plugin", "plugin.json"), "utf8")
    );
    expect(plugin).toEqual({
      name: "fixture-plugin",
      version: "0.0.0",
      description: "kept",
      agents: fixture.roles.map((role) => `./agents/${role}.md`)
    });

    const firstPlugin = await readFile(
      join(tmpDir, ".claude-plugin", "plugin.json"),
      "utf8"
    );
    await build({ root: tmpDir });

    for (const role of fixture.roles) {
      const content = await readFile(
        join(tmpDir, "agents", `${role}.md`),
        "utf8"
      );
      expect(sha256(content)).toBe(sha256(firstAgentBytes.get(role)));
    }
    expect(
      await readFile(join(tmpDir, ".claude-plugin", "plugin.json"), "utf8")
    ).toBe(firstPlugin);
  });

  test("warns about orphan instructions and fails when a contract instruction is missing", async () => {
    tmpDir = await mkTmpDir();
    const fixture = await setupBuildRoot(tmpDir);
    await writeFile(
      join(tmpDir, "data", "agent-instructions", "orphan.md"),
      "# Orphan\n",
      "utf8"
    );

    const ok = spawnBuild(tmpDir);
    expect(ok.status).toBe(0);
    expect(ok.stderr).toMatch(
      /Warning: instruction file has no contract role: orphan/
    );

    await rm(join(tmpDir, "data", "agent-instructions", `${fixture.roles[0]}.md`));
    const missing = spawnBuild(tmpDir);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(
      new RegExp(`Missing agent instructions: ${fixture.roles[0]}`)
    );
  });
});

describe("serializeFrontmatter", () => {
  test("keeps field order and serializes tools as an unquoted inline array", () => {
    expect(
      serializeFrontmatter({
        name: "dev",
        model: "gpt-5.5",
        description: "구현한다",
        tools: ["Read", "Glob", "Grep"]
      })
    ).toBe(
      [
        "---",
        "name: dev",
        "model: gpt-5.5",
        "description: 구현한다",
        "tools: [Read, Glob, Grep]",
        "---"
      ].join("\n")
    );
  });
});

async function setupBuildRoot(root) {
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
    roles: roles.map((role, index) => ({
      role,
      inputs: { allowed: [], denied: [] },
      outputs: [{ type: "artifact", target: `.crew/${role}.md` }],
      capabilities: {
        workspaceAccess: index === 7 ? "workspace-write" : "read-only"
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
      roles.map((role, index) => [
        role,
        { provider: index === 7 ? "codex" : "claude", model: `${role}-model` }
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
        description: "kept",
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

  return { roles, contracts, catalog };
}

function expectedAgent(fixture, role) {
  const contract = fixture.contracts.roles.find((item) => item.role === role);
  return [
    "---",
    `name: ${role}`,
    `model: ${fixture.catalog.agent_defaults[role].model}`,
    `description: ${contract.claudeSubagent.description}`,
    "tools: [Read, Glob, Grep]",
    "---",
    "",
    "## Capability",
    `workspaceAccess: ${contract.capabilities.workspaceAccess}`,
    "canAskUser: false",
    "canRequestAgent: false",
    "canUseShell: false",
    "canWriteCrewFiles: true",
    "",
    `# ${role}`,
    "",
    `Instruction body for ${role}.`,
    ""
  ].join("\n");
}

function spawnBuild(root) {
  return spawnSync(
    process.execPath,
    ["scripts/crew-agent-runner.mjs", "build", "--root", root],
    { encoding: "utf8" }
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
