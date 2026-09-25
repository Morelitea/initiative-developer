/**
 * A fake Initiative deployment, answering the calls `InitiativeAuth` makes in
 * the shapes Initiative sends: the token endpoint, the installations list, and
 * the installation's own configuration, connections, config status and
 * events. It also signs what Initiative signs for the app: context tokens and
 * connect returns.
 */

import { randomUUID } from "node:crypto";

import { audienceFor } from "initiative-app-kit";

import { PUBLIC_ID } from "../../src/vocabulary.js";
import { platform, platformJwks, signRs256 } from "./keys.js";

export const INITIATIVE_ORIGIN = "https://initiative.test";
export const INITIATIVE_BASE = `${INITIATIVE_ORIGIN}/api/v1`;

export interface MemberRow {
  connectionId: string;
  status: string;
  values: Record<string, unknown>;
}

export interface InstallState {
  installId: number;
  /** The handle Initiative minted for the community's `workspace` connection. */
  workspaceRef: string;
  workspace: Record<string, unknown> | null;
  members: Map<string, MemberRow>;
  configState: string;
  configStateDetail: string | null;
  statuses: Array<{ state: string; detail?: string }>;
  events: Array<{ event_type: string; payload: Record<string, unknown> }>;
  writes: Array<{ ref: string; body: Record<string, unknown> }>;
  /** `delegate subject` → this app's handle for that member. */
  delegated: Map<string, string>;
}

export class FakeInitiative {
  readonly installs = new Map<string, InstallState>();
  /** Which installations the listing answers with. Null: every one. */
  listed: string[] | null = null;
  /** When set, the installations list answers with this status. */
  listFails: number | null = null;
  readonly tokenRequests: URLSearchParams[] = [];
  private nextInstallId = 1;

  install(
    installation: string,
    setup: { workspace?: Record<string, unknown> | null; members?: Record<string, Record<string, unknown>> } = {}
  ): InstallState {
    const state: InstallState = {
      installId: this.nextInstallId++,
      workspaceRef: `cref_ws_${installation}`,
      workspace: setup.workspace === undefined ? { owner: "acme", installation_id: 42 } : setup.workspace,
      members: new Map(
        Object.entries(setup.members ?? {}).map(([ref, values]) => [
          ref,
          { connectionId: "account", status: "connected", values },
        ])
      ),
      configState: "unverified",
      configStateDetail: null,
      statuses: [],
      events: [],
      writes: [],
      delegated: new Map(),
    };
    this.installs.set(installation, state);
    return state;
  }

  /** A context token for one endpoint call. */
  contextToken(
    installation: string,
    endpointId: string,
    options: { connectionRefs?: Record<string, string>; claims?: Record<string, unknown>; key?: string } = {}
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return signRs256(options.key ?? platform.privateKeyPem, platform.kid, {
      jti: randomUUID(),
      iss: "initiative",
      aud: audienceFor(PUBLIC_ID),
      iat: now,
      exp: now + 60,
      guild_ref: installation,
      app_install_id: this.installs.get(installation)?.installId ?? 0,
      scope: "endpoint",
      endpoint_id: endpointId,
      ...(options.connectionRefs ? { connection_refs: options.connectionRefs } : {}),
      ...options.claims,
    });
  }

  /** A connect return, as Initiative hands one to the app's connect page. */
  connectReturn(
    installation: string,
    connectionId: string,
    connectionRef: string,
    claims: Record<string, unknown> = {}
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return signRs256(platform.privateKeyPem, platform.kid, {
      jti: randomUUID(),
      iss: "initiative",
      aud: audienceFor(PUBLIC_ID),
      iat: now,
      exp: now + 300,
      scope: "connect_return",
      guild_ref: installation,
      app_install_id: this.installs.get(installation)?.installId ?? 0,
      connection_id: connectionId,
      connection_ref: connectionRef,
      return_url: `${INITIATIVE_ORIGIN}/g/1/apps/connected?app=${PUBLIC_ID}`,
      ...claims,
    });
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
      return json(200, names.map((installation) => ({ installation, scopes: ["projects:read"], initiatives: [1] })));
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
        listing_uid: "TYG4VVZKAWRMBZ",
        listing_version: "1.0.0",
        enabled: true,
        config_state: state.configState,
        config_state_detail: state.configStateDetail,
        needs_config: state.workspace === null,
        connections: state.workspace ? { workspace: state.workspace } : {},
        member_connections: [...state.members].map(([ref, row]) => ({
          connection_id: row.connectionId,
          connection_ref: ref,
          status: row.status,
          values: row.values,
        })),
      });
    }

    if (rest === "connections/resolve" && method === "GET") {
      const ref = state.delegated.get(`${url.searchParams.get("delegate")} ${url.searchParams.get("subject")}`);
      if (!ref) return json(404, { detail: "CONNECTION_NOT_FOUND" });
      return json(200, connectionOf(ref, state.members.get(ref)));
    }

    if (rest.startsWith("connections/") && method === "PUT") {
      const ref = decodeURIComponent(rest.slice("connections/".length));
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.writes.push({ ref, body });
      const values = body.values as Record<string, unknown>;
      if (ref === state.workspaceRef) {
        state.workspace = { ...(state.workspace ?? {}), ...values };
        return json(200, connectionOf(ref, undefined));
      }
      const row = state.members.get(ref) ?? { connectionId: "account", status: "pending", values: {} };
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete row.values[key];
        else row.values[key] = value;
      }
      row.status = typeof body.status === "string" ? body.status : row.status;
      state.members.set(ref, row);
      return json(200, connectionOf(ref, row));
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
}

function connectionOf(ref: string, row: MemberRow | undefined): Record<string, unknown> {
  return {
    connection_id: row?.connectionId ?? "workspace",
    connection_ref: ref,
    status: row?.status ?? "connected",
    blocked: false,
    account_label: null,
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
