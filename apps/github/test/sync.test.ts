/**
 * The installations sync: the configuration verdict it reports, and ending
 * members' GitHub authorizations when Initiative no longer holds them or the
 * installation is gone.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MISSING_PASSES } from "../src/sync.js";
import { startHarness, type Harness } from "./support/harness.js";

const FAR = Math.floor(Date.now() / 1000) + 8 * 3600;
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install("gapp_one", {
    members: {
      cref_alice: { access_token: "ghu_alice", refresh_token: "ghr_alice", expires_at: FAR },
      cref_bob: { access_token: "ghu_bob", expires_at: FAR },
    },
  });
  h.initiative.install("gapp_two", { members: { cref_carol: { access_token: "ghu_carol" } } });
  h.github.install(42);
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

describe("an installation that is gone", () => {
  it("ends every member's GitHub grant once it is missing from consecutive listings", async () => {
    expect(await h.sync.run()).toMatchObject({ listed: 2, removed: [] });
    expect(MISSING_PASSES).toBe(2);

    h.initiative.listed = ["gapp_two"];
    expect(await h.sync.run()).toMatchObject({ removed: [] });
    expect(h.github.revoked).toEqual([]);

    const report = await h.sync.run();
    expect(report).toMatchObject({ removed: ["gapp_one"], revoked: 2 });
    expect(h.github.revoked.sort()).toEqual(["ghu_alice", "ghu_bob"]);
    // The grant is ended, authenticated as the app.
    const revocation = h.github.calls.find((call) => call.path === "/applications/Iv1.testclient/grant");
    expect(revocation?.method).toBe("DELETE");
    expect(revocation?.token).toBe(`Basic ${Buffer.from("Iv1.testclient:client-secret-for-tests").toString("base64")}`);
    // And what was cached for it is gone.
    expect(h.context.installs.known()).toEqual(["gapp_two"]);
  });

  it("comes back as a new installation without revoking anything", async () => {
    await h.sync.run();
    h.initiative.listed = ["gapp_two"];
    await h.sync.run();
    h.initiative.listed = null;
    await h.sync.run();
    h.initiative.listed = ["gapp_two"];
    await h.sync.run();
    expect(h.github.revoked).toEqual([]);
  });

  it("renews a lapsed token before ending the grant, since GitHub names a grant by a live token", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    h.initiative.install("gapp_three", {
      members: { cref_dan: { access_token: "ghu_dan_old", refresh_token: "ghr_dan", expires_at: past } },
    });
    h.github.refreshes.set("ghr_dan", { access_token: "ghu_dan_new", refresh_token: "ghr_dan_2", expires_in: 28800 });
    await h.sync.run();
    h.initiative.listed = ["gapp_one", "gapp_two"];
    await h.sync.run();
    await h.sync.run();
    expect(h.github.revoked).toEqual(["ghu_dan_new"]);
  });

  it("treats nothing as gone when the listing itself fails", async () => {
    await h.sync.run();
    h.initiative.listFails = 503;
    expect(await h.sync.run()).toBeNull();
    expect(await h.sync.run()).toBeNull();
    expect(h.github.revoked).toEqual([]);
    expect(h.context.installs.known().sort()).toEqual(["gapp_one", "gapp_two"]);
  });
});

describe("a member Initiative no longer holds", () => {
  it("has their grant ended at the next read of the configuration", async () => {
    await h.sync.run();
    h.initiative.installs.get("gapp_one")!.members.delete("cref_bob");
    await h.sync.run();
    await h.settle();
    expect(h.github.revoked).toEqual(["ghu_bob"]);
  });
});

describe("the configuration verdict", () => {
  it("reports ok while the organization's installation exists, once", async () => {
    await h.sync.run();
    await h.settle();
    await h.sync.run();
    await h.settle();
    expect(h.initiative.installs.get("gapp_one")!.statuses).toEqual([{ state: "ok" }]);
  });

  it("reports invalid when GitHub no longer has the installation", async () => {
    h.github.installations.delete(42);
    await h.sync.run();
    await h.settle();
    expect(h.initiative.installs.get("gapp_one")!.statuses).toEqual([
      { state: "invalid", detail: "github_installation_removed" },
    ]);
  });

  it("reports invalid while the organization has suspended the installation, and ok once it is back", async () => {
    h.github.installations.get(42)!.suspended = true;
    await h.sync.run();
    await h.settle();
    h.github.installations.get(42)!.suspended = false;
    await h.sync.run();
    await h.settle();
    expect(h.initiative.installs.get("gapp_one")!.statuses).toEqual([
      { state: "invalid", detail: "github_installation_suspended" },
      { state: "ok" },
    ]);
  });

  it("reports nothing for a community that has not connected an organization", async () => {
    h.initiative.install("gapp_empty", { workspace: null });
    await h.sync.run();
    await h.settle();
    expect(h.initiative.installs.get("gapp_empty")!.statuses).toEqual([]);
  });
});
