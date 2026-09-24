import { readFileSync, rmSync } from "node:fs";

const path = process.argv[2] ?? ".vitest-result.json";
let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`could not read the run report at ${path}: ${error.message}`);
  process.exit(1);
}
rmSync(path, { force: true });

const total = report.numTotalTests ?? 0;
const ran = (report.numPassedTests ?? 0) + (report.numFailedTests ?? 0);

if (total === 0) {
  console.error("the run selected no tests at all");
  process.exit(1);
}
if (ran === 0) {
  console.error(
    `the run selected ${total} test(s) and executed none of them — ` +
      "every one was skipped, which is not a pass",
  );
  process.exit(1);
}
console.log(`${ran} of ${total} test(s) executed`);
