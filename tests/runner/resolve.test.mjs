import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import {
  loadCatalog,
  loadProjectConfig,
  loadUserConfig
} from "../../scripts/lib/config.mjs";
import { resolveRole } from "../../scripts/lib/resolve.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

function fixtureContracts() {
  return {
    version: 1,
    roles: [
      {
        role: "planner",
        capabilities: { workspaceAccess: "read-only" }
      },
      {
        role: "dev",
        capabilities: { workspaceAccess: "workspace-write" }
      }
    ]
  };
}

function fixtureCatalog() {
  return {
    agent_defaults: {
      planner: { provider: "codex", model: "gpt-5.5", reasoning: "medium" },
      dev: { provider: "codex", model: "gpt-5.5", reasoning: "high" }
    },
    agent_runtime: {
      planner: { codex_sandbox: "read-only" },
      dev: { codex_sandbox: "read-only" }
    }
  };
}

describe("resolveRole", () => {
  test("returns provider, model, contract, dispatch and warnings for a role", () => {
    const result = resolveRole({
      role: "dev",
      catalog: fixtureCatalog(),
      userConfig: {},
      projectConfig: {},
      contracts: fixtureContracts()
    });

    expect(result).toEqual({
      role: "dev",
      provider: "codex",
      model: "gpt-5.5",
      reasoning: "high",
      codex_sandbox: "read-only",
      codex_network_access: false,
      contract: fixtureContracts().roles[1],
      dispatch: { path: "codex", write: false },
      warnings: [
        "dev: codex_sandbox read-only does not match contract capabilities.workspaceAccess workspace-write"
      ]
    });
  });

  test("uses precedence project over user over catalog default", () => {
    const result = resolveRole({
      role: "planner",
      catalog: fixtureCatalog(),
      userConfig: {
        providers: {
          planner: { provider: "codex", model: "gpt-5.4", reasoning: "xhigh" }
        }
      },
      projectConfig: {
        providers: {
          planner: { provider: "claude", model: "sonnet" }
        }
      },
      contracts: fixtureContracts()
    });

    expect(result.provider).toBe("claude");
    expect(result.model).toBe("sonnet");
    expect(result.reasoning).toBe(null);
    expect(result.dispatch).toEqual({ path: "claude", write: false });
  });

  test("throws for unknown role", () => {
    expect(() =>
      resolveRole({
        role: "unknown",
        catalog: fixtureCatalog(),
        userConfig: {},
        projectConfig: {},
        contracts: fixtureContracts()
      })
    ).toThrow(/Unknown role: unknown/);
  });
});

describe("config loaders", () => {
  test("loaders parse explicit files and return empty objects for missing config files", async () => {
    tmpDir = await mkTmpDir();
    const catalogPath = join(tmpDir, "provider-catalog.json");
    const missingCatalogPath = join(tmpDir, "missing-provider-catalog.json");
    const userConfigPath = join(tmpDir, "missing-user.json");
    const projectRoot = join(tmpDir, "project");
    const projectConfigDir = join(projectRoot, ".crew");
    const projectConfigPath = join(projectConfigDir, "config.json");

    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(catalogPath, JSON.stringify(fixtureCatalog()), "utf8");
    await writeFile(
      projectConfigPath,
      JSON.stringify({ providers: { planner: { provider: "claude" } } }),
      "utf8"
    );

    expect(loadCatalog(catalogPath)).toEqual(fixtureCatalog());
    expect(loadCatalog(missingCatalogPath)).toEqual({});
    expect(loadUserConfig(userConfigPath)).toEqual({});
    expect(loadProjectConfig(projectRoot)).toEqual({
      providers: { planner: { provider: "claude" } }
    });
  });
});

describe("crew-agent-runner resolve CLI", () => {
  test("prints JSON for planner role", async () => {
    tmpDir = await mkTmpDir();
    await mkdir(join(tmpDir, ".crew"), { recursive: true });
    await writeFile(
      join(tmpDir, ".crew", "config.json"),
      JSON.stringify({
        providers: {
          planner: { provider: "codex", model: "gpt-5.5", reasoning: "medium" }
        }
      }),
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", "crew-agent-runner.mjs"), "resolve", "--role", "planner", "--json"],
      { encoding: "utf8", cwd: tmpDir }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      role: "planner",
      provider: "codex",
      dispatch: { path: "codex", write: false }
    });
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  test("unknown role exits non-zero with stderr diagnostic", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/crew-agent-runner.mjs", "resolve", "--role", "unknown", "--json"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown role: unknown/);
  });
});
