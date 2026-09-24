/**
 * The app, running on a real port, with its outbound calls answered by a fake
 * GitHub and a fake Initiative.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import type { Config } from "../../src/config.js";
import { createContext, settle, type AppContext, type Logger } from "../../src/context.js";
import { createAppServer } from "../../src/server.js";
import { InstallationSync } from "../../src/sync.js";
import { ENDPOINTS_PATH } from "initiative-app-kit";
import { FakeGitHub, GITHUB_API, GITHUB_WEB } from "./fake-github.js";
import { FakeInitiative, INITIATIVE_BASE, INITIATIVE_ORIGIN } from "./fake-initiative.js";
import { appKey, githubAppKey } from "./keys.js";

export const WEBHOOK_SECRET = "webhook-secret-for-tests";
export const PUBLIC_URL = "https://github-app.test";

export interface Harness {
  initiative: FakeInitiative;
  github: FakeGitHub;
  context: AppContext;
  sync: InstallationSync;
  url: string;
  logs: string[];
  /** Call one endpoint as Initiative would. */
  invoke(
    installation: string,
    endpoint: string,
    params?: Record<string, unknown>,
    options?: { connectionRefs?: Record<string, string>; token?: string }
  ): Promise<{ status: number; body: Record<string, any> }>;
  /** Visit a browser route without following its redirect. */
  visit(path: string): Promise<{ status: number; location: string | null; text: string }>;
  settle(): Promise<void>;
  close(): Promise<void>;
}

export function testConfig(): Config {
  return {
    port: 0,
    publicUrl: PUBLIC_URL,
    initiative: { baseUrl: INITIATIVE_BASE, privateKey: appKey.privateKeyPem, keyId: appKey.kid },
    github: {
      clientId: "Iv1.testclient",
      clientSecret: "client-secret-for-tests",
      privateKey: githubAppKey,
      webhookSecret: WEBHOOK_SECRET,
      appSlug: null,
      apiBase: GITHUB_API,
      webBase: GITHUB_WEB,
    },
    syncIntervalSeconds: 300,
  };
}

export async function startHarness(): Promise<Harness> {
  const initiative = new FakeInitiative();
  const github = new FakeGitHub();
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

  const context = createContext(testConfig(), { fetch: outbound, log });
  const sync = new InstallationSync(context);
  const server: Server = createAppServer(context, { ready: () => sync.ready });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    initiative,
    github,
    context,
    sync,
    url,
    logs,
    async invoke(installation, endpoint, params = {}, options = {}) {
      const token =
        options.token ?? initiative.contextToken(installation, endpoint, { connectionRefs: options.connectionRefs });
      const response = await fetch(`${url}${ENDPOINTS_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, guild_ref: installation, params }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    },
    async visit(path) {
      const response = await fetch(`${url}${path}`, { redirect: "manual" });
      return { status: response.status, location: response.headers.get("location"), text: await response.text() };
    },
    settle: () => settle(context),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
