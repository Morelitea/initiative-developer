/**
 * The three announcements: what each GitHub delivery becomes, and the
 * declaration a subscriber reads before any arrives. The payload each builds
 * carries exactly the returns it declares.
 */

import type { Endpoint, EndpointReturn } from "initiative-app-kit";

import { EMIT_IDS, ISSUE_IDENTITY, many, out, text } from "../vocabulary.js";

const SUBJECT: readonly EndpointReturn[] = [
  out("repository", "string"),
  out("owner", "string"),
  out("number", "int"),
  out("title", "string"),
  out("url", "url"),
  out("author", "string"),
];

interface Announcement {
  declaration: Endpoint;
  /** The GitHub event and action it answers. */
  event: string;
  action: string;
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
    action: "opened",
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
    action: "closed",
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
    action: "review_requested",
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
];

export const EMIT_ENDPOINTS: readonly Endpoint[] = ANNOUNCEMENTS.map((one) => one.declaration);

/** What one GitHub delivery announces, or null when it announces nothing. */
export function translate(
  event: string,
  payload: Record<string, unknown>
): { eventType: string; payload: Record<string, unknown> } | null {
  const action = textOf(payload, "action");
  const announcement = ANNOUNCEMENTS.find((one) => one.event === event && one.action === action);
  if (!announcement) return null;
  const built = announcement.build(payload);
  return built ? { eventType: announcement.declaration.id, payload: built } : null;
}
