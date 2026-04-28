import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_CATALOG_PATH = "data/provider-catalog.json";

export function loadCatalog(filePath = DEFAULT_CATALOG_PATH) {
  return readJson(resolve(process.cwd(), filePath), true);
}

export function loadUserConfig(filePath = join(homedir(), ".claude", "crew", "config.json")) {
  return readJson(filePath, true);
}

export function loadProjectConfig(projectRoot = process.cwd()) {
  return readJson(join(projectRoot, ".crew", "config.json"), true);
}

function readJson(filePath, allowMissing) {
  if (!existsSync(filePath)) {
    if (allowMissing) {
      return {};
    }
    throw new Error(`File not found: ${filePath}`);
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}
