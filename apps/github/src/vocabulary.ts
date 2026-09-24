/**
 * Names shared by the manifest, the endpoints and the widgets: the public id,
 * the endpoint ids, the connection ids, and the parameters and returns several
 * endpoints have in common, each labelled in the four languages the manifest
 * ships.
 */

import type {
  EndpointIdentity,
  EndpointParam,
  EndpointReturn,
  LocalizedText,
  Scope,
} from "initiative-app-kit";

export const PUBLIC_ID = "morelitea.github";

/** The catalog listing's uid, and the bundled dashboard's. Immutable. */
export const LISTING_UID = "XTEAP993JW1E94";
export const DASHBOARD_UID = "YB67VZS8NB161S";

/** What the app asks a community to grant. */
export const SCOPES: readonly Scope[] = [
  "projects:read",
  "projects:write",
  "comments:write",
  "members:read",
  "initiatives:read",
  "tags:read",
];

/** The community's GitHub installation, written back by the install flow. */
export const WORKSPACE = "workspace";
/** Each member's own GitHub authorization, written back by the connect flow. */
export const ACCOUNT = "account";

export const PATHS = {
  connect: "/connect/github",
  connectCallback: "/connect/github/callback",
  install: "/install/github",
  installSetup: "/install/github/setup",
  installVerify: "/install/github/verify",
  webhook: "/github/webhook",
  jwks: "/.well-known/jwks.json",
} as const;

export function declare(name: string): string {
  return `app.${PUBLIC_ID}.${name}`;
}

export const READ_IDS = {
  listRepositories: declare("list-repositories"),
  listLabels: declare("list-labels"),
  getIssue: declare("get-issue"),
  findIssues: declare("find-issues"),
  getPullRequest: declare("get-pull-request"),
  findPullRequests: declare("find-pull-requests"),
  listAlerts: declare("list-alerts"),
  listProjects: declare("list-projects"),
  listProjectFields: declare("list-project-fields"),
  listProjectOptions: declare("list-project-options"),
  findProjectItem: declare("find-project-item"),
} as const;

export const WRITE_IDS = {
  openIssue: declare("open-issue"),
  comment: declare("comment"),
  closeIssue: declare("close-issue"),
  reopenIssue: declare("reopen-issue"),
  label: declare("label"),
  requestReview: declare("request-review"),
  moveProjectItem: declare("move-project-item"),
} as const;

export const EMIT_IDS = {
  issueOpened: declare("issue-opened"),
  issueClosed: declare("issue-closed"),
  reviewRequested: declare("review-requested"),
} as const;

export function text(en: string, de: string, es: string, fr: string): LocalizedText {
  return { en, de, es, fr };
}

export function param(
  key: string,
  type: EndpointParam["type"],
  label: LocalizedText,
  extra: Partial<EndpointParam> = {}
): EndpointParam {
  return { key, type, label, ...extra };
}

export function out(
  key: string,
  type: EndpointReturn["type"],
  extra: Partial<EndpointReturn> = {}
): EndpointReturn {
  return { key, type, ...extra };
}

export function many(value: EndpointReturn): EndpointReturn {
  return { ...value, list: true };
}

/** An issue or pull request is named by its repository and number, on a write and on an event alike. */
export const ISSUE_IDENTITY: EndpointIdentity = { kind: "issue", key: ["repository", "number"] };

export const REPO = param("repo", "string", text("Repository", "Repository", "Repositorio", "Dépôt"), {
  options_from: { endpoint: READ_IDS.listRepositories, key: "names" },
});

export const NUMBER = param("number", "int", text("Number", "Nummer", "Número", "Numéro"));

export const LABELS_IN = param("labels", "string", text("Labels", "Labels", "Etiquetas", "Étiquettes"), {
  list: true,
  options_from: { endpoint: READ_IDS.listLabels, key: "names", needs: { repo: "repo" } },
});

export const BOARD = param("project_id", "string", text("Project", "Projekt", "Proyecto", "Projet"), {
  options_from: { endpoint: READ_IDS.listProjects, key: "ids", label_key: "titles" },
});

export const FIELDS_OF = {
  endpoint: READ_IDS.listProjectFields,
  key: "ids",
  label_key: "names",
  needs: { project_id: "project_id" },
};

export const SORT_IN = param("sort", "select", text("Order by", "Sortieren nach", "Ordenar por", "Trier par"), {
  options: ["created", "updated", "comments"],
});

export const DIRECTION_IN = param("direction", "select", text("Order", "Reihenfolge", "Orden", "Ordre"), {
  options: ["desc", "asc"],
});

export const LIMIT_IN = param("limit", "int", text("How many", "Wie viele", "Cuántos", "Combien"));

export const SINCE_IN = param("since", "datetime", text("Since", "Seit", "Desde", "Depuis"));

export const SINCE_DAYS_IN = param(
  "since_days",
  "int",
  text("Days back", "Tage zurück", "Días atrás", "Jours en arrière")
);

export const REPO_OUT = out("repository", "string");
export const OWNER_OUT = out("owner", "string");
export const NUMBER_OUT = out("number", "int");
export const TITLE_OUT = out("title", "string");
export const STATE_OUT = out("state", "string");
export const URL_OUT = out("url", "url");
export const AUTHOR_OUT = out("author", "string");
export const MILESTONE_OUT = out("milestone", "string");
export const COMMENTS_OUT = out("comments", "int");
export const CLOSED_OUT = out("closed_at", "string");
export const LABELS_OUT = many(out("labels", "string"));
export const ASSIGNEES_OUT = many(out("assignees", "string"));
export const LINK_OUT = out("html_url", "url", { label: text("Link", "Link", "Enlace", "Lien") });

export const CREATED_OUT = out("created_at", "string", {
  label: text("Opened", "Geöffnet", "Abierta", "Ouvert"),
});

export const UPDATED_OUT = out("updated_at", "string", {
  label: text("Last updated", "Zuletzt aktualisiert", "Última actualización", "Dernière mise à jour"),
});

export const COUNT_OUT = out("count", "int", {
  label: text("How many", "Wie viele", "Cuántos", "Combien"),
});

export const TOTAL_OUT = out("total", "int", {
  label: text("How many in all", "Wie viele insgesamt", "Cuántos en total", "Combien en tout"),
});

/** Why a read has no answer, in a code a widget can put into words. */
export const UNAVAILABLE = out("unavailable", "string", {
  label: text(
    "Why there is no answer",
    "Warum es keine Antwort gibt",
    "Por qué no hay respuesta",
    "Pourquoi il n'y a pas de réponse"
  ),
});

/** The columns every list of issues or pull requests answers with. */
export const ROWS_OUT: EndpointReturn[] = [
  many(out("numbers", "int")),
  many(out("titles", "string")),
  many(out("urls", "url")),
  many(out("states", "string")),
  many(CREATED_OUT),
  many(UPDATED_OUT),
  many(out("closed_at", "string")),
  COUNT_OUT,
  TOTAL_OUT,
  UNAVAILABLE,
];
