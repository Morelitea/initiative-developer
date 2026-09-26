/**
 * Everything the app's routes and hooks share, built once from the settings.
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
  http: GitHubHttp;
  github: GitHubApp;
  /** The GitHub App's client, for ending a member's authorization. */
  oauth: OAuthClient;
  installs: InstallRegistry;
  /** Installation checks in a row on which Initiative could get no token, by installation. */
  unavailable: Map<string, number>;
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

  return {
    config,
    now,
    log,
    auth,
    jwks: new JwksCache({ fetchImpl: doFetch, now }),
    publicJwks: publicJwks(loadPrivateKey(config.initiative.privateKey, config.initiative.keyId)),
    http,
    github: new GitHubApp({ http, auth, log }),
    oauth: {
      http,
      webBase: config.github.webBase,
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
    },
    installs: new InstallRegistry({ auth, now }),
    unavailable: new Map<string, number>(),
  };
}
