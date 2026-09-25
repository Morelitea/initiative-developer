/**
 * What the hooks ask GitHub about a person's authorization of this GitHub
 * App: whose account a user token is, which installations it reaches, and
 * ending the authorization when Initiative is done with it.
 *
 * Initiative runs the authorization itself (the redirect, the code exchange
 * and renewing tokens); the app sees a user token only when a hook hands it
 * one.
 */

import { GITHUB_TIMEOUT_MS, headers, type GitHubHttp } from "./http.js";

export interface OAuthClient {
  http: GitHubHttp;
  webBase: string;
  clientId: string;
  clientSecret: string;
}

/** The login a user token belongs to, or null when GitHub would not say. */
export async function userLogin(http: GitHubHttp, accessToken: string): Promise<string | null> {
  try {
    const response = await http.fetch(`${http.apiBase}/user`, {
      headers: headers(accessToken),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { login?: unknown };
    return typeof body.login === "string" && body.login ? body.login : null;
  } catch {
    return null;
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

/** GitHub could not be asked, or answered with an error; worth trying again. */
export class GitHubUnreachable extends Error {}

/**
 * End a person's authorization of this app: every token issued under it,
 * refresh tokens included, and its entry in their GitHub settings.
 *
 * GitHub names the authorization by an access token that still works. When
 * the one given has lapsed and a refresh token came with it, the refresh
 * token is exchanged for a fresh access token, and that one ends it.
 *
 * Resolves once GitHub has ended it or recognizes neither token; throws
 * {@link GitHubUnreachable} when GitHub could not be asked.
 */
export async function endAuthorization(
  client: OAuthClient,
  tokens: { accessToken: string | null; refreshToken: string | null }
): Promise<"ended" | "nothing-to-end"> {
  if (tokens.accessToken && (await deleteGrant(client, tokens.accessToken)) === "ended") return "ended";
  const fresh = tokens.refreshToken ? await refreshAccessToken(client, tokens.refreshToken) : null;
  if (fresh && (await deleteGrant(client, fresh)) === "ended") return "ended";
  return "nothing-to-end";
}

/** `DELETE /applications/{client_id}/grant`, authenticated as the GitHub App's client. */
async function deleteGrant(client: OAuthClient, accessToken: string): Promise<"ended" | "unknown-token"> {
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await client.http.fetch(
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
  } catch (error) {
    throw new GitHubUnreachable(`could not reach GitHub: ${(error as Error).message}`);
  }
  if (response.status === 204) return "ended";
  // GitHub does not recognize the token: it lapsed, or its authorization already ended.
  if (response.status === 404 || response.status === 422) return "unknown-token";
  throw new GitHubUnreachable(`GitHub answered ${response.status}`);
}

/** A fresh access token for a refresh token, or null when GitHub refuses it. */
async function refreshAccessToken(client: OAuthClient, refreshToken: string): Promise<string | null> {
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
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GitHubUnreachable(`could not reach GitHub: ${(error as Error).message}`);
  }
  if (response.status >= 500) throw new GitHubUnreachable(`GitHub answered ${response.status}`);
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new GitHubUnreachable("GitHub answered without JSON");
  }
  // GitHub answers a refused exchange with 200 and an `error` field.
  return typeof body.access_token === "string" && body.access_token ? body.access_token : null;
}
