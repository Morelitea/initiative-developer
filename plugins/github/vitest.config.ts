import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Finding no test files is a failure, not a pass. scripts/assert-tests-ran.mjs
    // covers the other half: files found and every test inside them skipped.
    passWithNoTests: false,
  },
});
