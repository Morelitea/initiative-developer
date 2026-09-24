/**
 * The two browser trips: a member connecting their GitHub account, and an
 * admin installing the app on a GitHub organization. Each begins with a
 * connect return the kit verifies and ends at the return address with an
 * outcome.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startHarness, PUBLIC_URL, type Harness } from "./support/harness.js";
import { GITHUB_WEB } from "./support/fake-github.js";
import { INITIATIVE_ORIGIN } from "./support/fake-initiative.js";

const INSTALLATION = "gapp_one";
const MEMBER = "cref_alice";
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install(INSTALLATION, { workspace: null });
  h.github.install(42);
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

function start(path: string, connectionId: string, ref: string, claims: Record<string, unknown> = {}): string {
  const token = h.initiative.connectReturn(INSTALLATION, connectionId, ref, claims);
  const query = new URLSearchParams({ connection_ref: ref, guild_ref: INSTALLATION, return_token: token });
  return `${path}?${query.toString()}`;
}

function outcome(location: string | null): string | null {
  expect(location).not.toBeNull();
  const url = new URL(location!);
  expect(url.origin).toBe(INITIATIVE_ORIGIN);
  return url.searchParams.get("outcome");
}

describe("a member connects their account", () => {
  it("authorizes at GitHub and stores the token pair in their connection", async () => {
    const begun = await h.visit(start("/connect/github", "account", MEMBER));
    expect(begun.status).toBe(302);
    const authorize = new URL(begun.location!);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${GITHUB_WEB}/login/oauth/authorize`);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/connect/github/callback`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state")!;

    h.github.codes.set("code-1", { access_token: "ghu_new", refresh_token: "ghr_new", expires_in: 28800, refresh_token_expires_in: 15897600 });
    const back = await h.visit(`/connect/github/callback?code=code-1&state=${state}`);
    expect(back.status).toBe(302);
    expect(outcome(back.location)).toBe("connected");

    const exchange = h.github.exchanges[0];
    expect(exchange.get("code_verifier")).toBeTruthy();
    expect(exchange.get("client_secret")).toBe("client-secret-for-tests");

    const write = h.initiative.installs.get(INSTALLATION)!.writes[0];
    expect(write.ref).toBe(MEMBER);
    expect(write.body).toMatchObject({
      status: "connected",
      values: { access_token: "ghu_new", refresh_token: "ghr_new" },
    });
    const values = write.body.values as Record<string, number>;
    expect(values.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  it("refuses a connect return that does not verify", async () => {
    const unverifiable = `/connect/github?connection_ref=${MEMBER}&guild_ref=${INSTALLATION}&return_token=a.b.c`;
    const answer = await h.visit(unverifiable);
    expect(answer.status).toBe(400);
    expect(answer.location).toBeNull();
  });

  it("refuses a connect return for the other connection", async () => {
    const answer = await h.visit(start("/connect/github", "workspace", MEMBER));
    expect(answer.status).toBe(400);
  });

  it("refuses a handle the connect return does not name", async () => {
    const token = h.initiative.connectReturn(INSTALLATION, "account", MEMBER);
    const answer = await h.visit(`/connect/github?connection_ref=cref_other&guild_ref=${INSTALLATION}&return_token=${token}`);
    expect(answer.status).toBe(400);
  });

  it("takes each connect return once", async () => {
    const path = start("/connect/github", "account", MEMBER);
    expect((await h.visit(path)).status).toBe(302);
    const again = await h.visit(path);
    expect(outcome(again.location)).toBe("expired");
  });

  it("refuses an expired connect return", async () => {
    const now = Math.floor(Date.now() / 1000);
    const answer = await h.visit(start("/connect/github", "account", MEMBER, { iat: now - 900, exp: now - 600 }));
    expect(answer.status).toBe(400);
  });

  it("says refused when GitHub will not exchange the code, and stores nothing", async () => {
    const begun = await h.visit(start("/connect/github", "account", MEMBER));
    const state = new URL(begun.location!).searchParams.get("state")!;
    const back = await h.visit(`/connect/github/callback?code=wrong&state=${state}`);
    expect(outcome(back.location)).toBe("refused");
    expect(h.initiative.installs.get(INSTALLATION)!.writes).toHaveLength(0);
  });

  it("does not finish a trip it did not start", async () => {
    const answer = await h.visit("/connect/github/callback?code=code-1&state=made-up");
    expect(answer.status).toBe(400);
  });
});

describe("an admin installs the app on an organization", () => {
  async function throughInstallPage(): Promise<string> {
    const begun = await h.visit(start("/install/github", "workspace", "cref_ws"));
    expect(begun.status).toBe(302);
    const page = new URL(begun.location!);
    expect(`${page.origin}${page.pathname}`).toBe(`${GITHUB_WEB}/apps/initiative-test/installations/new`);
    return page.searchParams.get("state")!;
  }

  it("records the installation GitHub confirms the admin holds", async () => {
    const state = await throughInstallPage();
    const setup = await h.visit(`/install/github/setup?installation_id=42&setup_action=install&state=${state}`);
    const authorize = new URL(setup.location!);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/install/github/verify`);

    h.github.codes.set("code-admin", { access_token: "ghu_admin" });
    h.github.userInstallations.set("ghu_admin", [{ id: 42, login: "acme" }]);
    const verified = await h.visit(`/install/github/verify?code=code-admin&state=${authorize.searchParams.get("state")}`);
    expect(outcome(verified.location)).toBe("connected");

    const install = h.initiative.installs.get(INSTALLATION)!;
    expect(install.writes).toEqual([{ ref: "cref_ws", body: { values: { owner: "acme", installation_id: 42 } } }]);
    await h.settle();
    expect(install.statuses).toEqual([{ state: "ok" }]);
    // The token that proved the claim is not kept anywhere.
    expect(JSON.stringify(install.writes)).not.toContain("ghu_admin");
  });

  it("refuses an installation the admin does not hold", async () => {
    const state = await throughInstallPage();
    const setup = await h.visit(`/install/github/setup?installation_id=77&setup_action=install&state=${state}`);
    const verifyState = new URL(setup.location!).searchParams.get("state");
    h.github.codes.set("code-admin", { access_token: "ghu_admin" });
    h.github.userInstallations.set("ghu_admin", [{ id: 42, login: "acme" }]);
    const verified = await h.visit(`/install/github/verify?code=code-admin&state=${verifyState}`);
    expect(outcome(verified.location)).toBe("refused");
    expect(h.initiative.installs.get(INSTALLATION)!.writes).toHaveLength(0);
  });

  it("says awaiting approval when an owner still has to approve", async () => {
    const state = await throughInstallPage();
    const setup = await h.visit(`/install/github/setup?setup_action=request&state=${state}`);
    expect(outcome(setup.location)).toBe("awaiting_approval");
  });

  it("refuses a setup return this app did not send anyone to", async () => {
    const answer = await h.visit("/install/github/setup?installation_id=42&setup_action=install&state=made-up");
    expect(answer.status).toBe(400);
  });

  it("does not let a member's connect trip finish an installation", async () => {
    const begun = await h.visit(start("/connect/github", "account", MEMBER));
    const state = new URL(begun.location!).searchParams.get("state")!;
    const answer = await h.visit(`/install/github/setup?installation_id=42&setup_action=install&state=${state}`);
    expect(answer.status).toBe(400);
  });
});
