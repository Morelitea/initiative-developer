/**
 * The six announcements: the declaration a subscriber reads before any
 * arrives, and which GitHub deliveries become each. Initiative reads the
 * delivery's `headers` (names in lowercase) and `payload`; a delivery whose
 * subject GitHub did not name is announced as nothing. The payload each maps
 * carries exactly the returns it declares.
 */

import { defineEndpoint, type EmittedEndpoint, type Expression } from "initiative-app-sdk/manifest";

import { EMIT, ISSUE_IDENTITY, many, out, RELEASE_IDENTITY, TAG_IDENTITY, text } from "../vocabulary.js";
import { quote, TEXT } from "./support.js";

const SUBJECT = {
  repository: out("string"),
  owner: out("string"),
  number: out("int"),
  title: out("string"),
  url: out("url"),
  author: out("string"),
};

/**
 * What a release announcement carries. `name` is the release's title, which
 * is often not its tag; `branch` is the ref it was cut from.
 */
const RELEASE_SUBJECT = {
  repository: out("string"),
  owner: out("string"),
  tag: out("string"),
  name: out("string", { label: text("Title", "Titel", "Título", "Titre") }),
  branch: out("string", {
    label: text("Released from", "Veröffentlicht aus", "Publicado desde", "Publié depuis"),
  }),
  url: out("url"),
  author: out("string"),
};

/**
 * What a tag announcement carries. A tag points at a commit, not a branch, so
 * GitHub names none and neither does this.
 */
const TAG_SUBJECT = {
  repository: out("string"),
  owner: out("string"),
  tag: out("string"),
  url: out("url"),
  author: out("string"),
};

interface Announcement {
  declaration: EmittedEndpoint<object>;
  /** Which deliveries it announces. */
  when: Expression;
  /** Its payload. */
  map: Expression;
}

/** A delivery of one GitHub event, with one `action`. */
const delivery = (event: string, action?: string): Expression =>
  `headers."x-github-event" = ${quote(event)}${action ? ` and payload.action = ${quote(action)}` : ""}`;

/** Text that is there. */
const named = (path: string): Expression => `($type(${path}) = "string" and ${path} != "")`;

const REPOSITORY = `"repository": payload.repository.name, "owner": $text(payload.repository.owner.login)`;

/** An issue or a pull request, from the block of the payload it arrives under. */
const subjectOf = (holder: "issue" | "pull_request") => ({
  when: `$type(payload.${holder}.number) = "number" and ${named("payload.repository.name")}`,
  map: (extra: string) => `(
    ${TEXT};
    {
      ${REPOSITORY},
      "number": payload.${holder}.number,
      "title": $text(payload.${holder}.title),
      "url": $text(payload.${holder}.html_url),
      "author": $text(payload.${holder}.user.login),
      ${extra}
    }
  )`,
});

const ISSUE = subjectOf("issue");
const PULL = subjectOf("pull_request");

/** GitHub delivers `issues` events for pull requests too; those are not issues. */
const issueEvent = (action: string) => ({
  when: `${delivery("issues", action)} and $not($exists(payload.issue.pull_request)) and ${ISSUE.when}`,
  map: ISSUE.map(`"labels": [payload.issue.labels.name[$type($) = "string" and $ != ""]]`),
});

const releaseEvent = (action: string) => ({
  when: `${delivery("release", action)} and ${named("payload.repository.name")} and ${named("payload.release.tag_name")}`,
  map: `(
    ${TEXT};
    {
      ${REPOSITORY},
      "tag": payload.release.tag_name,
      "name": $text(payload.release.name),
      "branch": $text(payload.release.target_commitish),
      "url": $text(payload.release.html_url),
      "author": $text(payload.release.author.login)
    }
  )`,
});

export const ANNOUNCEMENTS = {
  [EMIT.issueOpened]: {
    ...issueEvent("opened"),
    declaration: defineEndpoint({
      direction: "emit",
      label: text("An issue was opened", "Ein Issue wurde geöffnet", "Se abrió una incidencia", "Un ticket a été ouvert"),
      description: text(
        "When somebody opens an issue in a repository the installation covers.",
        "Wenn jemand ein Issue in einem Repository der Installation öffnet.",
        "Cuando alguien abre una incidencia en un repositorio que cubre la instalación.",
        "Quand quelqu'un ouvre un ticket dans un dépôt couvert par l'installation."
      ),
      group: "issues",
      returns: { ...SUBJECT, labels: many(out("string")) },
      identity: ISSUE_IDENTITY,
    }),
  },
  [EMIT.issueClosed]: {
    ...issueEvent("closed"),
    declaration: defineEndpoint({
      direction: "emit",
      label: text("An issue was closed", "Ein Issue wurde geschlossen", "Se cerró una incidencia", "Un ticket a été fermé"),
      description: text(
        "When somebody closes an issue in a repository the installation covers.",
        "Wenn jemand ein Issue in einem Repository der Installation schließt.",
        "Cuando alguien cierra una incidencia en un repositorio que cubre la instalación.",
        "Quand quelqu'un ferme un ticket dans un dépôt couvert par l'installation."
      ),
      group: "issues",
      returns: { ...SUBJECT, labels: many(out("string")) },
      identity: ISSUE_IDENTITY,
    }),
  },
  [EMIT.reviewRequested]: {
    when: `${delivery("pull_request", "review_requested")} and ${PULL.when}`,
    map: PULL.map(
      `"reviewer": $type(payload.requested_reviewer.login) = "string"
        ? payload.requested_reviewer.login
        : $text(payload.requested_team.slug)`
    ),
    declaration: defineEndpoint({
      direction: "emit",
      label: text("A review was requested", "Eine Review wurde angefragt", "Se solicitó una revisión", "Une revue a été demandée"),
      description: text(
        "When a pull request asks a person or a team to review it.",
        "Wenn ein Pull Request eine Person oder ein Team um eine Review bittet.",
        "Cuando una pull request pide a una persona o un equipo que la revise.",
        "Quand une pull request demande à une personne ou une équipe de la relire."
      ),
      group: "reviews",
      returns: { ...SUBJECT, reviewer: out("string") },
      identity: ISSUE_IDENTITY,
    }),
  },
  // GitHub's own `released` and `prereleased`, rather than `published`: a
  // subscriber wanting only one is never sent the other, and a pre-release
  // promoted to a full release is announced as a release.
  [EMIT.releasePublished]: {
    ...releaseEvent("released"),
    declaration: defineEndpoint({
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
      returns: RELEASE_SUBJECT,
      identity: RELEASE_IDENTITY,
    }),
  },
  [EMIT.prereleasePublished]: {
    ...releaseEvent("prereleased"),
    declaration: defineEndpoint({
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
      returns: RELEASE_SUBJECT,
      identity: RELEASE_IDENTITY,
    }),
  },
  // GitHub sends `create` for a branch and a tag alike, told apart by `ref_type`.
  [EMIT.tagCreated]: {
    when: `${delivery("create")} and payload.ref_type = "tag" and ${named("payload.repository.name")} and ${named("payload.ref")}`,
    // GitHub sends no link for a new tag; its page is under the repository's.
    // A tag has no author of its own here: the person who pushed it.
    map: `(
      ${TEXT};
      $home := payload.repository.html_url;
      {
        ${REPOSITORY},
        "tag": payload.ref,
        "url": ${named("$home")} ? $encodeUrl($home & "/tree/" & payload.ref) : null,
        "author": $text(payload.sender.login)
      }
    )`,
    declaration: defineEndpoint({
      direction: "emit",
      label: text("A tag was pushed", "Ein Tag wurde gepusht", "Se subió una etiqueta", "Une étiquette a été poussée"),
      description: text(
        "When a tag is created in a repository the installation covers. GitHub does not say which branch a tag is on.",
        "Wenn in einem Repository der Installation ein Tag erstellt wird. GitHub gibt nicht an, auf welchem Branch ein Tag liegt.",
        "Cuando se crea una etiqueta en un repositorio que cubre la instalación. GitHub no indica en qué rama está una etiqueta.",
        "Quand une étiquette est créée dans un dépôt couvert par l'installation. GitHub n'indique pas sur quelle branche se trouve une étiquette."
      ),
      group: "releases",
      returns: TAG_SUBJECT,
      identity: TAG_IDENTITY,
    }),
  },
} satisfies Record<string, Announcement>;

/** The announcements' declarations, by name. */
export const EMIT_ENDPOINTS = Object.fromEntries(
  Object.entries(ANNOUNCEMENTS).map(([name, announcement]) => [name, announcement.declaration])
) as { [K in keyof typeof ANNOUNCEMENTS]: (typeof ANNOUNCEMENTS)[K]["declaration"] };

/** What GitHub's deliveries announce: the first row whose `when` holds. */
export const EVENTS = Object.entries(ANNOUNCEMENTS).map(([emit, announcement]) => ({
  when: announcement.when,
  emit: emit as keyof typeof ANNOUNCEMENTS,
  map: announcement.map,
}));
