/**
 * A member's GitHub token, asked of Initiative by the handle a context token
 * names: used for the call and not kept, and refused when the member's
 * connection is gone, blocked or expired.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memberToken } from "../src/credentials.js";
import { WRITE_IDS } from "../src/vocabulary.js";
import { asMember, startHarness, type Harness } from "./support/harness.js";

const INSTALLATION = "gapp_one";
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.github.install(42);
});

afterEach(() => h.close());

describe("a member's token", () => {
  it("is asked of Initiative by the member's handle, for every call", async () => {
    const install = h.initiative.install(INSTALLATION, { members: { cref_alice: "ghu_alice" } });
    h.github.rest.set("POST /repos/acme/widgets/issues/7/comments", () => ({ status: 201, body: { id: 1 } }));

    for (const round of [1, 2]) {
      const { status } = await h.invoke(
        INSTALLATION,
        WRITE_IDS.comment,
        { repo: "widgets", number: "7", body: `round ${round}` },
        asMember("cref_alice")
      );
      expect(status).toBe(200);
    }
    const sent = h.github.callsTo("POST", "/repos/acme/widgets/issues/7/comments");
    expect(sent.map((call) => call.token)).toEqual(["ghu_alice", "ghu_alice"]);
    expect(install.tokenAsks.filter((ref) => ref === "cref_alice")).toHaveLength(2);
  });

  it("stops at the next call once the member is blocked", async () => {
    const install = h.initiative.install(INSTALLATION, { members: { cref_alice: "ghu_alice" } });
    expect(await memberToken(h.context, h.client(INSTALLATION), "cref_alice")).toEqual({ ok: true, token: "ghu_alice" });
    install.members.get("cref_alice")!.blocked = true;
    expect(await memberToken(h.context, h.client(INSTALLATION), "cref_alice")).toEqual({ ok: false, reason: "not-connected" });
  });

  it("is refused for a connection Initiative could not renew, which the member connects again", async () => {
    const install = h.initiative.install(INSTALLATION, { members: { cref_alice: "ghu_alice" } });
    install.members.get("cref_alice")!.status = "expired";
    expect(await memberToken(h.context, h.client(INSTALLATION), "cref_alice")).toEqual({ ok: false, reason: "not-connected" });
  });

  it("is refused for a handle Initiative does not hold", async () => {
    h.initiative.install(INSTALLATION);
    expect(await memberToken(h.context, h.client(INSTALLATION), "cref_nobody")).toEqual({ ok: false, reason: "not-connected" });
  });

  it("is unavailable, not disconnected, when Initiative could not reach GitHub", async () => {
    h.initiative.install(INSTALLATION, { members: { cref_alice: "ghu_alice" } });
    h.initiative.connectionTokenFails = 502;
    expect(await memberToken(h.context, h.client(INSTALLATION), "cref_alice")).toEqual({ ok: false, reason: "unavailable" });
  });
});
