import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const MANAGED_BLOCK = [
  "# >>> crew-agent-runner managed >>>",
  "node scripts/crew-agent-runner.mjs validate || {",
  "  echo \"crew-agent-runner: validate failed. Run 'node scripts/crew-agent-runner.mjs build' to fix drift.\" >&2",
  "  exit 1",
  "}",
  "# <<< crew-agent-runner managed <<<"
].join("\n");

const START_MARKER = "# >>> crew-agent-runner managed >>>";
const END_MARKER = "# <<< crew-agent-runner managed <<<";
const BASH_SHEBANG = "#!/usr/bin/env bash";

export async function installHooks({ root = process.cwd() } = {}) {
  const projectRoot = resolve(root);
  const hooksDir = await resolveHooksDir(projectRoot);
  const hookPath = join(hooksDir, "pre-commit");
  await mkdir(hooksDir, { recursive: true });

  const existing = await readUtf8OrNull(hookPath);
  const base = ensureShebang(existing ?? "");
  const next = upsertManagedBlock(base, MANAGED_BLOCK);

  if (next !== existing) {
    await writeFile(hookPath, next, "utf8");
  }
  await chmod(hookPath, 0o755);

  return { hookPath };
}

export function ensureShebang(content) {
  if (content.startsWith("#!")) {
    return content;
  }

  return `${BASH_SHEBANG}\n${content}`;
}

export function upsertManagedBlock(content, block) {
  const start = content.indexOf(START_MARKER);
  if (start !== -1) {
    const end = content.indexOf(END_MARKER, start + START_MARKER.length);
    if (end !== -1) {
      const afterEnd = end + END_MARKER.length;
      return `${content.slice(0, start)}${block}${content.slice(afterEnd)}`;
    }
  }

  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${block}\n`;
}

async function resolveHooksDir(projectRoot) {
  const configuredHooksPath = readConfiguredHooksPath(projectRoot);
  if (configuredHooksPath) {
    return isAbsolute(configuredHooksPath)
      ? configuredHooksPath
      : resolve(projectRoot, configuredHooksPath);
  }

  const dotGit = join(projectRoot, ".git");
  try {
    const dotGitStat = await stat(dotGit);
    if (dotGitStat.isDirectory()) {
      return join(dotGit, "hooks");
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return join(dotGit, "hooks");
    }
    throw error;
  }

  const gitFile = await readFile(dotGit, "utf8");
  const match = /^gitdir:\s*(.+)\s*$/m.exec(gitFile);
  if (!match) {
    throw new Error(".git is not a directory or gitdir file");
  }

  const gitDir = match[1];
  return join(isAbsolute(gitDir) ? gitDir : resolve(dirname(dotGit), gitDir), "hooks");
}

function readConfiguredHooksPath(projectRoot) {
  try {
    const hooksPath = execFileSync(
      "git",
      ["-C", projectRoot, "config", "--get", "core.hooksPath"],
      { encoding: "utf8" }
    ).trim();
    return hooksPath || null;
  } catch {
    return null;
  }
}

async function readUtf8OrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
