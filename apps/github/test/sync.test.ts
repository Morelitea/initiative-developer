/**
 * The installations sync: the configuration verdict it reports from whether
 * GitHub still has each community's installation, and what it forgets when
 * Initiative stops listing an installation. Ending members' authorizations is
 * not the sync's: Initiative calls the revoke hook for that.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DETAILS, UNAVAILABLE_PASSES } from "../src/sync.js";
import { startHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install("gapp_one", { members: { cref_alice: "ghu_alice" } });
  h.initiative.install("gapp_two");
  h.github.install(42);
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

async function pass(): Promise<void> {
  await h.sync.run();
  await h.settle();
}

const statuses = (installation: string) => h.initiative.installs.get(installation)!.statuses;

describe("the configuration verdict", () => {
  it("reports ok while the organization's installation exists, once", async () => {
    await pass();
    await pass();
    expect(statuses("gapp_one")).toEqual([{ state: "ok" }]);
    // The installation token was asked of Initiative by the community connection's handle.
    expect(h.initiative.installs.get("gapp_one")!.tokenAsks).toContain("cref_ws_gapp_one");
  });

  it("reports the installation removed once GitHub stops honouring its token", async () => {
    await pass();
    // Initiative still hands out the token it minted; GitHub no longer takes it.
    h.github.installations.delete(42);
    await pass();
    expect(statuses("gapp_one")).toEqual([{ state: "ok" }, { state: "invalid", detail: DETAILS.removed }]);
  });

  it("reports invalid while the organization has suspended the installation, and ok once it is back", async () => {
    await pass();
    h.github.installations.get(42)!.suspended = true;
    await pass();
    h.github.installations.get(42)!.suspended = false;
    await pass();
    expect(statuses("gapp_one")).toEqual([
      { state: "ok" },
      { state: "invalid", detail: DETAILS.suspended },
      { state: "ok" },
    ]);
  });

  it("reports unavailable only after several passes on which Initiative could get no token", async () => {
    h.github.installations.delete(42);
    for (let count = 1; count < UNAVAILABLE_PASSES; count += 1) await pass();
    expect(statuses("gapp_one")).toEqual([]);
    await pass();
    await pass();
    expect(statuses("gapp_one")).toEqual([{ state: "invalid", detail: DETAILS.unavailable }]);
  });

  it("keeps a removal it reported rather than calling it unavailable later", async () => {
    await pass();
    h.github.installations.delete(42);
    await pass();
    // Initiative's minted token has lapsed, and GitHub mints no other.
    for (const install of h.initiative.installs.values()) install.minted = null;
    for (let count = 0; count < UNAVAILABLE_PASSES + 1; count += 1) await pass();
    expect(statuses("gapp_one").at(-1)).toEqual({ state: "invalid", detail: DETAILS.removed });
  });

  it("reports nothing when Initiative itself could not be asked", async () => {
    h.initiative.connectionTokenFails = 503;
    for (let count = 0; count < UNAVAILABLE_PASSES + 1; count += 1) await pass();
    expect(statuses("gapp_one")).toEqual([]);
  });

  it("reports nothing for a community that has not connected an organization", async () => {
    h.initiative.install("gapp_empty", { workspace: null });
    await pass();
    expect(statuses("gapp_empty")).toEqual([]);
    expect(h.initiative.installs.get("gapp_empty")!.tokenAsks).toEqual([]);
  });
});

describe("the installations list", () => {
  it("forgets an installation Initiative stops listing, and asks nothing of it", async () => {
    expect(await h.sync.run()).toMatchObject({ listed: 2, removed: [] });
    h.initiative.listed = ["gapp_two"];
    expect(await h.sync.run()).toMatchObject({ listed: 1, removed: ["gapp_one"] });
    expect(h.context.installs.known()).toEqual(["gapp_two"]);
    // Nothing is revoked by the app: the member's authorization is Initiative's to end.
    expect(h.github.revoked).toEqual([]);
  });

  it("leaves a paused installation as it is, and reads it again once it is active", async () => {
    await pass();
    h.initiative.inactive.add("gapp_one");
    const asked = h.initiative.installs.get("gapp_one")!.tokenAsks.length;
    await pass();
    expect(h.initiative.installs.get("gapp_one")!.tokenAsks).toHaveLength(asked);
    expect(h.context.installs.known().sort()).toEqual(["gapp_one", "gapp_two"]);

    h.initiative.inactive.delete("gapp_one");
    await pass();
    expect(h.initiative.installs.get("gapp_one")!.tokenAsks.length).toBeGreaterThan(asked);
  });

  it("forgets nothing when the listing itself fails", async () => {
    await pass();
    h.initiative.listFails = 503;
    expect(await h.sync.run()).toBeNull();
    expect(h.context.installs.known().sort()).toEqual(["gapp_one", "gapp_two"]);
  });
});
