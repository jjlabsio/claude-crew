// SPDX-License-Identifier: Apache-2.0
// Derived from @openai/codex-plugin-cc and modified for claude-crew.
import { ensureGitRepository } from "./git.mjs";

export function resolveWorkspaceRoot(cwd) {
  try {
    return ensureGitRepository(cwd);
  } catch {
    return cwd;
  }
}
