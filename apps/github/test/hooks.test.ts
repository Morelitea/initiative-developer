/**
 * The hooks Initiative calls while it runs the GitHub connections: taken only
 * on a lifecycle token for the hook called; `after_connect` checking an
 * organization's installation against the admin's own and naming a member's
 * account; `revoke` ending a member's authorization at GitHub; and `schedule`
 * reporting whether the organization's installation still exists.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DETAILS, UNAVAILABLE_CHECKS } from "../src/hooks.js";
import { CHECK_INSTALLATION, READ_IDS } from "../src/vocabulary.js";
import { CLIENT_ID, CLIENT_SECRET, startHarness, type Harness } from "./support/harness.js";
import { stranger } from "./support/keys.js";

const INSTALLATION = "gapp_one";
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install(INSTALLATION, { workspace: null });
  h.github.install(42);
});

afterEach(() => h.close());

const installed = (installationId: string) => ({
  connection: "workspace",
  actor: "installation",
  access_token: "ghu_admin",
  params: { installation_id: installationId },
});

const authorized = { connection: "account", actor: "member", access_token: "ghu_alice", params: {} };

describe("the lifecycle token", () => {
  it("is required", async () => {
    const response = await fetch(`${h.url}/v1/hooks/after_connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authorized),
    });
    expect(response.status).toBe(401);
  });

  const refusals: Array<[string, (h: Harness) => string]> = [
    ["a token minted for the other hook", (h) => h.initiative.hookToken(INSTALLATION, "revoke")],
    ["an endpoint call's token", (h) => h.initiative.contextToken(INSTALLATION, READ_IDS.listRepositories)],
    ["a token signed by a key the deployment never published", (h) =>
      h.initiative.hookToken(INSTALLATION, "after_connect", { key: stranger.privateKeyPem })],
    ["a token for another app", (h) =>
      h.initiative.hookToken(INSTALLATION, "after_connect", { claims: { aud: "initiative-app:acme.other" } })],
  ];

  for (const [what, token] of refusals) {
    it(`refuses ${what}`, async () => {
      h.github.users.set("ghu_alice", "alice");
      const { status } = await h.hook(INSTALLATION, "after_connect", authorized, { token: token(h) });
      expect(status).toBe(401);
      expect(h.github.calls).toHaveLength(0);
    });
  }

  it("answers 404 for a hook the app does not have", async () => {
    const { status } = await h.hook(INSTALLATION, "before_connect", authorized);
    expect(status).toBe(404);
  });
});

describe("after_connect for the organization", () => {
  it("records the installation the admin holds, with its account", async () => {
    h.github.userInstallations.set("ghu_admin", [{ id: 42, login: "acme" }]);
    const { status, body } = await h.hook(INSTALLATION, "after_connect", installed("42"));
    expect(status).toBe(200);
    expect(body).toEqual({ values: { owner: "acme", installation_id: 42 }, account_label: "acme" });
    // Asked as the admin, with the token Initiative handed over.
    expect(h.github.callsTo("GET", "/user/installations?per_page=100")[0].token).toBe("ghu_admin");
  });

  it("refuses an installation the admin does not hold", async () => {
    h.github.userInstallations.set("ghu_admin", [{ id: 77, login: "other" }]);
    const { status, body } = await h.hook(INSTALLATION, "after_connect", installed("42"));
    expect(status).toBe(200);
    expect(body).toEqual({ refuse: true });
  });

  it("refuses an installation id that is not one", async () => {
    const { body } = await h.hook(INSTALLATION, "after_connect", installed("42; drop"));
    expect(body).toEqual({ refuse: true });
    expect(h.github.calls).toHaveLength(0);
  });

  it("fails, so nothing is recorded, when GitHub will not list the admin's installations", async () => {
    const { status } = await h.hook(INSTALLATION, "after_connect", installed("42"));
    expect(status).toBe(500);
    expect(h.logs.some((line) => line.startsWith("error after_connect for workspace failed"))).toBe(true);
  });

  it("refuses the organization's connection made as a member", async () => {
    h.github.userInstallations.set("ghu_admin", [{ id: 42, login: "acme" }]);
    const { body } = await h.hook(INSTALLATION, "after_connect", { ...installed("42"), actor: "member" });
    expect(body).toEqual({ refuse: true });
  });
});

describe("after_connect for a member's account", () => {
  it("names the account by its login", async () => {
    h.github.users.set("ghu_alice", "alice");
    const { status, body } = await h.hook(INSTALLATION, "after_connect", authorized);
    expect(status).toBe(200);
    expect(body).toEqual({ account_label: "alice" });
  });

  it("fails when GitHub will not say whose the token is", async () => {
    const { status } = await h.hook(INSTALLATION, "after_connect", authorized);
    expect(status).toBe(500);
  });

  it("refuses a connection the app does not declare", async () => {
    const { body } = await h.hook(INSTALLATION, "after_connect", { ...authorized, connection: "billing" });
    expect(body).toEqual({ refuse: true });
  });
});

describe("revoke", () => {
  const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;

  it("ends the member's authorization at GitHub, as the GitHub App's client", async () => {
    const { status } = await h.hook(INSTALLATION, "revoke", {
      connection: "account",
      access_token: "ghu_alice",
      refresh_token: "ghr_alice",
    });
    expect(status).toBe(204);
    expect(h.github.revoked).toEqual(["ghu_alice"]);
    const call = h.github.callsTo("DELETE", `/applications/${CLIENT_ID}/grant`)[0];
    expect(call.token).toBe(basic);
    // A live access token needs no refresh first.
    expect(h.github.exchanges).toHaveLength(0);
  });

  it("renews a lapsed access token to end the authorization, since GitHub names it by a live one", async () => {
    h.github.lapsed.add("ghu_old");
    h.github.refreshes.set("ghr_alice", { access_token: "ghu_new", refresh_token: "ghr_2", expires_in: 28800 });
    const { status } = await h.hook(INSTALLATION, "revoke", {
      connection: "account",
      access_token: "ghu_old",
      refresh_token: "ghr_alice",
    });
    expect(status).toBe(204);
    expect(h.github.revoked).toEqual(["ghu_new"]);
    const exchange = h.github.exchanges[0];
    expect(exchange.get("grant_type")).toBe("refresh_token");
    expect(exchange.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("is done when GitHub recognizes neither token", async () => {
    h.github.lapsed.add("ghu_old");
    const { status } = await h.hook(INSTALLATION, "revoke", {
      connection: "account",
      access_token: "ghu_old",
      refresh_token: "ghr_spent",
    });
    expect(status).toBe(204);
    expect(h.github.revoked).toEqual([]);
  });

  it("fails, so Initiative tries again, when GitHub answers with an error", async () => {
    h.github.revokeStatus = 502;
    const { status } = await h.hook(INSTALLATION, "revoke", { connection: "account", access_token: "ghu_alice" });
    expect(status).toBe(500);
  });

  it("sends nothing for the organization's connection, whose user token was never kept", async () => {
    const { status } = await h.hook(INSTALLATION, "revoke", { connection: "workspace", access_token: "ghu_admin" });
    expect(status).toBe(204);
    expect(h.github.calls).toHaveLength(0);
  });
});

describe("schedule check-installation", () => {
  beforeEach(() => {
    h.initiative.install(INSTALLATION);
  });

  async function check(): Promise<number> {
    const { status } = await h.hook(INSTALLATION, "schedule", { schedule: CHECK_INSTALLATION, since: null });
    return status;
  }

  const statuses = () => h.initiative.installs.get(INSTALLATION)!.statuses;

  it("reports ok while the organization's installation exists, once", async () => {
    expect(await check()).toBe(204);
    expect(await check()).toBe(204);
    expect(statuses()).toEqual([{ state: "ok" }]);
    // The installation token was asked of Initiative by the community connection's handle.
    expect(h.initiative.installs.get(INSTALLATION)!.tokenAsks).toContain(`cref_ws_${INSTALLATION}`);
  });

  it("reports the installation removed once GitHub stops honouring its token", async () => {
    await check();
    // Initiative still hands out the token it minted; GitHub no longer takes it.
    h.github.installations.delete(42);
    expect(await check()).toBe(204);
    expect(statuses()).toEqual([{ state: "ok" }, { state: "invalid", detail: DETAILS.removed }]);
  });

  it("reports invalid while the organization has suspended the installation, and ok once it is back", async () => {
    await check();
    h.github.installations.get(42)!.suspended = true;
    await check();
    h.github.installations.get(42)!.suspended = false;
    await check();
    expect(statuses()).toEqual([{ state: "ok" }, { state: "invalid", detail: DETAILS.suspended }, { state: "ok" }]);
  });

  it("reports unavailable only after several checks on which Initiative could get no token", async () => {
    h.github.installations.delete(42);
    for (let count = 1; count < UNAVAILABLE_CHECKS; count += 1) await check();
    expect(statuses()).toEqual([]);
    await check();
    await check();
    expect(statuses()).toEqual([{ state: "invalid", detail: DETAILS.unavailable }]);
  });

  it("keeps a removal it reported rather than calling it unavailable later", async () => {
    await check();
    h.github.installations.delete(42);
    await check();
    // Initiative's minted token has lapsed, and GitHub mints no other.
    h.initiative.installs.get(INSTALLATION)!.minted = null;
    for (let count = 0; count < UNAVAILABLE_CHECKS + 1; count += 1) await check();
    expect(statuses().at(-1)).toEqual({ state: "invalid", detail: DETAILS.removed });
  });

  it("fails, so Initiative tries again, when Initiative itself could not be asked", async () => {
    h.initiative.connectionTokenFails = 503;
    expect(await check()).toBe(500);
    expect(statuses()).toEqual([]);
  });

  it("reports nothing for a community that has not connected an organization", async () => {
    h.initiative.install(INSTALLATION, { workspace: null });
    expect(await check()).toBe(204);
    expect(statuses()).toEqual([]);
    expect(h.initiative.installs.get(INSTALLATION)!.tokenAsks).toEqual([]);
  });
});
