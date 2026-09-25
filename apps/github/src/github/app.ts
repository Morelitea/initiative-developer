/**
 * This app as a GitHub App: the JWT it signs as itself, the installation
 * tokens it mints from that JWT, and what it asks GitHub about an
 * installation. Tokens and repository lists are cached in memory only.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";

import { rest, type Answer, type Failure, type GitHubHttp } from "./http.js";

/** GitHub accepts an app JWT of at most ten minutes; it is back-dated for clock skew. */
const JWT_LIFETIME_SECONDS = 540;
const JWT_BACKDATE_SECONDS = 60;

/** An installation token is renewed this long before it expires. */
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

/** A permission level per GitHub permission name, as an installation was granted it. */
export type Grant = Readonly<Record<string, string>>;

const LEVELS: Readonly<Record<string, number>> = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

/** Whether a grant reaches at least `level` on `permission`. */
export function grants(grant: Grant, permission: string, level: string): boolean {
  return (LEVELS[grant[permission] ?? ""] ?? 0) >= (LEVELS[level] ?? Number.POSITIVE_INFINITY);
}

export interface InstallationToken {
  token: string;
  /** What the owner granted, as GitHub said it when minting; null when it did not say. */
  grant: Grant | null;
  expiresAt: number;
}

/** What GitHub says about an installation: whose it is, that it is suspended or gone, or nothing. */
export type InstallationLookup =
  | { state: "present"; owner: string }
  | { state: "suspended"; owner: string }
  | { state: "gone" }
  | { state: "unknown"; detail: string };

export interface GitHubAppOptions {
  http: GitHubHttp;
  webBase: string;
  clientId: string;
  privateKey: string;
  slug: string | null;
}

export class GitHubApp {
  private readonly key: KeyObject;
  private readonly tokens = new Map<number, InstallationToken>();
  private readonly minting = new Map<number, Promise<InstallationToken | null>>();
  private readonly repositories = new Map<number, { names: string[]; readAt: number }>();
  private slug: string | null;

  constructor(private readonly options: GitHubAppOptions) {
    this.key = createPrivateKey(options.privateKey);
    this.slug = options.slug;
  }

  get http(): GitHubHttp {
    return this.options.http;
  }

  /** The JWT this app signs as itself: RS256, issued by its client id. */
  jwt(): string {
    const iat = Math.floor(this.http.now() / 1000) - JWT_BACKDATE_SECONDS;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iat,
      exp: iat + JWT_BACKDATE_SECONDS + JWT_LIFETIME_SECONDS,
      iss: this.options.clientId,
    })}`;
    return `${input}.${sign("sha256", Buffer.from(input), this.key).toString("base64url")}`;
  }

  private asApp<T>(method: string, path: string): Promise<Answer<T>> {
    return rest<T>(this.http, this.jwt(), method, path);
  }

  /** The address of GitHub's own install page for this app, or null when GitHub will not name it. */
  async installUrl(): Promise<string | null> {
    if (!this.slug) {
      const answer = await this.asApp<{ slug?: unknown }>("GET", "/app");
      if (!answer.ok || typeof answer.body.slug !== "string") return null;
      this.slug = answer.body.slug;
    }
    return `${this.options.webBase}/apps/${encodeURIComponent(this.slug)}/installations/new`;
  }

  /**
   * A token that acts as this app inside one installation, or null when
   * GitHub will not mint one (the installation is gone, suspended or GitHub is
   * unreachable). Cached until shortly before it expires.
   */
  async installationToken(installationId: number): Promise<InstallationToken | null> {
    const held = this.tokens.get(installationId);
    if (held && held.expiresAt - TOKEN_SKEW_MS > this.http.now()) return held;

    const pending = this.minting.get(installationId);
    if (pending) return pending;

    const request = (async () => {
      try {
        const answer = await this.asApp<{ token?: unknown; expires_at?: unknown; permissions?: unknown }>(
          "POST",
          `/app/installations/${installationId}/access_tokens`
        );
        if (!answer.ok || typeof answer.body.token !== "string" || !answer.body.token) {
          this.tokens.delete(installationId);
          return null;
        }
        const expiresAt =
          typeof answer.body.expires_at === "string" ? Date.parse(answer.body.expires_at) : Number.NaN;
        const minted: InstallationToken = {
          token: answer.body.token,
          grant: readGrant(answer.body.permissions),
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.http.now() + TOKEN_SKEW_MS,
        };
        this.tokens.set(installationId, minted);
        return minted;
      } finally {
        this.minting.delete(installationId);
      }
    })();
    this.minting.set(installationId, request);
    return request;
  }

  /** Whose an installation is, asked with the app's own key. */
  async installation(installationId: number): Promise<InstallationLookup> {
    const answer = await this.asApp<{ account?: { login?: unknown }; suspended_at?: unknown }>(
      "GET",
      `/app/installations/${installationId}`
    );
    if (!answer.ok) {
      return answer.failure === "not-found"
        ? { state: "gone" }
        : { state: "unknown", detail: answer.message };
    }
    const login = answer.body.account?.login;
    if (typeof login !== "string" || !login) return { state: "unknown", detail: "installation names no account" };
    return answer.body.suspended_at ? { state: "suspended", owner: login } : { state: "present", owner: login };
  }

  /**
   * Every repository one installation covers, as GitHub has it now, or why
   * GitHub would not say. Never a partial list.
   */
  async installationRepositories(
    installationId: number
  ): Promise<{ names: string[] } | { failure: Failure }> {
    const held = this.repositories.get(installationId);
    if (held && held.readAt > this.http.now() - REPOSITORY_TTL_MS) return { names: held.names };

    const minted = await this.installationToken(installationId);
    if (!minted) return { failure: "vendor-error" };

    const names: string[] = [];
    for (let page = 1; page <= REPOSITORY_PAGES; page += 1) {
      const answer = await rest<{ repositories?: unknown }>(
        this.http,
        minted.token,
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
    this.repositories.set(installationId, { names, readAt: this.http.now() });
    return { names };
  }

  /** Drop what is cached for an installation, because it changed or is gone. */
  forget(installationId: number): void {
    this.tokens.delete(installationId);
    this.repositories.delete(installationId);
  }

  /** Drop only the repository list, because GitHub said it changed. */
  forgetRepositories(installationId: number): void {
    this.repositories.delete(installationId);
  }
}

/** `null` is "GitHub did not say", which is never read as "granted nothing". */
function readGrant(said: unknown): Grant | null {
  if (!said || typeof said !== "object" || Array.isArray(said)) return null;
  const grant: Record<string, string> = {};
  for (const [permission, level] of Object.entries(said as Record<string, unknown>)) {
    if (typeof level === "string") grant[permission] = level;
  }
  return grant;
}
