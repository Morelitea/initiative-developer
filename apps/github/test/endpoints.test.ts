/**
 * Every endpoint, called as Initiative calls it: each read's answer and its
 * answer when GitHub refuses the installation, and each write's call to
 * GitHub as the member and its refusal when the organization never granted
 * the permission it needs.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMIT_IDS, READ_IDS, WRITE_IDS } from "../src/vocabulary.js";
import { startHarness, type Harness } from "./support/harness.js";

const INSTALLATION = "gapp_one";
const MEMBER = "cref_alice";
const FAR = Math.floor(Date.now() / 1000) + 8 * 3600;

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
  h.initiative.install(INSTALLATION, {
    members: {
      [MEMBER]: { access_token: "ghu_alice", refresh_token: "ghr_alice", expires_at: FAR, refresh_expires_at: FAR },
    },
  });
  h.github.install(42);
});

afterEach(async () => {
  await h.settle();
  await h.close();
});

const refusedByGitHub = { body: { data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] } };

const issueNode = {
  __typename: "Issue",
  number: 7,
  title: "Broken build",
  url: "https://github.test/acme/widgets/issues/7",
  state: "OPEN",
  stateReason: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  closedAt: null,
  author: { login: "bob" },
  milestone: { title: "1.0" },
  comments: { totalCount: 2 },
  labels: { nodes: [{ name: "bug" }] },
  assignees: { nodes: [{ login: "alice" }] },
};

const row = {
  number: 7,
  title: "Broken build",
  url: "https://github.test/acme/widgets/issues/7",
  state: "OPEN",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  closedAt: null,
};

interface ReadCase {
  id: string;
  params: Record<string, unknown>;
  /** The GraphQL operation it asks, with the data GitHub answers. */
  operation?: string;
  data?: unknown;
  expected: Record<string, unknown>;
  /** Make GitHub refuse the installation. */
  refuse(h: Harness): void;
}

const graphqlRefusal = (operation: string) => (h: Harness) => h.github.graphql.set(operation, () => refusedByGitHub);

const READS: ReadCase[] = [
  {
    id: READ_IDS.listRepositories,
    params: {},
    expected: { names: ["widgets", "gadgets"], owner: "acme", count: 2 },
    refuse: (h) =>
      h.github.rest.set("GET /installation/repositories", () => ({
        status: 403,
        body: { message: "Resource not accessible by integration" },
      })),
  },
  {
    id: READ_IDS.listLabels,
    params: { repo: "widgets" },
    operation: "Labels",
    data: { repository: { labels: { totalCount: 2, nodes: [{ name: "bug" }, { name: "docs" }] } } },
    expected: { names: ["bug", "docs"], count: 2, total: 2 },
    refuse: graphqlRefusal("Labels"),
  },
  {
    id: READ_IDS.getIssue,
    params: { repo: "Widgets", number: "7" },
    operation: "Subject",
    data: { repository: { issueOrPullRequest: issueNode } },
    expected: {
      repository: "widgets",
      owner: "acme",
      number: 7,
      state: "open",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "1.0",
      comments: 2,
      is_pull_request: false,
      state_reason: null,
    },
    refuse: graphqlRefusal("Subject"),
  },
  {
    id: READ_IDS.findIssues,
    params: { repo: "widgets", state: "all", labels: ["bug"], since_days: "14", limit: "5" },
    operation: "Issues",
    data: { repository: { issues: { totalCount: 40, nodes: [row] } } },
    expected: { numbers: [7], titles: ["Broken build"], states: ["open"], count: 1, total: 40 },
    refuse: graphqlRefusal("Issues"),
  },
  {
    id: READ_IDS.getPullRequest,
    params: { repo: "widgets", number: "9" },
    operation: "Pull",
    data: {
      repository: {
        pullRequest: {
          ...issueNode,
          __typename: "PullRequest",
          number: 9,
          state: "MERGED",
          isDraft: false,
          merged: true,
          mergedAt: "2026-09-03T00:00:00Z",
          headRefName: "fix",
          baseRefName: "main",
          changedFiles: 3,
          commits: { totalCount: 2 },
        },
      },
    },
    expected: { number: 9, state: "merged", merged: true, draft: false, head_ref: "fix", base_ref: "main", commits: 2, changed_files: 3 },
    refuse: graphqlRefusal("Pull"),
  },
  {
    id: READ_IDS.findPullRequests,
    params: { repo: "widgets", state: "open" },
    operation: "Pulls",
    data: { repository: { pullRequests: { totalCount: 1, nodes: [{ ...row, number: 9 }] } } },
    expected: { numbers: [9], count: 1, total: 1 },
    refuse: graphqlRefusal("Pulls"),
  },
  {
    id: READ_IDS.listAlerts,
    params: { repo: "widgets" },
    operation: "Alerts",
    data: {
      repository: {
        vulnerabilityAlerts: {
          totalCount: 2,
          nodes: [
            { number: 1, securityVulnerability: { severity: "CRITICAL", package: { name: "left-pad" } } },
            { number: 2, securityVulnerability: { severity: "MODERATE", package: { name: "qs" } } },
          ],
        },
      },
    },
    expected: {
      numbers: [1, 2],
      severities: ["critical", "medium"],
      packages: ["left-pad", "qs"],
      count: 2,
      url: "https://github.test/acme/widgets/security/dependabot",
    },
    refuse: graphqlRefusal("Alerts"),
  },
  {
    id: READ_IDS.listProjects,
    params: {},
    operation: "Boards",
    data: { repositoryOwner: { projectsV2: { totalCount: 1, nodes: [{ id: "PVT_1", title: "Roadmap", number: 1, url: "u" }] } } },
    expected: { ids: ["PVT_1"], titles: ["Roadmap"], count: 1 },
    refuse: graphqlRefusal("Boards"),
  },
  {
    id: READ_IDS.listProjectFields,
    params: { project_id: "PVT_1" },
    operation: "Fields",
    data: {
      node: {
        owner: { login: "ACME" },
        fields: { nodes: [{ id: "F_1", name: "Status", options: [{ id: "O_1", name: "Todo" }] }, {}] },
      },
    },
    expected: { ids: ["F_1"], names: ["Status"], count: 1 },
    refuse: graphqlRefusal("Fields"),
  },
  {
    id: READ_IDS.listProjectOptions,
    params: { project_id: "PVT_1", field: "status" },
    operation: "Fields",
    data: {
      node: {
        owner: { login: "acme" },
        fields: { nodes: [{ id: "F_1", name: "Status", options: [{ id: "O_1", name: "Todo" }, { id: "O_2", name: "Done" }] }] },
      },
    },
    expected: { field_id: "F_1", field_name: "Status", option_ids: ["O_1", "O_2"], option_names: ["Todo", "Done"] },
    refuse: graphqlRefusal("Fields"),
  },
  {
    id: READ_IDS.findProjectItem,
    params: { project_id: "PVT_1", repo: "widgets", number: "7" },
    operation: "Card",
    data: {
      repository: {
        issueOrPullRequest: { projectItems: { nodes: [{ id: "PVTI_other", project: { id: "PVT_2" } }, { id: "PVTI_7", project: { id: "PVT_1" } }] } },
      },
    },
    expected: { item_id: "PVTI_7", repository: "widgets", owner: "acme", number: 7 },
    refuse: graphqlRefusal("Card"),
  },
];

describe("reads", () => {
  it("covers all eleven", () => {
    expect(READS.map((one) => one.id).sort()).toEqual(Object.values(READ_IDS).sort());
  });

  for (const one of READS) {
    const name = one.id.split(".").pop();

    it(`${name} answers on the installation's token`, async () => {
      if (one.operation) h.github.graphql.set(one.operation, () => ({ body: { data: one.data } }));
      const { status, body } = await h.invoke(INSTALLATION, one.id, one.params);
      expect(status).toBe(200);
      expect(body.endpoint).toBe(one.id);
      expect(body.actor).toBe("installation");
      expect(body.result).toMatchObject(one.expected);
      expect(body.result.unavailable).toBeUndefined();
      for (const call of h.github.calls.filter((c) => c.path === "/graphql")) {
        expect(call.token).toMatch(/^ghs_42_/);
      }
    });

    it(`${name} says so when GitHub refuses the installation`, async () => {
      one.refuse(h);
      const { status, body } = await h.invoke(INSTALLATION, one.id, one.params);
      expect(status).toBe(200);
      expect(body.result).toEqual({ unavailable: "forbidden" });
    });
  }

  it("names a missing repository rather than guessing one", async () => {
    const { body } = await h.invoke(INSTALLATION, READ_IDS.findIssues, {});
    expect(body.result).toEqual({ unavailable: "repository-required" });
  });

  it("refuses a repository the installation does not cover", async () => {
    const { body } = await h.invoke(INSTALLATION, READ_IDS.findIssues, { repo: "elsewhere" });
    expect(body.result).toEqual({ unavailable: "repository-not-listed" });
  });

  it("says a community has no organization connected", async () => {
    h.initiative.install("gapp_empty", { workspace: null });
    const { body } = await h.invoke("gapp_empty", READ_IDS.listRepositories, {});
    expect(body.result).toEqual({ unavailable: "not-configured" });
  });

  it("answers @me on the member's own token", async () => {
    h.github.graphql.set("ReviewRequested", (variables) => ({
      body: { data: { search: { issueCount: 1, nodes: [{ ...row, number: 9 }] } } },
      ...(String(variables.query).includes("review-requested:@me") ? {} : { status: 500 }),
    }));
    const { body } = await h.invoke(
      INSTALLATION,
      READ_IDS.findPullRequests,
      { repo: "widgets", review_requested: "@me" },
      { connectionRefs: { account: MEMBER } }
    );
    expect(body.actor).toBe("member");
    expect(body.result).toMatchObject({ numbers: [9], total: 1 });
    expect(h.github.calls.find((call) => call.path === "/graphql")?.token).toBe("ghu_alice");
  });

  it("asks a member who has not connected to connect for @me", async () => {
    const { body } = await h.invoke(INSTALLATION, READ_IDS.findPullRequests, { repo: "widgets", review_requested: "@me" });
    expect(body.result).toEqual({ unavailable: "not-connected" });
  });

  it("refuses a reviewer that is not a GitHub login", async () => {
    const { body } = await h.invoke(INSTALLATION, READ_IDS.findPullRequests, { repo: "widgets", review_requested: "a b" });
    expect(body.result).toEqual({ unavailable: "bad-login" });
  });
});

interface WriteCase {
  id: string;
  params: Record<string, unknown>;
  /** The GitHub route it calls, and what GitHub answers. */
  route: string;
  answer: { status: number; body?: unknown };
  expected: Record<string, unknown>;
  sent?: unknown;
}

const WRITES: WriteCase[] = [
  {
    id: WRITE_IDS.openIssue,
    params: { repo: "widgets", title: "Broken", body: "It broke.", labels: ["bug"], assignees: ["alice"] },
    route: "POST /repos/acme/widgets/issues",
    answer: { status: 201, body: { number: 12, html_url: "https://github.test/acme/widgets/issues/12", id: 999, title: "Broken" } },
    expected: { repository: "widgets", number: 12, html_url: "https://github.test/acme/widgets/issues/12", id: 999 },
    sent: { title: "Broken", body: "It broke.", labels: ["bug"], assignees: ["alice"] },
  },
  {
    id: WRITE_IDS.comment,
    params: { repo: "widgets", number: "7", body: "On it." },
    route: "POST /repos/acme/widgets/issues/7/comments",
    answer: { status: 201, body: { id: 5, html_url: "https://github.test/c/5" } },
    expected: { repository: "widgets", number: 7, id: 5, html_url: "https://github.test/c/5" },
    sent: { body: "On it." },
  },
  {
    id: WRITE_IDS.closeIssue,
    params: { repo: "widgets", number: "7", reason: "not_planned" },
    route: "PATCH /repos/acme/widgets/issues/7",
    answer: { status: 200, body: { number: 7, state: "closed", html_url: "h" } },
    expected: { repository: "widgets", number: 7, state: "closed", html_url: "h" },
    sent: { state: "closed", state_reason: "not_planned" },
  },
  {
    id: WRITE_IDS.reopenIssue,
    params: { repo: "widgets", number: "7" },
    route: "PATCH /repos/acme/widgets/issues/7",
    answer: { status: 200, body: { number: 7, state: "open", html_url: "h" } },
    expected: { repository: "widgets", number: 7, state: "open" },
    sent: { state: "open" },
  },
  {
    id: WRITE_IDS.label,
    params: { repo: "widgets", number: "7", add: ["bug"] },
    route: "POST /repos/acme/widgets/issues/7/labels",
    answer: { status: 200, body: [] },
    expected: { repository: "widgets", number: 7 },
    sent: { labels: ["bug"] },
  },
  {
    id: WRITE_IDS.requestReview,
    params: { repo: "widgets", number: "9", reviewers: ["carol"], team_reviewers: ["core"] },
    route: "POST /repos/acme/widgets/pulls/9/requested_reviewers",
    answer: { status: 201, body: { html_url: "https://github.test/acme/widgets/pull/9" } },
    expected: { repository: "widgets", number: 9, html_url: "https://github.test/acme/widgets/pull/9" },
    sent: { reviewers: ["carol"], team_reviewers: ["core"] },
  },
];

describe("writes", () => {
  for (const one of WRITES) {
    const name = one.id.split(".").pop();

    it(`${name} calls GitHub as the member it is done for`, async () => {
      h.github.rest.set(one.route, () => one.answer);
      const { status, body } = await h.invoke(INSTALLATION, one.id, one.params, { connectionRefs: { account: MEMBER } });
      expect(status).toBe(200);
      expect(body).toMatchObject({ endpoint: one.id, actor: "member" });
      expect(body.result).toMatchObject(one.expected);
      const [method, path] = one.route.split(" ");
      const sent = h.github.callsTo(method, path);
      expect(sent).toHaveLength(1);
      expect(sent[0].token).toBe("ghu_alice");
      if (one.sent) expect(sent[0].body).toEqual(one.sent);
    });

    it(`${name} is refused when the organization never granted what it needs`, async () => {
      h.github.install(42, { permissions: { metadata: "read", vulnerability_alerts: "read" } });
      h.github.rest.set(one.route, () => one.answer);
      const { status, body } = await h.invoke(INSTALLATION, one.id, one.params, { connectionRefs: { account: MEMBER } });
      expect(status).toBe(403);
      expect(body.error).toBe("missing-permission");
      const [method, path] = one.route.split(" ");
      expect(h.github.callsTo(method, path)).toHaveLength(0);
    });
  }

  it("move-project-item sets the card's field as the member", async () => {
    h.github.graphql.set("Move", (variables, token) => ({
      body: { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: String(variables.item) } } } },
      ...(token === "ghu_alice" ? {} : { status: 401 }),
    }));
    const { status, body } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.moveProjectItem,
      { project_id: "PVT_1", item_id: "PVTI_7", field_id: "F_1", option_id: "O_2" },
      { connectionRefs: { account: MEMBER } }
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ actor: "member", result: { item_id: "PVTI_7" } });
  });

  it("move-project-item is refused without a projects permission", async () => {
    h.github.install(42, { permissions: { issues: "write", metadata: "read" } });
    const { status, body } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.moveProjectItem,
      { project_id: "PVT_1", item_id: "PVTI_7", field_id: "F_1", option_id: "O_2" },
      { connectionRefs: { account: MEMBER } }
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: "missing-permission", detail: "organization_projects or repository_projects" });
    expect(h.github.operations()).not.toContain("Move");
  });

  it("covers all seven", () => {
    expect([...WRITES.map((one) => one.id), WRITE_IDS.moveProjectItem].sort()).toEqual(Object.values(WRITE_IDS).sort());
  });

  it("passes GitHub's own refusal through as a status", async () => {
    h.github.rest.set("POST /repos/acme/widgets/issues/7/comments", () => ({ status: 403, body: { message: "Must have push access" } }));
    const { status, body } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.comment,
      { repo: "widgets", number: "7", body: "x" },
      { connectionRefs: { account: MEMBER } }
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({ error: "forbidden", detail: "Must have push access" });
  });

  it("removes labels before adding, and a label already gone is not an error", async () => {
    h.github.rest.set("DELETE /repos/acme/widgets/issues/7/labels/wontfix", () => ({ status: 404, body: { message: "Label does not exist" } }));
    h.github.rest.set("POST /repos/acme/widgets/issues/7/labels", () => ({ status: 200, body: [] }));
    const { status } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.label,
      { repo: "widgets", number: "7", add: ["bug"], remove: ["wontfix"] },
      { connectionRefs: { account: MEMBER } }
    );
    expect(status).toBe(200);
    const order = h.github.calls
      .filter((call) => call.path.startsWith("/repos/acme/widgets/issues/7/labels"))
      .map((call) => call.method);
    expect(order).toEqual(["DELETE", "POST"]);
  });

  it("never falls back to the app when the member has not connected", async () => {
    h.github.rest.set("POST /repos/acme/widgets/issues", () => ({ status: 201, body: { number: 1 } }));
    const { status, body } = await h.invoke(INSTALLATION, WRITE_IDS.openIssue, { repo: "widgets", title: "x" });
    expect(status).toBe(409);
    expect(body.error).toBe("not-connected");
    expect(h.github.callsTo("POST", "/repos/acme/widgets/issues")).toHaveLength(0);
  });

  it("refuses a handle Initiative does not hold a credential for", async () => {
    const { status, body } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.openIssue,
      { repo: "widgets", title: "x" },
      { connectionRefs: { account: "cref_nobody" } }
    );
    expect(status).toBe(409);
    expect(body.error).toBe("not-connected");
  });

  it("asks for the parameters a write cannot run without", async () => {
    const { status, body } = await h.invoke(
      INSTALLATION,
      WRITE_IDS.openIssue,
      { repo: "widgets" },
      { connectionRefs: { account: MEMBER } }
    );
    expect(status).toBe(400);
    expect(body.error).toBe("invalid-params");
  });
});

describe("announcements", () => {
  for (const id of Object.values(EMIT_IDS)) {
    it(`${id.split(".").pop()} is delivered, never called`, async () => {
      const { status, body } = await h.invoke(INSTALLATION, id, {});
      expect(status).toBe(400);
      expect(body.detail).toContain("emitted rather than called");
    });
  }
});
