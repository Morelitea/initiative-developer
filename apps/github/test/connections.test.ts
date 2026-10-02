/**
 * The two GitHub connections Initiative runs: checking an organization's
 * installation against the admin's own once they connect it, naming a
 * member's account, and asking GitHub whether the installation still exists.
 */

import { runAfterConnect, runHealth } from "initiative-app-sdk/testing";
import { describe, expect, it } from "vitest";

import app from "../src/app.js";
import { ACCOUNT, WORKSPACE } from "../src/vocabulary.js";
import { recorded } from "./fixtures.js";

const API = "https://api.github.com";

const installed = (installationId: string, ...pages: unknown[]) =>
  runAfterConnect(app, WORKSPACE, {
    params: { installation_id: installationId },
    responses: (pages.length ? pages : [recorded("rest/user-installations")]).map((body) => ({ body })),
  });

describe("after_connect for the organization", () => {
  it("records the installation the admin holds, with its account", async () => {
    const run = await installed("42");
    expect(run.requests).toEqual([
      {
        method: "GET",
        url: `${API}/user/installations?page=1&per_page=100`,
        headers: expect.objectContaining({ "X-GitHub-Api-Version": "2022-11-28" }),
      },
    ]);
    expect(run).toMatchObject({ result: { values: { owner: "acme", installation_id: 42 }, account_label: "acme" } });
  });

  it("finds it on a later page of the admin's installations", async () => {
    const others = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + index, account: { login: `org-${index}` } }));
    const run = await installed("42", { installations: others }, recorded("rest/user-installations"));
    expect(run.requests.map((request) => request.url)).toEqual([
      `${API}/user/installations?page=1&per_page=100`,
      `${API}/user/installations?page=2&per_page=100`,
    ]);
    expect(run).toMatchObject({ result: { values: { owner: "acme", installation_id: 42 } } });
  });

  it("refuses an installation the admin does not hold", async () => {
    for (const claimed of ["43", "abc", ""]) {
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
