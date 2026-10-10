/**
 * The manifest `initiative-plugin build` wrote from the plug-in's definition, and the
 * registry listing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest, type Manifest } from "initiative-plugin-sdk/manifest";
import { describe, expect, it } from "vitest";

import { ACCOUNT, LISTING_UID, READ, READ_IDS, WORKSPACE } from "../src/vocabulary.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "..", "registry", "sources", "beyonders-studio", LISTING_UID);
const read = <T>(path: string) => JSON.parse(readFileSync(path, "utf-8")) as T;
const packageVersion = read<{ version: string }>(join(root, "package.json")).version;
const manifest = read<Manifest>(join(root, "manifest.json"));
/**
 * The last version that ran as a service beside Initiative, as published: its
 * ids start `app.` and its kind is `app_kind`, where this version says `plugin.`
 * and `plugin_kind`.
 */
const service = read<Manifest>(join(source, "2.6.0", "manifest.json"));

/** A value with every endpoint id reduced to its bare name, so 2.6.0's and this version's compare. */
function unprefixed<T>(value: T): T {
  if (typeof value === "string") return value.replace(/^(app|plugin)\.beyonders-studio\.github\./, "") as T;
  if (Array.isArray(value)) return value.map(unprefixed) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, unprefixed(inner)])) as T;
  }
  return value;
}

/** Whether one dotted version is later than another. */
function later(a: string, b: string): boolean {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index += 1) {
    if (x[index] !== y[index]) return x[index] > y[index];
  }
  return false;
}

const connection = (id: string) => manifest.connections!.find((one) => one.id === id)!;

describe("manifest", () => {
  it("passes the SDK's validation", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("declares fifteen reads, seven writes and six announcements", () => {
    const counts: Record<string, number> = {};
    for (const endpoint of manifest.endpoints ?? []) counts[endpoint.direction] = (counts[endpoint.direction] ?? 0) + 1;
    expect(counts).toEqual({ read: 15, write: 7, emit: 6 });
  });

  it("is declarative: Initiative calls GitHub itself, and runs no service", () => {
    expect(manifest.hosts).toEqual(["api.github.com"]);
    expect(Object.keys(manifest).sort()).toEqual(
      [
        ...Object.keys(service)
          .filter((key) => key !== "service" && key !== "schedules")
          .map((key) => (key === "app_kind" ? "plugin_kind" : key)),
        "hosts",
        "min_plugin_api",
      ].sort()
    );
  });

  it("needs plug-in API contract 6.0, the SDK it is built against", () => {
    expect(manifest.min_plugin_api).toBe("6.0");
  });

  it("keeps every endpoint 2.6.0 had as it was, and adds the review queue", () => {
    const terms = ({ id, direction, params, returns, public: open, actors, identity }: NonNullable<Manifest["endpoints"]>[number]) =>
      ({ id, direction, params, returns, public: open, actors, identity });
    const before = unprefixed(service.endpoints!.map(terms));
    const after = unprefixed(manifest.endpoints!.map(terms));
    expect(after.filter((endpoint) => endpoint.id !== READ.reviewQueue)).toEqual(before);
    expect(after.find((endpoint) => endpoint.id === READ.reviewQueue)).toEqual({
      ...before.find((endpoint) => endpoint.id === READ.findPullRequests),
      id: READ.reviewQueue,
      params: before
        .find((endpoint) => endpoint.id === READ.findPullRequests)!
        .params!.filter((param) => param.key !== "review_requested"),
      actors: ["member"],
    });
  });

  it("names every endpoint, widget and connection in four languages", () => {
    const texts = [
      ...(manifest.endpoints ?? []).flatMap((endpoint) => [endpoint.label, endpoint.description]),
      ...(manifest.widgets ?? []).flatMap((widget) => [
        (widget.meta as Record<string, unknown>).name,
        (widget.meta as Record<string, unknown>).description,
      ]),
      ...(manifest.connections ?? []).map((connection) => connection.label),
      manifest.vendor!.label,
      ...manifest.vendor!.fields.map((field) => field.label),
    ];
    for (const localized of texts) expect(Object.keys(localized as object).sort()).toEqual(["de", "en", "es", "fr"]);
  });

  it("makes every write run as the member, never as the plug-in", () => {
    for (const endpoint of (manifest.endpoints ?? []).filter((one) => one.direction === "write")) {
      expect(endpoint.actors).toEqual(["member"]);
      expect(endpoint.requires).toEqual({ all_of: ["workspace", "account"] });
    }
  });

  it("offers every read and write to other plug-ins, and no announcement", () => {
    for (const endpoint of manifest.endpoints ?? []) {
      if (endpoint.direction === "emit") {
        expect(endpoint.public).toBeUndefined();
        continue;
      }
      expect(endpoint.public).toBe(true);
      expect(endpoint.admin_only).toBeUndefined();
      if (endpoint.direction === "read" && endpoint.id !== READ_IDS.reviewQueue) {
        expect(endpoint.actors).toEqual(["installation", "member"]);
        expect(endpoint.requires).toEqual({ all_of: ["workspace"] });
      }
    }
  });

  it("has Initiative run both GitHub connections with the GitHub App's own values", () => {
    expect(manifest.vendor!.fields.map((field) => [field.key, field.type, field.required])).toEqual([
      ["client_id", "string", true],
      ["client_secret", "secret", true],
      ["app_slug", "string", true],
      ["app_id", "string", true],
      ["private_key", "secret", true],
      ["webhook_secret", "secret", true],
    ]);
    expect(manifest.webhooks).toEqual({
      verify: {
        scheme: "hmac_sha256",
        header: "X-Hub-Signature-256",
        prefix: "sha256=",
        encoding: "hex",
        secret: "{vendor.webhook_secret}",
      },
      dedup: "X-GitHub-Delivery",
      route: { path: "installation.id", connection: WORKSPACE, field: "installation_id" },
      events: expect.any(Array),
      status: expect.any(Array),
    });
    expect(manifest.webhooks!.events!.map((event) => event.emit)).toEqual(
      manifest.endpoints!.filter((endpoint) => endpoint.direction === "emit").map((endpoint) => endpoint.id)
    );

    const workspace = connection(WORKSPACE);
    expect(workspace.scope).toBe("static");
    expect(workspace.flow).toMatchObject({
      client_id: "{vendor.client_id}",
      client_secret: "{vendor.client_secret}",
      install_url: "https://github.com/apps/{vendor.app_slug}/installations/new",
      after_connect: { code: "installation-not-held" },
    });
    expect(workspace.flow!.revoke).toBeUndefined();
    expect(workspace.token).toEqual({
      type: "jwt_bearer",
      exchange_url: "https://api.github.com/app/installations/{installation_id}/access_tokens",
      iss: "{vendor.app_id}",
      key: "{vendor.private_key}",
      alg: "RS256",
      lifetime: 540,
    });
    expect(workspace.fields.every((field) => field.managed)).toBe(true);
    expect(workspace.health).toMatchObject({ every: "15m" });

    const account = connection(ACCOUNT);
    expect(account.scope).toBe("interactive");
    // Initiative ends a member's authorization at GitHub with the GitHub App's own values.
    expect(account.flow).toMatchObject({
      after_connect: { map: expect.stringContaining("account_label") },
      revoke: "github_grant",
      revoke_url: "https://api.github.com/applications/{vendor.client_id}/grant",
    });
    expect(account.flow!.install_url).toBeUndefined();
    // The tokens Initiative keeps are never declared as fields.
    expect(account.fields).toEqual([]);
  });

  it("lets Initiative create the GitHub App the README registers, filling all six values", () => {
    expect(manifest.vendor!.setup).toEqual({
      kind: "github_app_manifest",
      app: {
        name: "Initiative",
        url: "https://github.com/beyonders-studio/initiative-developer/tree/main/plugins/github",
        public: false,
        default_permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "read",
          vulnerability_alerts: "read",
          organization_projects: "write",
          metadata: "read",
        },
        default_events: ["issues", "pull_request", "release", "create"],
      },
      values: {
        client_id: "client_id",
        client_secret: "client_secret",
        app_slug: "slug",
        app_id: "id",
        private_key: "pem",
        webhook_secret: "webhook_secret",
      },
    });
  });

  it("is listed in the registry, with a registration by declaration", () => {
    const listing = read<Record<string, any>>(join(source, "listing.json"));
    expect(listing).toMatchObject({ uid: LISTING_UID, public_id: "beyonders-studio.github", publisher: "beyonders-studio" });
    expect(listing.registration).toEqual({ kind: "declarative", scope_ceiling: [], reference_sectors: [] });
    // Between releases the plug-in runs ahead of what the listing publishes, never behind it.
    expect(packageVersion === listing.versions[0].version || later(packageVersion, listing.versions[0].version)).toBe(true);
  });
});
