/**
 * The app's registry source listing: what the catalogue shows, the versions it
 * offers with their manifests inline, and the registration a deployment reads
 * the app's keys and ceiling from. Its avatar sits beside it, under `assets/`.
 *
 * Two values are placeholders until a release is cut, both in a shape the
 * registry accepts: the image digest (all zeros) comes from the image build,
 * and the key set is replaced by the public half of the key the app signs
 * with (`initiative-app keygen` writes it as `jwks.json`).
 *
 * The "GitHub overview" dashboard is not a listing of its own here: it is
 * bundled in the manifest, and a deployment publishes it from there.
 */

import { createHash } from "node:crypto";

import type { Manifest } from "initiative-app-kit";

import { LISTING_UID, PUBLIC_ID, SCOPES } from "./vocabulary.js";

export const VERSION = "1.0.0";

/** The oldest Initiative that serves this app's installation calls. */
export const MIN_APP_VERSION = "0.73.0";

export const IMAGE_PLACEHOLDER = `ghcr.io/morelitea/initiative-github@sha256:${"0".repeat(64)}`;

export const KEY_PLACEHOLDER = {
  kty: "EC",
  crv: "P-256",
  alg: "ES256",
  use: "sig",
  kid: "filled-at-release",
};

export function listingEntry(manifest: Manifest, avatar: Buffer): Record<string, unknown> {
  return {
    schema: 1,
    uid: LISTING_UID,
    public_id: PUBLIC_ID,
    publisher: "morelitea",
    kind: "app",
    name: "GitHub",
    summary: "Your organization's issues, reviews and dependency alerts, on a dashboard and in your automations.",
    description: [
      "Bring a GitHub organization into your community.",
      "",
      "An admin connects the organization once, on GitHub's own install page, and picks the repositories the app may see. Dashboards then show open issues, pull requests waiting on review, Dependabot alerts and a fortnight of throughput for everyone, with nobody pasting a token.",
      "",
      "Members who connect their own GitHub account get their own review queue, and automations can open, comment on, close, label and move issues as them.",
    ].join("\n"),
    avatar: { path: "assets/avatar.png", sha256: createHash("sha256").update(avatar).digest("hex") },
    versions: [
      {
        version: VERSION,
        manifest,
        min_app_version: MIN_APP_VERSION,
        release_notes:
          "Rewritten on the installation-token platform. Existing installs are removed and installed again, then the GitHub organization is connected again.",
      },
    ],
    registration: {
      kind: "container",
      image: IMAGE_PLACEHOLDER,
      jwks: { keys: [KEY_PLACEHOLDER] },
      scope_ceiling: [...SCOPES],
      reference_sectors: [],
    },
  };
}
