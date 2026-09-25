/** Initiative's calls are taken only on a context token the kit verifies, for the endpoint called. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { READ_IDS, WRITE_IDS } from "../src/vocabulary.js";
import { startHarness, type Harness } from "./support/harness.js";
import { stranger } from "./support/keys.js";

const INSTALLATION = "gapp_one";
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install(INSTALLATION);
  h.github.install(42);
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

describe("context verification", () => {
  it("refuses a call with no token", async () => {
    const response = await fetch(`${h.url}/v1/endpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: READ_IDS.listRepositories, params: {} }),
    });
    expect(response.status).toBe(401);
  });

  const refusals: Array<[string, (h: Harness) => string]> = [
    ["a token signed by a key the deployment never published", (h) =>
      h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories, { key: stranger.privateKeyPem })],
    ["a token for another app", (h) =>
      h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories, { claims: { aud: "initiative-app:acme.other" } })],
    ["a token from another issuer", (h) =>
      h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories, { claims: { iss: "elsewhere" } })],
    ["an expired token", (h) =>
      h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories, {
        claims: { iat: Math.floor(Date.now() / 1000) - 600, exp: Math.floor(Date.now() / 1000) - 300 },
      })],
    ["a connect return presented as a context token", (h) => h.initiative.connectReturn(INSTALLATION, "account", "cref_x")],
    ["something that is not a JWT", () => "not-a-token"],
  ];

  for (const [what, token] of refusals) {
    it(`refuses ${what}`, async () => {
      const { status, body } = await h.invoke(INSTALLATION, READ_IDS.listRepositories, {}, { token: token(h) });
      expect(status).toBe(401);
      expect(body.error).toBe("unauthorized");
      expect(h.github.calls).toHaveLength(0);
    });
  }

  it("refuses a token minted for a different endpoint", async () => {
    const token = h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories);
    const { status, body } = await h.invoke(INSTALLATION, WRITE_IDS.openIssue, { repo: "widgets", title: "x" }, { token });
    expect(status).toBe(400);
    expect(body.detail).toContain("this token is for");
    expect(h.github.calls).toHaveLength(0);
  });

  it("refuses a lifecycle notice presented as an endpoint call", async () => {
    const token = h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories, { claims: { scope: "lifecycle" } });
    const { status } = await h.invoke(INSTALLATION, READ_IDS.listRepositories, {}, { token });
    expect(status).toBe(400);
  });

  it("refuses an endpoint the app does not declare", async () => {
    const endpoint = "app.morelitea.github.delete-repository";
    const { status, body } = await h.invoke(INSTALLATION, endpoint, {});
    expect(status).toBe(400);
    expect(body.detail).toContain("does not offer");
  });

  it("takes the community from the token, never from the body", async () => {
    h.initiative.install("gapp_two", { workspace: null });
    const token = h.initiative.contextToken("gapp_two", READ_IDS.listRepositories);
    const response = await fetch(`${h.url}/v1/endpoints`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: READ_IDS.listRepositories, guild_ref: INSTALLATION, params: {} }),
    });
    expect(((await response.json()) as { result: unknown }).result).toEqual({ unavailable: "not-configured" });
  });
});

describe("health", () => {
  it("is alive at once and ready after the first sync", async () => {
    expect((await fetch(`${h.url}/healthz`)).status).toBe(200);
    expect((await fetch(`${h.url}/readyz`)).status).toBe(503);
    await h.sync.run();
    expect((await fetch(`${h.url}/readyz`)).status).toBe(200);
  });

  it("publishes the app's own public key", async () => {
    const jwks = (await (await fetch(`${h.url}/.well-known/jwks.json`)).json()) as { keys: Array<Record<string, unknown>> };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: "app-1", kty: "EC" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });

  it("lists what it declares", async () => {
    const body = (await (await fetch(`${h.url}/v1/endpoints`)).json()) as { endpoints: unknown[] };
    expect(body.endpoints).toHaveLength(21);
  });
});
