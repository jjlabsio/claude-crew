// SPDX-License-Identifier: Apache-2.0
// Derived from @openai/codex-plugin-cc and modified for claude-crew.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "crew-codex-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const LOCK_DIR_NAME = ".lock";
const LOCK_WAIT_TIMEOUT_MS = 10000;
const LOCK_POLL_INTERVAL_MS = 50;
const LOCK_STALE_AFTER_MS = 60000;
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false
    },
    jobs: []
  };
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveLockDir(cwd) {
  return path.join(resolveStateDir(cwd), LOCK_DIR_NAME);
}

function writeLockOwner(lockDir) {
  fs.writeFileSync(
    path.join(lockDir, "owner.json"),
    `${JSON.stringify({ pid: process.pid, createdAt: nowIso() }, null, 2)}\n`,
    "utf8"
  );
}

function readLockOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function getLockAgeMs(lockDir, owner) {
  const createdAt = Date.parse(owner?.createdAt ?? "");
  if (Number.isFinite(createdAt)) {
    return Date.now() - createdAt;
  }
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs;
  } catch {
    return 0;
  }
}

function removeStaleLock(lockDir, owner) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `Failed to remove stale Codex companion state lock held by pid ${owner?.pid ?? "unknown"}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function maybeRemoveStaleLock(lockDir, options = {}) {
  const staleAfterMs = options.staleAfterMs ?? LOCK_STALE_AFTER_MS;
  const owner = readLockOwner(lockDir);
  const ageMs = getLockAgeMs(lockDir, owner);

  if (!owner) {
    if (ageMs >= staleAfterMs) {
      removeStaleLock(lockDir, owner);
      return true;
    }
    return false;
  }

  if (!isProcessAlive(owner.pid) || ageMs >= staleAfterMs) {
    removeStaleLock(lockDir, owner);
    return true;
  }
  return false;
}

function acquireStateLock(cwd, options = {}) {
  const timeoutMs = options.timeoutMs ?? LOCK_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? LOCK_POLL_INTERVAL_MS;
  const stateDir = resolveStateDir(cwd);
  const lockDir = resolveLockDir(cwd);
  const startedAt = Date.now();
  fs.mkdirSync(stateDir, { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      writeLockOwner(lockDir);
      return lockDir;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for Codex companion state lock: ${lockDir}`);
      }
      if (maybeRemoveStaleLock(lockDir, options)) {
        continue;
      }
      sleepSync(pollIntervalMs);
    }
  }
}

async function acquireStateLockAsync(cwd, options = {}) {
  const timeoutMs = options.timeoutMs ?? LOCK_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? LOCK_POLL_INTERVAL_MS;
  const stateDir = resolveStateDir(cwd);
  const lockDir = resolveLockDir(cwd);
  const startedAt = Date.now();
  fs.mkdirSync(stateDir, { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      writeLockOwner(lockDir);
      return lockDir;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for Codex companion state lock: ${lockDir}`);
      }
      if (maybeRemoveStaleLock(lockDir, options)) {
        continue;
      }
      await sleep(pollIntervalMs);
    }
  }
}

function releaseStateLock(lockDir) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Lock release is best-effort; callers should not fail after their write completed.
  }
}

export function withStateLock(cwd, callback, options = {}) {
  const lockDir = acquireStateLock(cwd, options);
  try {
    return callback();
  } finally {
    releaseStateLock(lockDir);
  }
}

export async function withStateLockAsync(cwd, callback, options = {}) {
  const lockDir = await acquireStateLockAsync(cwd, options);
  try {
    return await callback();
  } finally {
    releaseStateLock(lockDir);
  }
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function writeJsonFileAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function saveStateUnlocked(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...(state.config ?? {})
    },
    jobs: nextJobs
  };

  const retainedIds = new Set(nextJobs.map((job) => job.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) {
      continue;
    }
    removeJobFile(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }

  writeJsonFileAtomic(resolveStateFile(cwd), nextState);
  return nextState;
}

export function saveState(cwd, state) {
  return withStateLock(cwd, () => saveStateUnlocked(cwd, state));
}

export function updateState(cwd, mutate) {
  return withStateLock(cwd, () => {
    const state = loadState(cwd);
    mutate(state);
    return saveStateUnlocked(cwd, state);
  });
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}

export function updateJobStateAndFile(cwd, jobId, mutate) {
  return withStateLock(cwd, () => {
    const state = loadState(cwd);
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobId);
    const existingJob = existingIndex === -1 ? null : state.jobs[existingIndex];
    const result = mutate(existingJob, { timestamp });
    if (!result) {
      return null;
    }

    const stateJob = result.stateJob ?? result.job ?? null;
    if (!stateJob) {
      return null;
    }

    const nextStateJob = {
      ...(existingJob ?? {
        createdAt: timestamp
      }),
      ...stateJob,
      id: jobId,
      updatedAt: stateJob.updatedAt ?? timestamp
    };

    if (existingIndex === -1) {
      state.jobs.unshift(nextStateJob);
    } else {
      state.jobs[existingIndex] = nextStateJob;
    }

    const nextState = saveStateUnlocked(cwd, state);
    const fileJob = result.fileJob ?? nextStateJob;
    if (fileJob) {
      writeJsonFileAtomic(resolveJobFile(cwd, jobId), fileJob);
    }

    return {
      state: nextState,
      job: nextStateJob,
      fileJob
    };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  writeJsonFileAtomic(jobFile, payload);
  return jobFile;
}

export function readJobFile(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}
