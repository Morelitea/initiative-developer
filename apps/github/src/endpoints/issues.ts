import { graphql, rest } from "../github/http.js";
import {
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
  READ_IDS,
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
  WORKSPACE,
  WRITE_IDS,
} from "../vocabulary.js";
import {
  bad,
  choice,
  int,
  isResult,
  limit,
  list,
  lower,
  nodes,
  ordering,
  PAGE,
  pick,
  PUBLIC_READ,
  PUBLIC_WRITE,
  readFailure,
  repoAccess,
  repository,
  ROW_FIELDS,
  rows,
  since,
  states,
  subject,
  SUBJECT_FIELDS,
  text as textParam,
  unavailable,
  writeFailure,
  type Call,
  type Connection,
  type Place,
  type Read,
  type Row,
  type SubjectNode,
  type Write,
  type WriteOutcome,
} from "./support.js";

export const listLabels: Read = {
  declaration: {
    id: READ_IDS.listLabels,
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
    params: [REPO],
    returns: [
      many(out("names", "string", { label: text("Labels", "Labels", "Etiquetas", "Étiquettes") })),
      COUNT_OUT,
      TOTAL_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const answer = await graphql<{ repository: { labels: Connection<{ name?: string }> } | null }>(
      call.context.github.http,
      access.token,
      `query Labels($owner: String!, $repo: String!, $first: Int!) {
         repository(owner: $owner, name: $repo) { labels(first: $first) { totalCount nodes { name } } }
       }`,
      { owner: access.owner, repo: access.repo, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const labels = answer.body.repository?.labels;
    if (!labels) return { actor: "installation", result: unavailable("not-found") };
    const names = nodes(labels).map((label) => label.name).filter((name): name is string => !!name);
    return {
      actor: "installation",
      result: { names, count: names.length, total: labels.totalCount ?? names.length },
    };
  },
};

export const listMilestones: Read = {
  declaration: {
    id: READ_IDS.listMilestones,
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
    params: [REPO],
    returns: [
      many(out("numbers", "int", { label: text("Milestones", "Meilensteine", "Hitos", "Jalons") })),
      many(out("titles", "string", { label: text("Names", "Namen", "Nombres", "Noms") })),
      COUNT_OUT,
      TOTAL_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    // Open ones, soonest due first: what somebody is planning against.
    const answer = await graphql<{
      repository: { milestones: Connection<{ number?: number; title?: string }> } | null;
    }>(
      call.context.github.http,
      access.token,
      `query Milestones($owner: String!, $repo: String!, $first: Int!) {
         repository(owner: $owner, name: $repo) {
           milestones(first: $first, states: [OPEN], orderBy: { field: DUE_DATE, direction: ASC }) {
             totalCount
             nodes { number title }
           }
         }
       }`,
      { owner: access.owner, repo: access.repo, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const milestones = answer.body.repository?.milestones;
    if (!milestones) return { actor: "installation", result: unavailable("not-found") };
    const found = nodes(milestones).filter(
      (milestone): milestone is { number: number; title?: string } => typeof milestone.number === "number"
    );
    return {
      actor: "installation",
      result: {
        numbers: found.map((milestone) => milestone.number),
        titles: found.map((milestone) => milestone.title ?? ""),
        count: found.length,
        total: milestones.totalCount ?? found.length,
      },
    };
  },
};

export const getIssue: Read = {
  declaration: {
    id: READ_IDS.getIssue,
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
    params: [REPO, NUMBER],
    returns: [
      REPO_OUT,
      OWNER_OUT,
      NUMBER_OUT,
      TITLE_OUT,
      STATE_OUT,
      out("state_reason", "string", {
        label: text("Why it closed", "Warum geschlossen", "Motivo del cierre", "Raison de la fermeture"),
      }),
      URL_OUT,
      AUTHOR_OUT,
      LABELS_OUT,
      ASSIGNEES_OUT,
      MILESTONE_OUT,
      COMMENTS_OUT,
      out("is_pull_request", "bool"),
      CREATED_OUT,
      UPDATED_OUT,
      CLOSED_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const number = int(call.params, "number");
    if (number === undefined) return { actor: "installation", result: unavailable("number-required") };

    const answer = await graphql<{ repository: { issueOrPullRequest: SubjectNode | null } | null }>(
      call.context.github.http,
      access.token,
      `query Subject($owner: String!, $repo: String!, $number: Int!) {
         repository(owner: $owner, name: $repo) {
           issueOrPullRequest(number: $number) {
             __typename
             ... on Issue { ${SUBJECT_FIELDS} stateReason }
             ... on PullRequest { ${SUBJECT_FIELDS} }
           }
         }
       }`,
      { owner: access.owner, repo: access.repo, number }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const node = answer.body.repository?.issueOrPullRequest;
    if (!node) return { actor: "installation", result: unavailable("not-found") };
    return {
      actor: "installation",
      result: {
        ...subject(node, access.owner, access.repo),
        state_reason: lower(node.stateReason),
        is_pull_request: node.__typename === "PullRequest",
      },
    };
  },
};

const ISSUE_STATES = ["open", "closed", "all"] as const;

export const findIssues: Read = {
  declaration: {
    id: READ_IDS.findIssues,
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
    params: [
      REPO,
      param("state", "select", text("State", "Status", "Estado", "État"), { options: [...ISSUE_STATES] }),
      LABELS_IN,
      param("assignee", "string", text("Assignee", "Zuständige Person", "Persona asignada", "Personne assignée"), {
        options_from: PEOPLE_OF,
      }),
      param("milestone", "int", text("Milestone", "Meilenstein", "Hito", "Jalon"), { options_from: MILESTONES_OF }),
      SINCE_IN,
      SINCE_DAYS_IN,
      SORT_IN,
      DIRECTION_IN,
      LIMIT_IN,
    ],
    returns: ROWS_OUT,
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const labels = list(call.params, "labels");
    const assignee = textParam(call.params, "assignee");
    const milestone = textParam(call.params, "milestone");
    const after = since(call.params, call.context.now());

    const answer = await graphql<{ repository: { issues: Connection<Row> } | null }>(
      call.context.github.http,
      access.token,
      `query Issues($owner: String!, $repo: String!, $first: Int!, $filter: IssueFilters, $order: IssueOrder!) {
         repository(owner: $owner, name: $repo) {
           issues(first: $first, filterBy: $filter, orderBy: $order) { totalCount nodes { ${ROW_FIELDS} } }
         }
       }`,
      {
        owner: access.owner,
        repo: access.repo,
        first: limit(call.params),
        order: ordering(call.params),
        filter: {
          states: states(choice(call.params, "state", ISSUE_STATES, "open")),
          ...(labels.length ? { labels } : {}),
          ...(assignee ? { assignee } : {}),
          ...(milestone ? { milestoneNumber: milestone } : {}),
          ...(after ? { since: after } : {}),
        },
      }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const issues = answer.body.repository?.issues;
    if (!issues) return { actor: "installation", result: unavailable("not-found") };
    return { actor: "installation", result: rows(nodes(issues), issues.totalCount) };
  },
};

/** The repository a write names, checked against what the installation covers. */
export async function writePlace(call: Call, place: Place): Promise<{ repo: string } | WriteOutcome> {
  const chosen = await repository(call, place);
  if ("unavailable" in chosen) {
    const status = chosen.unavailable === "repository-required" ? 400 : chosen.unavailable === "repository-not-listed" ? 404 : 502;
    return { ok: false, status, error: chosen.unavailable };
  }
  return chosen;
}

async function setState(call: Call, token: string, place: Place, closing: boolean): Promise<WriteOutcome> {
  const where = await writePlace(call, place);
  if ("ok" in where) return where;
  const number = int(call.params, "number");
  if (number === undefined) return bad("number is required");
  const reason = textParam(call.params, "reason");

  const answer = await rest(call.context.github.http, token, "PATCH", `/repos/${place.owner}/${where.repo}/issues/${number}`, {
    state: closing ? "closed" : "open",
    ...(closing && (reason === "completed" || reason === "not_planned") ? { state_reason: reason } : {}),
  });
  if (!answer.ok) return writeFailure(answer.failure, answer.message);
  return { ok: true, result: { repository: where.repo, ...pick(answer.body, ["number", "state", "html_url"]) } };
}

export const openIssue: Write = {
  declaration: {
    id: WRITE_IDS.openIssue,
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
    params: [
      REPO,
      param("title", "string", text("Title", "Titel", "Título", "Titre"), { required: true }),
      param("body", "string", text("Body", "Text", "Cuerpo", "Corps")),
      LABELS_IN,
      param("assignees", "string", text("Assignees", "Zuständige", "Asignados", "Assignés"), {
        list: true,
        options_from: PEOPLE_OF,
      }),
    ],
    returns: [
      REPO_OUT,
      NUMBER_OUT,
      LINK_OUT,
      out("id", "int", { label: text("GitHub id", "GitHub-ID", "ID de GitHub", "Identifiant GitHub") }),
    ],
    identity: ISSUE_IDENTITY,
  },

  async run(call, token, place) {
    const where = await writePlace(call, place);
    if ("ok" in where) return where;
    const title = textParam(call.params, "title");
    if (!title) return bad("title is required");
    const body = textParam(call.params, "body");
    const labels = list(call.params, "labels");
    const assignees = list(call.params, "assignees");

    const answer = await rest(call.context.github.http, token, "POST", `/repos/${place.owner}/${where.repo}/issues`, {
      title,
      ...(body ? { body } : {}),
      ...(labels.length ? { labels } : {}),
      ...(assignees.length ? { assignees } : {}),
    });
    if (!answer.ok) return writeFailure(answer.failure, answer.message);
    return { ok: true, result: { repository: where.repo, ...pick(answer.body, ["number", "html_url", "id"]) } };
  },
};

export const comment: Write = {
  declaration: {
    id: WRITE_IDS.comment,
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
    params: [REPO, NUMBER, param("body", "string", text("Body", "Text", "Cuerpo", "Corps"), { required: true })],
    returns: [
      REPO_OUT,
      NUMBER_OUT,
      out("id", "int", {
        label: text("Comment id", "Kommentar-ID", "ID del comentario", "Identifiant du commentaire"),
      }),
      LINK_OUT,
    ],
    identity: ISSUE_IDENTITY,
  },

  async run(call, token, place) {
    const where = await writePlace(call, place);
    if ("ok" in where) return where;
    const number = int(call.params, "number");
    const body = textParam(call.params, "body");
    if (number === undefined) return bad("number is required");
    if (!body) return bad("body is required");

    const answer = await rest(
      call.context.github.http,
      token,
      "POST",
      `/repos/${place.owner}/${where.repo}/issues/${number}/comments`,
      { body }
    );
    if (!answer.ok) return writeFailure(answer.failure, answer.message);
    return { ok: true, result: { repository: where.repo, number, ...pick(answer.body, ["id", "html_url"]) } };
  },
};

const STATE_RETURNS = [REPO_OUT, NUMBER_OUT, out("state", "string"), LINK_OUT];

export const closeIssue: Write = {
  declaration: {
    id: WRITE_IDS.closeIssue,
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
    params: [
      REPO,
      NUMBER,
      param("reason", "select", text("Reason", "Grund", "Motivo", "Raison"), { options: ["completed", "not_planned"] }),
    ],
    returns: STATE_RETURNS,
    identity: ISSUE_IDENTITY,
  },

  run: (call, token, place) => setState(call, token, place, true),
};

export const reopenIssue: Write = {
  declaration: {
    id: WRITE_IDS.reopenIssue,
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
    params: [REPO, NUMBER],
    returns: STATE_RETURNS,
    identity: ISSUE_IDENTITY,
  },

  run: (call, token, place) => setState(call, token, place, false),
};

export const label: Write = {
  declaration: {
    id: WRITE_IDS.label,
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
    params: [
      REPO,
      NUMBER,
      { ...LABELS_IN, key: "add", label: text("Labels to add", "Hinzuzufügende Labels", "Etiquetas a añadir", "Étiquettes à ajouter") },
      { ...LABELS_IN, key: "remove", label: text("Labels to remove", "Zu entfernende Labels", "Etiquetas a quitar", "Étiquettes à retirer") },
    ],
    returns: [REPO_OUT, NUMBER_OUT],
    identity: ISSUE_IDENTITY,
  },

  async run(call, token, place) {
    const where = await writePlace(call, place);
    if ("ok" in where) return where;
    const number = int(call.params, "number");
    if (number === undefined) return bad("number is required");
    const add = list(call.params, "add");
    const remove = list(call.params, "remove");
    if (!add.length && !remove.length) return bad("name a label to add or to remove");
    const base = `/repos/${place.owner}/${where.repo}/issues/${number}/labels`;

    // Removals first, so naming a label in both ends with it present. A label
    // that was not there is already the state asked for.
    for (const name of remove) {
      const answer = await rest(call.context.github.http, token, "DELETE", `${base}/${encodeURIComponent(name)}`);
      if (!answer.ok && answer.failure !== "not-found") return writeFailure(answer.failure, answer.message);
    }
    if (add.length) {
      const answer = await rest(call.context.github.http, token, "POST", base, { labels: add });
      if (!answer.ok) return writeFailure(answer.failure, answer.message);
    }
    return { ok: true, result: { repository: where.repo, number } };
  },
};
