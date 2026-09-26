import { defineEndpoint } from "initiative-app-sdk/manifest";

import { graphql } from "../github/http.js";
import {
  installationAccess,
  isResult,
  nodes,
  PAGE,
  PUBLIC_READ,
  readFailure,
  repoAccess,
  unavailable,
  type Connection,
} from "./support.js";
import {
  COUNT_OUT,
  many,
  out,
  OWNER_OUT,
  REPO,
  text,
  TOTAL_OUT,
  UNAVAILABLE,
  WORKSPACE,
} from "../vocabulary.js";

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
  requires: { all_of: [WORKSPACE] },

  async handler(call) {
    const access = await installationAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const covered = await call.context.github.installationRepositories(call.client, access);
    if ("failure" in covered) return { actor: "installation", result: readFailure(covered.failure) };
    return {
      actor: "installation",
      result: { names: covered.names, owner: access.owner, count: covered.names.length },
    };
  },
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
  requires: { all_of: [WORKSPACE] },

  async handler(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const answer = await graphql<{ repository: { assignableUsers: Connection<{ login?: string }> } | null }>(
      call.context.github.http,
      access.token,
      `query Assignees($owner: String!, $repo: String!, $first: Int!) {
         repository(owner: $owner, name: $repo) { assignableUsers(first: $first) { totalCount nodes { login } } }
       }`,
      { owner: access.owner, repo: access.repo, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const people = answer.body.repository?.assignableUsers;
    if (!people) return { actor: "installation", result: unavailable("not-found") };
    const logins = nodes(people).map((person) => person.login).filter((login): login is string => !!login);
    return {
      actor: "installation",
      result: { logins, count: logins.length, total: people.totalCount ?? logins.length },
    };
  },
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
  requires: { all_of: [WORKSPACE] },

  async handler(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    // Alphabetical, so a menu of them keeps its order as people push.
    const answer = await graphql<{ repository: { refs: Connection<{ name?: string }> } | null }>(
      call.context.github.http,
      access.token,
      `query Branches($owner: String!, $repo: String!, $first: Int!) {
         repository(owner: $owner, name: $repo) {
           refs(refPrefix: "refs/heads/", first: $first, orderBy: { field: ALPHABETICAL, direction: ASC }) {
             totalCount
             nodes { name }
           }
         }
       }`,
      { owner: access.owner, repo: access.repo, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const refs = answer.body.repository?.refs;
    if (!refs) return { actor: "installation", result: unavailable("not-found") };
    const names = nodes(refs).map((ref) => ref.name).filter((name): name is string => !!name);
    return {
      actor: "installation",
      result: { names, count: names.length, total: refs.totalCount ?? names.length },
    };
  },
});
