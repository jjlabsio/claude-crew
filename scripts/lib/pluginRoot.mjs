import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const PLUGIN_ROOT = resolve(HERE, "..", "..");

export function pluginPath(...segments) {
  return resolve(PLUGIN_ROOT, ...segments);
}
