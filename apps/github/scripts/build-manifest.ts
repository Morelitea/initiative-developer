/**
 * Write `manifest.json`, and the app's registry source under
 * `registry/sources/morelitea/<uid>/` (the listing, this version's definition
 * and the avatar), from their sources, after the kit has validated the
 * manifest. With `--check`, write nothing and fail when any committed file
 * differs from what would be written.
 *
 * The registry source is written only while the listing names the version in
 * `package.json`. Between releases the app's version runs ahead of the
 * listing, and the definition the listing already publishes is left as it
 * was: a new version is listed at its release, with its image's digest.
 *
 *   npm run manifest          # write both
 *   npm run manifest:check    # CI
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "initiative-app-kit";

import { DEFINITION_PATH, listingEntry, VERSION } from "../src/listing.config.js";
import { manifest } from "../src/manifest.config.js";
import { LISTING_UID } from "../src/vocabulary.js";

// dist/scripts/ → the app's own directory.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The listing's source, in the registry beside the other listings.
const source = join(root, "..", "..", "registry", "sources", "morelitea", LISTING_UID);
const check = process.argv.includes("--check");
const packageVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }).version;
const listed = packageVersion === VERSION;

const problems = validateManifest(manifest);
if (problems.length) {
  for (const problem of problems) console.error(`manifest${problem.where}: ${problem.message}`);
  process.exit(1);
}

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const avatar = readFileSync(join(root, "assets", "avatar.png"));
const listingText = `${JSON.stringify(listingEntry(avatar), null, 2)}\n`;

const outputs: Array<readonly [string, string | Buffer]> = [[join(root, "manifest.json"), manifestText]];
if (listed) {
  outputs.push(
    [join(source, "listing.json"), listingText],
    [join(source, DEFINITION_PATH), manifestText],
    [join(source, "assets", "avatar.png"), avatar]
  );
} else {
  console.log(`the registry source lists ${VERSION}; ${packageVersion} is listed at its release`);
}

let stale = false;
for (const [path, content] of outputs) {
  const name = path.slice(join(root, "..", "..").length + 1);
  if (check) {
    let current: Buffer | null = null;
    try {
      current = readFileSync(path);
    } catch {
      current = null;
    }
    if (!current || !current.equals(Buffer.from(content))) {
      console.error(`${name} is out of date: run npm run manifest`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${name}`);
  }
}
process.exit(stale ? 1 : 0);
