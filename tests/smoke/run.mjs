import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setupSandbox } from "./lib/sandbox.mjs";
import { checkRunner } from "./lib/runner-check.mjs";
import { runSkills } from "./lib/skills.mjs";
import { printReport } from "./lib/report.mjs";

const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function guardDevEnvironment() {
  const pluginJsonPath = path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

  try {
    await fs.access(pluginJsonPath);
  } catch {
    console.error(
      "This script must be run from the claude-crew plugin root (.claude-plugin/plugin.json not found)",
    );
    process.exit(1);
  }
}

async function main() {
  await guardDevEnvironment();

  const results = [];

  const sandboxResults = await setupSandbox(PLUGIN_ROOT);
  results.push(...sandboxResults);

  const sandboxFailed = sandboxResults.some((r) => r.status === "FAIL");

  if (sandboxFailed) {
    results.push({ name: "runner-check", status: "SKIP", reason: "sandbox setup failed" });
    results.push({ name: "skills", status: "SKIP", reason: "sandbox setup failed" });
  } else {
    const runnerResults = await checkRunner(PLUGIN_ROOT);
    results.push(...runnerResults);

    const sandboxPath = path.join(PLUGIN_ROOT, "test-sandbox");
    const skillResults = await runSkills(sandboxPath, PLUGIN_ROOT);
    results.push(...skillResults);
  }

  printReport(results);

  const failed = results.filter((r) =>
    ["FAIL", "TIMEOUT"].includes(r.status),
  ).length;
  const passed = results.filter((r) => r.status === "PASS").length;

  if (failed === 0) {
    console.log("All smoke tests passed");
    process.exitCode = 0;
  } else {
    console.log(`Smoke tests failed: ${passed}/${results.length} passed`);
    process.exitCode = 1;
  }
}

await main();
