import fs from "node:fs/promises";

/**
 * Assert that a file exists at the given path.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function assertFileExists(filePath) {
  try {
    await fs.access(filePath);
    return { ok: true };
  } catch {
    return { ok: false, reason: `file not found: ${filePath}` };
  }
}

/**
 * Assert that a file contains all specified section headings.
 * Looks for `# <section>` or `## <section>` patterns (case-insensitive).
 * Returns the first missing section found.
 * @param {string} filePath - Absolute path to the file.
 * @param {string[]} sections - Section names to look for.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function assertContainsSections(filePath, sections) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return { ok: false, reason: `file not found: ${filePath}` };
  }

  for (const section of sections) {
    // Match `# section` or `## section` (with optional leading whitespace)
    const pattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(section)}`, "mi");
    if (!pattern.test(content)) {
      return { ok: false, reason: `missing section: ${section}` };
    }
  }

  return { ok: true };
}

/**
 * Assert that a file contains at least one of the specified section headings.
 * @param {string} filePath - Absolute path to the file.
 * @param {string[]} sections - Section names (at least one must be present).
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function assertContainsAnySections(filePath, sections) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return { ok: false, reason: `file not found: ${filePath}` };
  }

  for (const section of sections) {
    const pattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(section)}`, "mi");
    if (pattern.test(content)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: `missing all sections: ${sections.join(", ")}` };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
