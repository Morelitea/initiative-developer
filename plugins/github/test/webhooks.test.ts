/**
 * GitHub's deliveries, as Initiative maps them once it has checked and routed
 * one to a community: the six announcements, and the organization's
 * installation being removed, suspended or restored.
 */

import { runWebhook } from "initiative-plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "../src/plugin.js";
import { EMIT } from "../src/vocabulary.js";
import { recorded } from "./fixtures.js";

function deliver(event: string, payload: unknown) {
  return runWebhook(plugin, {
    headers: { "X-GitHub-Event": event, "X-GitHub-Delivery": "delivery-1" },
    payload,
    connection: { owner: "acme", installation_id: 42 },
  });
}

/** A recorded delivery with some of its fields changed. */
const changed = (name: string, change: (payload: any) => void) => {
  const payload = recorded(name);
  change(payload);
  return payload;
};

describe("announcements", () => {
  it("announces an opened issue", async () => {
    expect(await deliver("issues", recorded("deliveries/issues"))).toEqual({
      event: {
        emit: EMIT.issueOpened,
        payload: {
          repository: "widgets",
          owner: "acme",
          number: 7,
          title: "Broken build",
          url: "https://github.com/acme/widgets/issues/7",
          author: "bob",
          labels: ["bug"],
        },
      },
    });
  });

  it("announces a closed issue", async () => {
    const closed = changed("deliveries/issues", (payload) => {
      payload.action = "closed";
      payload.issue.labels = [];
    });
    expect(await deliver("issues", closed)).toMatchObject({
      event: { emit: EMIT.issueClosed, payload: { repository: "widgets", number: 7, labels: [] } },
    });
  });

  it("announces a review request, naming the reviewer or the team", async () => {
    expect(await deliver("pull_request", recorded("deliveries/pull_request"))).toEqual({
      event: {
        emit: EMIT.reviewRequested,
        payload: {
          repository: "widgets",
          owner: "acme",
          number: 9,
          title: "Fix",
          url: "https://github.com/acme/widgets/pull/9",
          author: "carol",
          reviewer: "dave",
        },
      },
    });
    const team = changed("deliveries/pull_request", (payload) => {
      delete payload.requested_reviewer;
      payload.requested_team = { slug: "core" };
    });
    expect(await deliver("pull_request", team)).toMatchObject({ event: { payload: { reviewer: "core" } } });
  });

  it("announces a full release", async () => {
    expect(await deliver("release", recorded("deliveries/release"))).toEqual({
      event: {
        emit: EMIT.releasePublished,
        payload: {
          repository: "widgets",
          owner: "acme",
          tag: "v1.2.0",
          name: "Spring",
          branch: "main",
          url: "https://github.com/acme/widgets/releases/tag/v1.2.0",
          author: "erin",
        },
      },
    });
  });

  it("announces a pre-release as one, and its untitled name as null", async () => {
    const prerelease = changed("deliveries/release", (payload) => {
      payload.action = "prereleased";
      payload.release.name = null;
      payload.release.prerelease = true;
    });
    expect(await deliver("release", prerelease)).toMatchObject({
      event: { emit: EMIT.prereleasePublished, payload: { tag: "v1.2.0", name: null } },
    });
  });

  it("announces a tag, with its page and who pushed it", async () => {
    expect(await deliver("create", recorded("deliveries/create"))).toEqual({
      event: {
        emit: EMIT.tagCreated,
        payload: {
          repository: "widgets",
          owner: "acme",
          tag: "release/1.0",
          url: "https://github.com/acme/widgets/tree/release/1.0",
          author: "frank",
        },
      },
    });
    const spaced = changed("deliveries/create", (payload) => {
      payload.ref = "v1 beta";
    });
    expect(await deliver("create", spaced)).toMatchObject({
      event: { payload: { url: "https://github.com/acme/widgets/tree/v1%20beta" } },
    });
  });

  it("says nothing of a delivery whose subject GitHub did not name", async () => {
    const quiet = [
      ["issues", changed("deliveries/issues", (payload) => (payload.issue.pull_request = { url: "x" }))],
      ["issues", changed("deliveries/issues", (payload) => delete payload.issue.number)],
      ["issues", changed("deliveries/issues", (payload) => (payload.repository.name = ""))],
      ["pull_request", changed("deliveries/pull_request", (payload) => delete payload.repository)],
      ["release", changed("deliveries/release", (payload) => (payload.release.tag_name = ""))],
      ["create", changed("deliveries/create", (payload) => delete payload.ref)],
    ] as const;
    for (const [event, payload] of quiet) expect(await deliver(event, payload)).toEqual({});
  });

  it("says nothing of other actions and events", async () => {
    for (const action of ["edited", "labeled", "reopened"]) {
      expect(await deliver("issues", changed("deliveries/issues", (payload) => (payload.action = action)))).toEqual({});
    }
    for (const action of ["published", "created", "edited", "deleted"]) {
      expect(await deliver("release", changed("deliveries/release", (payload) => (payload.action = action)))).toEqual({});
    }
    expect(await deliver("create", changed("deliveries/create", (payload) => (payload.ref_type = "branch")))).toEqual({});
    expect(await deliver("push", { ref: "refs/heads/main", installation: { id: 42 }, repository: recorded("deliveries/issues").repository })).toEqual({});
  });
});

describe("the organization's installation", () => {
  const status = (action: string) => deliver("installation", changed("deliveries/installation", (payload) => (payload.action = action)));

  it("is removed, suspended and restored as GitHub says", async () => {
    expect(await status("deleted")).toEqual({ status: { connection: "workspace", state: "removed" } });
    expect(await status("suspend")).toEqual({ status: { connection: "workspace", state: "suspended" } });
    expect(await status("unsuspend")).toEqual({ status: { connection: "workspace", state: "ok" } });
  });

  it("is not changed by anything else", async () => {
    expect(await status("new_permissions_accepted")).toEqual({});
    expect(await deliver("installation_repositories", { action: "added", installation: { id: 42 } })).toEqual({});
  });
});
