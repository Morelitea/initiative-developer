/**
 * Names shared by the manifest, the endpoints and the widgets: the public id,
 * the endpoint ids, the connection ids, and the parameters and returns several
 * endpoints have in common, each labelled in the four languages the manifest
 * ships.
 */

import type { LocalizedText, ParamSpec, ParamType, ReturnSpec, ReturnValueType, Scope } from "initiative-app-sdk/manifest";

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

/** The community's GitHub installation, which Initiative connects on GitHub's install page. */
export const WORKSPACE = "workspace";
/** Each member's own GitHub authorization, which Initiative runs and holds. */
export const ACCOUNT = "account";

/** The schedule on which Initiative asks whether the organization's installation still exists. */
export const CHECK_INSTALLATION = "check-installation";

export function declare(name: string): string {
  return `app.${PUBLIC_ID}.${name}`;
}

/** Each name's manifest id, `app.<public id>.<name>`. */
function ids<const T extends Record<string, string>>(names: T): { [K in keyof T]: string } {
  return Object.fromEntries(Object.entries(names).map(([key, name]) => [key, declare(name)])) as { [K in keyof T]: string };
}

/** The endpoints, by the names the app's definition keys them by. */
export const READ = {
  listRepositories: "list-repositories",
  listAssignees: "list-assignees",
  listBranches: "list-branches",
  listLabels: "list-labels",
  listMilestones: "list-milestones",
  getIssue: "get-issue",
  findIssues: "find-issues",
  getPullRequest: "get-pull-request",
  findPullRequests: "find-pull-requests",
  listAlerts: "list-alerts",
  listProjects: "list-projects",
  listProjectFields: "list-project-fields",
  listProjectOptions: "list-project-options",
  findProjectItem: "find-project-item",
} as const;

export const WRITE = {
  openIssue: "open-issue",
  comment: "comment",
  closeIssue: "close-issue",
  reopenIssue: "reopen-issue",
  label: "label",
  requestReview: "request-review",
  moveProjectItem: "move-project-item",
} as const;

export const EMIT = {
  issueOpened: "issue-opened",
  issueClosed: "issue-closed",
  reviewRequested: "review-requested",
  releasePublished: "release-published",
  prereleasePublished: "prerelease-published",
  tagCreated: "tag-created",
} as const;

export const READ_IDS = ids(READ);
export const WRITE_IDS = ids(WRITE);
export const EMIT_IDS = ids(EMIT);

export function text(en: string, de: string, es: string, fr: string): LocalizedText {
  return { en, de, es, fr };
}

export function param<const T extends ParamType, const X extends Partial<ParamSpec> = {}>(
  type: T,
  label: LocalizedText,
  extra?: X
): { type: T; label: LocalizedText } & X {
  return { type, label, ...(extra as X) };
}

export function out<const T extends ReturnValueType, const X extends Partial<Exclude<ReturnSpec, string>> = {}>(
  type: T,
  extra?: X
): { type: T } & X {
  return { type, ...(extra as X) };
}

export function many<const V extends object>(value: V): V & { list: true } {
  return { ...value, list: true };
}

/** An issue or pull request is named by its repository and number, on a write and on an event alike. */
export const ISSUE_IDENTITY = { kind: "issue", key: ["repository", "number"] };

/** A release is named by its repository and tag. */
export const RELEASE_IDENTITY = { kind: "release", key: ["repository", "tag"] };

/**
 * A tag is named the same way but is its own kind: a tag and a release cut at
 * it are two objects at GitHub, and either exists without the other.
 */
export const TAG_IDENTITY = { kind: "tag", key: ["repository", "tag"] };

export const REPO = {
  repo: param("string", text("Repository", "Repository", "Repositorio", "Dépôt"), {
    options_from: { endpoint: READ.listRepositories, key: "names" },
  }),
};

/**
 * Who can be assigned in that repository. GitHub answers who may be asked for
 * a review with the same list, so one read fills both.
 */
export const PEOPLE_OF = { endpoint: READ.listAssignees, key: "logins", needs: { repo: "repo" } };

/** That repository's open milestones, by number, read by title. */
export const MILESTONES_OF = {
  endpoint: READ.listMilestones,
  key: "numbers",
  label_key: "titles",
  needs: { repo: "repo" },
};

export const NUMBER = { number: param("int", text("Number", "Nummer", "Número", "Numéro")) };

export const LABELS_IN = {
  labels: param("string", text("Labels", "Labels", "Etiquetas", "Étiquettes"), {
    list: true,
    options_from: { endpoint: READ.listLabels, key: "names", needs: { repo: "repo" } },
  }),
};

export const BOARD = {
  project_id: param("string", text("Project", "Projekt", "Proyecto", "Projet"), {
    options_from: { endpoint: READ.listProjects, key: "ids", label_key: "titles" },
  }),
};

export const FIELDS_OF = {
  endpoint: READ.listProjectFields,
  key: "ids",
  label_key: "names",
  needs: { project_id: "project_id" },
};

export const SORT_IN = {
  sort: param("select", text("Order by", "Sortieren nach", "Ordenar por", "Trier par"), {
    options: ["created", "updated", "comments"],
  }),
};

export const DIRECTION_IN = {
  direction: param("select", text("Order", "Reihenfolge", "Orden", "Ordre"), { options: ["desc", "asc"] }),
};

export const LIMIT_IN = { limit: param("int", text("How many", "Wie viele", "Cuántos", "Combien")) };

export const SINCE_IN = { since: param("datetime", text("Since", "Seit", "Desde", "Depuis")) };

export const SINCE_DAYS_IN = {
  since_days: param("int", text("Days back", "Tage zurück", "Días atrás", "Jours en arrière")),
};

export const REPO_OUT = { repository: out("string") };
export const OWNER_OUT = { owner: out("string") };
export const NUMBER_OUT = { number: out("int") };
export const TITLE_OUT = { title: out("string") };
export const STATE_OUT = { state: out("string") };
export const URL_OUT = { url: out("url") };
export const AUTHOR_OUT = { author: out("string") };
export const MILESTONE_OUT = { milestone: out("string") };
export const COMMENTS_OUT = { comments: out("int") };
export const CLOSED_OUT = { closed_at: out("string") };
export const LABELS_OUT = { labels: many(out("string")) };
export const ASSIGNEES_OUT = { assignees: many(out("string")) };
export const LINK_OUT = { html_url: out("url", { label: text("Link", "Link", "Enlace", "Lien") }) };

const OPENED = out("string", { label: text("Opened", "Geöffnet", "Abierta", "Ouvert") });
const LAST_UPDATED = out("string", {
  label: text("Last updated", "Zuletzt aktualisiert", "Última actualización", "Dernière mise à jour"),
});

export const CREATED_OUT = { created_at: OPENED };
export const UPDATED_OUT = { updated_at: LAST_UPDATED };

export const COUNT_OUT = { count: out("int", { label: text("How many", "Wie viele", "Cuántos", "Combien") }) };

export const TOTAL_OUT = {
  total: out("int", { label: text("How many in all", "Wie viele insgesamt", "Cuántos en total", "Combien en tout") }),
};

/** Why a read has no answer, in a code a widget can put into words. */
export const UNAVAILABLE = {
  unavailable: out("string", {
    label: text(
      "Why there is no answer",
      "Warum es keine Antwort gibt",
      "Por qué no hay respuesta",
      "Pourquoi il n'y a pas de réponse"
    ),
  }),
};

/** The columns every list of issues or pull requests answers with. */
export const ROWS_OUT = {
  numbers: many(out("int")),
  titles: many(out("string")),
  urls: many(out("url")),
  states: many(out("string")),
  created_at: many(OPENED),
  updated_at: many(LAST_UPDATED),
  closed_at: many(out("string")),
  ...COUNT_OUT,
  ...TOTAL_OUT,
  ...UNAVAILABLE,
};
