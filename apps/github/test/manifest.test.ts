/** The manifest, the committed artifacts built from it, and the settings the app starts with. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "initiative-app-kit";
import { describe, expect, it } from "vitest";

import { ConfigError, ENVIRONMENT, loadConfig } from "../src/config.js";
import { listingEntry } from "../src/listing.config.js";
import { manifest } from "../src/manifest.config.js";
import { SCOPES } from "../src/vocabulary.js";
import { githubAppKey, appKey } from "./support/keys.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("manifest", () => {
  it("passes the kit's validation", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("declares eleven reads, seven writes and three announcements", () => {
    const counts: Record<string, number> = {};
    for (const endpoint of manifest.endpoints ?? []) counts[endpoint.direction] = (counts[endpoint.direction] ?? 0) + 1;
    expect(counts).toEqual({ read: 11, write: 7, emit: 3 });
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
    ];
    for (const localized of texts) expect(Object.keys(localized as object).sort()).toEqual(["de", "en", "es", "fr"]);
  });

  it("makes every write run as the member, never as the app", () => {
    for (const endpoint of (manifest.endpoints ?? []).filter((one) => one.direction === "write")) {
      expect(endpoint.actors).toEqual(["member"]);
      expect(endpoint.requires).toEqual({ all_of: ["workspace", "account"] });
    }
  });

  it("is what manifest.json holds", () => {
    expect(readFileSync(join(root, "manifest.json"), "utf-8")).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it("is what listing.json carries, with the ceiling and a registration by container", () => {
    const avatar = readFileSync(join(root, "assets", "avatar.png"));
    const listing = JSON.parse(readFileSync(join(root, "listing.json"), "utf-8"));
    expect(listing).toEqual(listingEntry(manifest, avatar));
    expect(listing.versions[0].manifest).toEqual(manifest);
    expect(listing.registration).toMatchObject({ kind: "container", scope_ceiling: [...SCOPES], reference_sectors: [] });
  });
});

describe("settings", () => {
  const env = {
    APP_PUBLIC_URL: "https://github-app.example.com/",
    INITIATIVE_BASE_URL: "http://initiative:8173/api/v1",
    INITIATIVE_APP_PRIVATE_KEY: Buffer.from(appKey.privateKeyPem).toString("base64"),
    INITIATIVE_APP_KEY_ID: "app-1",
    GITHUB_CLIENT_ID: "Iv1.x",
    GITHUB_CLIENT_SECRET: "s",
    GITHUB_APP_PRIVATE_KEY: githubAppKey.replaceAll("\n", "\\n"),
    GITHUB_WEBHOOK_SECRET: "w",
  };

  it("reads every required setting, and keys as PEM, escaped PEM or base64", () => {
    const config = loadConfig(env);
    expect(config.publicUrl).toBe("https://github-app.example.com");
    expect(config.initiative.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(config.github.privateKey).toContain("\n");
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
    expect(() => loadConfig({ ...env, GITHUB_APP_PRIVATE_KEY: "not a key" })).toThrow(/not a PEM private key/);
  });
});
