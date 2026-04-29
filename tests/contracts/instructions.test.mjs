import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { loadContracts } from "../../scripts/lib/contracts.mjs";
import { cleanupTmpDir, mkTmpDir } from "../_helpers/fs.mjs";

const INSTRUCTIONS_DIR = join(process.cwd(), "data", "agent-instructions");
const ROLES = loadContracts().roles.map((contract) => contract.role);

async function validateInstructionsFor(roles, dir) {
  for (const role of roles) {
    const path = join(dir, `${role}.md`);
    let text;

    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`${role} instructions file is missing at ${path}`, {
        cause: error
      });
    }

    expect(text, `${role} instructions must not start with frontmatter`).not.toMatch(
      /^---(?:\r?\n|$)/
    );
    expect(text.trim(), `${role} instructions must not be empty`).not.toBe("");
  }
}

describe("agent instructions files", () => {
  test.each(ROLES)(
    "%s instructions exist without frontmatter and are not empty",
    async (role) => {
      await validateInstructionsFor([role], INSTRUCTIONS_DIR);
    }
  );

  test("missing instructions file is detected", async () => {
    const dir = await mkTmpDir();

    try {
      await expect(validateInstructionsFor(["missing-role"], dir)).rejects.toThrow(
        /missing-role instructions file is missing/
      );
    } finally {
      await cleanupTmpDir(dir);
    }
  });
});
