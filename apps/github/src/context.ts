/**
 * Everything the app's endpoints and hooks share, built once from the
 * settings and handed to each as `context`.
 *
 * Outbound HTTP goes through one injectable `fetch`, and time through one
 * clock, so the tests can stand a fake GitHub and a fake Initiative behind
 * them.
 */

import type { Config } from "./config.js";
import { GitHubApp } from "./github/app.js";
import type { GitHubHttp } from "./github/http.js";
import type { OAuthClient } from "./github/oauth.js";
import { InstallRegistry } from "./installs.js";

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

export interface GitHubContext {
  config: Config;
  now: () => number;
  log: Logger;
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

export function createContext(config: Config, options: ContextOptions = {}): GitHubContext {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? consoleLogger;

  const http: GitHubHttp = { fetch: doFetch, apiBase: config.github.apiBase, now };

  return {
    config,
    now,
    log,
    http,
    github: new GitHubApp({ http, log }),
    oauth: {
      http,
      webBase: config.github.webBase,
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
    },
    installs: new InstallRegistry({ now }),
    unavailable: new Map<string, number>(),
  };
}

declare module "initiative-app-sdk/manifest" {
  interface AppContext extends GitHubContext {}
}
