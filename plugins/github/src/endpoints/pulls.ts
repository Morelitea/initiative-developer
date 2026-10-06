import { defineEndpoint } from "initiative-plugin-sdk/manifest";

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
} from "../vocabulary.js";
import {
  GITHUB_ERRORS,
  graphql,
  LIMIT,
  needs,
  NEEDS_NUMBER,
  NEEDS_REPO,
  PUBLIC_READ,
  PUBLIC_WRITE,
  REPO_NAME,
  REPO_PATH,
  REPO_VARIABLES,
  rest,
  ROW_FIELDS,
  rows,
  subject,
  SUBJECT_FIELDS,
} from "./support.js";

const PULL_STATES = ["open", "closed", "merged", "all"] as const;

/** What both searches for pull requests take: everything but whose review is wanted. */
const PULL_PARAMS = {
  ...REPO,
  state: param("select", text("State", "Status", "Estado", "État"), { options: [...PULL_STATES] }),
  ...LABELS_IN,
  base_ref: param("string", text("Into branch", "Nach Branch", "Hacia la rama", "Vers la branche")),
  head_ref: param("string", text("From branch", "Von Branch", "Desde la rama", "Depuis la branche")),
};

const ORDER_IN = { ...SORT_IN, ...DIRECTION_IN, ...LIMIT_IN };

/** A GitHub login: letters, digits and single inner hyphens, at most 39. */
const LOGIN = `($login := params.review_requested; $length($login) <= 39 and $contains($login, /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/))`;

/**
 * Pull requests in the repository a call names, through GitHub's search:
 * `reviewer` is the search term for whose review is wanted.
 * Closed means closed without merging, as GitHub's own lists of pull requests
 * mean it. Values are quoted, so a parameter names one value.
 */
function search(reviewer: string, connection: string) {
  return graphql(
    `query Search($query: String!, $first: Int!) {
       search(query: $query, type: ISSUE, first: $first) {
         issueCount
         nodes { ... on PullRequest { ${ROW_FIELDS} } }
       }
     }`,
    `(
      $quoted := function($value) { '"' & $replace($value, '"', '') & '"' };
      {
        "query": $join([
          "repo:" & connections.workspace.owner & "/" & ${REPO_NAME},
          "is:pr",
          params.state = "closed" ? "is:closed is:unmerged" : params.state = "merged" ? "is:merged" : $not(params.state = "all") ? "is:open",
          params.labels.("label:" & $quoted($)),
          params.base_ref ? "base:" & $quoted(params.base_ref),
          params.head_ref ? "head:" & $quoted(params.head_ref),
          ${reviewer},
          "sort:" & (params.sort ? params.sort : "created") & "-" & (params.direction = "asc" ? "asc" : "desc")
        ], " "),
        "first": ${LIMIT}
      }
    )`,
    connection
  );
}

const FOUND = `(
  $search := response.body.data.search;
  ${rows("$search.nodes", "$search.issueCount")}
)`;

export const findPullRequests = defineEndpoint({
  direction: "read",
  label: text("Find pull requests", "Pull Requests suchen", "Buscar pull requests", "Rechercher des pull requests"),
  description: text(
    "The pull requests matching a question, including the ones waiting on a review.",
    "Die Pull Requests, die zu einer Frage passen, auch die, die auf eine Review warten.",
    "Las pull requests que coinciden con una consulta, incluidas las que esperan revisión.",
    "Les pull requests correspondant à une question, y compris celles en attente de revue."
  ),
  group: "reviews",
  ...PUBLIC_READ,
  cache_ttl_seconds: 60,
  params: {
    ...PULL_PARAMS,
    review_requested: param("string", text("Waiting on", "Wartet auf", "Esperando a", "En attente de"), {
      options_from: PEOPLE_OF,
    }),
    ...ORDER_IN,
  },
  returns: ROWS_OUT,
  request: search(`params.review_requested and ${LOGIN} ? "review-requested:" & params.review_requested`, WORKSPACE),
  ...needs(NEEDS_REPO, [`params.review_requested and $not(${LOGIN})`, "bad-login"]),
  map: FOUND,
});

export const reviewQueue = defineEndpoint({
  direction: "read",
  label: text("Waiting on your review", "Wartet auf deine Review", "Esperando tu revisión", "En attente de votre revue"),
  description: text(
    "The pull requests in a repository that asked for the member's review.",
    "Die Pull Requests eines Repositories, die die Review des Mitglieds angefragt haben.",
    "Las pull requests de un repositorio que pidieron la revisión del miembro.",
    "Les pull requests d'un dépôt qui ont demandé la revue du membre."
  ),
  group: "reviews",
  public: true,
  actors: ["member"],
  requires: { all_of: [WORKSPACE, ACCOUNT] },
  cache_ttl_seconds: 60,
  params: { ...PULL_PARAMS, ...ORDER_IN },
  returns: ROWS_OUT,
  // GitHub's search as the member, for whom `@me` stands.
  request: search(`"review-requested:@me"`, ACCOUNT),
  ...needs(NEEDS_REPO),
  map: FOUND,
});

export const getPullRequest = defineEndpoint({
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
  params: { ...REPO, ...NUMBER },
  returns: {
    ...REPO_OUT,
    ...OWNER_OUT,
    ...NUMBER_OUT,
    ...TITLE_OUT,
    ...STATE_OUT,
    merged: out("bool"),
    draft: out("bool"),
    ...URL_OUT,
    ...AUTHOR_OUT,
    ...LABELS_OUT,
    ...ASSIGNEES_OUT,
    ...MILESTONE_OUT,
    ...COMMENTS_OUT,
    head_ref: out("string", { label: text("From branch", "Von Branch", "Desde la rama", "Depuis la branche") }),
    base_ref: out("string", { label: text("Into branch", "Nach Branch", "Hacia la rama", "Vers la branche") }),
    commits: out("int"),
    changed_files: out("int"),
    ...CREATED_OUT,
    ...UPDATED_OUT,
    ...CLOSED_OUT,
    merged_at: out("string"),
    ...UNAVAILABLE,
  },
  request: graphql(
    `query Pull($owner: String!, $repo: String!, $number: Int!) {
       repository(owner: $owner, name: $repo) {
         name
         owner { login }
         pullRequest(number: $number) {
           ${SUBJECT_FIELDS}
           isDraft merged mergedAt headRefName baseRefName changedFiles
           commits { totalCount }
         }
       }
     }`,
    `{${REPO_VARIABLES}, "number": params.number}`
  ),
  ...needs(NEEDS_REPO, NEEDS_NUMBER),
  map: subject(
    "pullRequest",
    `{
      "merged": $node.merged = true,
      "draft": $node.isDraft = true,
      "head_ref": $text($node.headRefName),
      "base_ref": $text($node.baseRefName),
      "commits": $node.commits.totalCount ? $node.commits.totalCount : 0,
      "changed_files": $node.changedFiles ? $node.changedFiles : 0,
      "merged_at": $text($node.mergedAt)
    }`
  ),
});

export const requestReview = defineEndpoint({
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
  params: {
    ...REPO,
    ...NUMBER,
    reviewers: param("string", text("Reviewers", "Reviewer", "Revisores", "Relecteurs"), {
      list: true,
      options_from: PEOPLE_OF,
    }),
    team_reviewers: param("string", text("Team reviewers", "Team-Reviewer", "Equipos revisores", "Équipes relectrices"), {
      list: true,
    }),
  },
  returns: { ...REPO_OUT, ...NUMBER_OUT, ...LINK_OUT },
  identity: ISSUE_IDENTITY,
  request: rest("POST", `${REPO_PATH} & "/pulls/" & params.number & "/requested_reviewers"`, {
    connection: ACCOUNT,
    body: `$merge([
      $count(params.reviewers) ? {"reviewers": [params.reviewers]},
      $count(params.team_reviewers) ? {"team_reviewers": [params.team_reviewers]}
    ])`,
  }),
  errors: GITHUB_ERRORS,
  map: `{"repository": response.body.base.repo.name, "number": params.number, "html_url": response.body.html_url}`,
});
