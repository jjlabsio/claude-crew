import { defineConfig } from "vitest/config";
import { basename, join, sep } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    environment: "node",
    resolveSnapshotPath(testPath, extension) {
      const marker = `${sep}tests${sep}`;
      const index = testPath.lastIndexOf(marker);
      if (index === -1) {
        return `${testPath}${extension}`;
      }

      const testRoot = testPath.slice(0, index + marker.length - 1);
      return join(testRoot, "__snapshots__", `${basename(testPath)}${extension}`);
    },
    coverage: { enabled: false }
  }
});
