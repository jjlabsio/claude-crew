import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createCheckpoint,
  getLatestCheckpoint,
  readRunState,
  writeRunState
} from "../../lib/crew-state.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

let tmpDir;

afterEach(async () => {
  if (tmpDir) {
    await cleanupTmpDir(tmpDir);
    tmpDir = undefined;
  }
});

describe("crew run state", () => {
  test("reads null when current run state does not exist", async () => {
    tmpDir = await mkTmpDir();
    expect(await readRunState(join(tmpDir, ".crew"))).toBeNull();
  });

  test("writes current run state atomically and returns a new object", async () => {
    tmpDir = await mkTmpDir();
    const crewDir = join(tmpDir, ".crew");
    const state = {
      active: true,
      workflow: "crew-dev",
      phase: "qa",
      taskId: "TASK-123"
    };

    const written = await writeRunState(crewDir, state);

    expect(written).not.toBe(state);
    expect(written).toMatchObject({
      version: 1,
      active: true,
      workflow: "crew-dev",
      phase: "qa",
      taskId: "TASK-123"
    });
    expect(written.lastUpdatedAt).toEqual(expect.any(String));
    expect(state.lastUpdatedAt).toBeUndefined();
    expect(await readRunState(crewDir)).toEqual(written);
  });

  test("creates and resolves latest checkpoint from current run state", async () => {
    tmpDir = await mkTmpDir();
    const crewDir = join(tmpDir, ".crew");
    await mkdir(crewDir, { recursive: true });
    await writeRunState(crewDir, {
      active: true,
      workflow: "crew-dev",
      phase: "dev",
      artifactPaths: [".crew/artifacts/dev-result.json"]
    });

    const checkpointPath = await createCheckpoint(crewDir);
    const latest = await getLatestCheckpoint(crewDir);

    expect(latest).toBe(checkpointPath);
    expect(JSON.parse(await readFile(checkpointPath, "utf8"))).toMatchObject({
      active: true,
      workflow: "crew-dev",
      phase: "dev",
      artifactPaths: [".crew/artifacts/dev-result.json"]
    });
  });
});
