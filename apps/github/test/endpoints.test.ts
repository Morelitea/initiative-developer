/**
 * Every endpoint, as Initiative runs it: the requests it makes to GitHub, on
 * which connection, and what it makes of GitHub's recorded answers, refusals
 * included.
 */

import { runEndpoint, type RecordedResponse } from "initiative-app-sdk/testing";
import { describe, expect, it } from "vitest";

import app from "../src/app.js";
import { READ, WRITE } from "../src/vocabulary.js";
import { recorded } from "./fixtures.js";

const NOW = "2026-10-01T12:00:00Z";
const CONNECTIONS = { workspace: { owner: "acme", installation_id: 42 }, account: {} };
const API = "https://api.github.com";
const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "initiative-github",
};

/** One endpoint, called with `params`, answered in turn by each recorded body or answer. */
function call(name: string, params: Record<string, unknown>, ...answers: Array<string | RecordedResponse>) {
  return runEndpoint(app, name, {
    params,
    connections: CONNECTIONS,
    now: NOW,
    responses: answers.map((answer) => (typeof answer === "string" ? { body: recorded(answer) } : answer)),
  });
}

const variables = (run: Awaited<ReturnType<typeof call>>) =>
  (run.requests[0].body as { variables: Record<string, unknown> }).variables;

interface ReadCase {
  name: string;
  params: Record<string, unknown>;
  answers: string[];
  result: Record<string, unknown>;
}

const ROW = {
  urls: ["https://github.com/acme/widgets/issues/7"],
  states: ["open"],
  created_at: ["2026-09-01T00:00:00Z"],
  updated_at: ["2026-09-02T00:00:00Z"],
  closed_at: [""],
};

const READS: ReadCase[] = [
  {
    name: READ.listRepositories,
    params: {},
    answers: ["rest/installation-repositories"],
    result: { names: ["widgets", "gadgets"], owner: "acme", count: 2 },
  },
  {
    name: READ.listAssignees,
    params: { repo: "widgets" },
    answers: ["graphql/assignees"],
    result: { logins: ["alice", "bob"], count: 2, total: 3 },
  },
  {
    name: READ.listBranches,
    params: { repo: "widgets" },
    answers: ["graphql/branches"],
    result: { names: ["develop", "main"], count: 2, total: 2 },
  },
  {
    name: READ.listLabels,
    params: { repo: "widgets" },
    answers: ["graphql/labels"],
    result: { names: ["bug", "docs"], count: 2, total: 2 },
  },
  {
    name: READ.listMilestones,
    params: { repo: "widgets" },
    answers: ["graphql/milestones"],
    result: { numbers: [3, 5], titles: ["1.0", "1.1"], count: 2, total: 2 },
  },
  {
    name: READ.getIssue,
    params: { repo: "Widgets", number: 7 },
    answers: ["graphql/subject"],
    result: {
      repository: "widgets",
      owner: "acme",
      number: 7,
      title: "Broken build",
      state: "open",
      state_reason: null,
      url: "https://github.com/acme/widgets/issues/7",
      author: "bob",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "1.0",
      comments: 2,
      is_pull_request: false,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      closed_at: null,
    },
  },
  {
    name: READ.findIssues,
    params: { repo: "widgets", state: "all", labels: ["bug"], since_days: 14, limit: 5, sort: "updated" },
    answers: ["graphql/issues"],
    result: {
      numbers: [7, 8],
      titles: ["Broken build", "Slow tests"],
      urls: [...ROW.urls, ROW.urls[0]],
      states: ["open", "closed"],
      created_at: [...ROW.created_at, ...ROW.created_at],
      updated_at: [...ROW.updated_at, ...ROW.updated_at],
      closed_at: ["", "2026-09-03T00:00:00Z"],
      count: 2,
      total: 40,
    },
  },
  {
    name: READ.getPullRequest,
    params: { repo: "widgets", number: 9 },
    answers: ["graphql/pull"],
    result: {
      repository: "widgets",
      owner: "acme",
      number: 9,
      title: "Fix the build",
      state: "merged",
      merged: true,
      draft: false,
      url: "https://github.com/acme/widgets/pull/9",
      author: "bob",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "1.0",
      comments: 2,
      head_ref: "fix",
      base_ref: "main",
      commits: 2,
      changed_files: 3,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      closed_at: "2026-09-03T00:00:00Z",
      merged_at: "2026-09-03T00:00:00Z",
    },
  },
  {
    name: READ.findPullRequests,
    params: { repo: "widgets" },
    answers: ["graphql/search"],
    result: { ...ROW, numbers: [9], titles: ["Fix the build"], urls: ["https://github.com/acme/widgets/pull/9"], count: 1, total: 1 },
  },
  {
    name: READ.reviewQueue,
    params: { repo: "widgets" },
    answers: ["graphql/search"],
    result: { ...ROW, numbers: [9], titles: ["Fix the build"], urls: ["https://github.com/acme/widgets/pull/9"], count: 1, total: 1 },
  },
  {
    name: READ.listAlerts,
    params: { repo: "widgets" },
    answers: ["graphql/alerts"],
    result: {
      numbers: [1, 2],
      severities: ["critical", "medium"],
      packages: ["left-pad", "qs"],
      urls: [
        "https://github.com/acme/widgets/security/dependabot/1",
        "https://github.com/acme/widgets/security/dependabot/2",
      ],
      count: 2,
      total: 2,
      url: "https://github.com/acme/widgets/security/dependabot",
    },
  },
  {
    name: READ.listProjects,
    params: {},
    answers: ["graphql/boards"],
    result: {
      ids: ["PVT_1"],
      titles: ["Roadmap"],
      numbers: [1],
      urls: ["https://github.com/orgs/acme/projects/1"],
      count: 1,
      total: 1,
    },
  },
  {
    name: READ.listProjectFields,
    params: { project_id: "PVT_1" },
    answers: ["graphql/fields"],
    result: { ids: ["F_1"], names: ["Status"], count: 1 },
  },
  {
    name: READ.listProjectOptions,
    params: { project_id: "PVT_1", field: "status" },
    answers: ["graphql/fields"],
    result: { field_id: "F_1", field_name: "Status", option_ids: ["O_1", "O_2"], option_names: ["Todo", "Done"] },
  },
  {
    name: READ.findProjectItem,
    params: { project_id: "PVT_1", repo: "widgets", number: 7 },
    answers: ["graphql/card"],
    result: { item_id: "PVTI_7", repository: "widgets", owner: "acme", number: 7 },
  },
];

describe("reads", () => {
  it("covers all fifteen", () => {
    expect(READS.map((one) => one.name).sort()).toEqual(Object.values(READ).sort());
  });

  for (const one of READS) {
    it(`${one.name} answers from GitHub's answer`, async () => {
      const run = await call(one.name, one.params, ...one.answers);
      expect(run).toEqual({ requests: expect.any(Array), result: one.result });
      for (const request of run.requests) expect(request.headers).toEqual(HEADERS);
    });

    it(`${one.name} says so when GitHub refuses the installation`, async () => {
      const run = await call(one.name, one.params, { status: 403, body: recorded("rest/forbidden") });
      expect(run).toMatchObject({ unavailable: "not-authorized" });
    });

    it(`${one.name} is retried when GitHub is limiting requests`, async () => {
      const limited = { status: 403, headers: { "X-RateLimit-Remaining": "0" }, body: recorded("rest/rate-limited") };
      expect(await call(one.name, one.params, limited)).toMatchObject({ transient: true });
      expect(await call(one.name, one.params, { status: 429 })).toMatchObject({ transient: true });
    });
  }

  it("asks GitHub as the organization's installation, about the repository the call names", async () => {
    const run = await call(READ.listLabels, { repo: "widgets" }, "graphql/labels");
    expect(run.requests).toEqual([
      {
        method: "POST",
        url: `${API}/graphql`,
        headers: HEADERS,
        body: { query: expect.stringContaining("repository(owner: $owner, name: $repo)"), variables: { owner: "acme", repo: "widgets", first: 100 } },
        connection: "workspace",
      },
    ]);
  });

  it("reads every page of the installation's repositories, up to five", async () => {
    const page = (names: string[]) => ({ body: { repositories: names.map((name) => ({ name })) } });
    const full = Array.from({ length: 100 }, (_, index) => `repo-${index}`);
    const run = await call(READ.listRepositories, {}, page(full), page(["last"]));
    expect(run.requests.map((request) => request.url)).toEqual([
      `${API}/installation/repositories?page=1&per_page=100`,
      `${API}/installation/repositories?page=2&per_page=100`,
    ]);
    expect(run).toMatchObject({ result: { count: 101, owner: "acme" } });

    const capped = await call(READ.listRepositories, {}, ...Array.from({ length: 5 }, () => page(full)));
    expect(capped.requests).toHaveLength(5);
    expect(capped).toMatchObject({ result: { count: 500 } });
  });

  it("asks for issues by state, labels, order and how far back", async () => {
    const run = await call(
      READ.findIssues,
      { repo: "widgets", state: "all", labels: ["bug"], since_days: 14, limit: 5, sort: "updated" },
      "graphql/issues"
    );
    expect(variables(run)).toEqual({
      owner: "acme",
      repo: "widgets",
      first: 5,
      order: { field: "UPDATED_AT", direction: "DESC" },
      filter: { states: null, labels: ["bug"], since: "2026-09-17T12:00:00.000Z" },
    });

    const defaults = await call(READ.findIssues, { repo: "widgets", assignee: "alice", milestone: 3, limit: 500 }, "graphql/issues");
    expect(variables(defaults)).toEqual({
      owner: "acme",
      repo: "widgets",
      first: 100,
      order: { field: "CREATED_AT", direction: "DESC" },
      filter: { states: ["OPEN"], assignee: "alice", milestoneNumber: "3" },
    });
  });

  it("finds pull requests through GitHub's search, as the installation", async () => {
    const run = await call(
      READ.findPullRequests,
      {
        repo: "widgets",
        state: "closed",
        labels: ["needs review", "ui"],
        base_ref: "main",
        head_ref: "fix",
        review_requested: "dave",
        sort: "updated",
        direction: "asc",
        limit: 10,
      },
      "graphql/search"
    );
    expect(run.requests[0].connection).toBe("workspace");
    expect(variables(run)).toEqual({
      query:
        'repo:acme/widgets is:pr is:closed is:unmerged label:"needs review" label:"ui" base:"main" head:"fix" review-requested:dave sort:updated-asc',
      first: 10,
    });

    const all = await call(READ.findPullRequests, { repo: "widgets", state: "all" }, "graphql/search");
    expect(variables(all)).toEqual({ query: "repo:acme/widgets is:pr sort:created-desc", first: 30 });
  });

  it("refuses a reviewer that is not a GitHub login, and never searches for it", async () => {
    for (const login of ["a b", "@me", "-dave", "x".repeat(40)]) {
      const run = await call(READ.findPullRequests, { repo: "widgets", review_requested: login }, "graphql/search");
      expect(run).toMatchObject({ unavailable: "bad-login" });
      expect(variables(run).query).not.toContain("review-requested");
    }
  });

  it("asks for the member's review queue as the member, in the repository on the organization", async () => {
    const run = await call(READ.reviewQueue, { repo: "widgets", labels: ["ui"], limit: 10 }, "graphql/search");
    expect(run.requests.map((request) => [request.method, request.url, request.connection])).toEqual([
      ["POST", `${API}/graphql`, "account"],
    ]);
    expect(variables(run)).toEqual({
      query: 'repo:acme/widgets is:pr is:open label:"ui" review-requested:@me sort:created-desc',
      first: 10,
    });
  });

  it("names a missing repository, number, board or field rather than guessing one", async () => {
    const refused = { body: recorded("graphql/invalid-variables") };
    expect(await call(READ.findIssues, {}, refused)).toMatchObject({ unavailable: "repository-required" });
    expect(await call(READ.getIssue, { repo: "widgets" }, refused)).toMatchObject({ unavailable: "number-required" });
    expect(await call(READ.listProjectFields, {}, refused)).toMatchObject({ unavailable: "project-required" });
    expect(await call(READ.listProjectOptions, { project_id: "PVT_1" }, refused)).toMatchObject({ unavailable: "field-required" });
    expect(await call(READ.reviewQueue, {}, refused)).toMatchObject({ unavailable: "repository-required" });
  });

  it("says a repository, issue or pull request is not there", async () => {
    for (const name of [READ.listLabels, READ.listAssignees, READ.findIssues, READ.getIssue, READ.listAlerts, READ.findProjectItem]) {
      const run = await call(name, { repo: "elsewhere", number: 7, project_id: "PVT_1" }, "graphql/not-found");
      expect(run).toMatchObject({ unavailable: "not-found" });
    }
  });

  it("reads GitHub's refusal inside a GraphQL answer", async () => {
    expect(await call(READ.listAlerts, { repo: "widgets" }, "graphql/forbidden")).toMatchObject({ unavailable: "not-authorized" });
    expect(await call(READ.listLabels, { repo: "widgets" }, "graphql/rate-limited")).toMatchObject({ transient: true });
    expect(await call(READ.listLabels, { repo: "widgets" }, "graphql/invalid-variables")).toMatchObject({ unavailable: "invalid" });
  });

  it("reads only boards on the organization's own account", async () => {
    const elsewhere = recorded("graphql/fields");
    elsewhere.data.node.owner.login = "other";
    expect(await call(READ.listProjectFields, { project_id: "PVT_9" }, { body: elsewhere })).toMatchObject({
      unavailable: "project-not-listed",
    });
    expect(await call(READ.listProjectOptions, { project_id: "PVT_gone", field: "Status" }, "graphql/no-such-node")).toMatchObject({
      unavailable: "no-such-project",
    });
    expect(await call(READ.listProjectOptions, { project_id: "PVT_1", field: "Priority" }, "graphql/fields")).toMatchObject({
      unavailable: "no-such-field",
    });
    expect(await call(READ.listProjectOptions, { project_id: "PVT_1", field: "F_1" }, "graphql/fields")).toMatchObject({
      result: { field_id: "F_1" },
    });
  });

  it("says when an issue has no card on the board", async () => {
    const run = await call(READ.findProjectItem, { project_id: "PVT_3", repo: "widgets", number: 7 }, "graphql/card");
    expect(run).toMatchObject({ unavailable: "not-on-that-board" });
  });
});

interface WriteCase {
  name: string;
  params: Record<string, unknown>;
  /** The change it makes as the member, and GitHub's answer. */
  change: [method: string, path: string, body: unknown];
  answer: string;
  result: Record<string, unknown>;
}

const WRITES: WriteCase[] = [
  {
    name: WRITE.openIssue,
    params: { repo: "widgets", title: "Broken", body: "It broke.", labels: ["bug"], assignees: ["alice"] },
    change: ["POST", "/repos/acme/widgets/issues", { title: "Broken", body: "It broke.", labels: ["bug"], assignees: ["alice"] }],
    answer: "rest/issue-created",
    result: { repository: "widgets", number: 12, html_url: "https://github.com/acme/widgets/issues/12", id: 1001 },
  },
  {
    name: WRITE.comment,
    params: { repo: "widgets", number: 7, body: "On it." },
    change: ["POST", "/repos/acme/widgets/issues/7/comments", { body: "On it." }],
    answer: "rest/comment",
    result: { repository: "widgets", number: 7, id: 5, html_url: "https://github.com/acme/widgets/issues/7#issuecomment-5" },
  },
  {
    name: WRITE.closeIssue,
    params: { repo: "widgets", number: 7, reason: "not_planned" },
    change: ["PATCH", "/repos/acme/widgets/issues/7", { state: "closed", state_reason: "not_planned" }],
    answer: "rest/issue-closed",
    result: { repository: "widgets", number: 7, state: "closed", html_url: "https://github.com/acme/widgets/issues/7" },
  },
  {
    name: WRITE.reopenIssue,
    params: { repo: "widgets", number: 7 },
    change: ["PATCH", "/repos/acme/widgets/issues/7", { state: "open" }],
    answer: "rest/issue",
    result: { repository: "widgets", number: 7, state: "open", html_url: "https://github.com/acme/widgets/issues/7" },
  },
  {
    name: WRITE.requestReview,
    params: { repo: "widgets", number: 9, reviewers: ["carol"], team_reviewers: ["core"] },
    change: ["POST", "/repos/acme/widgets/pulls/9/requested_reviewers", { reviewers: ["carol"], team_reviewers: ["core"] }],
    answer: "rest/review-requested",
    result: { repository: "widgets", number: 9, html_url: "https://github.com/acme/widgets/pull/9" },
  },
];

describe("writes", () => {
  it("covers all seven", () => {
    expect([...WRITES.map((one) => one.name), WRITE.label, WRITE.moveProjectItem].sort()).toEqual(Object.values(WRITE).sort());
  });

  for (const one of WRITES) {
    it(`${one.name} writes as the member, in the repository on the organization`, async () => {
      const run = await call(one.name, one.params, one.answer);
      const [method, path, body] = one.change;
      expect(run.requests).toEqual([{ method, url: `${API}${path}`, headers: HEADERS, body, connection: "account" }]);
      expect(run).toMatchObject({ result: one.result });
    });
  }

  it("passes GitHub's refusal of the member through", async () => {
    const missing = await call(WRITE.openIssue, { repo: "elsewhere", title: "x" }, { status: 404, body: { message: "Not Found" } });
    expect(missing).toMatchObject({ unavailable: "not-found" });
    const run = await call(WRITE.comment, { repo: "widgets", number: 7, body: "x" }, {
      status: 403,
      body: { message: "Must have push access" },
    });
    expect(run).toMatchObject({ unavailable: "not-authorized" });
    const invalid = await call(WRITE.requestReview, { repo: "widgets", number: 9 }, { status: 422 });
    expect(invalid.requests[0].body).toEqual({});
    expect(invalid).toMatchObject({ unavailable: "invalid" });
  });

  it("label reads the issue's labels, then sets them as the member", async () => {
    const run = await call(
      WRITE.label,
      { repo: "widgets", number: 7, add: ["triage", "bug"], remove: ["wontfix"] },
      "rest/issue",
      "rest/labels"
    );
    expect(run.requests).toEqual([
      { method: "GET", url: `${API}/repos/acme/widgets/issues/7`, headers: HEADERS, connection: "workspace" },
      {
        method: "PUT",
        url: `${API}/repos/acme/widgets/issues/7/labels`,
        headers: HEADERS,
        body: { labels: ["triage", "bug"] },
        connection: "account",
      },
    ]);
    expect(run).toMatchObject({ result: { repository: "widgets", number: 7 } });
  });

  it("label keeps a label named both to add and to remove, and may remove every label", async () => {
    const both = await call(WRITE.label, { repo: "widgets", number: 7, add: ["ui"], remove: ["UI", "bug"] }, "rest/issue", "rest/labels");
    expect(both.requests[1].body).toEqual({ labels: ["Wontfix", "ui"] });
    const none = await call(WRITE.label, { repo: "widgets", number: 7, remove: ["bug", "wontfix"] }, "rest/issue", "rest/labels");
    expect(none.requests[1].body).toEqual({ labels: [] });
  });

  it("label asks for a label to add or remove", async () => {
    const run = await call(WRITE.label, { repo: "widgets", number: 7 }, "rest/issue");
    expect(run.requests).toHaveLength(1);
    expect(run).toMatchObject({ unavailable: "invalid" });
  });

  it("move-project-item sets the card's field as the member", async () => {
    const params = { project_id: "PVT_1", item_id: "PVTI_7", field_id: "F_1", option_id: "O_2" };
    const run = await call(WRITE.moveProjectItem, params, "graphql/moved");
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].connection).toBe("account");
    expect(variables(run)).toEqual({ project: "PVT_1", item: "PVTI_7", field: "F_1", option: "O_2" });
    expect(run).toMatchObject({ result: { item_id: "PVTI_7" } });
  });
});
