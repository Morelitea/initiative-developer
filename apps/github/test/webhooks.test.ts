/**
 * GitHub's deliveries, as Initiative forwards them to the `webhook` hook for
 * the community they were routed to, turned into the six announcements.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMIT_IDS } from "../src/vocabulary.js";
import { startHarness, type Harness } from "./support/harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install("gapp_one");
  h.initiative.install("gapp_other", { workspace: { owner: "other", installation_id: 77 } });
});

afterEach(() => h.close());

async function deliver(event: string, payload: unknown, installation = "gapp_one") {
  return h.hook(installation, "webhook", {
    connection: "workspace",
    headers: { "x-github-event": event, "x-github-delivery": "delivery-1" },
    body: JSON.stringify(payload),
  });
}

const events = (installation = "gapp_one") => h.initiative.installs.get(installation)!.events;

const repository = { name: "widgets", owner: { login: "acme" } };
const issue = {
  number: 7,
  title: "Broken build",
  html_url: "https://github.test/acme/widgets/issues/7",
  user: { login: "bob" },
  labels: [{ name: "bug" }],
};

describe("announcements", () => {
  it("emits issue-opened in the community the delivery was routed to", async () => {
    const { status } = await deliver("issues", { action: "opened", installation: { id: 42 }, repository, issue });
    expect(status).toBe(204);
    expect(events()).toEqual([
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
    expect(events("gapp_other")).toHaveLength(0);
  });

  it("emits issue-closed", async () => {
    const site = { name: "site", owner: { login: "other" } };
    await deliver("issues", { action: "closed", installation: { id: 77 }, repository: site, issue }, "gapp_other");
    expect(events("gapp_other")).toHaveLength(1);
    expect(events("gapp_other")[0]).toMatchObject({ event_type: EMIT_IDS.issueClosed, payload: { repository: "site", number: 7 } });
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
    expect(events().map((event) => [event.event_type, event.payload.reviewer])).toEqual([
      [EMIT_IDS.reviewRequested, "dave"],
      [EMIT_IDS.reviewRequested, "core"],
    ]);
    expect(events()[0].payload).toMatchObject({ number: 9, author: "carol", repository: "widgets" });
  });

  const release = {
    tag_name: "v1.2.0",
    name: "Spring",
    target_commitish: "main",
    html_url: "https://github.test/acme/widgets/releases/tag/v1.2.0",
    author: { login: "erin" },
    prerelease: false,
  };

  it("emits release-published for a full release", async () => {
    await deliver("release", { action: "released", installation: { id: 42 }, repository, release });
    expect(events()).toEqual([
      {
        event_type: EMIT_IDS.releasePublished,
        payload: {
          repository: "widgets",
          owner: "acme",
          tag: "v1.2.0",
          name: "Spring",
          branch: "main",
          url: "https://github.test/acme/widgets/releases/tag/v1.2.0",
          author: "erin",
        },
      },
    ]);
  });

  it("emits prerelease-published for a pre-release, and not release-published", async () => {
    await deliver("release", {
      action: "prereleased",
      installation: { id: 42 },
      repository,
      release: { ...release, tag_name: "v1.3.0-rc.1", name: null, prerelease: true },
    });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toEqual({
      event_type: EMIT_IDS.prereleasePublished,
      payload: {
        repository: "widgets",
        owner: "acme",
        tag: "v1.3.0-rc.1",
        name: null,
        branch: "main",
        url: "https://github.test/acme/widgets/releases/tag/v1.2.0",
        author: "erin",
      },
    });
  });

  it("emits release-published when a pre-release is promoted to a full release", async () => {
    const candidate = { ...release, tag_name: "v1.3.0", name: "Summer" };
    await deliver("release", {
      action: "prereleased",
      installation: { id: 42 },
      repository,
      release: { ...candidate, prerelease: true },
    });
    await deliver("release", { action: "released", installation: { id: 42 }, repository, release: candidate });
    expect(events().map((event) => [event.event_type, event.payload.tag])).toEqual([
      [EMIT_IDS.prereleasePublished, "v1.3.0"],
      [EMIT_IDS.releasePublished, "v1.3.0"],
    ]);
  });

  it("says nothing of other release actions, or a release with no tag", async () => {
    for (const action of ["published", "created", "edited", "deleted"]) {
      await deliver("release", { action, installation: { id: 42 }, repository, release });
    }
    await deliver("release", {
      action: "released",
      installation: { id: 42 },
      repository,
      release: { ...release, tag_name: "" },
    });
    expect(events()).toHaveLength(0);
  });

  it("emits tag-created for a tag, with its page and who pushed it", async () => {
    await deliver("create", {
      ref: "release/1.0",
      ref_type: "tag",
      master_branch: "main",
      installation: { id: 42 },
      repository: { ...repository, html_url: "https://github.test/acme/widgets" },
      sender: { login: "frank" },
    });
    expect(events()).toEqual([
      {
        event_type: EMIT_IDS.tagCreated,
        payload: {
          repository: "widgets",
          owner: "acme",
          tag: "release/1.0",
          url: "https://github.test/acme/widgets/tree/release/1.0",
          author: "frank",
        },
      },
    ]);
  });

  it("says nothing of a new branch", async () => {
    await deliver("create", {
      ref: "feature",
      ref_type: "branch",
      installation: { id: 42 },
      repository,
      sender: { login: "frank" },
    });
    expect(events()).toHaveLength(0);
  });

  it("accepts events it does not announce, and emits nothing", async () => {
    expect((await deliver("issues", { action: "edited", installation: { id: 42 }, repository, issue })).status).toBe(204);
    expect((await deliver("push", { installation: { id: 42 }, repository })).status).toBe(204);
    expect(events()).toHaveLength(0);
  });

  it("does not announce a pull request as an issue", async () => {
    await deliver("issues", {
      action: "opened",
      installation: { id: 42 },
      repository,
      issue: { ...issue, pull_request: { url: "x" } },
    });
    expect(events()).toHaveLength(0);
  });

  it("fails, so GitHub delivers it again, when Initiative will not take the announcement", async () => {
    h.initiative.listed = [];
    const { status } = await deliver("issues", { action: "opened", installation: { id: 42 }, repository, issue });
    expect(status).toBe(500);
  });

  it("tells the community's admins when GitHub removes its installation", async () => {
    const { status } = await deliver("installation", { action: "deleted", installation: { id: 42 } });
    expect(status).toBe(204);
    expect(h.initiative.installs.get("gapp_one")!.statuses.at(-1)).toEqual({
      state: "invalid",
      detail: "github_installation_removed",
    });
  });
});
