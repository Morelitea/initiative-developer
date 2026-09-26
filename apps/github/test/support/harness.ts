/**
 * The app, running on a real port, with its outbound calls answered by a fake
 * GitHub and a fake Initiative.
 */

import type { AddressInfo } from "node:net";

import { Initiative, loadPrivateKey, type Client } from "initiative-app-sdk/client";
import { createApp, serve } from "initiative-app-sdk/server";

import app from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createContext, type GitHubContext, type Logger } from "../../src/context.js";
import { PUBLIC_ID } from "../../src/vocabulary.js";
import { FakeGitHub, GITHUB_API, GITHUB_WEB } from "./fake-github.js";
import { FakeInitiative, INITIATIVE_BASE, INITIATIVE_ORIGIN } from "./fake-initiative.js";
import { appKey } from "./keys.js";

export const CLIENT_ID = "Iv1.testclient";
export const CLIENT_SECRET = "client-secret-for-tests";

/** How one endpoint call is made: the handles that travel, extra claims, or a token of the test's own. */
export interface CallOptions {
  connectionRefs?: Record<string, string>;
  claims?: Record<string, unknown>;
  token?: string;
}

/** The app whose calls reach this one through Initiative in the tests. */
export const CALLER = "morelitea.automations";

/**
 * Another app's call through Initiative, as a member: Initiative names the
 * member by this app's reference for them and hands on only their own
 * `account` handle, when they have connected one.
 */
export function asMember(accountRef?: string): CallOptions {
  return {
    connectionRefs: accountRef ? { account: accountRef } : {},
    claims: { act: { sub: CALLER }, actor: "member", member: "uref_alice" },
  };
}

/** Another app's call through Initiative, as the community: only the community's `workspace` handle travels. */
export function asCommunity(installation: string): CallOptions {
  return {
    connectionRefs: { workspace: `cref_ws_${installation}` },
    claims: { act: { sub: CALLER }, actor: "installation" },
  };
}

export interface Harness {
  initiative: FakeInitiative;
  github: FakeGitHub;
  context: GitHubContext;
  url: string;
  logs: string[];
  /**
   * Call one endpoint as Initiative would: for a widget by default, or for
   * another app when `claims` names it (`act`, `actor`, `member`).
   */
  invoke(
    installation: string,
    endpoint: string,
    params?: Record<string, unknown>,
    options?: CallOptions
  ): Promise<{ status: number; body: Record<string, any> }>;
  /** Call one hook as Initiative would. */
  hook(
    installation: string,
    name: string,
    body: unknown,
    options?: { token?: string }
  ): Promise<{ status: number; body: Record<string, any> | null }>;
  /** Initiative as the app reaches it, acting as one installation. */
  client(installation: string): Client;
  close(): Promise<void>;
}

export function testConfig(): Config {
  return {
    port: 0,
    initiative: { baseUrl: INITIATIVE_BASE, privateKey: appKey.privateKeyPem, keyId: appKey.kid },
    github: {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      apiBase: GITHUB_API,
      webBase: GITHUB_WEB,
    },
  };
}

export async function startHarness(): Promise<Harness> {
  const github = new FakeGitHub();
  const initiative = new FakeInitiative(github);
  const logs: string[] = [];
  const log: Logger = {
    info: (message) => logs.push(`info ${message}`),
    warn: (message) => logs.push(`warn ${message}`),
    error: (message, error) => logs.push(`error ${message} ${error ?? ""}`),
  };

  const outbound = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === INITIATIVE_ORIGIN) return initiative.handle(url, init);
    if (url.origin === GITHUB_API || url.origin === GITHUB_WEB) return github.handle(url, init);
    throw new Error(`unexpected call to ${url}`);
  }) as typeof fetch;

  const config = testConfig();
  const context = createContext(config, { fetch: outbound, log });
  const key = { privateKey: config.initiative.privateKey, kid: config.initiative.keyId };
  const server = serve(
    createApp(app, { baseUrl: config.initiative.baseUrl, key, context, fetch: outbound, log }),
    { port: 0, hostname: "127.0.0.1" }
  );
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const initiativeClient = new Initiative({
    baseUrl: config.initiative.baseUrl,
    publicId: PUBLIC_ID,
    key: loadPrivateKey(key.privateKey, key.kid),
    fetch: outbound,
  });

  return {
    initiative,
    github,
    context,
    url,
    logs,
    async invoke(installation, endpoint, params = {}, options = {}) {
      const token =
        options.token ??
        initiative.contextToken(installation, endpoint, { connectionRefs: options.connectionRefs, claims: options.claims });
      const response = await fetch(`${url}/v1/endpoints`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, guild_ref: installation, params }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    },
    async hook(installation, name, body, options = {}) {
      const token = options.token ?? initiative.hookToken(installation, name);
      const response = await fetch(`${url}/v1/hooks/${name}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null };
    },
    client: (installation) => initiativeClient.asInstallation(installation),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
