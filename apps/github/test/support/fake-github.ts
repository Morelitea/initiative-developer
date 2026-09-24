/**
 * A fake GitHub: the app endpoints (installation tokens, installations), the
 * REST and GraphQL calls the endpoints make, the user authorization pages and
 * token exchange, and grant revocation. Every call is recorded with the token
 * it carried.
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
  permissions: Record<string, string>;
}

type GraphQLHandler = (variables: Record<string, unknown>, token: string) => { status?: number; body: unknown };
type RestHandler = (body: unknown, token: string) => { status: number; body?: unknown };

export const FULL_PERMISSIONS = {
  issues: "write",
  pull_requests: "write",
  vulnerability_alerts: "read",
  organization_projects: "write",
  metadata: "read",
};

export class FakeGitHub {
  readonly installations = new Map<number, GitHubInstallation>();
  readonly calls: Recorded[] = [];
  /** GraphQL answers by operation name. */
  readonly graphql = new Map<string, GraphQLHandler>();
  /** REST answers by `METHOD /path`. */
  readonly rest = new Map<string, RestHandler>();
  /** Authorization codes a person comes back with → the grant they exchange for. */
  readonly codes = new Map<string, { access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>();
  /** Refresh tokens → the grant a refresh returns; absent means refused. */
  readonly refreshes = new Map<string, { access_token: string; refresh_token?: string; expires_in?: number }>();
  /** Access tokens → the installations that person can reach. */
  readonly userInstallations = new Map<string, Array<{ id: number; login: string }>>();
  readonly revoked: string[] = [];
  readonly exchanges: URLSearchParams[] = [];
  private minted = 0;

  install(id: number, setup: Partial<GitHubInstallation> = {}): void {
    this.installations.set(id, {
      owner: setup.owner ?? "acme",
      repos: setup.repos ?? ["widgets", "gadgets"],
      permissions: setup.permissions ?? { ...FULL_PERMISSIONS },
    });
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
        if (form.get("grant_type") === "refresh_token") {
          const grant = this.refreshes.get(form.get("refresh_token") ?? "");
          return grant ? json(200, grant) : json(200, { error: "bad_refresh_token" });
        }
        const grant = this.codes.get(form.get("code") ?? "");
        return grant ? json(200, grant) : json(200, { error: "bad_verification_code" });
      }
      return json(404, { message: "Not Found" });
    }

    const path = `${url.pathname}${url.search}`;
    this.calls.push({ method, path, token, body });

    if (method === "GET" && url.pathname === "/app") return json(200, { slug: "initiative-test" });

    const tokenPath = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (tokenPath && method === "POST") {
      const installation = this.installations.get(Number(tokenPath[1]));
      if (!installation) return json(404, { message: "Not Found" });
      this.minted += 1;
      return json(201, {
        token: `ghs_${tokenPath[1]}_${this.minted}`,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        permissions: installation.permissions,
      });
    }

    const installationPath = url.pathname.match(/^\/app\/installations\/(\d+)$/);
    if (installationPath && method === "GET") {
      const installation = this.installations.get(Number(installationPath[1]));
      return installation
        ? json(200, {
            id: Number(installationPath[1]),
            account: { login: installation.owner },
            suspended_at: installation.suspended ? "2026-09-20T00:00:00Z" : null,
          })
        : json(404, { message: "Not Found" });
    }

    if (url.pathname === "/installation/repositories" && method === "GET") {
      const installation = this.installationOf(token);
      if (!installation) return json(401, { message: "Bad credentials" });
      const handler = this.rest.get("GET /installation/repositories");
      if (handler) {
        const answer = handler(undefined, token);
        return json(answer.status, answer.body ?? {});
      }
      return json(200, { total_count: installation.repos.length, repositories: installation.repos.map((name) => ({ name })) });
    }

    if (url.pathname === "/user/installations" && method === "GET") {
      const held = this.userInstallations.get(token);
      if (!held) return json(401, { message: "Bad credentials" });
      return json(200, { installations: held.map(({ id, login }) => ({ id, account: { login } })) });
    }

    const grantPath = url.pathname.match(/^\/applications\/([^/]+)\/grant$/);
    if (grantPath && method === "DELETE") {
      this.revoked.push(String((body as { access_token?: unknown })?.access_token));
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
