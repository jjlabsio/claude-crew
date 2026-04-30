import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { loadCatalog } from "../../scripts/lib/config.mjs";
import { loadContracts } from "../../scripts/lib/contracts.mjs";
import {
  PLUGIN_ROOT,
  pluginPath
} from "../../scripts/lib/pluginRoot.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const ORIGINAL_CWD = process.cwd();
let tmpDir;

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

describe("plugin root paths", () => {
  test("PLUGIN_ROOT points at the plugin worktree root", () => {
    expect(PLUGIN_ROOT).toBe(REPO_ROOT);
  });

  test("pluginPath resolves data files under the plugin root", () => {
    expect(pluginPath("data", "agent-contracts.json")).toBe(
      resolve(REPO_ROOT, "data", "agent-contracts.json")
    );
    expect(existsSync(pluginPath("data", "agent-contracts.json"))).toBe(true);
  });

  test("loadContracts without args reads plugin root data regardless of cwd", () => {
    process.chdir("/tmp");

    const contracts = loadContracts();

    expect(contracts.roles.map((contract) => contract.role)).toContain("planner");
  });

  test("loadCatalog without args reads plugin root data regardless of cwd", () => {
    process.chdir("/tmp");

    const catalog = loadCatalog();

    expect(catalog.agent_defaults.planner).toMatchObject({
      provider: "codex"
    });
  });

  test("loadContracts with explicit paths resolves against cwd or absolute path", async () => {
    tmpDir = await mkTmpDir();
    const contractsPath = resolve(tmpDir, "data", "agent-contracts.json");
    await mkdir(resolve(tmpDir, "data"), { recursive: true });
    await writeFile(
      contractsPath,
      `${JSON.stringify(fixtureContracts("cwd-role"), null, 2)}\n`,
      "utf8"
    );
    process.chdir(tmpDir);

    expect(loadContracts("data/agent-contracts.json").roles[0].role).toBe(
      "cwd-role"
    );
    expect(loadContracts(contractsPath).roles[0].role).toBe("cwd-role");
  });
});

function fixtureContracts(role) {
  return {
    version: 1,
    roles: [
      {
        role,
        inputs: { allowed: [], denied: [] },
        outputs: [],
        capabilities: { workspaceAccess: "read-only" },
        policy: { maxAttempts: 1 },
        claudeSubagent: { tools: [] }
      }
    ]
  };
}
