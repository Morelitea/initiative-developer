/**
 * GitHub's user authorization for this GitHub App: sending a person to
 * authorize, exchanging the code they come back with, refreshing the token it
 * produced, and ending the authorization when the app is done with them.
 */

import { createHash, randomBytes } from "node:crypto";

import { GITHUB_TIMEOUT_MS, headers, type GitHubHttp } from "./http.js";

export interface OAuthClient {
  http: GitHubHttp;
  webBase: string;
  clientId: string;
  clientSecret: string;
}

/** A user token and what it takes to renew it. Times are milliseconds since the epoch. */
export interface UserGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
}

export type GrantAnswer =
  | { ok: true; grant: UserGrant }
  | { ok: false; reason: "refused" | "unreachable"; detail: string };

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

/** Where to send a person to authorize this app. */
export function authorizeUrl(
  client: OAuthClient,
  options: { state: string; redirectUri: string; challenge: string }
): string {
  const query = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: options.redirectUri,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
  });
  return `${client.webBase}/login/oauth/authorize?${query.toString()}`;
}

/** Exchange the code a person came back with. */
export function exchangeCode(
  client: OAuthClient,
  options: { code: string; redirectUri: string; verifier: string }
): Promise<GrantAnswer> {
  return tokenRequest(client, {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.verifier,
  });
}

/** Renew a user token. A refresh token is spent by using it. */
export function refreshGrant(client: OAuthClient, refreshToken: string): Promise<GrantAnswer> {
  return tokenRequest(client, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(
  client: OAuthClient,
  form: Record<string, string>
): Promise<GrantAnswer> {
  let response: Response;
  try {
    response = await client.http.fetch(`${client.webBase}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "initiative-github",
      },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        ...form,
      }).toString(),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: (error as Error).message };
  }
  if (response.status >= 500) {
    return { ok: false, reason: "unreachable", detail: `GitHub answered ${response.status}` };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "unreachable", detail: "GitHub answered without JSON" };
  }
  // GitHub answers a refused exchange with 200 and an `error` field.
  if (typeof body.error === "string" || typeof body.access_token !== "string" || !body.access_token) {
    return { ok: false, reason: "refused", detail: String(body.error ?? `status ${response.status}`) };
  }

  const now = client.http.now();
  const after = (seconds: unknown) =>
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : null;
  return {
    ok: true,
    grant: {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
      expiresAt: after(body.expires_in),
      refreshExpiresAt: after(body.refresh_token_expires_in),
    },
  };
}

/**
 * End a person's authorization of this app: every token issued under it,
 * refresh tokens included, and its entry in their GitHub settings. `true` when
 * GitHub confirmed it or it was already gone.
 */
export async function revokeGrant(client: OAuthClient, accessToken: string): Promise<boolean> {
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
  try {
    const response = await client.http.fetch(
      `${client.http.apiBase}/applications/${encodeURIComponent(client.clientId)}/grant`,
      {
        method: "DELETE",
        headers: {
          ...headers("", { "Content-Type": "application/json" }),
          Authorization: `Basic ${basic}`,
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      }
    );
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}

/**
 * The installations of this app a person can reach, asked as them: id → the
 * account it is on. Null when GitHub would not say.
 */
export async function userInstallations(
  http: GitHubHttp,
  accessToken: string
): Promise<Map<number, string> | null> {
  try {
    const response = await http.fetch(`${http.apiBase}/user/installations?per_page=100`, {
      headers: headers(accessToken),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { installations?: unknown };
    if (!Array.isArray(body.installations)) return null;
    const held = new Map<number, string>();
    for (const entry of body.installations) {
      const one = entry as { id?: unknown; account?: { login?: unknown } } | null;
      if (typeof one?.id === "number" && typeof one.account?.login === "string") {
        held.set(one.id, one.account.login);
      }
    }
    return held;
  } catch {
    return null;
  }
}
