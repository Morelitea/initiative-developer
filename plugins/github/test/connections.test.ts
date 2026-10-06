/**
 * The two GitHub connections Initiative runs: checking that the person
 * connecting an installation controls the account it is on, naming a member's
 * account, and asking GitHub whether the installation still exists.
 */

import { runAfterConnect, runHealth } from "initiative-plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import app from "../src/app.js";
import { ACCOUNT, WORKSPACE } from "../src/vocabulary.js";
import { recorded } from "./fixtures.js";

const API = "https://api.github.com";

const MEMBERSHIPS = `${API}/user/memberships/orgs?state=active&page=1&per_page=100`;

/**
 * Connecting the installation the install page returned, with the person's
 * installations (every page of them), their organization memberships and
 * their own account as GitHub answers them.
 */
const installed = (
  installationId: string,
  { installations = [recorded("rest/user-installations")], memberships = recorded("rest/user-memberships") }: {
    installations?: unknown[];
    memberships?: unknown;
  } = {}
) =>
  runAfterConnect(app, WORKSPACE, {
    params: { installation_id: installationId },
    responses: [...installations, memberships, recorded("rest/user")].map((body) => ({ body })),
  });

describe("after_connect for the organization", () => {
  it("records an organization's installation for one of its admins", async () => {
    const run = await installed("42");
    expect(run.requests).toEqual(
      [`${API}/user/installations?page=1&per_page=100`, MEMBERSHIPS, `${API}/user`].map((url) => ({
        method: "GET",
        url,
        headers: expect.objectContaining({ "X-GitHub-Api-Version": "2022-11-28" }),
      }))
    );
    expect(run).toMatchObject({ result: { values: { owner: "acme", installation_id: 42 }, account_label: "acme" } });
  });

  it("finds it on a later page of the person's installations", async () => {
    const others = Array.from({ length: 100 }, (_, index) => ({
      id: 1000 + index,
      account: { login: `org-${index}`, id: 5000 + index, type: "Organization" },
    }));
    const run = await installed("42", { installations: [{ installations: others }, recorded("rest/user-installations")] });
    expect(run.requests.map((request) => request.url)).toEqual([
      `${API}/user/installations?page=1&per_page=100`,
      `${API}/user/installations?page=2&per_page=100`,
      MEMBERSHIPS,
      `${API}/user`,
    ]);
    expect(run).toMatchObject({ result: { values: { owner: "acme", installation_id: 42 } } });
  });

  it("refuses an organization's installation to a member who is not its admin", async () => {
    expect(await installed("41")).toMatchObject({ refused: "installation-not-held" });
    const pending = recorded("rest/user-memberships").map((row: Record<string, unknown>) => ({ ...row, state: "pending" }));
    expect(await installed("42", { memberships: pending })).toMatchObject({ refused: "installation-not-held" });
    expect(await installed("42", { memberships: [] })).toMatchObject({ refused: "installation-not-held" });
  });

  it("records a personal account's installation for that person only", async () => {
    expect(await installed("43")).toMatchObject({
      result: { values: { owner: "alice", installation_id: 43 }, account_label: "alice" },
    });
    expect(await installed("44")).toMatchObject({ refused: "installation-not-held" });
  });

  it("refuses an installation the person does not hold", async () => {
    for (const claimed of ["45", "abc", ""]) {
      expect(await installed(claimed)).toMatchObject({ refused: "installation-not-held" });
    }
  });
});

describe("after_connect for a member", () => {
  it("names the connection by the account's login", async () => {
    const run = await runAfterConnect(app, ACCOUNT, { responses: [{ body: recorded("rest/user") }] });
    expect(run.requests.map((request) => request.url)).toEqual([`${API}/user`]);
    expect(run).toMatchObject({ result: { account_label: "alice" } });
  });
});

describe("the organization's health", () => {
  const health = (status: number, body?: unknown) =>
    runHealth(app, WORKSPACE, { fields: { owner: "acme", installation_id: 42 }, responses: [{ status, body }] });

  it("asks for one of the installation's repositories", async () => {
    const run = await health(200, recorded("rest/installation-repositories"));
    expect(run.requests.map((request) => request.url)).toEqual([`${API}/installation/repositories?per_page=1`]);
    expect(run).toMatchObject({ result: "ok" });
  });

  it("is removed once GitHub stops honouring the installation's token", async () => {
    expect(await health(401, { message: "Bad credentials" })).toMatchObject({ result: "removed" });
  });

  it("is suspended when GitHub says so", async () => {
    expect(await health(403, recorded("rest/suspended"))).toMatchObject({ result: "suspended" });
  });

  it("is unavailable on any other answer", async () => {
    expect(await health(403, recorded("rest/forbidden"))).toMatchObject({ result: "unavailable" });
    expect(await health(502)).toMatchObject({ result: "unavailable" });
  });
});
