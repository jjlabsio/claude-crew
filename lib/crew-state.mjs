import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const STATE_VERSION = 1;
const CURRENT_RUN_FILE = "current-run.json";

export function currentRunPath(crewDir) {
  return join(crewDir, "state", CURRENT_RUN_FILE);
}

export function checkpointsDir(crewDir) {
  return join(crewDir, "state", "checkpoints");
}

export async function readRunState(crewDir) {
  const path = currentRunPath(crewDir);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read crew run state at ${path}: ${error.message}`);
  }
}

export async function writeRunState(crewDir, state) {
  const stateDir = join(crewDir, "state");
  await mkdir(stateDir, { recursive: true });

  const nextState = {
    ...state,
    version: state.version ?? STATE_VERSION,
    lastUpdatedAt: new Date().toISOString()
  };

  const destination = currentRunPath(crewDir);
  const tempPath = join(
    stateDir,
    `.${CURRENT_RUN_FILE}.${process.pid}.${Date.now()}.tmp`
  );

  await writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  await rename(tempPath, destination);
  return nextState;
}

export async function createCheckpoint(crewDir) {
  const state = await readRunState(crewDir);
  if (!state) return null;

  const dir = checkpointsDir(crewDir);
  await mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const checkpointPath = join(dir, `checkpoint-${timestamp}.json`);
  await writeFile(checkpointPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return checkpointPath;
}

export async function getLatestCheckpoint(crewDir) {
  const dir = checkpointsDir(crewDir);
  if (!existsSync(dir)) return null;

  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir))
    .filter((file) => /^checkpoint-.+\.json$/.test(file))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) return null;
  return join(dir, basename(files.at(-1)));
}
