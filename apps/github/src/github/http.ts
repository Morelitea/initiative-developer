/**
 * Calls to GitHub's REST and GraphQL APIs with a bearer token, answered as a
 * value rather than thrown, so a read can turn a refusal into words a widget
 * shows and a write can turn it into a status.
 */

export const API_VERSION = "2022-11-28";

/** How long any one call to GitHub may take. */
export const GITHUB_TIMEOUT_MS = 10_000;

export type Failure =
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "invalid"
  | "vendor-error";

export type Answer<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; failure: Failure; message: string; retryAfterMs?: number };

export interface GitHubHttp {
  fetch: typeof fetch;
  apiBase: string;
  now: () => number;
}

export function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "initiative-github",
    ...extra,
  };
}

/**
 * How long GitHub asks to be left alone, or null when a 403/429 is not a rate
 * limit. A secondary limit carries `retry-after`; a primary one has
 * `x-ratelimit-remaining: 0` and a reset time.
 */
export function rateLimit(response: Response, now: number): number | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) && reset > 0 ? Math.max(0, reset * 1000 - now) : 60_000;
  }
  if (response.status === 429) return 60_000;
  return null;
}

async function send<T>(
  http: GitHubHttp,
  url: string,
  init: RequestInit
): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await http.fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  } catch (error) {
    return { ok: false, status: 0, failure: "vendor-error", message: `could not reach GitHub: ${(error as Error).message}` };
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (response.ok) return { ok: true, status: response.status, body: (body ?? {}) as T };

  const message =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : response.statusText || `GitHub answered ${response.status}`;
  const wait = rateLimit(response, http.now());
  if (wait !== null) {
    return { ok: false, status: response.status, failure: "rate-limited", message, retryAfterMs: wait };
  }
  const failure: Failure =
    response.status === 401 || response.status === 403
      ? "forbidden"
      : response.status === 404
        ? "not-found"
        : response.status === 422 || response.status === 400
          ? "invalid"
          : "vendor-error";
  return { ok: false, status: response.status, failure, message };
}

/** One REST call. `path` is relative to the API base. */
export function rest<T = Record<string, unknown>>(
  http: GitHubHttp,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Answer<T>> {
  return send<T>(http, `${http.apiBase}${path}`, {
    method,
    headers: headers(token, body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface GraphQLError {
  type?: string;
  message?: string;
}

/**
 * One GraphQL query or mutation.
 *
 * Each query here asks for one thing, so an error saying the token may not
 * see something is a refusal of the whole read. Any other error beside data
 * is not a failure: a missing object comes back null and the null is the
 * answer. An answer with no data at all is classified by its first error.
 */
export async function graphql<T>(
  http: GitHubHttp,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<Answer<T>> {
  const answer = await send<{ data?: T | null; errors?: GraphQLError[] }>(
    http,
    `${http.apiBase}/graphql`,
    {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!answer.ok) return answer;
  const errors = answer.body.errors ?? [];
  const refused = errors.find((error) => error.type === "FORBIDDEN" || error.type === "INSUFFICIENT_SCOPES");
  if (refused) {
    return { ok: false, status: answer.status, failure: "forbidden", message: refused.message ?? "forbidden" };
  }
  const data = answer.body.data;
  if (data) return { ok: true, status: answer.status, body: data };

  const first = errors[0];
  const type = first?.type ?? "";
  const failure: Failure =
    type === "FORBIDDEN" || type === "INSUFFICIENT_SCOPES"
      ? "forbidden"
      : type === "NOT_FOUND"
        ? "not-found"
        : type === "RATE_LIMITED"
          ? "rate-limited"
          : "vendor-error";
  return { ok: false, status: answer.status, failure, message: first?.message ?? "GitHub answered without data" };
}
