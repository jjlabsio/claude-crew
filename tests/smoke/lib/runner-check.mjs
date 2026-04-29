import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 30_000;

/**
 * Execute a runner sub-command and return { stdout, stderr, exitCode }.
 * On timeout, throws an error with code "TIMEOUT".
 */
function execRunner(runnerPath, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [runnerPath, ...args],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          const timeoutErr = new Error(`Timed out after ${TIMEOUT_MS / 1000}s`);
          timeoutErr.code = "TIMEOUT";
          reject(timeoutErr);
          return;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? error.code ?? 1 : 0,
        });
      },
    );
  });
}

async function checkResolve(runnerPath) {
  const name = "resolve";
  try {
    const { stdout, stderr, exitCode } = await execRunner(runnerPath, [
      "resolve",
      "--role",
      "dev",
      "--json",
    ]);

    if (exitCode !== 0) {
      return { name, status: "FAIL", reason: `exit code ${exitCode}: ${stderr.trim()}` };
    }

    try {
      JSON.parse(stdout);
    } catch {
      return { name, status: "FAIL", reason: "stdout is not valid JSON" };
    }

    return { name, status: "PASS" };
  } catch (err) {
    if (err.code === "TIMEOUT") {
      return { name, status: "TIMEOUT", reason: `exceeded ${TIMEOUT_MS / 1000}s` };
    }
    return { name, status: "FAIL", reason: err.message };
  }
}

async function checkRender(runnerPath) {
  const name = "render";
  let tmpFile;
  try {
    // Create temp request JSON file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-render-"));
    tmpFile = path.join(tmpDir, "request.json");
    await fs.writeFile(
      tmpFile,
      JSON.stringify({
        role: "dev",
        taskId: "smoke-check",
        inputs: [],
        instruction: "noop",
      }),
    );

    const { stdout, stderr, exitCode } = await execRunner(runnerPath, [
      "render",
      "--role",
      "dev",
      "--request-file",
      tmpFile,
    ]);

    if (exitCode !== 0) {
      return { name, status: "FAIL", reason: `exit code ${exitCode}: ${stderr.trim()}` };
    }

    if (stdout.trim().length === 0) {
      return { name, status: "FAIL", reason: "stdout is empty" };
    }

    return { name, status: "PASS" };
  } catch (err) {
    if (err.code === "TIMEOUT") {
      return { name, status: "TIMEOUT", reason: `exceeded ${TIMEOUT_MS / 1000}s` };
    }
    return { name, status: "FAIL", reason: err.message };
  } finally {
    if (tmpFile) {
      await fs.rm(path.dirname(tmpFile), { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function checkValidate(runnerPath, pluginRoot) {
  const name = "validate";
  try {
    const { stdout, stderr, exitCode } = await execRunner(runnerPath, [
      "validate",
      "--root",
      pluginRoot,
    ]);

    if (exitCode !== 0) {
      return { name, status: "FAIL", reason: `exit code ${exitCode}: ${stderr.trim()}` };
    }

    if (!stdout.includes("OK")) {
      return { name, status: "FAIL", reason: "stdout does not contain \"OK\"" };
    }

    return { name, status: "PASS" };
  } catch (err) {
    if (err.code === "TIMEOUT") {
      return { name, status: "TIMEOUT", reason: `exceeded ${TIMEOUT_MS / 1000}s` };
    }
    return { name, status: "FAIL", reason: err.message };
  }
}

export async function checkRunner(pluginRoot) {
  const runnerPath = path.join(pluginRoot, "scripts", "crew-agent-runner.mjs");
  const results = [];

  results.push(await checkResolve(runnerPath));
  results.push(await checkRender(runnerPath));
  results.push(await checkValidate(runnerPath, pluginRoot));

  return results;
}
