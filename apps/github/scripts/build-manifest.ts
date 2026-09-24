/**
 * Write `manifest.json` and the registry source `listing.json` (which carries
 * the same manifest inline) from their sources, after the kit has validated
 * the manifest. With `--check`, write nothing and fail when
 * either committed file differs from what would be written.
 *
 *   npm run manifest          # write both
 *   npm run manifest:check    # CI
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "initiative-app-kit";

import { listingEntry } from "../src/listing.config.js";
import { manifest } from "../src/manifest.config.js";

// dist/scripts/ → the app's own directory.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const check = process.argv.includes("--check");

const problems = validateManifest(manifest);
if (problems.length) {
  for (const problem of problems) console.error(`manifest${problem.where}: ${problem.message}`);
  process.exit(1);
}

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const avatar = readFileSync(join(root, "assets", "avatar.png"));
const listingText = `${JSON.stringify(listingEntry(manifest, avatar), null, 2)}\n`;

let stale = false;
for (const [name, text] of [
  ["manifest.json", manifestText],
  ["listing.json", listingText],
] as const) {
  const path = join(root, name);
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf-8");
    } catch {
      current = "";
    }
    if (current !== text) {
      console.error(`${name} is out of date: run npm run manifest`);
      stale = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${name}`);
  }
}
process.exit(stale ? 1 : 0);
