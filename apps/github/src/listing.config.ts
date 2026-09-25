/**
 * The app's registry source listing: what the catalogue shows, the versions it
 * offers, and the registration a deployment reads the app's keys and ceiling
 * from. `npm run manifest` writes it under `registry/sources/morelitea/<uid>/`,
 * beside each version's definition (`<version>/manifest.json`) and the avatar
 * (`assets/avatar.png`).
 *
 * `IMAGE` is the digest the image workflow printed for this version, and
 * `JWKS` the public half of the key the app signs its token requests with.
 *
 * The "GitHub overview" dashboard is not a listing of its own here: it is
 * bundled in the manifest, and a deployment publishes it from there.
 */

import { createHash } from "node:crypto";

import { LISTING_UID, PUBLIC_ID, SCOPES } from "./vocabulary.js";

export const VERSION = "2.0.0";

/**
 * The oldest Initiative that runs this app's connections. Development builds
 * report the last release until the next one, and no release before the next
 * one follows the registry, so this admits development builds and every later
 * release.
 */
export const MIN_APP_VERSION = "0.72.0";

/** The image this version runs, pinned by digest. */
export const IMAGE =
  "ghcr.io/morelitea/initiative-github@sha256:8f3b4e230c19c257d71a10429d34b85260384157bbaeb9c63a3911475e252929";

/** The public key the app's token requests are verified with. */
export const JWKS = {
  keys: [
    {"kty": "EC", "kid": "github-1", "alg": "ES256", "use": "sig", "crv": "P-256", "x": "AnzMCoYTwqIVaUH3j-djW2xSDIf3TAH1GyKkxMGqkcs", "y": "4BuzhHAZZ8LS7CZcb_Pz415ae8tD01N7cwGERgJgujk"},
  ],
};

/** Where each version's definition sits, beside the listing. */
export const DEFINITION_PATH = `${VERSION}/manifest.json`;

export function listingEntry(avatar: Buffer): Record<string, unknown> {
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
        definition: DEFINITION_PATH,
        min_app_version: MIN_APP_VERSION,
        release_notes:
          "Initiative now runs the GitHub sign-ins and holds the tokens. Each member connects their GitHub account again, once.",
      },
    ],
    registration: {
      kind: "container",
      image: IMAGE,
      jwks: JWKS,
      scope_ceiling: [...SCOPES],
      reference_sectors: [],
    },
  };
}
