import { defineEndpoint } from "initiative-app-sdk/manifest";

import {
  ACCOUNT,
  ASSIGNEES_OUT,
  AUTHOR_OUT,
  CLOSED_OUT,
  COMMENTS_OUT,
  COUNT_OUT,
  CREATED_OUT,
  DIRECTION_IN,
  ISSUE_IDENTITY,
  LABELS_IN,
  LABELS_OUT,
  LIMIT_IN,
  LINK_OUT,
  many,
  MILESTONE_OUT,
  MILESTONES_OF,
  NUMBER,
  NUMBER_OUT,
  out,
  OWNER_OUT,
  param,
  PEOPLE_OF,
  REPO,
  REPO_OUT,
  ROWS_OUT,
  SINCE_DAYS_IN,
  SINCE_IN,
  SORT_IN,
  STATE_OUT,
  text,
  TITLE_OUT,
  TOTAL_OUT,
  UNAVAILABLE,
  UPDATED_OUT,
  URL_OUT,
} from "../vocabulary.js";
import {
  GITHUB_ERRORS,
  graphql,
  LIMIT,
  needs,
  NEEDS_NUMBER,
  NEEDS_REPO,
  ORDERING,
  PAGE,
  PUBLIC_READ,
  PUBLIC_WRITE,
  REPO_PATH,
  REPO_VARIABLES,
  repositoryList,
  rest,
  ROW_FIELDS,
  rows,
  SINCE,
  subject,
  SUBJECT_FIELDS,
} from "./support.js";

export const listLabels = defineEndpoint({
  direction: "read",
  label: text("Labels", "Labels", "Etiquetas", "Étiquettes"),
  description: text(
    "Every label that exists on the repository.",
    "Alle Labels, die es im Repository gibt.",
    "Todas las etiquetas que existen en el repositorio.",
    "Toutes les étiquettes qui existent dans le dépôt."
  ),
  group: "issues",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...REPO },
  returns: {
    names: many(out("string", { label: text("Labels", "Labels", "Etiquetas", "Étiquettes") })),
    ...COUNT_OUT,
    ...TOTAL_OUT,
    ...UNAVAILABLE,
  },
  request: graphql(
    `query Labels($owner: String!, $repo: String!, $first: Int!) {
       repository(owner: $owner, name: $repo) { labels(first: $first) { totalCount nodes { name } } }
     }`,
    `{${REPO_VARIABLES}, "first": ${PAGE}}`
  ),
  ...needs(NEEDS_REPO),
  map: repositoryList("labels", "names", "name"),
});

export const listMilestones = defineEndpoint({
  direction: "read",
  label: text("Milestones", "Meilensteine", "Hitos", "Jalons"),
  description: text(
    "The milestones a repository is still working towards.",
    "Die Meilensteine, auf die ein Repository noch hinarbeitet.",
    "Los hitos hacia los que un repositorio todavía trabaja.",
    "Les jalons vers lesquels un dépôt travaille encore."
  ),
  group: "issues",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...REPO },
  returns: {
    numbers: many(out("int", { label: text("Milestones", "Meilensteine", "Hitos", "Jalons") })),
    titles: many(out("string", { label: text("Names", "Namen", "Nombres", "Noms") })),
    ...COUNT_OUT,
    ...TOTAL_OUT,
    ...UNAVAILABLE,
  },
  // Open ones, soonest due first: what somebody is planning against.
  request: graphql(
    `query Milestones($owner: String!, $repo: String!, $first: Int!) {
       repository(owner: $owner, name: $repo) {
         milestones(first: $first, states: [OPEN], orderBy: { field: DUE_DATE, direction: ASC }) {
           totalCount
           nodes { number title }
         }
       }
     }`,
    `{${REPO_VARIABLES}, "first": ${PAGE}}`
  ),
  ...needs(NEEDS_REPO),
  map: `(
    $list := response.body.data.repository.milestones;
    $found := $list.nodes[$type(number) = "number"];
    $list ? {
      "numbers": [$found.number],
      "titles": [$found.(title ? title : "")],
      "count": $count($found),
      "total": $list.totalCount
    } : {"unavailable": "not-found"}
  )`,
});

export const getIssue = defineEndpoint({
  direction: "read",
  label: text("Get an issue", "Issue abrufen", "Obtener una incidencia", "Récupérer un ticket"),
  description: text(
    "One issue by number: its state, its labels and who it is assigned to.",
    "Ein Issue nach Nummer: Status, Labels und zuständige Personen.",
    "Una incidencia por número: su estado, sus etiquetas y a quién está asignada.",
    "Un ticket par numéro : son état, ses étiquettes et à qui il est assigné."
  ),
  group: "issues",
  ...PUBLIC_READ,
  cache_ttl_seconds: 0,
  params: { ...REPO, ...NUMBER },
  returns: {
    ...REPO_OUT,
    ...OWNER_OUT,
    ...NUMBER_OUT,
    ...TITLE_OUT,
    ...STATE_OUT,
    state_reason: out("string", {
      label: text("Why it closed", "Warum geschlossen", "Motivo del cierre", "Raison de la fermeture"),
    }),
    ...URL_OUT,
    ...AUTHOR_OUT,
    ...LABELS_OUT,
    ...ASSIGNEES_OUT,
    ...MILESTONE_OUT,
    ...COMMENTS_OUT,
    is_pull_request: out("bool"),
    ...CREATED_OUT,
    ...UPDATED_OUT,
    ...CLOSED_OUT,
    ...UNAVAILABLE,
  },
  request: graphql(
    `query Subject($owner: String!, $repo: String!, $number: Int!) {
       repository(owner: $owner, name: $repo) {
         name
         owner { login }
         issueOrPullRequest(number: $number) {
           __typename
           ... on Issue { ${SUBJECT_FIELDS} stateReason }
           ... on PullRequest { ${SUBJECT_FIELDS} }
         }
       }
     }`,
    `{${REPO_VARIABLES}, "number": params.number}`
  ),
  ...needs(NEEDS_REPO, NEEDS_NUMBER),
  map: subject(
    "issueOrPullRequest",
    `{
      "state_reason": $node.stateReason ? $lowercase($node.stateReason) : null,
      "is_pull_request": $node.__typename = "PullRequest"
    }`
  ),
});

const ISSUE_STATES = ["open", "closed", "all"] as const;

export const findIssues = defineEndpoint({
  direction: "read",
  label: text("Find issues", "Issues suchen", "Buscar incidencias", "Rechercher des tickets"),
  description: text(
    "The issues matching a question, as the numbers to act on.",
    "Die Issues, die zu einer Frage passen, als die Nummern, mit denen man weiterarbeitet.",
    "Las incidencias que coinciden con una consulta, como los números sobre los que actuar.",
    "Les tickets correspondant à une question, sous forme des numéros sur lesquels agir."
  ),
  group: "issues",
  ...PUBLIC_READ,
  cache_ttl_seconds: 60,
  params: {
    ...REPO,
    state: param("select", text("State", "Status", "Estado", "État"), { options: [...ISSUE_STATES] }),
    ...LABELS_IN,
    assignee: param("string", text("Assignee", "Zuständige Person", "Persona asignada", "Personne assignée"), {
      options_from: PEOPLE_OF,
    }),
    milestone: param("int", text("Milestone", "Meilenstein", "Hito", "Jalon"), { options_from: MILESTONES_OF }),
    ...SINCE_IN,
    ...SINCE_DAYS_IN,
    ...SORT_IN,
    ...DIRECTION_IN,
    ...LIMIT_IN,
  },
  returns: ROWS_OUT,
  request: graphql(
    `query Issues($owner: String!, $repo: String!, $first: Int!, $filter: IssueFilters, $order: IssueOrder!) {
       repository(owner: $owner, name: $repo) {
         issues(first: $first, filterBy: $filter, orderBy: $order) { totalCount nodes { ${ROW_FIELDS} } }
       }
     }`,
    `{
      ${REPO_VARIABLES},
      "first": ${LIMIT},
      "order": ${ORDERING},
      "filter": $merge([
        {"states": params.state = "all" ? null : params.state = "closed" ? ["CLOSED"] : ["OPEN"]},
        $count(params.labels) ? {"labels": [params.labels]},
        params.assignee ? {"assignee": params.assignee},
        $exists(params.milestone) ? {"milestoneNumber": $string(params.milestone)},
        ($since := ${SINCE}; $since ? {"since": $since})
      ])
    }`
  ),
  ...needs(NEEDS_REPO),
  map: `(
    $issues := response.body.data.repository.issues;
    $issues ? ${rows("$issues.nodes", "$issues.totalCount")} : {"unavailable": "not-found"}
  )`,
});

/** An issue's state changed as the member, with GitHub's reason when it closes. */
function setState(closing: boolean) {
  return {
    request: rest("PATCH", `${REPO_PATH} & "/issues/" & params.number`, {
      connection: ACCOUNT,
      body: closing
        ? `$merge([{"state": "closed"}, params.reason in ["completed", "not_planned"] ? {"state_reason": params.reason}])`
        : `{"state": "open"}`,
    }),
    errors: GITHUB_ERRORS,
    map: `{
      "repository": $split(response.body.repository_url, "/")[-1],
      "number": response.body.number,
      "state": response.body.state,
      "html_url": response.body.html_url
    }`,
  };
}

export const openIssue = defineEndpoint({
  direction: "write",
  label: text("Open an issue", "Issue öffnen", "Abrir una incidencia", "Ouvrir un ticket"),
  description: text(
    "Opens one in a repository the installation covers, as the member.",
    "Öffnet eines in einem Repository der Installation, als das Mitglied.",
    "Abre una en un repositorio que cubre la instalación, como el miembro.",
    "En ouvre un dans un dépôt couvert par l'installation, en tant que le membre."
  ),
  group: "issues",
  ...PUBLIC_WRITE,
  params: {
    ...REPO,
    title: param("string", text("Title", "Titel", "Título", "Titre"), { required: true }),
    body: param("string", text("Body", "Text", "Cuerpo", "Corps")),
    ...LABELS_IN,
    assignees: param("string", text("Assignees", "Zuständige", "Asignados", "Assignés"), {
      list: true,
      options_from: PEOPLE_OF,
    }),
  },
  returns: {
    ...REPO_OUT,
    ...NUMBER_OUT,
    ...LINK_OUT,
    id: out("int", { label: text("GitHub id", "GitHub-ID", "ID de GitHub", "Identifiant GitHub") }),
  },
  identity: ISSUE_IDENTITY,
  request: rest("POST", `${REPO_PATH} & "/issues"`, {
    connection: ACCOUNT,
    body: `$merge([
      {"title": params.title},
      params.body ? {"body": params.body},
      $count(params.labels) ? {"labels": [params.labels]},
      $count(params.assignees) ? {"assignees": [params.assignees]}
    ])`,
  }),
  errors: GITHUB_ERRORS,
  map: `{
    "repository": $split(response.body.repository_url, "/")[-1],
    "number": response.body.number,
    "html_url": response.body.html_url,
    "id": response.body.id
  }`,
});

export const comment = defineEndpoint({
  direction: "write",
  label: text("Comment", "Kommentieren", "Comentar", "Commenter"),
  description: text(
    "Adds a comment to an issue or a pull request, as the member.",
    "Fügt einem Issue oder Pull Request einen Kommentar hinzu, als das Mitglied.",
    "Añade un comentario a una incidencia o pull request, como el miembro.",
    "Ajoute un commentaire à un ticket ou une pull request, en tant que le membre."
  ),
  group: "issues",
  ...PUBLIC_WRITE,
  params: { ...REPO, ...NUMBER, body: param("string", text("Body", "Text", "Cuerpo", "Corps"), { required: true }) },
  returns: {
    ...REPO_OUT,
    ...NUMBER_OUT,
    id: out("int", {
      label: text("Comment id", "Kommentar-ID", "ID del comentario", "Identifiant du commentaire"),
    }),
    ...LINK_OUT,
  },
  identity: ISSUE_IDENTITY,
  request: rest("POST", `${REPO_PATH} & "/issues/" & params.number & "/comments"`, {
    connection: ACCOUNT,
    body: `{"body": params.body}`,
  }),
  errors: GITHUB_ERRORS,
  map: `{
    "repository": $split(response.body.issue_url, "/")[-3],
    "number": params.number,
    "id": response.body.id,
    "html_url": response.body.html_url
  }`,
});

const STATE_RETURNS = { ...REPO_OUT, ...NUMBER_OUT, state: out("string"), ...LINK_OUT };

export const closeIssue = defineEndpoint({
  direction: "write",
  label: text("Close an issue", "Issue schließen", "Cerrar una incidencia", "Fermer un ticket"),
  description: text(
    "Closes it as completed or as not planned, as the member.",
    "Schließt es als erledigt oder als nicht geplant, als das Mitglied.",
    "La cierra como completada o como no planificada, como el miembro.",
    "Le ferme comme terminé ou comme non planifié, en tant que le membre."
  ),
  group: "issues",
  ...PUBLIC_WRITE,
  params: {
    ...REPO,
    ...NUMBER,
    reason: param("select", text("Reason", "Grund", "Motivo", "Raison"), { options: ["completed", "not_planned"] }),
  },
  returns: STATE_RETURNS,
  identity: ISSUE_IDENTITY,
  ...setState(true),
});

export const reopenIssue = defineEndpoint({
  direction: "write",
  label: text("Reopen an issue", "Issue wieder öffnen", "Reabrir una incidencia", "Rouvrir un ticket"),
  description: text(
    "Puts a closed issue back into the open state, as the member.",
    "Versetzt ein geschlossenes Issue zurück in den offenen Zustand, als das Mitglied.",
    "Devuelve una incidencia cerrada al estado abierto, como el miembro.",
    "Remet un ticket fermé à l'état ouvert, en tant que le membre."
  ),
  group: "issues",
  ...PUBLIC_WRITE,
  params: { ...REPO, ...NUMBER },
  returns: STATE_RETURNS,
  identity: ISSUE_IDENTITY,
  ...setState(false),
});

export const label = defineEndpoint({
  direction: "write",
  label: text("Change labels", "Labels ändern", "Cambiar etiquetas", "Modifier les étiquettes"),
  description: text(
    "Adds or removes labels on an issue or a pull request, as the member.",
    "Fügt an einem Issue oder Pull Request Labels hinzu oder entfernt sie, als das Mitglied.",
    "Añade o quita etiquetas en una incidencia o pull request, como el miembro.",
    "Ajoute ou retire des étiquettes sur un ticket ou une pull request, en tant que le membre."
  ),
  group: "issues",
  ...PUBLIC_WRITE,
  params: {
    ...REPO,
    ...NUMBER,
    add: { ...LABELS_IN.labels, label: text("Labels to add", "Hinzuzufügende Labels", "Etiquetas a añadir", "Étiquettes à ajouter") },
    remove: { ...LABELS_IN.labels, label: text("Labels to remove", "Zu entfernende Labels", "Etiquetas a quitar", "Étiquettes à retirer") }},
  returns: { ...REPO_OUT, ...NUMBER_OUT },
  identity: ISSUE_IDENTITY,
  // The issue's labels now, read on the installation, then the whole set
  // written as the member. Naming a label in both lists ends with it present;
  // GitHub matches label names without regard to case.
  steps: [
    { name: "issue", request: rest("GET", `${REPO_PATH} & "/issues/" & params.number`) },
    {
      name: "labels",
      request: rest("PUT", `${REPO_PATH} & "/issues/" & params.number & "/labels"`, {
        connection: ACCOUNT,
        body: `(
          $add := [params.add];
          $gone := [params.remove.$lowercase($), $add.$lowercase($)];
          {"labels": [steps.issue.body.labels.name[$not($lowercase($) in $gone)], $distinct($add)]}
        )`,
      }),
    },
  ],
  errors: [{ status: "2xx", when: "$count(params.add) + $count(params.remove) = 0", code: "invalid" }, ...GITHUB_ERRORS],
  map: `{"repository": $split(steps.issue.body.repository_url, "/")[-1], "number": params.number}`,
});
