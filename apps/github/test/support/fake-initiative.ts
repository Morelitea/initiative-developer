/**
 * A fake Initiative deployment, answering the calls `InitiativeAuth` makes in
 * the shapes Initiative sends: the token endpoint, the installations list (a
 * page of one at a time, so every listing follows its `Link`), and the
 * installation's own configuration, connection tokens, config status and
 * events. It also signs what Initiative signs for the app: context tokens for
 * endpoint calls and lifecycle tokens for hook calls.
 *
 * Connection tokens are answered as Initiative answers them: a member's from
 * the connection it holds, and the community's minted from the fake GitHub's
 * installation and reused, as Initiative reuses a minted token until shortly
 * before it expires.
 */

import { randomUUID } from "node:crypto";

import { audienceFor } from "initiative-app-kit";

import { PUBLIC_ID } from "../../src/vocabulary.js";
import type { FakeGitHub } from "./fake-github.js";
import { platform, platformJwks, signRs256 } from "./keys.js";

export const INITIATIVE_ORIGIN = "https://initiative.test";
export const INITIATIVE_BASE = `${INITIATIVE_ORIGIN}/api/v1`;

export interface MemberRow {
  connectionId: string;
  status: "connected" | "expired";
  blocked: boolean;
  accessToken: string;
}

export interface InstallState {
  installId: number;
  /** The handle Initiative minted for the community's `workspace` connection. */
  workspaceRef: string;
  workspace: Record<string, unknown> | null;
  /** The installation token Initiative last minted, reused until it is cleared. */
  minted: string | null;
  members: Map<string, MemberRow>;
  configState: string;
  configStateDetail: string | null;
  statuses: Array<{ state: string; detail?: string }>;
  events: Array<{ event_type: string; payload: Record<string, unknown> }>;
  /** Every connection handle a token was asked for, in order. */
  tokenAsks: string[];
}

export class FakeInitiative {
  readonly installs = new Map<string, InstallState>();
  /** Which installations the listing answers with. Null: every one. */
  listed: string[] | null = null;
  /** When set, the installations list answers with this status. */
  listFails: number | null = null;
  /** Installations the listing reports as paused: switched off, or their community on hold. */
  readonly inactive = new Set<string>();
  readonly tokenRequests: URLSearchParams[] = [];
  /** When set, every connection token answers with this status. */
  connectionTokenFails: number | null = null;
  private nextInstallId = 1;

  constructor(private readonly github: FakeGitHub) {}

  /** An installation; `members` maps each connection handle to the GitHub token Initiative holds for it. */
  install(
    installation: string,
    setup: { workspace?: Record<string, unknown> | null; members?: Record<string, string> } = {}
  ): InstallState {
    const state: InstallState = {
      installId: this.nextInstallId++,
      workspaceRef: `cref_ws_${installation}`,
      workspace: setup.workspace === undefined ? { owner: "acme", installation_id: 42 } : setup.workspace,
      minted: null,
      members: new Map(
        Object.entries(setup.members ?? {}).map(([ref, accessToken]) => [
          ref,
          { connectionId: "account", status: "connected", blocked: false, accessToken },
        ])
      ),
      configState: "unverified",
      configStateDetail: null,
      statuses: [],
      events: [],
      tokenAsks: [],
    };
    this.installs.set(installation, state);
    return state;
  }

  private sign(installation: string, claims: Record<string, unknown>, key?: string): string {
    const now = Math.floor(Date.now() / 1000);
    return signRs256(key ?? platform.privateKeyPem, platform.kid, {
      jti: randomUUID(),
      iss: "initiative",
      aud: audienceFor(PUBLIC_ID),
      iat: now,
      exp: now + 60,
      guild_ref: installation,
      app_install_id: this.installs.get(installation)?.installId ?? 0,
      ...claims,
    });
  }

  /** A context token for one endpoint call. */
  contextToken(
    installation: string,
    endpointId: string,
    options: { connectionRefs?: Record<string, string>; claims?: Record<string, unknown>; key?: string } = {}
  ): string {
    return this.sign(
      installation,
      {
        scope: "endpoint",
        endpoint_id: endpointId,
        ...(options.connectionRefs ? { connection_refs: options.connectionRefs } : {}),
        ...options.claims,
      },
      options.key
    );
  }

  /** A lifecycle token for one hook call. */
  hookToken(installation: string, hook: string, options: { claims?: Record<string, unknown>; key?: string } = {}): string {
    return this.sign(installation, { scope: "lifecycle", hook, ...options.claims }, options.key);
  }

  async handle(url: URL, init: RequestInit): Promise<Response> {
    const path = url.pathname;
    const method = (init.method ?? "GET").toUpperCase();
    const bearer = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";

    if (path === "/api/v1/app-platform/jwks.json") return json(200, platformJwks);

    if (path === "/api/v1/app-platform/oauth/token" && method === "POST") {
      const form = new URLSearchParams(String(init.body ?? ""));
      this.tokenRequests.push(form);
      if (form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" || !form.get("client_assertion")) {
        return json(401, { error: "invalid_client" });
      }
      const installation = form.get("installation");
      if (installation === null) return json(200, { access_token: "app-token", token_type: "Bearer", expires_in: 600 });
      if (!this.installs.has(installation)) return json(400, { error: "invalid_grant", error_description: "unknown installation" });
      return json(200, { access_token: `inst:${installation}`, token_type: "Bearer", expires_in: 600, scope: "projects:read" });
    }

    if (path === "/api/v1/app-platform/installations" && method === "GET") {
      if (bearer !== "app-token") return json(401, { detail: "unauthorized" });
      if (this.listFails !== null) return json(this.listFails, { detail: "unavailable" });
      const names = this.listed ?? [...this.installs.keys()];
      const at = Number(url.searchParams.get("cursor") ?? 0);
      const page = json(
        200,
        names.slice(at, at + 1).map((installation) => ({ installation, active: !this.inactive.has(installation) }))
      );
      if (at + 1 < names.length) page.headers.set("Link", `<?cursor=${at + 1}>; rel="next"`);
      return page;
    }

    const prefix = "/api/v1/app-platform/installation/";
    if (!path.startsWith(prefix)) return json(404, { detail: "not_found" });
    const installation = bearer.startsWith("inst:") ? bearer.slice("inst:".length) : "";
    const state = this.installs.get(installation);
    const listed = this.listed ?? [...this.installs.keys()];
    if (!state || !listed.includes(installation)) return json(401, { detail: "unauthorized" });
    const rest = path.slice(prefix.length);

    if (rest === "config" && method === "GET") {
      return json(200, {
        guild_ref: installation,
        install_id: state.installId,
        listing_uid: "XTEAP993JW1E94",
        listing_version: "2.0.0",
        enabled: true,
        config_state: state.configState,
        config_state_detail: state.configStateDetail,
        needs_config: state.workspace === null,
        connections: state.workspace ? { workspace: state.workspace } : {},
        connection_refs: state.workspace ? { workspace: state.workspaceRef } : {},
        // A flow connection's tokens are never in the configuration.
        member_connections: [...state.members].map(([ref, row]) => ({
          connection_id: row.connectionId,
          connection_ref: ref,
          status: row.status,
          values: {},
        })),
      });
    }

    const tokenPath = /^connections\/([^/]+)\/token$/.exec(rest);
    if (tokenPath && method === "POST") {
      const ref = decodeURIComponent(tokenPath[1]);
      state.tokenAsks.push(ref);
      if (this.connectionTokenFails !== null) return json(this.connectionTokenFails, { detail: "APP_CHANNEL_TOKEN_UNAVAILABLE" });
      return this.connectionToken(state, ref);
    }

    if (rest === "config-status" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { state: string; detail?: string };
      state.statuses.push(body);
      state.configState = body.state;
      state.configStateDetail = body.detail ?? null;
      return json(200, {
        guild_ref: installation,
        install_id: state.installId,
        config_state: state.configState,
        config_state_detail: state.configStateDetail,
      });
    }

    if (rest === "events" && method === "POST") {
      state.events.push(JSON.parse(String(init.body)));
      return json(202, { status: "accepted" });
    }

    return json(404, { detail: "not_found" });
  }

  private connectionToken(state: InstallState, ref: string): Response {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    if (ref === state.workspaceRef) {
      if (!state.workspace) return json(409, { detail: "APP_CHANNEL_CONNECTION_NO_TOKEN" });
      if (!state.minted) {
        state.minted = this.github.mint(Number(state.workspace.installation_id));
        if (!state.minted) return json(502, { detail: "APP_CHANNEL_TOKEN_UNAVAILABLE" });
      }
      return json(200, { access_token: state.minted, expires_at: expiresAt });
    }
    const row = state.members.get(ref);
    if (!row) return json(404, { detail: "APP_CHANNEL_CONNECTION_NOT_FOUND" });
    if (row.blocked) return json(403, { detail: "APP_CHANNEL_CONNECTION_BLOCKED" });
    if (row.status === "expired") return json(409, { detail: "APP_CHANNEL_CONNECTION_EXPIRED" });
    return json(200, { access_token: row.accessToken, expires_at: expiresAt });
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
