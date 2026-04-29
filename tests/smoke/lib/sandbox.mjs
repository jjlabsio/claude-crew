import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

export async function setupSandbox(pluginRoot) {
  const results = [];
  const sandboxPath = path.join(pluginRoot, "test-sandbox");
  const fixturePath = path.join(pluginRoot, "tests", "fixtures", "smoke");

  // 1. Remove existing sandbox and recreate
  try {
    await fs.rm(sandboxPath, { recursive: true, force: true });
    await fs.mkdir(sandboxPath, { recursive: true });

    // 2. Copy fixture files
    const entries = await fs.readdir(fixturePath);
    for (const entry of entries) {
      await fs.copyFile(
        path.join(fixturePath, entry),
        path.join(sandboxPath, entry),
      );
    }

    // 3. git init + add + commit
    execSync("git init && git add -A && git commit -m \"initial\"", {
      cwd: sandboxPath,
      stdio: "pipe",
    });

    results.push({ name: "sandbox-init", status: "PASS" });
  } catch (err) {
    results.push({
      name: "sandbox-init",
      status: "FAIL",
      reason: err.message,
    });
    return results;
  }

  // 4. claude plugin marketplace add + plugin install
  try {
    const pluginJson = JSON.parse(
      await fs.readFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const pluginName = pluginJson.name;

    execSync(`claude plugin marketplace add --scope local ${pluginRoot}`, {
      cwd: sandboxPath,
      stdio: "pipe",
    });

    execSync(`claude plugin install --scope local ${pluginName}`, {
      cwd: sandboxPath,
      stdio: "pipe",
    });

    results.push({ name: "plugin-add", status: "PASS" });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    results.push({
      name: "plugin-add",
      status: "FAIL",
      reason: stderr,
    });
  }

  // 5. Write .crew/config.json — ensure at least one codex agent per stage
  //    interview: pm, plan: explorer, dev: dev (already default)
  try {
    const crewDir = path.join(sandboxPath, ".crew");
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(
      path.join(crewDir, "config.json"),
      JSON.stringify({
        providers: {
          pm: { provider: "codex", model: "gpt-5.5", reasoning: "medium" },
          techlead: { provider: "codex", model: "gpt-5.5", reasoning: "medium" },
          planner: { provider: "codex", model: "gpt-5.5", reasoning: "medium" },
          dev: { provider: "codex", model: "gpt-5.5", reasoning: "medium" },
        },
      }, null, 2) + "\n",
    );
  } catch (err) {
    results.push({
      name: "codex-config",
      status: "FAIL",
      reason: err.message,
    });
  }

  return results;
}
