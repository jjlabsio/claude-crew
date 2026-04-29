import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { pluginPath } from "./pluginRoot.mjs";

export function loadCatalog(filePath) {
  return readJson(
    filePath === undefined
      ? pluginPath("data", "provider-catalog.json")
      : resolve(process.cwd(), filePath),
    true
  );
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
