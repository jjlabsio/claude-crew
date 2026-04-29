import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function mkTmpDir() {
  return mkdtemp(join(tmpdir(), "claude-crew-"));
}

export function cleanupTmpDir(path) {
  return rm(path, { recursive: true, force: true });
}
