import { spawn } from "node:child_process";
import path from "node:path";

import {
  assertFileExists,
  assertContainsSections,
  assertContainsAnySections,
} from "./verify.mjs";

/**
 * Skill definitions in execution order.
 * Each skill specifies its name, timeout, prompt builder, artifact verifications,
 * and which skills it depends on (by name).
 */
const SKILL_DEFS = [
  {
    name: "crew-setup",
    timeout: 120_000,
    prompt: () =>
      "/claude-crew:crew-setup\n\n" +
      "provider 설정은 모두 기본값으로 선택해라. " +
      "HUD 설치는 하지 마라. " +
      ".gitignore와 .gitattributes는 변경을 허용한다. " +
      "모든 결정을 자체적으로 내려라. 사용자에게 질문하지 마라.",
    verify: () => [],
    dependsOn: [],
  },
  {
    name: "crew-interview",
    timeout: 300_000,
    prompt: () =>
      "/claude-crew:crew-interview 간단한 hello 함수를 index.js에 추가\n\n" +
      "task-id는 smoke-test로 지정해라. " +
      "모든 질문에 기본 선택지(첫 번째)를 선택해라. " +
      "최소 스코프로 진행해라. " +
      "fixture 프로젝트에 간단한 기능 추가 요청이다: add hello function to index.js. " +
      "spec 승인 후 crew-plan으로 넘어가지 말고 여기서 종료해라. " +
      "모든 결정을 자체적으로 내려라. 사용자에게 질문하지 마라.",
    verify: (sandboxPath) => [
      {
        type: "file",
        path: path.join(sandboxPath, ".crew", "plans", "smoke-test", "spec.md"),
      },
      {
        type: "sections",
        path: path.join(sandboxPath, ".crew", "plans", "smoke-test", "spec.md"),
        sections: ["목표", "수용 기준"],
      },
    ],
    dependsOn: [],
  },
  {
    name: "crew-plan",
    timeout: 600_000,
    prompt: () =>
      "/claude-crew:crew-plan smoke-test\n\n" +
      "task-id는 smoke-test이다. " +
      "테스트 전략은 None으로 선택해라. " +
      "crew-dev로 넘어가지 말고 여기서 종료해라. " +
      "모든 결정을 자체적으로 내려라. 사용자에게 질문하지 마라.",
    verify: (sandboxPath) => [
      {
        type: "file",
        path: path.join(sandboxPath, ".crew", "plans", "smoke-test", "plan.md"),
      },
      {
        type: "any-sections",
        path: path.join(sandboxPath, ".crew", "plans", "smoke-test", "plan.md"),
        sections: ["유저 스토리", "US-"],
      },
    ],
    dependsOn: ["crew-interview"],
  },
  {
    name: "crew-dev",
    timeout: 900_000,
    prompt: () =>
      "/claude-crew:crew-dev smoke-test\n\n" +
      "task-id는 smoke-test이다. " +
      "모든 결정을 자체적으로 내려라. 사용자에게 질문하지 마라.",
    verify: (sandboxPath) => [
      {
        type: "file",
        path: path.join(sandboxPath, ".crew", "plans", "smoke-test", "dev-log.md"),
      },
    ],
    dependsOn: ["crew-plan"],
  },
];

/**
 * Run `claude -p --dir <sandboxPath>` with the given prompt text.
 * Returns { exitCode, stdout, stderr }.
 * On timeout, kills the process and returns exitCode "TIMEOUT".
 */
function runClaude(sandboxPath, promptText, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn("claude", ["-p", "--dir", sandboxPath, promptText], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Give 5 seconds for graceful exit, then force kill
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    }, timeoutMs);

    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: "TIMEOUT", stdout, stderr });
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    child.on("error", (err) => {
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: stderr + "\n" + err.message });
    });
  });
}

/**
 * Run artifact verification checks for a skill.
 * @returns {{ ok: boolean, reason?: string }}
 */
async function runVerifications(checks) {
  for (const check of checks) {
    if (check.type === "file") {
      const result = await assertFileExists(check.path);
      if (!result.ok) return result;
    } else if (check.type === "sections") {
      const result = await assertContainsSections(check.path, check.sections);
      if (!result.ok) return result;
    } else if (check.type === "any-sections") {
      const result = await assertContainsAnySections(check.path, check.sections);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}

/**
 * Execute all 4 skills sequentially with dependency SKIP logic and artifact verification.
 * @param {string} sandboxPath - Absolute path to the sandbox directory.
 * @param {string} pluginRoot - Absolute path to the plugin root.
 * @returns {Promise<Array<{name: string, status: string, reason?: string}>>}
 */
export async function runSkills(sandboxPath, pluginRoot) {
  const results = [];
  /** @type {Map<string, string>} skill name -> status */
  const statusMap = new Map();

  for (const skill of SKILL_DEFS) {
    // Check dependencies — if any dependency is not PASS, skip this skill
    const failedDep = skill.dependsOn.find(
      (dep) => statusMap.get(dep) !== "PASS",
    );

    if (failedDep) {
      const depStatus = statusMap.get(failedDep) ?? "UNKNOWN";
      const result = {
        name: skill.name,
        status: "SKIP",
        reason: `dependency failed: ${failedDep} (${depStatus})`,
      };
      results.push(result);
      statusMap.set(skill.name, "SKIP");
      continue;
    }

    // Execute the skill
    const promptText = skill.prompt();
    const { exitCode, stdout, stderr } = await runClaude(
      sandboxPath,
      promptText,
      skill.timeout,
    );

    if (exitCode === "TIMEOUT") {
      const result = {
        name: skill.name,
        status: "TIMEOUT",
        reason: `exceeded ${skill.timeout / 1000}s`,
      };
      results.push(result);
      statusMap.set(skill.name, "TIMEOUT");
      continue;
    }

    if (exitCode !== 0) {
      const stderrSnippet = stderr.trim().split("\n").slice(-3).join(" | ");
      const result = {
        name: skill.name,
        status: "FAIL",
        reason: `exit code ${exitCode}${stderrSnippet ? ": " + stderrSnippet : ""}`,
      };
      results.push(result);
      statusMap.set(skill.name, "FAIL");
      continue;
    }

    // Verify artifacts
    const checks = skill.verify(sandboxPath);
    if (checks.length > 0) {
      const verification = await runVerifications(checks);
      if (!verification.ok) {
        const result = {
          name: skill.name,
          status: "FAIL",
          reason: verification.reason,
        };
        results.push(result);
        statusMap.set(skill.name, "FAIL");
        continue;
      }
    }

    results.push({ name: skill.name, status: "PASS" });
    statusMap.set(skill.name, "PASS");
  }

  return results;
}
