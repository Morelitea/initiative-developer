/**
 * What every endpoint shares: the requests Initiative makes to GitHub for it,
 * what GitHub's answers mean, and the JSONata that reads parameters and
 * reshapes answers.
 *
 * Every expression reads `params`, the request's connection as `connection`,
 * every connection the endpoint requires as `connections.<id>` (the
 * organization's `owner` is `connections.workspace.owner`), `now`, and once
 * GitHub has answered, `response` and each earlier step as `steps.<name>`.
 * Initiative adds the token itself.
 *
 * A read answers what it could not do in its result (`unavailable`), so a
 * widget can say why. A write is refused with the code.
 */

import type { Endpoint, ErrorRule, Expression, Paging, VendorRequest } from "initiative-app-sdk/manifest";

import { ACCOUNT, WORKSPACE } from "../vocabulary.js";

export const API = "https://api.github.com";
export const WEB = "https://github.com";

/** A JSONata string literal. */
export const quote = (value: string): Expression => JSON.stringify(value);

/** GitHub's media type and API version, on every request. */
const HEADERS: Record<string, Expression> = {
  Accept: quote("application/vnd.github+json"),
  "X-GitHub-Api-Version": quote("2022-11-28"),
  "User-Agent": quote("initiative-github"),
};

/**
 * One REST call. `path` is an expression for the address after the API's
 * base. It runs on the organization's installation unless it names another
 * connection, or null for a connection's own check, which runs on that
 * connection.
 */
export function rest(
  method: VendorRequest["method"],
  path: Expression,
  extra: { connection?: string | null; body?: Expression; query?: Record<string, Expression>; paging?: Paging } = {}
): VendorRequest {
  const { connection = WORKSPACE, ...more } = extra;
  return { method, url: `${quote(API)} & ${path}`, headers: HEADERS, ...(connection ? { connection } : {}), ...more };
}

/** One GraphQL query or mutation, its variables an expression answering an object. */
export function graphql(query: string, variables: Expression, connection: string = WORKSPACE): VendorRequest {
  return {
    method: "POST",
    url: quote(`${API}/graphql`),
    headers: HEADERS,
    graphql: { query: query.replace(/\s+/g, " ").trim(), variables },
    connection,
  };
}

/**
 * The repository a call names, when `repo` is a name GitHub gives a
 * repository: letters, digits, '.', '-' and '_', at most 100, and neither '.'
 * nor '..'. Anything else is no repository at all, so every address and
 * search names one repository of the organization or none.
 */
export const REPO_NAME = `(
  $repo := params.repo;
  $type($repo) = "string" and $length($repo) <= 100 and $contains($repo, /^[A-Za-z0-9._-]+$/) and $not($repo in [".", ".."])
    ? $repo : ""
)`;

/**
 * The repository a call names, as its path at GitHub: on the organization,
 * whichever connection the request carries.
 */
export const REPO_PATH = `"/repos/" & connections.workspace.owner & "/" & ${REPO_NAME}`;

/**
 * A read other apps may call through Initiative, as the community or as one of
 * its members. It runs on the organization's installation either way, so it
 * answers the same for both.
 */
export const PUBLIC_READ = {
  public: true,
  actors: ["installation", "member"],
  requires: { all_of: [WORKSPACE] },
} satisfies Pick<Endpoint, "public" | "actors" | "requires">;

/**
 * A write other apps may call through Initiative, as one of the community's
 * members only: it runs on that member's own GitHub account.
 */
export const PUBLIC_WRITE = {
  public: true,
  actors: ["member"],
  requires: { all_of: [WORKSPACE, ACCOUNT] },
} satisfies Pick<Endpoint, "public" | "actors" | "requires">;

// --- what GitHub's answers mean ----------------------------------------------

const RATE_LIMITED = `$exists(response.headers."retry-after") or response.headers."x-ratelimit-remaining" = "0"`;

/**
 * GitHub's limits are passing failures. A GraphQL answer is 200 even when it
 * is refused, so a refusal is read from its errors; an answer with errors and
 * no data at all is a question GitHub could not take.
 */
export const GITHUB_ERRORS: ErrorRule[] = [
  { status: 403, when: RATE_LIMITED, code: "transient" },
  { status: "2xx", when: `response.body.errors[type = "RATE_LIMITED"]`, code: "transient" },
  { status: "2xx", when: `response.body.errors[type in ["FORBIDDEN", "INSUFFICIENT_SCOPES"]]`, code: "not-authorized" },
  { status: "2xx", when: "response.body.errors and $not($exists(response.body.data) and $boolean(response.body.data))", code: "invalid" },
];

/** A parameter the caller left out, or left empty. */
const missing = (key: string): Expression => `$not($exists(params.${key})) or params.${key} = ""`;

/**
 * Questions a read cannot be asked, each answered with its own code whatever
 * GitHub made of it, then GitHub's errors.
 */
export function needs(...refusals: Array<[when: Expression, code: string]>): { unavailable: string[]; errors: ErrorRule[] } {
  return {
    unavailable: refusals.map(([, code]) => code),
    errors: [
      ...refusals.flatMap(([when, code]) =>
        (["2xx", "4xx"] as const).map((status): ErrorRule => ({ status, when, code }))
      ),
      ...GITHUB_ERRORS,
    ],
  };
}

/** No repository, or a name no repository can have. */
export const NEEDS_REPO: [string, string] = [`${REPO_NAME} = ""`, "repository-required"];
export const NEEDS_NUMBER: [string, string] = [missing("number"), "number-required"];
export const NEEDS_PROJECT: [string, string] = [missing("project_id"), "project-required"];
export const NEEDS_FIELD: [string, string] = [missing("field"), "field-required"];

// --- parameters ----------------------------------------------------------------

export const PAGE = 100;

/** `limit`, from 1 to a page, 30 when not given. */
export const LIMIT = `($exists(params.limit) ? $min([$max([params.limit, 1]), ${PAGE}]) : 30)`;

/** `sort` and `direction`, as GitHub's GraphQL orders issues. */
export const ORDERING = `{
  "field": params.sort = "updated" ? "UPDATED_AT" : params.sort = "comments" ? "COMMENTS" : "CREATED_AT",
  "direction": params.direction = "asc" ? "ASC" : "DESC"
}`;

/** `since` as given, or `since_days` back from now, as RFC 3339. */
export const SINCE = `(
  params.since ? $fromMillis($toMillis(params.since))
  : params.since_days > 0 ? $fromMillis($millis() - params.since_days * 86400000)
)`;

/** The variables naming the call's repository on the organization. */
export const REPO_VARIABLES = `"owner": connections.workspace.owner, "repo": ${REPO_NAME}`;

// --- answers -------------------------------------------------------------------

/** Text as GitHub gave it, or null. */
export const TEXT = `$text := function($value) { $type($value) = "string" ? $value : null }`;

/** The fields every row of issues or pull requests is asked for. */
export const ROW_FIELDS = "number title url state createdAt updatedAt closedAt";

export const SUBJECT_FIELDS = `${ROW_FIELDS}
  author { login }
  milestone { title }
  comments { totalCount }
  labels(first: 50) { nodes { name } }
  assignees(first: 20) { nodes { login } }`;

/** The columns every list of issues or pull requests answers with, from its nodes and its total. */
export function rows(found: Expression, total: Expression): Expression {
  return `(
    $rows := ${found}[$type($) = "object"];
    {
      "numbers": [$rows.(number ? number : 0)],
      "titles": [$rows.(title ? title : "")],
      "urls": [$rows.(url ? url : "")],
      "states": [$rows.(state ? $lowercase(state) : "")],
      "created_at": [$rows.(createdAt ? createdAt : "")],
      "updated_at": [$rows.(updatedAt ? updatedAt : "")],
      "closed_at": [$rows.(closedAt ? closedAt : "")],
      "count": $count($rows),
      "total": ${total}
    }
  )`;
}

/**
 * One issue or pull request in the words the endpoints return, from a query
 * whose `repository` names itself and holds the node at `node`, with `extra`
 * fields of the node's kind. Not found when GitHub has no such node.
 */
export function subject(node: string, extra: string): Expression {
  return `(
    ${TEXT};
    $repository := response.body.data.repository;
    $node := $repository.${node};
    $node ? $merge([
      {
        "repository": $repository.name,
        "owner": $repository.owner.login,
        "number": $node.number,
        "title": $text($node.title),
        "state": $node.state ? $lowercase($node.state) : null,
        "url": $text($node.url),
        "author": $text($node.author.login),
        "labels": [$node.labels.nodes.name],
        "assignees": [$node.assignees.nodes.login],
        "milestone": $text($node.milestone.title),
        "comments": $node.comments.totalCount ? $node.comments.totalCount : 0,
        "created_at": $text($node.createdAt),
        "updated_at": $text($node.updatedAt),
        "closed_at": $text($node.closedAt)
      },
      ${extra}
    ]) : {"unavailable": "not-found"}
  )`;
}

/** One of the repository's lists: the values at `path` in its nodes, and how many there are in all. */
export function repositoryList(list: string, column: string, path: string): Expression {
  return `(
    $list := response.body.data.repository.${list};
    $list ? (
      $found := [$list.nodes.${path}];
      {"${column}": $found, "count": $count($found), "total": $list.totalCount}
    ) : {"unavailable": "not-found"}
  )`;
}
