/** The manifest, the committed artifacts built from it, and the settings the app starts with. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "initiative-app-kit";
import { describe, expect, it } from "vitest";

import { ConfigError, ENVIRONMENT, loadConfig } from "../src/config.js";
import { listingEntry, VERSION } from "../src/listing.config.js";
import { manifest } from "../src/manifest.config.js";
import { ACCOUNT, LISTING_UID, SCOPES, WORKSPACE } from "../src/vocabulary.js";
import { appKey } from "./support/keys.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }).version;

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
  it("passes the kit's validation", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("declares fourteen reads, seven writes and six announcements", () => {
    const counts: Record<string, number> = {};
    for (const endpoint of manifest.endpoints ?? []) counts[endpoint.direction] = (counts[endpoint.direction] ?? 0) + 1;
    expect(counts).toEqual({ read: 14, write: 7, emit: 6 });
  });

  it("asks for exactly the scopes it was cleared for", () => {
    expect(manifest.service.scopes).toEqual([
      "projects:read",
      "projects:write",
      "comments:write",
      "members:read",
      "initiatives:read",
      "tags:read",
    ]);
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

  it("makes every write run as the member, never as the app", () => {
    for (const endpoint of (manifest.endpoints ?? []).filter((one) => one.direction === "write")) {
      expect(endpoint.actors).toEqual(["member"]);
      expect(endpoint.requires).toEqual({ all_of: ["workspace", "account"] });
    }
  });

  it("offers every read and write to other apps, and no announcement", () => {
    for (const endpoint of manifest.endpoints ?? []) {
      if (endpoint.direction === "emit") {
        expect(endpoint.public).toBeUndefined();
        continue;
      }
      expect(endpoint.public).toBe(true);
      expect(endpoint.admin_only).toBeUndefined();
      if (endpoint.direction === "read") expect(endpoint.actors).toEqual(["installation", "member"]);
    }
  });

  it("has Initiative run both GitHub connections with the GitHub App's own values", () => {
    expect(manifest.vendor!.fields.map((field) => [field.key, field.type, field.required])).toEqual([
      ["client_id", "string", true],
      ["client_secret", "secret", true],
      ["app_slug", "string", true],
      ["app_id", "string", true],
      ["private_key", "secret", true],
    ]);

    const workspace = connection(WORKSPACE);
    expect(workspace.scope).toBe("static");
    expect(workspace.flow).toMatchObject({
      client_id: "{vendor.client_id}",
      client_secret: "{vendor.client_secret}",
      install_url: "https://github.com/apps/{vendor.app_slug}/installations/new",
      after_connect: true,
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

    const account = connection(ACCOUNT);
    expect(account.scope).toBe("interactive");
    expect(account.flow).toMatchObject({ after_connect: true, revoke: "hook" });
    expect(account.flow!.install_url).toBeUndefined();
    // The tokens Initiative keeps are never declared as fields.
    expect(account.fields).toEqual([]);
  });

  it("is what manifest.json holds", () => {
    expect(readFileSync(join(root, "manifest.json"), "utf-8")).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it("is what the registry source carries once listed, with the ceiling and a registration by container", () => {
    const source = join(root, "..", "..", "registry", "sources", "morelitea", LISTING_UID);
    const avatar = readFileSync(join(root, "assets", "avatar.png"));
    const listing = JSON.parse(readFileSync(join(source, "listing.json"), "utf-8"));
    expect(listing).toEqual(listingEntry(avatar));
    expect(listing.registration).toMatchObject({ kind: "container", scope_ceiling: [...SCOPES], reference_sectors: [] });
    expect(listing.registration.jwks.keys[0]).toMatchObject({ kty: "EC", kid: "github-1", alg: "ES256" });
    if (packageVersion === VERSION) {
      const definition = JSON.parse(readFileSync(join(source, listing.versions[0].definition), "utf-8"));
      expect(definition).toEqual(manifest);
    } else {
      // Between releases the app runs ahead of what the listing publishes, never behind it.
      expect(later(packageVersion, VERSION)).toBe(true);
    }
  });
});

describe("settings", () => {
  const env = {
    INITIATIVE_BASE_URL: "http://initiative:8173/api/v1/",
    INITIATIVE_APP_PRIVATE_KEY: Buffer.from(appKey.privateKeyPem).toString("base64"),
    INITIATIVE_APP_KEY_ID: "app-1",
    GITHUB_CLIENT_ID: "Iv1.x",
    GITHUB_CLIENT_SECRET: "s",
    GITHUB_WEBHOOK_SECRET: "w",
  };

  it("reads every required setting, and keys as PEM, escaped PEM or base64", () => {
    const config = loadConfig(env);
    expect(config.initiative.baseUrl).toBe("http://initiative:8173/api/v1");
    expect(config.initiative.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(loadConfig({ ...env, INITIATIVE_APP_PRIVATE_KEY: appKey.privateKeyPem.replaceAll("\n", "\\n") }).initiative.privateKey).toContain("\n");
    expect(config.github.apiBase).toBe("https://api.github.com");
    expect(config.port).toBe(8080);
  });

  it("refuses to start without one, naming it", () => {
    for (const name of ENVIRONMENT.required) {
      const partial: Record<string, string> = { ...env };
      delete partial[name];
      expect(() => loadConfig(partial)).toThrow(new ConfigError(`missing required settings: ${name}`));
    }
  });

  it("refuses a key that is not a PEM private key", () => {
    expect(() => loadConfig({ ...env, INITIATIVE_APP_PRIVATE_KEY: "not a key" })).toThrow(/not a PEM private key/);
  });
});
