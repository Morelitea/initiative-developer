/**
 * Everything the app's routes and jobs share, built once from the settings.
 *
 * Outbound HTTP goes through one injectable `fetch`, and time through one
 * clock, so the tests can stand a fake GitHub and a fake Initiative behind
 * them.
 */

import { InitiativeAuth, JwksCache, loadPrivateKey, publicJwks, type Jwks } from "initiative-app-kit";

import type { Config } from "./config.js";
import { GitHubApp } from "./github/app.js";
import type { GitHubHttp } from "./github/http.js";
import type { OAuthClient } from "./github/oauth.js";
import { revokeMember } from "./credentials.js";
import { FlowStore } from "./flows.js";
import { InstallRegistry } from "./installs.js";
import { PUBLIC_ID } from "./vocabulary.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, error) => (error === undefined ? console.error(message) : console.error(message, error)),
};

export interface AppContext {
  config: Config;
  now: () => number;
  log: Logger;
  auth: InitiativeAuth;
  jwks: JwksCache;
  /** The app's own public key, served for a deployment that registers it by address. */
  publicJwks: Jwks;
  github: GitHubApp;
  oauth: OAuthClient;
  installs: InstallRegistry;
  flows: FlowStore;
  /** Revocations started in the background, so a test or a shutdown can wait for them. */
  pending: Set<Promise<unknown>>;
}

export interface ContextOptions {
  fetch?: typeof fetch;
  now?: () => number;
  log?: Logger;
}

export function createContext(config: Config, options: ContextOptions = {}): AppContext {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? consoleLogger;

  const http: GitHubHttp = { fetch: doFetch, apiBase: config.github.apiBase, now };
  const auth = new InitiativeAuth({
    baseUrl: config.initiative.baseUrl,
    clientId: PUBLIC_ID,
    privateKey: config.initiative.privateKey,
    kid: config.initiative.keyId,
    fetch: doFetch,
    clock: now,
  });

  const context = {
    config,
    now,
    log,
    auth,
    jwks: new JwksCache({ fetchImpl: doFetch, now }),
    publicJwks: publicJwks(loadPrivateKey(config.initiative.privateKey, config.initiative.keyId)),
    github: new GitHubApp({
      http,
      webBase: config.github.webBase,
      clientId: config.github.clientId,
      privateKey: config.github.privateKey,
      slug: config.github.appSlug,
    }),
    oauth: {
      http,
      webBase: config.github.webBase,
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
    },
    flows: new FlowStore(now),
    pending: new Set<Promise<unknown>>(),
  } as Omit<AppContext, "installs"> as AppContext;

  context.installs = new InstallRegistry({
    auth,
    now,
    // Initiative deleted its copy: the member disconnected, was blocked, or
    // left. Their authorization at GitHub ends too.
    onMemberGone: (installation, credential) => {
      track(context, revokeMember(context, credential), `revoke a member of ${installation}`);
    },
  });
  return context;
}

/** Run something in the background, logging a failure rather than losing it. */
export function track(context: AppContext, work: Promise<unknown>, what: string): void {
  const guarded = work.catch((error) => context.log.error(`could not ${what}`, error));
  context.pending.add(guarded);
  void guarded.finally(() => context.pending.delete(guarded));
}

/** Wait for every background job started so far. */
export async function settle(context: AppContext): Promise<void> {
  while (context.pending.size) await Promise.all([...context.pending]);
}
