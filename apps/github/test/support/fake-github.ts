/**
 * A fake GitHub: the installations Initiative mints tokens for, the REST and
 * GraphQL calls the endpoints make, what the hooks ask about a user token,
 * the token refresh, and grant revocation. Every API call is recorded with
 * the token it carried.
 */

import { json } from "./fake-initiative.js";

export const GITHUB_API = "https://api.github.test";
export const GITHUB_WEB = "https://github.test";

export interface Recorded {
  method: string;
  path: string;
  token: string;
  body: unknown;
}

export interface GitHubInstallation {
  owner: string;
  suspended?: boolean;
  repos: string[];
}

type GraphQLHandler = (variables: Record<string, unknown>, token: string) => { status?: number; body: unknown };
type RestHandler = (body: unknown, token: string) => { status: number; body?: unknown };

export class FakeGitHub {
  readonly installations = new Map<number, GitHubInstallation>();
  readonly calls: Recorded[] = [];
  /** GraphQL answers by operation name. */
  readonly graphql = new Map<string, GraphQLHandler>();
  /** REST answers by `METHOD /path`. */
  readonly rest = new Map<string, RestHandler>();
  /** Refresh tokens → the grant a refresh returns; absent means refused. */
  readonly refreshes = new Map<string, { access_token: string; refresh_token?: string; expires_in?: number }>();
  /** User access tokens → the login they belong to. */
  readonly users = new Map<string, string>();
  /** User access tokens → the installations that person can reach. */
  readonly userInstallations = new Map<string, Array<{ id: number; login: string }>>();
  /** User access tokens GitHub no longer recognizes. */
  readonly lapsed = new Set<string>();
  /** The access tokens whose grant was ended. */
  readonly revoked: string[] = [];
  readonly exchanges: URLSearchParams[] = [];
  /** When set, grant revocation answers with this status. */
  revokeStatus: number | null = null;
  private minted = 0;

  install(id: number, setup: Partial<GitHubInstallation> = {}): void {
    this.installations.set(id, {
      owner: setup.owner ?? "acme",
      suspended: setup.suspended,
      repos: setup.repos ?? ["widgets", "gadgets"],
    });
  }

  /**
   * What GitHub answers the GitHub App's token exchange for one installation,
   * as Initiative makes it: a token, or null for one that is gone or
   * suspended.
   */
  mint(installationId: number): string | null {
    const installation = this.installations.get(installationId);
    if (!installation || installation.suspended) return null;
    this.minted += 1;
    return `ghs_${installationId}_${this.minted}`;
  }

  /** The calls made to one path, in order. */
  callsTo(method: string, path: string): Recorded[] {
    return this.calls.filter((call) => call.method === method && call.path === path);
  }

  async handle(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : auth;
    const raw = typeof init.body === "string" ? init.body : "";
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }

    if (url.origin === GITHUB_WEB) {
      if (url.pathname === "/login/oauth/access_token" && method === "POST") {
        const form = new URLSearchParams(raw);
        this.exchanges.push(form);
        const grant = form.get("grant_type") === "refresh_token" ? this.refreshes.get(form.get("refresh_token") ?? "") : undefined;
        return grant ? json(200, grant) : json(200, { error: "bad_refresh_token" });
      }
      return json(404, { message: "Not Found" });
    }

    const path = `${url.pathname}${url.search}`;
    this.calls.push({ method, path, token, body });

    if (url.pathname === "/installation/repositories" && method === "GET") {
      const installation = this.installationOf(token);
      if (!installation) return json(401, { message: "Bad credentials" });
      if (installation.suspended) return json(403, { message: "This installation has been suspended" });
      const handler = this.rest.get("GET /installation/repositories");
      if (handler) {
        const answer = handler(undefined, token);
        return json(answer.status, answer.body ?? {});
      }
      return json(200, { total_count: installation.repos.length, repositories: installation.repos.map((name) => ({ name })) });
    }

    if (url.pathname === "/user" && method === "GET") {
      const login = this.users.get(token);
      return login ? json(200, { login, id: 1 }) : json(401, { message: "Bad credentials" });
    }

    if (url.pathname === "/user/installations" && method === "GET") {
      const held = this.userInstallations.get(token);
      if (!held) return json(401, { message: "Bad credentials" });
      return json(200, { installations: held.map(({ id, login }) => ({ id, account: { login } })) });
    }

    const grantPath = url.pathname.match(/^\/applications\/([^/]+)\/grant$/);
    if (grantPath && method === "DELETE") {
      if (this.revokeStatus !== null) return json(this.revokeStatus, { message: "Server Error" });
      const accessToken = String((body as { access_token?: unknown })?.access_token);
      if (this.lapsed.has(accessToken)) return json(404, { message: "Not Found" });
      this.revoked.push(accessToken);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/graphql" && method === "POST") {
      const { query, variables } = body as { query: string; variables: Record<string, unknown> };
      const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      const handler = this.graphql.get(name);
      if (!handler) return json(200, { data: null, errors: [{ type: "NOT_FOUND", message: `no fake for ${name}` }] });
      const answer = handler(variables, token);
      return json(answer.status ?? 200, answer.body);
    }

    const handler = this.rest.get(`${method} ${url.pathname}`);
    if (handler) {
      const answer = handler(body, token);
      return answer.status === 204 ? new Response(null, { status: 204 }) : json(answer.status, answer.body ?? {});
    }
    return json(404, { message: "Not Found" });
  }

  /** The GraphQL operations called, by name. */
  operations(): string[] {
    return this.calls
      .filter((call) => call.path === "/graphql")
      .map((call) => /(?:query|mutation)\s+(\w+)/.exec((call.body as { query: string }).query)?.[1] ?? "");
  }

  private installationOf(token: string): GitHubInstallation | undefined {
    const id = /^ghs_(\d+)_/.exec(token)?.[1];
    return id ? this.installations.get(Number(id)) : undefined;
  }
}
