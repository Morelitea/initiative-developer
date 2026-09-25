/**
 * The four dashboard tiles. Each module runs in Initiative's sandbox with one
 * data source, the endpoint its tile is bound to, and returns a scene.
 *
 * Every read answers why it has nothing in `unavailable`, and every tile says
 * so in words rather than drawing a zero.
 */

import type { Widget } from "initiative-app-kit";

import { ACCOUNT, READ_IDS, WORKSPACE } from "./vocabulary.js";

const WHY_NOTHING = `
var WHY = {
  "repository-required": "Choose a repository for this tile",
  "repository-not-listed": "This tile names a repository the installation does not cover",
  "not-configured": "No GitHub organization is connected yet",
  "installation-unavailable": "GitHub would not let the app into the organization",
  "not-connected": "Connect your GitHub account to see this",
  "not-found": "That repository is not there, or not visible to the app",
  "forbidden": "The organization has not granted the app this",
  "vendor-error": "GitHub did not answer",
  "rate-limited": "GitHub is limiting requests; this tile will fill in shortly"
};

function missing(data) {
  var why = (data.values || {}).unavailable;
  if (!why) return null;
  return { v: 1, scene: { kind: "empty", message: WHY[why] || "There is nothing to show" } };
}
`.trim();

function module(render: string): string {
  return `${WHY_NOTHING}\n\n${render.trim()}`;
}

export const openIssues: Widget = {
  id: "open-issues",
  meta: {
    name: { en: "Open issues", de: "Offene Issues", es: "Incidencias abiertas", fr: "Tickets ouverts" },
    description: {
      en: "How many issues are open.",
      de: "Wie viele Issues offen sind.",
      es: "Cuántas incidencias están abiertas.",
      fr: "Combien de tickets sont ouverts.",
    },
  },
  endpoints: [READ_IDS.findIssues],
  module_source: module(`
function render(data) {
  var nothing = missing(data);
  if (nothing) return nothing;
  var values = data.values || {};
  return {
    v: 1,
    scene: {
      kind: "metric",
      value: typeof values.total === "number" ? values.total : (data.rows || []).length,
      label: "Open issues"
    }
  };
}`),
  sample_data: {
    [READ_IDS.findIssues]: { numbers: [812], titles: ["Cache the issue counts"], count: 1, total: 42 },
  },
  requires: { all_of: [WORKSPACE] },
};

export const reviewQueue: Widget = {
  id: "review-queue",
  meta: {
    name: { en: "Waiting on you", de: "Wartet auf dich", es: "Esperando por ti", fr: "En attente de vous" },
    description: {
      en: "Pull requests that asked for your review.",
      de: "Pull Requests, die deine Review angefragt haben.",
      es: "Pull requests que pidieron tu revisión.",
      fr: "Pull requests qui ont demandé votre revue.",
    },
  },
  endpoints: [READ_IDS.findPullRequests],
  module_source: module(`
function render(data) {
  var nothing = missing(data);
  if (nothing) return nothing;
  var rows = data.rows || [];
  if (!rows.length) return { v: 1, scene: { kind: "empty", message: "Nothing is waiting on you" } };
  return {
    v: 1,
    scene: {
      kind: "table",
      columns: [
        { key: "number", label: "#", align: "end" },
        { key: "title", label: "Pull request" }
      ],
      rows: rows.slice(0, 10).map(function (row) {
        return { number: row.numbers || "", title: row.titles || "" };
      })
    }
  };
}`),
  sample_data: {
    [READ_IDS.findPullRequests]: {
      numbers: [812, 809],
      titles: ["Cache the issue counts", "Drop the unused index"],
      urls: ["#", "#"],
      count: 2,
      total: 2,
    },
  },
  requires: { all_of: [WORKSPACE, ACCOUNT] },
};

export const dependabotAlerts: Widget = {
  id: "dependabot-alerts",
  meta: {
    name: { en: "Dependabot alerts", de: "Dependabot-Warnungen", es: "Alertas de Dependabot", fr: "Alertes Dependabot" },
    description: {
      en: "Open dependency alerts by severity, worst first.",
      de: "Offene Abhängigkeitswarnungen nach Schwere, die schlimmsten zuerst.",
      es: "Alertas de dependencias abiertas por severidad, las peores primero.",
      fr: "Alertes de dépendances ouvertes par gravité, les pires d'abord.",
    },
  },
  endpoints: [READ_IDS.listAlerts],
  module_source: module(`
function render(data) {
  var nothing = missing(data);
  if (nothing) return nothing;
  var counts = {};
  (data.rows || []).forEach(function (row) {
    if (row.severities) counts[row.severities] = (counts[row.severities] || 0) + 1;
  });
  var shown = ["critical", "high", "medium", "low"].filter(function (s) { return counts[s]; });
  if (!shown.length) return { v: 1, scene: { kind: "empty", message: "No open Dependabot alerts" } };
  return {
    v: 1,
    scene: {
      kind: "series",
      mark: "bar",
      series: [{
        name: "Alerts",
        points: shown.map(function (s) {
          return { x: s.charAt(0).toUpperCase() + s.slice(1), y: counts[s] };
        })
      }]
    }
  };
}`),
  sample_data: {
    [READ_IDS.listAlerts]: {
      severities: ["critical", "high", "high", "medium", "medium", "medium", "medium"],
      packages: ["left-pad", "lodash", "lodash", "minimist", "minimist", "qs", "qs"],
      count: 7,
      total: 7,
      url: "#",
    },
  },
  requires: { all_of: [WORKSPACE] },
};

export const issueThroughput: Widget = {
  id: "issue-throughput",
  meta: {
    name: {
      en: "Issues opened and closed",
      de: "Geöffnete und geschlossene Issues",
      es: "Incidencias abiertas y cerradas",
      fr: "Tickets ouverts et fermés",
    },
    description: {
      en: "A fortnight of opens against closes.",
      de: "Zwei Wochen Öffnungen gegen Schließungen.",
      es: "Dos semanas de aperturas frente a cierres.",
      fr: "Deux semaines d'ouvertures contre fermetures.",
    },
  },
  endpoints: [READ_IDS.findIssues],
  module_source: module(`
function render(data) {
  var nothing = missing(data);
  if (nothing) return nothing;
  var days = {};
  function bucket(iso) {
    var day = String(iso).slice(0, 10);
    if (!days[day]) days[day] = { opened: 0, closed: 0 };
    return days[day];
  }
  (data.rows || []).forEach(function (row) {
    if (row.created_at) bucket(row.created_at).opened += 1;
    if (row.closed_at) bucket(row.closed_at).closed += 1;
  });
  var ordered = Object.keys(days).sort();
  if (!ordered.length) {
    return { v: 1, scene: { kind: "empty", message: "Nothing opened or closed in this window" } };
  }
  return {
    v: 1,
    scene: {
      kind: "series",
      mark: "line",
      series: [
        { name: "Opened", points: ordered.map(function (d) { return { x: d, y: days[d].opened }; }) },
        { name: "Closed", points: ordered.map(function (d) { return { x: d, y: days[d].closed }; }) }
      ]
    }
  };
}`),
  sample_data: {
    [READ_IDS.findIssues]: {
      created_at: ["2026-08-17T09:00:00Z", "2026-08-17T11:00:00Z", "2026-08-18T09:00:00Z", "2026-08-19T09:00:00Z"],
      closed_at: ["2026-08-17T15:00:00Z", "2026-08-19T15:00:00Z", "", ""],
      count: 4,
      total: 4,
    },
  },
  requires: { all_of: [WORKSPACE] },
};

export const WIDGETS: readonly Widget[] = [openIssues, reviewQueue, dependabotAlerts, issueThroughput];
