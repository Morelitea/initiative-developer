/**
 * GitHub's deliveries: taken only with a valid `X-Hub-Signature-256`, and
 * turned into the three announcements for each community bound to the
 * installation they came from.
 */

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifySignature } from "../src/github/webhooks.js";
import { EMIT_IDS } from "../src/vocabulary.js";
import { startHarness, WEBHOOK_SECRET, type Harness } from "./support/harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install("gapp_one");
  h.initiative.install("gapp_two");
  h.initiative.install("gapp_other", { workspace: { owner: "other", installation_id: 77 } });
  h.github.install(42);
  h.github.install(77, { owner: "other" });
  await h.sync.run();
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

let delivery = 0;

async function deliver(event: string, payload: unknown, options: { signature?: string; id?: string } = {}) {
  const body = JSON.stringify(payload);
  const response = await fetch(`${h.url}/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": options.id ?? `delivery-${++delivery}`,
      "X-Hub-Signature-256": options.signature ?? sign(body),
    },
    body,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const repository = { name: "widgets", owner: { login: "acme" } };
const issue = {
  number: 7,
  title: "Broken build",
  html_url: "https://github.test/acme/widgets/issues/7",
  user: { login: "bob" },
  labels: [{ name: "bug" }],
};

describe("signature", () => {
  it("verifies GitHub's HMAC over the raw body", () => {
    const body = Buffer.from('{"a":1}');
    expect(verifySignature(WEBHOOK_SECRET, body, sign('{"a":1}'))).toBe(true);
    expect(verifySignature(WEBHOOK_SECRET, body, sign('{"a": 1}'))).toBe(false);
    expect(verifySignature(WEBHOOK_SECRET, body, sign('{"a":1}', "another-secret"))).toBe(false);
    expect(verifySignature(WEBHOOK_SECRET, body, "sha1=abc")).toBe(false);
    expect(verifySignature(WEBHOOK_SECRET, body, undefined)).toBe(false);
  });

  it("refuses a delivery with a bad signature, and announces nothing", async () => {
    const { status } = await deliver(
      "issues",
      { action: "opened", installation: { id: 42 }, repository, issue },
      { signature: sign("something else") }
    );
    expect(status).toBe(401);
    expect(h.initiative.installs.get("gapp_one")!.events).toHaveLength(0);
  });

  it("refuses a delivery with no signature", async () => {
    const response = await fetch(`${h.url}/github/webhook`, {
      method: "POST",
      headers: { "X-GitHub-Event": "issues" },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });
});

describe("announcements", () => {
  it("emits issue-opened to every community bound to the installation", async () => {
    const { status, body } = await deliver("issues", { action: "opened", installation: { id: 42 }, repository, issue });
    expect(status).toBe(200);
    expect(body.emitted).toBe(2);
    for (const installation of ["gapp_one", "gapp_two"]) {
      expect(h.initiative.installs.get(installation)!.events).toEqual([
        {
          event_type: EMIT_IDS.issueOpened,
          payload: {
            repository: "widgets",
            owner: "acme",
            number: 7,
            title: "Broken build",
            url: "https://github.test/acme/widgets/issues/7",
            author: "bob",
            labels: ["bug"],
          },
        },
      ]);
    }
    expect(h.initiative.installs.get("gapp_other")!.events).toHaveLength(0);
  });

  it("emits issue-closed", async () => {
    await deliver("issues", { action: "closed", installation: { id: 77 }, repository: { name: "site", owner: { login: "other" } }, issue });
    const events = h.initiative.installs.get("gapp_other")!.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: EMIT_IDS.issueClosed, payload: { repository: "site", number: 7 } });
  });

  it("emits review-requested, naming the reviewer or the team", async () => {
    const pull = { number: 9, title: "Fix", html_url: "https://github.test/acme/widgets/pull/9", user: { login: "carol" } };
    await deliver("pull_request", {
      action: "review_requested",
      installation: { id: 42 },
      repository,
      pull_request: pull,
      requested_reviewer: { login: "dave" },
    });
    await deliver("pull_request", {
      action: "review_requested",
      installation: { id: 42 },
      repository,
      pull_request: pull,
      requested_team: { slug: "core" },
    });
    const events = h.initiative.installs.get("gapp_one")!.events;
    expect(events.map((event) => [event.event_type, event.payload.reviewer])).toEqual([
      [EMIT_IDS.reviewRequested, "dave"],
      [EMIT_IDS.reviewRequested, "core"],
    ]);
    expect(events[0].payload).toMatchObject({ number: 9, author: "carol", repository: "widgets" });
  });

  it("announces a redelivery once", async () => {
    const payload = { action: "opened", installation: { id: 42 }, repository, issue };
    await deliver("issues", payload, { id: "same" });
    const { body } = await deliver("issues", payload, { id: "same" });
    expect(body.reason).toBe("repeat");
    expect(h.initiative.installs.get("gapp_one")!.events).toHaveLength(1);
  });

  it("says nothing about events it does not announce", async () => {
    const { body } = await deliver("issues", { action: "edited", installation: { id: 42 }, repository, issue });
    expect(body).toEqual({ emitted: 0, reason: "nothing-to-say" });
    const push = await deliver("push", { installation: { id: 42 }, repository });
    expect(push.body.reason).toBe("nothing-to-say");
  });

  it("does not announce a pull request as an issue", async () => {
    const { body } = await deliver("issues", {
      action: "opened",
      installation: { id: 42 },
      repository,
      issue: { ...issue, pull_request: { url: "x" } },
    });
    expect(body.reason).toBe("nothing-to-say");
  });

  it("drops a delivery from an installation no community is bound to", async () => {
    const { body } = await deliver("issues", { action: "opened", installation: { id: 999 }, repository, issue });
    expect(body.reason).toBe("unbound");
  });

  it("tells a community's admins when GitHub removes its installation", async () => {
    const { body } = await deliver("installation", { action: "deleted", installation: { id: 42 } });
    expect(body.reason).toBe("lifecycle");
    await h.settle();
    expect(h.initiative.installs.get("gapp_one")!.statuses.at(-1)).toEqual({
      state: "invalid",
      detail: "github_installation_removed",
    });
  });
});
