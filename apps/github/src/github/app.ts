/**
 * The community's GitHub installation, as this app reaches it: the token that
 * acts inside it, which Initiative mints from the GitHub App's key and hands
 * over by the community connection's handle, the repositories it covers, and
 * whether GitHub still has it. Tokens and repository lists are cached in
 * memory only.
 */

import { InitiativeApiError, type InitiativeAuth } from "initiative-app-kit";

import type { Logger } from "../context.js";
import type { Workspace } from "../installs.js";
import { rest, type Failure, type GitHubHttp } from "./http.js";

/** An installation token is asked for again this long before it expires. */
const TOKEN_SKEW_MS = 60_000;

/** How long an installation's repository list is reused. */
export const REPOSITORY_TTL_MS = 15 * 60_000;

const PER_PAGE = 100;
const REPOSITORY_PAGES = 5;

/**
 * The permissions the GitHub App registration asks for. Initiative shows them
 * to a member about to connect, and the README lists them for whoever
 * registers the GitHub App.
 */
export const PERMISSIONS: Readonly<Record<string, string>> = {
  issues: "write",
  pull_requests: "write",
  vulnerability_alerts: "read",
  organization_projects: "write",
  metadata: "read",
};

/** The webhook events the GitHub App registration subscribes to. */
export const WEBHOOK_EVENTS: readonly string[] = ["issues", "pull_request"];

/**
 * Whether GitHub still has an installation: present, suspended by its owner,
 * gone, not mintable (Initiative could not get a token for it), or not known
 * because something could not be asked.
 */
export type InstallationCheck =
  | { state: "present" }
  | { state: "suspended" }
  | { state: "gone" }
  | { state: "unavailable" }
  | { state: "unknown"; detail: string };

interface HeldToken {
  token: string;
  expiresAt: number;
  installationId: number;
}

export interface GitHubAppOptions {
  http: GitHubHttp;
  auth: InitiativeAuth;
  log: Logger;
}

export class GitHubApp {
  /** Installation tokens, by the Initiative installation they were asked for. */
  private readonly tokens = new Map<string, HeldToken>();
  private readonly asking = new Map<string, Promise<string | null>>();
  private readonly repositories = new Map<number, { names: string[]; readAt: number }>();

  constructor(private readonly options: GitHubAppOptions) {}

  get http(): GitHubHttp {
    return this.options.http;
  }

  /**
   * A token that acts as this app inside the community's GitHub installation,
   * or null when Initiative will not hand one over (GitHub would not mint it,
   * or the configuration is not complete). Cached until shortly before it
   * expires.
   */
  async installationToken(installation: string, workspace: Workspace): Promise<string | null> {
    const held = this.tokens.get(installation);
    if (held && held.installationId === workspace.installationId && held.expiresAt - TOKEN_SKEW_MS > this.http.now()) {
      return held.token;
    }
    const pending = this.asking.get(installation);
    if (pending) return pending;
    const request = this.ask(installation, workspace)
      .then((token) => token.accessToken)
      .catch((error: unknown) => {
        this.tokens.delete(installation);
        this.options.log.warn(`no installation token for ${installation}: ${(error as Error).message}`);
        return null;
      })
      .finally(() => this.asking.delete(installation));
    this.asking.set(installation, request);
    return request;
  }

  private async ask(installation: string, workspace: Workspace): Promise<{ accessToken: string }> {
    const answer = await this.options.auth.connectionToken(installation, workspace.ref);
    if (answer.expiresAt !== null) {
      this.tokens.set(installation, {
        token: answer.accessToken,
        expiresAt: answer.expiresAt,
        installationId: workspace.installationId,
      });
    }
    return answer;
  }

  /**
   * Whether GitHub still has the community's installation: a fresh token is
   * asked of Initiative and shown to GitHub once.
   */
  async check(installation: string, workspace: Workspace): Promise<InstallationCheck> {
    let token: string;
    try {
      token = (await this.ask(installation, workspace)).accessToken;
    } catch (error) {
      this.tokens.delete(installation);
      // Initiative asked GitHub for a token and got none.
      if (error instanceof InitiativeApiError && error.status === 502) return { state: "unavailable" };
      return { state: "unknown", detail: (error as Error).message };
    }
    const answer = await rest(this.http, token, "GET", "/installation/repositories?per_page=1");
    if (answer.ok) return { state: "present" };
    if (answer.status === 401) {
      // GitHub no longer honours the installation's token: the installation was removed.
      this.forget(workspace.installationId);
      return { state: "gone" };
    }
    if (answer.status === 403 && /suspended/i.test(answer.message)) {
      this.forget(workspace.installationId);
      return { state: "suspended" };
    }
    return { state: "unknown", detail: answer.message };
  }

  /**
   * Every repository the community's installation covers, as GitHub has it
   * now, or why GitHub would not say. Never a partial list.
   */
  async installationRepositories(
    installation: string,
    workspace: Workspace
  ): Promise<{ names: string[] } | { failure: Failure }> {
    const held = this.repositories.get(workspace.installationId);
    if (held && held.readAt > this.http.now() - REPOSITORY_TTL_MS) return { names: held.names };

    const token = await this.installationToken(installation, workspace);
    if (!token) return { failure: "vendor-error" };

    const names: string[] = [];
    for (let page = 1; page <= REPOSITORY_PAGES; page += 1) {
      const answer = await rest<{ repositories?: unknown }>(
        this.http,
        token,
        "GET",
        `/installation/repositories?per_page=${PER_PAGE}&page=${page}`
      );
      if (!answer.ok) return { failure: answer.failure };
      if (!Array.isArray(answer.body.repositories)) return { failure: "vendor-error" };
      for (const entry of answer.body.repositories) {
        const name = (entry as { name?: unknown } | null)?.name;
        if (typeof name === "string" && name) names.push(name);
      }
      if (answer.body.repositories.length < PER_PAGE) break;
    }
    this.repositories.set(workspace.installationId, { names, readAt: this.http.now() });
    return { names };
  }

  /** Drop what is cached for a GitHub installation, because it changed or is gone. */
  forget(installationId: number): void {
    for (const [installation, held] of this.tokens) {
      if (held.installationId === installationId) this.tokens.delete(installation);
    }
    this.repositories.delete(installationId);
  }

  /** Drop only the repository list, because GitHub said it changed. */
  forgetRepositories(installationId: number): void {
    this.repositories.delete(installationId);
  }

  /** Drop the token held for one community, because its installation is gone from Initiative. */
  forgetInstallation(installation: string): void {
    this.tokens.delete(installation);
  }
}
