/**
 * The six announcements: what each GitHub delivery becomes, and the
 * declaration a subscriber reads before any arrives. The payload each builds
 * carries exactly the returns it declares.
 */

import type { Endpoint, EndpointReturn } from "initiative-app-kit";

import { EMIT_IDS, ISSUE_IDENTITY, many, out, RELEASE_IDENTITY, TAG_IDENTITY, text } from "../vocabulary.js";

const SUBJECT: readonly EndpointReturn[] = [
  out("repository", "string"),
  out("owner", "string"),
  out("number", "int"),
  out("title", "string"),
  out("url", "url"),
  out("author", "string"),
];

/**
 * What a release announcement carries. `name` is the release's title, which
 * is often not its tag; `branch` is the ref it was cut from.
 */
const RELEASE_SUBJECT: readonly EndpointReturn[] = [
  out("repository", "string"),
  out("owner", "string"),
  out("tag", "string"),
  out("name", "string", { label: text("Title", "Titel", "Título", "Titre") }),
  out("branch", "string", {
    label: text("Released from", "Veröffentlicht aus", "Publicado desde", "Publié depuis"),
  }),
  out("url", "url"),
  out("author", "string"),
];

/**
 * What a tag announcement carries. A tag points at a commit, not a branch, so
 * GitHub names none and neither does this.
 */
const TAG_SUBJECT: readonly EndpointReturn[] = [
  out("repository", "string"),
  out("owner", "string"),
  out("tag", "string"),
  out("url", "url"),
  out("author", "string"),
];

interface Announcement {
  declaration: Endpoint;
  /** The GitHub event it answers, and which deliveries of it. */
  event: string;
  when(payload: Record<string, unknown>): boolean;
  build(payload: Record<string, unknown>): Record<string, unknown> | null;
}

function field(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null ? (source as Record<string, unknown>)[key] : undefined;
}

function textOf(source: unknown, key: string): string | null {
  const value = field(source, key);
  return typeof value === "string" ? value : null;
}

/** An issue or a pull request, from the block of the payload it arrives under. */
function subjectOf(payload: Record<string, unknown>, holder: "issue" | "pull_request") {
  const subject = field(payload, holder);
  const number = field(subject, "number");
  const repository = textOf(field(payload, "repository"), "name");
  if (typeof number !== "number" || !repository) return null;
  return {
    repository,
    owner: textOf(field(field(payload, "repository"), "owner"), "login"),
    number,
    title: textOf(subject, "title"),
    url: textOf(subject, "html_url"),
    author: textOf(field(subject, "user"), "login"),
  };
}

/** A delivery whose `action` is `name`. */
const action = (name: string) => (payload: Record<string, unknown>) => textOf(payload, "action") === name;

function ownerOf(payload: Record<string, unknown>): string | null {
  return textOf(field(field(payload, "repository"), "owner"), "login");
}

function releaseEvent(payload: Record<string, unknown>) {
  const release = field(payload, "release");
  const repository = textOf(field(payload, "repository"), "name");
  const tag = textOf(release, "tag_name");
  if (!repository || !tag) return null;
  return {
    repository,
    owner: ownerOf(payload),
    tag,
    name: textOf(release, "name"),
    branch: textOf(release, "target_commitish"),
    url: textOf(release, "html_url"),
    author: textOf(field(release, "author"), "login"),
  };
}

function tagEvent(payload: Record<string, unknown>) {
  const repository = textOf(field(payload, "repository"), "name");
  const tag = textOf(payload, "ref");
  if (!repository || !tag) return null;
  // GitHub sends no link for a new tag; its page is under the repository's.
  const home = textOf(field(payload, "repository"), "html_url");
  return {
    repository,
    owner: ownerOf(payload),
    tag,
    url: home ? encodeURI(`${home}/tree/${tag}`) : null,
    // A tag has no author of its own here: the person who pushed it.
    author: textOf(field(payload, "sender"), "login"),
  };
}

function labelsOf(payload: Record<string, unknown>): string[] {
  const labels = field(field(payload, "issue"), "labels");
  return Array.isArray(labels)
    ? labels.map((label) => textOf(label, "name")).filter((name): name is string => !!name)
    : [];
}

function issueEvent(payload: Record<string, unknown>) {
  const base = subjectOf(payload, "issue");
  // GitHub delivers `issues` events for pull requests too; those are not issues.
  if (!base || field(field(payload, "issue"), "pull_request") !== undefined) return null;
  return { ...base, labels: labelsOf(payload) };
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    event: "issues",
    when: action("opened"),
    build: issueEvent,
    declaration: {
      id: EMIT_IDS.issueOpened,
      direction: "emit",
      label: text("An issue was opened", "Ein Issue wurde geöffnet", "Se abrió una incidencia", "Un ticket a été ouvert"),
      description: text(
        "When somebody opens an issue in a repository the installation covers.",
        "Wenn jemand ein Issue in einem Repository der Installation öffnet.",
        "Cuando alguien abre una incidencia en un repositorio que cubre la instalación.",
        "Quand quelqu'un ouvre un ticket dans un dépôt couvert par l'installation."
      ),
      group: "issues",
      returns: [...SUBJECT, many(out("labels", "string"))],
      identity: ISSUE_IDENTITY,
    },
  },
  {
    event: "issues",
    when: action("closed"),
    build: issueEvent,
    declaration: {
      id: EMIT_IDS.issueClosed,
      direction: "emit",
      label: text("An issue was closed", "Ein Issue wurde geschlossen", "Se cerró una incidencia", "Un ticket a été fermé"),
      description: text(
        "When somebody closes an issue in a repository the installation covers.",
        "Wenn jemand ein Issue in einem Repository der Installation schließt.",
        "Cuando alguien cierra una incidencia en un repositorio que cubre la instalación.",
        "Quand quelqu'un ferme un ticket dans un dépôt couvert par l'installation."
      ),
      group: "issues",
      returns: [...SUBJECT, many(out("labels", "string"))],
      identity: ISSUE_IDENTITY,
    },
  },
  {
    event: "pull_request",
    when: action("review_requested"),
    build: (payload) => {
      const base = subjectOf(payload, "pull_request");
      if (!base) return null;
      return {
        ...base,
        reviewer:
          textOf(field(payload, "requested_reviewer"), "login") ??
          textOf(field(payload, "requested_team"), "slug"),
      };
    },
    declaration: {
      id: EMIT_IDS.reviewRequested,
      direction: "emit",
      label: text("A review was requested", "Eine Review wurde angefragt", "Se solicitó una revisión", "Une revue a été demandée"),
      description: text(
        "When a pull request asks a person or a team to review it.",
        "Wenn ein Pull Request eine Person oder ein Team um eine Review bittet.",
        "Cuando una pull request pide a una persona o un equipo que la revise.",
        "Quand une pull request demande à une personne ou une équipe de la relire."
      ),
      group: "reviews",
      returns: [...SUBJECT, out("reviewer", "string")],
      identity: ISSUE_IDENTITY,
    },
  },
  // GitHub's own `released` and `prereleased`, rather than `published`: a
  // subscriber wanting only one is never sent the other, and a pre-release
  // promoted to a full release is announced as a release.
  {
    event: "release",
    when: action("released"),
    build: releaseEvent,
    declaration: {
      id: EMIT_IDS.releasePublished,
      direction: "emit",
      label: text(
        "A release was published",
        "Ein Release wurde veröffentlicht",
        "Se publicó una versión",
        "Une version a été publiée"
      ),
      description: text(
        "When a full release goes out in a repository the installation covers. Pre-releases have their own announcement.",
        "Wenn ein vollständiges Release in einem Repository der Installation erscheint. Pre-Releases haben eine eigene Ankündigung.",
        "Cuando sale una versión completa en un repositorio que cubre la instalación. Las versiones preliminares tienen su propio aviso.",
        "Quand une version complète sort dans un dépôt couvert par l'installation. Les préversions ont leur propre annonce."
      ),
      group: "releases",
      returns: [...RELEASE_SUBJECT],
      identity: RELEASE_IDENTITY,
    },
  },
  {
    event: "release",
    when: action("prereleased"),
    build: releaseEvent,
    declaration: {
      id: EMIT_IDS.prereleasePublished,
      direction: "emit",
      label: text(
        "A pre-release was published",
        "Ein Pre-Release wurde veröffentlicht",
        "Se publicó una versión preliminar",
        "Une préversion a été publiée"
      ),
      description: text(
        "When a release marked as a pre-release goes out in a repository the installation covers.",
        "Wenn ein als Pre-Release markiertes Release in einem Repository der Installation erscheint.",
        "Cuando sale una versión marcada como preliminar en un repositorio que cubre la instalación.",
        "Quand une version marquée comme préversion sort dans un dépôt couvert par l'installation."
      ),
      group: "releases",
      returns: [...RELEASE_SUBJECT],
      identity: RELEASE_IDENTITY,
    },
  },
  // GitHub sends `create` for a branch and a tag alike, told apart by `ref_type`.
  {
    event: "create",
    when: (payload) => textOf(payload, "ref_type") === "tag",
    build: tagEvent,
    declaration: {
      id: EMIT_IDS.tagCreated,
      direction: "emit",
      label: text("A tag was pushed", "Ein Tag wurde gepusht", "Se subió una etiqueta", "Une étiquette a été poussée"),
      description: text(
        "When a tag is created in a repository the installation covers. GitHub does not say which branch a tag is on.",
        "Wenn in einem Repository der Installation ein Tag erstellt wird. GitHub gibt nicht an, auf welchem Branch ein Tag liegt.",
        "Cuando se crea una etiqueta en un repositorio que cubre la instalación. GitHub no indica en qué rama está una etiqueta.",
        "Quand une étiquette est créée dans un dépôt couvert par l'installation. GitHub n'indique pas sur quelle branche se trouve une étiquette."
      ),
      group: "releases",
      returns: [...TAG_SUBJECT],
      identity: TAG_IDENTITY,
    },
  },
];

export const EMIT_ENDPOINTS: readonly Endpoint[] = ANNOUNCEMENTS.map((one) => one.declaration);

/** What one GitHub delivery announces, or null when it announces nothing. */
export function translate(
  event: string,
  payload: Record<string, unknown>
): { eventType: string; payload: Record<string, unknown> } | null {
  const announcement = ANNOUNCEMENTS.find((one) => one.event === event && one.when(payload));
  if (!announcement) return null;
  const built = announcement.build(payload);
  return built ? { eventType: announcement.declaration.id, payload: built } : null;
}
