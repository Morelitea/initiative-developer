/**
 * What every endpoint shares: the shape of a call, the credential it runs on,
 * which repository it is about, and reading its parameters.
 *
 * A read answers what it could not do in its result (`unavailable`), so a
 * widget can say why. A write answers with a status and an error code, so an
 * automation can tell a refusal from a retry.
 */

import type { ActorKind, ContextClaims, Endpoint } from "initiative-app-kit";

import type { AppContext } from "../context.js";
import type { Failure } from "../github/http.js";
import type { Workspace } from "../installs.js";

export interface Call {
  context: AppContext;
  /** The installation reference: the community, as this app's install knows it. */
  installation: string;
  claims: ContextClaims;
  params: Record<string, unknown>;
}

export type Result = Record<string, unknown>;

export interface ReadOutcome {
  actor: ActorKind;
  result: Result;
}

export interface Read {
  declaration: Endpoint;
  run(call: Call): Promise<ReadOutcome>;
}

export type WriteOutcome =
  | { ok: true; result: Result }
  | { ok: false; status: number; error: string; detail?: string };

export interface Write {
  declaration: Endpoint;
  run(call: Call, token: string, place: Place): Promise<WriteOutcome>;
}

/** Where a call lands: the community's GitHub account and installation. */
export type Place = Workspace;

/** Why a read has no answer. */
export type Unavailable = { unavailable: string };

export const unavailable = (reason: string): Unavailable => ({ unavailable: reason });

/** A GitHub failure, as the code a read answers with. */
export function readFailure(failure: Failure): Unavailable {
  return unavailable(failure === "invalid" ? "vendor-error" : failure);
}

/** A GitHub failure, as the status a write answers with. */
export function writeFailure(failure: Failure, message: string): WriteOutcome {
  const status =
    failure === "forbidden" ? 403 : failure === "not-found" ? 404 : failure === "rate-limited" ? 429 : failure === "invalid" ? 422 : 502;
  return { ok: false, status, error: failure, detail: message };
}

export const bad = (detail: string): WriteOutcome => ({ ok: false, status: 400, error: "invalid-params", detail });

export interface InstallationAccess extends Place {
  token: string;
}

/** The community's GitHub installation and a token acting inside it, or why there is none. */
export async function installationAccess(call: Call): Promise<InstallationAccess | Unavailable> {
  const snapshot = await call.context.installs.snapshot(call.installation);
  if (!snapshot.workspace) return unavailable("not-configured");
  const token = await call.context.github.installationToken(call.installation, snapshot.workspace);
  if (!token) return unavailable("installation-unavailable");
  return { ...snapshot.workspace, token };
}

export function isResult(value: object): value is Unavailable {
  return "unavailable" in value;
}

/**
 * Which repository a call is about: named by the caller and covered by the
 * installation, in the spelling GitHub gave. Nothing is inferred, including on
 * an installation covering exactly one repository.
 */
export async function repository(
  call: Call,
  workspace: Workspace
): Promise<{ repo: string } | Unavailable> {
  const asked = text(call.params, "repo");
  if (!asked) return { unavailable: "repository-required" };
  const covered = await call.context.github.installationRepositories(call.installation, workspace);
  if ("failure" in covered) return { unavailable: covered.failure === "invalid" ? "vendor-error" : covered.failure };
  const repo = covered.names.find((name) => name.toLowerCase() === asked.toLowerCase());
  return repo ? { repo } : { unavailable: "repository-not-listed" };
}

/** Installation access plus the repository, for a read. */
export async function repoAccess(
  call: Call
): Promise<(InstallationAccess & { repo: string }) | Unavailable> {
  const access = await installationAccess(call);
  if (isResult(access)) return access;
  const chosen = await repository(call, access);
  if ("unavailable" in chosen) return chosen;
  return { ...access, repo: chosen.repo };
}

// --- parameters -------------------------------------------------------------
//
// Initiative sends parameters as strings (a list as an array of strings); an
// automation may send numbers and booleans as they are. Both are read here.

export function text(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function int(params: Record<string, unknown>, key: string): number | undefined {
  const value = text(params, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function list(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function choice<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = text(params, key)?.toLowerCase();
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export const PAGE = 100;
export const DEFAULT_LIMIT = 30;

export function limit(params: Record<string, unknown>): number {
  const wanted = int(params, "limit");
  return wanted === undefined ? DEFAULT_LIMIT : Math.min(Math.max(wanted, 1), PAGE);
}

/** `since` as given, or `since_days` back from now, as RFC 3339. */
export function since(params: Record<string, unknown>, now: number): string | undefined {
  const absolute = text(params, "since");
  if (absolute && Number.isFinite(Date.parse(absolute))) return new Date(Date.parse(absolute)).toISOString();
  const days = int(params, "since_days");
  if (days === undefined || days <= 0) return undefined;
  return new Date(now - days * 86_400_000).toISOString();
}

// --- GraphQL rows -----------------------------------------------------------

export interface Connection<T> {
  totalCount?: number;
  nodes?: Array<T | null>;
}

export function nodes<T>(connection: Connection<T> | null | undefined): T[] {
  return (connection?.nodes ?? []).filter((node): node is T => node !== null);
}

export const lower = (value: string | null | undefined): string | null =>
  typeof value === "string" ? value.toLowerCase() : null;

export const orNull = (value: string | null | undefined): string | null =>
  typeof value === "string" ? value : null;

export interface Row {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
}

export const ROW_FIELDS = "number title url state createdAt updatedAt closedAt";

export const SUBJECT_FIELDS = `${ROW_FIELDS}
  author { login }
  milestone { title }
  comments { totalCount }
  labels(first: 50) { nodes { name } }
  assignees(first: 20) { nodes { login } }`;

export interface SubjectNode extends Row {
  __typename?: string;
  stateReason?: string | null;
  author?: { login?: string } | null;
  milestone?: { title?: string } | null;
  comments?: { totalCount?: number };
  labels?: Connection<{ name?: string }>;
  assignees?: Connection<{ login?: string }>;
}

/** The columns every list of issues or pull requests answers with. */
export function rows(found: Row[], total: number | undefined): Result {
  return {
    numbers: found.map((row) => row.number ?? 0),
    titles: found.map((row) => row.title ?? ""),
    urls: found.map((row) => row.url ?? ""),
    states: found.map((row) => lower(row.state) ?? ""),
    created_at: found.map((row) => row.createdAt ?? ""),
    updated_at: found.map((row) => row.updatedAt ?? ""),
    closed_at: found.map((row) => row.closedAt ?? ""),
    count: found.length,
    total: total ?? found.length,
  };
}

/** One issue or pull request, in the words the endpoints return. */
export function subject(node: SubjectNode, owner: string, repo: string): Result {
  return {
    repository: repo,
    owner,
    number: node.number ?? 0,
    title: orNull(node.title),
    state: lower(node.state),
    url: orNull(node.url),
    author: orNull(node.author?.login),
    labels: nodes(node.labels).map((label) => label.name).filter((name): name is string => !!name),
    assignees: nodes(node.assignees).map((person) => person.login).filter((login): login is string => !!login),
    milestone: orNull(node.milestone?.title),
    comments: node.comments?.totalCount ?? 0,
    created_at: orNull(node.createdAt),
    updated_at: orNull(node.updatedAt),
    closed_at: orNull(node.closedAt),
  };
}

const ORDER_FIELDS = { created: "CREATED_AT", updated: "UPDATED_AT", comments: "COMMENTS" } as const;

export function ordering(params: Record<string, unknown>): { field: string; direction: string } {
  return {
    field: ORDER_FIELDS[choice(params, "sort", ["created", "updated", "comments"] as const, "created")],
    direction: choice(params, "direction", ["desc", "asc"] as const, "desc").toUpperCase(),
  };
}

export function states(value: string): string[] | null {
  return value === "all" ? null : [value.toUpperCase()];
}

/** Only the keys GitHub actually answered with. */
export function pick(body: Record<string, unknown>, keys: string[]): Result {
  const found: Result = {};
  for (const key of keys) if (body[key] !== undefined) found[key] = body[key];
  return found;
}
