/**
 * A member's GitHub credential, resolved through their connection: renewed
 * and written back when it is about to lapse, cleared when GitHub has ended
 * it, and found for a member another app names.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { delegatedMemberToken, memberToken } from "../src/credentials.js";
import { WRITE_IDS } from "../src/vocabulary.js";
import { startHarness, type Harness } from "./support/harness.js";

const INSTALLATION = "gapp_one";
const SOON = () => Math.floor(Date.now() / 1000) + 30;
const FAR = () => Math.floor(Date.now() / 1000) + 8 * 3600;
let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.github.install(42);
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

describe("renewal", () => {
  it("renews a token about to lapse, writes it back, and writes as the member with it", async () => {
    h.initiative.install(INSTALLATION, {
      members: { cref_alice: { access_token: "ghu_old", refresh_token: "ghr_1", expires_at: SOON(), refresh_expires_at: FAR() } },
    });
    h.github.refreshes.set("ghr_1", { access_token: "ghu_new", refresh_token: "ghr_2", expires_in: 28800 });
    h.github.rest.set("POST /repos/acme/widgets/issues/7/comments", () => ({ status: 201, body: { id: 1 } }));

    const { status } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.comment,
      { repo: "widgets", number: "7", body: "hi" },
      { connectionRefs: { account: "cref_alice" } }
    );
    expect(status).toBe(200);
    expect(h.github.callsTo("POST", "/repos/acme/widgets/issues/7/comments")[0].token).toBe("ghu_new");

    const stored = h.initiative.installs.get(INSTALLATION)!.members.get("cref_alice")!;
    expect(stored.values).toMatchObject({ access_token: "ghu_new", refresh_token: "ghr_2" });
    expect(stored.values.expires_at as number).toBeGreaterThan(FAR() - 60);
  });

  it("clears the connection when GitHub has ended the authorization", async () => {
    h.initiative.install(INSTALLATION, {
      members: { cref_alice: { access_token: "ghu_old", refresh_token: "ghr_dead", expires_at: SOON() } },
    });
    expect(await memberToken(h.context, INSTALLATION, "cref_alice")).toBeNull();
    const row = h.initiative.installs.get(INSTALLATION)!.members.get("cref_alice")!;
    expect(row.status).toBe("pending");
    expect(row.values).toEqual({});
  });

  it("keeps the token it has when GitHub cannot be reached", async () => {
    h.initiative.install(INSTALLATION, {
      members: { cref_alice: { access_token: "ghu_old", refresh_token: "ghr_1", expires_at: SOON() } },
    });
    const unreachable = h.context.oauth.http.fetch;
    h.context.oauth.http.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/login/oauth/access_token")) throw new Error("connection reset");
      return unreachable(input, init);
    }) as typeof fetch;
    expect(await memberToken(h.context, INSTALLATION, "cref_alice")).toBe("ghu_old");
    expect(h.initiative.installs.get(INSTALLATION)!.writes).toHaveLength(0);
  });

  it("shares one renewal between concurrent calls", async () => {
    h.initiative.install(INSTALLATION, {
      members: { cref_alice: { access_token: "ghu_old", refresh_token: "ghr_1", expires_at: SOON() } },
    });
    h.github.refreshes.set("ghr_1", { access_token: "ghu_new", expires_in: 28800 });
    const tokens = await Promise.all([1, 2, 3].map(() => memberToken(h.context, INSTALLATION, "cref_alice")));
    expect(tokens).toEqual(["ghu_new", "ghu_new", "ghu_new"]);
    expect(h.github.exchanges.filter((form) => form.get("grant_type") === "refresh_token")).toHaveLength(1);
  });

  it("finds a member who connected after the configuration was read", async () => {
    h.initiative.install(INSTALLATION);
    await h.context.installs.snapshot(INSTALLATION);
    h.initiative.installs.get(INSTALLATION)!.members.set("cref_late", {
      connectionId: "account",
      status: "connected",
      values: { access_token: "ghu_late" },
    });
    expect(await memberToken(h.context, INSTALLATION, "cref_late")).toBe("ghu_late");
  });
});

describe("a member another app names", () => {
  it("is resolved to this app's own handle for them", async () => {
    const install = h.initiative.install(INSTALLATION, {
      members: { cref_alice: { access_token: "ghu_alice", expires_at: FAR() } },
    });
    install.delegated.set("morelitea.automations uapp_alice", "cref_alice");
    expect(
      await delegatedMemberToken(h.context, INSTALLATION, { delegate: "morelitea.automations", subject: "uapp_alice" })
    ).toBe("ghu_alice");
    expect(
      await delegatedMemberToken(h.context, INSTALLATION, { delegate: "morelitea.automations", subject: "uapp_nobody" })
    ).toBeNull();
  });
});
