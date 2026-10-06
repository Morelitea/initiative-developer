import { defineEndpoint } from "initiative-plugin-sdk/manifest";

import { COUNT_OUT, many, out, OWNER_OUT, REPO, text, TOTAL_OUT, UNAVAILABLE } from "../vocabulary.js";
import {
  GITHUB_ERRORS,
  graphql,
  needs,
  NEEDS_REPO,
  PAGE,
  PUBLIC_READ,
  REPO_VARIABLES,
  repositoryList,
  rest,
} from "./support.js";

export const listRepositories = defineEndpoint({
  direction: "read",
  label: text("Repositories", "Repositories", "Repositorios", "Dépôts"),
  description: text(
    "The repositories the organization's installation covers.",
    "Die Repositories, die die Installation der Organisation umfasst.",
    "Los repositorios que cubre la instalación de la organización.",
    "Les dépôts couverts par l'installation de l'organisation."
  ),
  group: "repositories",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  returns: {
    names: many(out("string", { label: text("Repositories", "Repositories", "Repositorios", "Dépôts") })),
    ...OWNER_OUT,
    ...COUNT_OUT,
    ...UNAVAILABLE,
  },
  request: rest("GET", `"/installation/repositories"`, {
    paging: {
      kind: "page_number",
      page_param: "page",
      per_page_param: "per_page",
      per_page: PAGE,
      items: "response.body.repositories",
      max_pages: 5,
      on_limit: "truncate",
    },
  }),
  errors: GITHUB_ERRORS,
  map: `(
    $names := [response.body.name];
    {"names": $names, "owner": connections.workspace.owner, "count": $count($names)}
  )`,
});

export const listAssignees = defineEndpoint({
  direction: "read",
  label: text("Who can be assigned", "Wer zuständig sein kann", "Quién puede ser asignado", "Qui peut être assigné"),
  description: text(
    "The people a repository's issues and pull requests can be given to.",
    "Die Personen, denen Issues und Pull Requests eines Repositories zugewiesen werden können.",
    "Las personas a las que se pueden asignar las incidencias y pull requests de un repositorio.",
    "Les personnes à qui les tickets et pull requests d'un dépôt peuvent être confiés."
  ),
  group: "repositories",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...REPO },
  returns: {
    logins: many(out("string", { label: text("People", "Personen", "Personas", "Personnes") })),
    ...COUNT_OUT,
    ...TOTAL_OUT,
    ...UNAVAILABLE,
  },
  request: graphql(
    `query Assignees($owner: String!, $repo: String!, $first: Int!) {
       repository(owner: $owner, name: $repo) { assignableUsers(first: $first) { totalCount nodes { login } } }
     }`,
    `{${REPO_VARIABLES}, "first": ${PAGE}}`
  ),
  ...needs(NEEDS_REPO),
  map: repositoryList("assignableUsers", "logins", "login"),
});

export const listBranches = defineEndpoint({
  direction: "read",
  label: text("Branches", "Branches", "Ramas", "Branches"),
  description: text(
    "The branches a repository has.",
    "Die Branches, die ein Repository hat.",
    "Las ramas que tiene un repositorio.",
    "Les branches d'un dépôt."
  ),
  group: "repositories",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...REPO },
  returns: {
    names: many(out("string", { label: text("Branches", "Branches", "Ramas", "Branches") })),
    ...COUNT_OUT,
    ...TOTAL_OUT,
    ...UNAVAILABLE,
  },
  // Alphabetical, so a menu of them keeps its order as people push.
  request: graphql(
    `query Branches($owner: String!, $repo: String!, $first: Int!) {
       repository(owner: $owner, name: $repo) {
         refs(refPrefix: "refs/heads/", first: $first, orderBy: { field: ALPHABETICAL, direction: ASC }) {
           totalCount
           nodes { name }
         }
       }
     }`,
    `{${REPO_VARIABLES}, "first": ${PAGE}}`
  ),
  ...needs(NEEDS_REPO),
  map: repositoryList("refs", "names", "name"),
});
