/**
 * What the hooks ask GitHub about a person's authorization of this GitHub
 * App: whose account a user token is, and which installations it reaches.
 *
 * Initiative runs the authorization itself (the redirect, the code exchange,
 * renewing tokens and ending it); the app sees a user token only when a hook
 * hands it one.
 */

import { GITHUB_TIMEOUT_MS, headers, type GitHubHttp } from "./http.js";

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
