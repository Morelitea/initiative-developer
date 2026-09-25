import { callerToken } from "../credentials.js";
import { graphql, rest } from "../github/http.js";
import {
  ACCOUNT,
  ASSIGNEES_OUT,
  AUTHOR_OUT,
  CLOSED_OUT,
  COMMENTS_OUT,
  CREATED_OUT,
  DIRECTION_IN,
  ISSUE_IDENTITY,
  LABELS_IN,
  LABELS_OUT,
  LIMIT_IN,
  LINK_OUT,
  MILESTONE_OUT,
  NUMBER,
  NUMBER_OUT,
  out,
  OWNER_OUT,
  param,
  PEOPLE_OF,
  READ_IDS,
  REPO,
  REPO_OUT,
  ROWS_OUT,
  SORT_IN,
  STATE_OUT,
  text,
  TITLE_OUT,
  UNAVAILABLE,
  UPDATED_OUT,
  URL_OUT,
  WORKSPACE,
  WRITE_IDS,
} from "../vocabulary.js";
import { writePlace } from "./issues.js";
import {
  bad,
  choice,
  int,
  isResult,
  limit,
  list,
  nodes,
  ordering,
  orNull,
  pick,
  PUBLIC_READ,
  PUBLIC_WRITE,
  readFailure,
  repoAccess,
  ROW_FIELDS,
  rows,
  states,
  subject,
  SUBJECT_FIELDS,
  text as textParam,
  unavailable,
  writeFailure,
  type Call,
  type Connection,
  type Read,
  type ReadOutcome,
  type Row,
  type SubjectNode,
  type Write,
} from "./support.js";

const PULL_STATES = ["open", "closed", "merged", "all"] as const;

/** A GitHub login, or `@me`. Letters, digits and single inner hyphens, at most 39. */
export function isLogin(value: string): boolean {
  if (value === "@me") return true;
  if (!value || value.length > 39 || value.startsWith("-") || value.endsWith("-")) return false;
  let previous = "";
  for (const character of value) {
    const alphanumeric =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9");
    if (!alphanumeric && character !== "-") return false;
    if (character === "-" && previous === "-") return false;
    previous = character;
  }
  return true;
}

/**
 * Pull requests waiting on one reviewer, through GitHub's search. `@me` means
 * the member the call is for, so it runs on the member's own credential.
 */
async function waitingOn(call: Call, reviewer: string): Promise<ReadOutcome> {
  const actor = reviewer === "@me" ? "member" : "installation";
  if (!isLogin(reviewer)) return { actor, result: unavailable("bad-login") };
  if (list(call.params, "labels").length || textParam(call.params, "base_ref") || textParam(call.params, "head_ref")) {
    return { actor, result: unavailable("unsupported-combination") };
  }

  const access = await repoAccess(call);
  if (isResult(access)) return { actor, result: access };

  let token = access.token;
  if (reviewer === "@me") {
    // A call made as the community names no member for `@me` to mean.
    const own = await callerToken(call);
    if (!own.ok) {
      const reason = own.reason === "no-member" ? "member-required" : own.reason === "not-connected" ? "not-connected" : "vendor-error";
      return { actor, result: unavailable(reason) };
    }
    token = own.token;
  }

  const qualifiers = [`repo:${access.owner}/${access.repo}`, "is:pr", `review-requested:${reviewer}`];
  const state = choice(call.params, "state", PULL_STATES, "open");
  if (state !== "all") qualifiers.push(`is:${state}`);

  const answer = await graphql<{ search: Connection<Row> & { issueCount?: number } }>(
    call.context.github.http,
    token,
    `query ReviewRequested($query: String!, $first: Int!) {
       search(query: $query, type: ISSUE, first: $first) {
         issueCount
         nodes { ... on PullRequest { ${ROW_FIELDS} } }
       }
     }`,
    { query: qualifiers.join(" "), first: limit(call.params) }
  );
  if (!answer.ok) return { actor, result: readFailure(answer.failure) };
  return { actor, result: rows(nodes(answer.body.search), answer.body.search.issueCount) };
}

export const findPullRequests: Read = {
  declaration: {
    id: READ_IDS.findPullRequests,
    direction: "read",
    label: text("Find pull requests", "Pull Requests suchen", "Buscar pull requests", "Rechercher des pull requests"),
    description: text(
      "The pull requests matching a question, including the ones waiting on a review.",
      "Die Pull Requests, die zu einer Frage passen, auch die, die auf eine Review warten.",
      "Las pull requests que coinciden con una consulta, incluidas las que esperan revisión.",
      "Les pull requests correspondant à une question, y compris celles en attente de revue."
    ),
    group: "reviews",
    // `@me` is the member the call is for; everything else runs on the installation.
    ...PUBLIC_READ,
    cache_ttl_seconds: 60,
    params: [
      REPO,
      param("state", "select", text("State", "Status", "Estado", "État"), { options: [...PULL_STATES] }),
      LABELS_IN,
      param("base_ref", "string", text("Into branch", "Nach Branch", "Hacia la rama", "Vers la branche")),
      param("head_ref", "string", text("From branch", "Von Branch", "Desde la rama", "Depuis la branche")),
      param("review_requested", "string", text("Waiting on", "Wartet auf", "Esperando a", "En attente de"), {
        options_from: PEOPLE_OF,
      }),
      SORT_IN,
      DIRECTION_IN,
      LIMIT_IN,
    ],
    returns: ROWS_OUT,
    // Either is enough to be called: the member's account travels when they
    // have connected one, and `@me` needs it.
    requires: { any_of: [WORKSPACE, ACCOUNT] },
  },

  async run(call) {
    const reviewer = textParam(call.params, "review_requested");
    if (reviewer !== undefined) return waitingOn(call, reviewer);

    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const labels = list(call.params, "labels");
    const answer = await graphql<{ repository: { pullRequests: Connection<Row> } | null }>(
      call.context.github.http,
      access.token,
      `query Pulls($owner: String!, $repo: String!, $first: Int!, $states: [PullRequestState!],
                   $labels: [String!], $base: String, $head: String, $order: IssueOrder!) {
         repository(owner: $owner, name: $repo) {
           pullRequests(first: $first, states: $states, labels: $labels,
                        baseRefName: $base, headRefName: $head, orderBy: $order) {
             totalCount
             nodes { ${ROW_FIELDS} }
           }
         }
       }`,
      {
        owner: access.owner,
        repo: access.repo,
        first: limit(call.params),
        order: ordering(call.params),
        states: states(choice(call.params, "state", PULL_STATES, "open")),
        labels: labels.length ? labels : null,
        base: textParam(call.params, "base_ref") ?? null,
        head: textParam(call.params, "head_ref") ?? null,
      }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const pulls = answer.body.repository?.pullRequests;
    if (!pulls) return { actor: "installation", result: unavailable("not-found") };
    return { actor: "installation", result: rows(nodes(pulls), pulls.totalCount) };
  },
};

interface PullNode extends SubjectNode {
  isDraft?: boolean;
  merged?: boolean;
  mergedAt?: string | null;
  headRefName?: string;
  baseRefName?: string;
  changedFiles?: number;
  commits?: { totalCount?: number };
}

export const getPullRequest: Read = {
  declaration: {
    id: READ_IDS.getPullRequest,
    direction: "read",
    label: text("Get a pull request", "Pull Request abrufen", "Obtener una pull request", "Récupérer une pull request"),
    description: text(
      "One pull request by number: whether it is a draft, and whether it merged.",
      "Ein Pull Request nach Nummer: ob er ein Entwurf ist und ob er gemergt wurde.",
      "Una pull request por número: si es un borrador y si se fusionó.",
      "Une pull request par numéro : si c'est un brouillon, et si elle a été fusionnée."
    ),
    group: "reviews",
    ...PUBLIC_READ,
    cache_ttl_seconds: 0,
    params: [REPO, NUMBER],
    returns: [
      REPO_OUT,
      OWNER_OUT,
      NUMBER_OUT,
      TITLE_OUT,
      STATE_OUT,
      out("merged", "bool"),
      out("draft", "bool"),
      URL_OUT,
      AUTHOR_OUT,
      LABELS_OUT,
      ASSIGNEES_OUT,
      MILESTONE_OUT,
      COMMENTS_OUT,
      out("head_ref", "string", { label: text("From branch", "Von Branch", "Desde la rama", "Depuis la branche") }),
      out("base_ref", "string", { label: text("Into branch", "Nach Branch", "Hacia la rama", "Vers la branche") }),
      out("commits", "int"),
      out("changed_files", "int"),
      CREATED_OUT,
      UPDATED_OUT,
      CLOSED_OUT,
      out("merged_at", "string"),
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const number = int(call.params, "number");
    if (number === undefined) return { actor: "installation", result: unavailable("number-required") };

    const answer = await graphql<{ repository: { pullRequest: PullNode | null } | null }>(
      call.context.github.http,
      access.token,
      `query Pull($owner: String!, $repo: String!, $number: Int!) {
         repository(owner: $owner, name: $repo) {
           pullRequest(number: $number) {
             ${SUBJECT_FIELDS}
             isDraft merged mergedAt headRefName baseRefName changedFiles
             commits { totalCount }
           }
         }
       }`,
      { owner: access.owner, repo: access.repo, number }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const node = answer.body.repository?.pullRequest;
    if (!node) return { actor: "installation", result: unavailable("not-found") };
    return {
      actor: "installation",
      result: {
        ...subject(node, access.owner, access.repo),
        merged: Boolean(node.merged),
        draft: Boolean(node.isDraft),
        head_ref: orNull(node.headRefName),
        base_ref: orNull(node.baseRefName),
        commits: node.commits?.totalCount ?? 0,
        changed_files: node.changedFiles ?? 0,
        merged_at: orNull(node.mergedAt),
      },
    };
  },
};

export const requestReview: Write = {
  declaration: {
    id: WRITE_IDS.requestReview,
    direction: "write",
    label: text("Request a review", "Review anfragen", "Solicitar una revisión", "Demander une revue"),
    description: text(
      "Asks people or teams to review a pull request, as the member.",
      "Bittet Personen oder Teams, einen Pull Request zu prüfen, als das Mitglied.",
      "Pide a personas o equipos que revisen una pull request, como el miembro.",
      "Demande à des personnes ou des équipes de relire une pull request, en tant que le membre."
    ),
    group: "reviews",
    ...PUBLIC_WRITE,
    params: [
      REPO,
      NUMBER,
      param("reviewers", "string", text("Reviewers", "Reviewer", "Revisores", "Relecteurs"), {
        list: true,
        options_from: PEOPLE_OF,
      }),
      param("team_reviewers", "string", text("Team reviewers", "Team-Reviewer", "Equipos revisores", "Équipes relectrices"), {
        list: true,
      }),
    ],
    returns: [REPO_OUT, NUMBER_OUT, LINK_OUT],
    identity: ISSUE_IDENTITY,
  },

  async run(call, token, place) {
    const where = await writePlace(call, place);
    if ("ok" in where) return where;
    const number = int(call.params, "number");
    if (number === undefined) return bad("number is required");
    const reviewers = list(call.params, "reviewers");
    const teams = list(call.params, "team_reviewers");
    if (!reviewers.length && !teams.length) return bad("name a reviewer or a team");

    const answer = await rest(
      call.context.github.http,
      token,
      "POST",
      `/repos/${place.owner}/${where.repo}/pulls/${number}/requested_reviewers`,
      { ...(reviewers.length ? { reviewers } : {}), ...(teams.length ? { team_reviewers: teams } : {}) }
    );
    if (!answer.ok) return writeFailure(answer.failure, answer.message);
    return { ok: true, result: { repository: where.repo, number, ...pick(answer.body, ["html_url"]) } };
  },
};
