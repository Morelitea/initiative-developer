/**
 * The plug-in, declared once: the GitHub connections Initiative runs for it, the
 * calls Initiative makes to GitHub for each endpoint and how it reshapes the
 * answers, what GitHub's deliveries announce, its widgets and dashboard, and
 * its registry listing. `npm run manifest` builds `manifest.json` and the
 * registry source from it.
 *
 * Nothing of the plug-in runs anywhere: Initiative makes every call itself.
 */

import { definePlugin, type ConnectionFlow, type GithubPermissionLevel, type Paging } from "initiative-plugin-sdk/manifest";

import { EMIT_ENDPOINTS, EVENTS } from "./endpoints/emissions.js";
import {
  closeIssue,
  comment,
  findIssues,
  getIssue,
  issueThroughput,
  label,
  listLabels,
  listMilestones,
  openIssue,
  reopenIssue,
} from "./endpoints/issues.js";
import { findProjectItem, listProjectFields, listProjectOptions, listProjects, moveProjectItem } from "./endpoints/projects.js";
import { findPullRequests, getPullRequest, requestReview, reviewQueue } from "./endpoints/pulls.js";
import { listAssignees, listBranches, listRepositories } from "./endpoints/repositories.js";
import { listAlerts } from "./endpoints/security.js";
import { API, quote, rest, WEB } from "./endpoints/support.js";
import { ACCOUNT, DASHBOARD_UID, LISTING_UID, PUBLIC_ID, READ, text, WORKSPACE, WRITE } from "./vocabulary.js";

/**
 * The permissions the GitHub App registration asks for. Initiative shows them
 * to a member about to connect and creates the GitHub App with them, and the
 * README lists them for whoever registers the GitHub App by hand.
 */
const PERMISSIONS: Readonly<Record<string, GithubPermissionLevel>> = {
  issues: "write",
  pull_requests: "write",
  contents: "read",
  vulnerability_alerts: "read",
  organization_projects: "write",
  metadata: "read",
};

/** The webhook events the GitHub App registration subscribes to. */
const WEBHOOK_EVENTS = ["issues", "pull_request", "release", "create"];

/** GitHub's user authorization for the GitHub App, which both connections run. */
const GITHUB_OAUTH: ConnectionFlow = {
  type: "oauth2",
  authorize_url: `${WEB}/login/oauth/authorize`,
  token_url: `${WEB}/login/oauth/access_token`,
  client_id: "{vendor.client_id}",
  client_secret: "{vendor.client_secret}",
  pkce: true,
};

/** Every page, up to ten of a hundred, of a list the person's own token reads. */
const pages = (items: string): Paging => ({
  kind: "page_number",
  page_param: "page",
  per_page_param: "per_page",
  per_page: 100,
  items,
  max_pages: 10,
  on_limit: "truncate",
});

/** A delivery about the GitHub App's installation itself. */
const installation = (action: string) =>
  `headers."x-github-event" = "installation" and payload.action = ${quote(action)}`;

/** Why a tile has nothing to draw: each read's `unavailable` codes, in words. */
const WHY_NOTHING = {
  repository_required: text(
    "Choose a repository for this tile",
    "Wähle ein Repository für diese Kachel",
    "Elige un repositorio para este mosaico",
    "Choisissez un dépôt pour cette tuile"
  ),
  not_found: text(
    "That repository is not there, or not visible to the plug-in",
    "Dieses Repository gibt es nicht, oder das Plug-in sieht es nicht",
    "Ese repositorio no existe o el plug-in no lo ve",
    "Ce dépôt n'existe pas, ou le plug-in ne le voit pas"
  ),
  not_authorized: text(
    "The organization has not granted the plug-in this",
    "Die Organisation hat dem Plug-in das nicht erlaubt",
    "La organización no ha concedido esto al plug-in",
    "L'organisation n'a pas accordé cela au plug-in"
  ),
  nothing: text("There is nothing to show", "Es gibt nichts anzuzeigen", "No hay nada que mostrar", "Il n'y a rien à afficher"),
};

export default definePlugin({
  publicId: PUBLIC_ID,
  uid: LISTING_UID,
  name: "GitHub",
  // The oldest plug-in API contract this runs on: the SDK release it is built
  // against. A deployment serving another major, or an older minor, refuses it.
  minPluginApi: "4.2",
  hosts: ["api.github.com"],

  // What the operator supplies once per deployment for the GitHub App: the
  // flows, the installation token and the webhooks below name them as
  // {vendor.<key>}.
  vendor: {
    label: text("GitHub App", "GitHub-App", "GitHub App", "GitHub App"),
    fields: [
      {
        key: "client_id",
        type: "string",
        required: true,
        label: text("Client ID", "Client-ID", "ID de cliente", "ID client"),
      },
      {
        key: "client_secret",
        type: "secret",
        required: true,
        label: text("Client secret", "Client-Secret", "Secreto de cliente", "Secret client"),
      },
      {
        key: "app_slug",
        type: "string",
        required: true,
        label: text(
          "App name in its GitHub address",
          "App-Name in der GitHub-Adresse",
          "Nombre de la app en su dirección de GitHub",
          "Nom de l'app dans son adresse GitHub"
        ),
      },
      {
        key: "app_id",
        type: "string",
        required: true,
        label: text("App ID", "App-ID", "ID de la app", "ID de l'app"),
      },
      {
        key: "private_key",
        type: "secret",
        required: true,
        label: text("Private key", "Privater Schlüssel", "Clave privada", "Clé privée"),
      },
      {
        key: "webhook_secret",
        type: "secret",
        required: true,
        label: text("Webhook secret", "Webhook-Secret", "Secreto del webhook", "Secret du webhook"),
      },
    ],
    // Initiative can create the GitHub App from the operator's browser, with
    // the permissions and events the README's registration table lists, and
    // write GitHub's answer into the six fields above.
    setup: {
      kind: "github_app_manifest",
      app: {
        name: "Initiative",
        url: "https://github.com/beyonders-studio/initiative-developer/tree/main/plugins/github",
        public: false,
        default_permissions: { ...PERMISSIONS },
        default_events: [...WEBHOOK_EVENTS],
      },
      values: {
        client_id: "client_id",
        client_secret: "client_secret",
        app_slug: "slug",
        app_id: "id",
        private_key: "pem",
        webhook_secret: "webhook_secret",
      },
    },
  },

  connections: {
    // The community's GitHub installation. An admin connects it once:
    // Initiative sends them to GitHub's install page, then through one
    // authorization, and keeps the installation they came back with only if
    // it is one of theirs and they control the account it is on: an admin of
    // the organization, or the user it is installed for. Initiative mints its
    // tokens from the GitHub App's key, and checks every 15 minutes that
    // GitHub still has it.
    [WORKSPACE]: {
      scope: "static",
      label: text("GitHub organization", "GitHub-Organisation", "Organización de GitHub", "Organisation GitHub"),
      fields: [
        {
          key: "owner",
          type: "string",
          required: true,
          managed: true,
          label: text("Owner or organization", "Inhaber oder Organisation", "Propietario u organización", "Propriétaire ou organisation"),
        },
        {
          key: "installation_id",
          type: "int",
          required: true,
          managed: true,
          label: text("Installation", "Installation", "Instalación", "Installation"),
        },
      ],
      flow: {
        ...GITHUB_OAUTH,
        install_url: `${WEB}/apps/{vendor.app_slug}/installations/new`,
        after_connect: {
          steps: [
            {
              name: "installations",
              request: rest("GET", `"/user/installations"`, { connection: null, paging: pages("response.body.installations") }),
            },
            {
              name: "memberships",
              request: rest("GET", `"/user/memberships/orgs"`, {
                connection: null,
                query: { state: quote("active") },
                paging: pages("response.body"),
              }),
            },
            { name: "user", request: rest("GET", `"/user"`, { connection: null }) },
          ],
          map: `(
            $claimed := params.installation_id;
            $held := steps.installations.body[$string(id) = $claimed][0];
            $account := $held.account;
            $controls := $account.type = "Organization"
              ? $exists(steps.memberships.body[organization.id = $account.id and state = "active" and role = "admin"])
              : $account.type = "User" and $account.id = steps.user.body.id;
            $controls ? {"values": {"owner": $account.login, "installation_id": $held.id}, "account_label": $account.login} : {}
          )`,
          refuse_when: "$not($exists(result.values.owner) and $exists(result.values.installation_id))",
          code: "installation-not-held",
        },
      },
      token: {
        type: "jwt_bearer",
        exchange_url: `${API}/app/installations/{installation_id}/access_tokens`,
        iss: "{vendor.app_id}",
        key: "{vendor.private_key}",
        alg: "RS256",
        lifetime: 540,
      },
      // GitHub stops honouring the installation's token once it is removed,
      // and says so when it is suspended.
      health: {
        request: rest("GET", `"/installation/repositories"`, { connection: null, query: { per_page: quote("1") } }),
        every: "15m",
        states: [
          { status: 401, state: "removed" },
          { status: 403, when: "$contains(response.body.message, /suspended/i)", state: "suspended" },
        ],
      },
    },
    // Each member's own GitHub authorization, for what the plug-in does
    // as them. Initiative holds it, renews it and ends it at GitHub, and names
    // the connection by the account's login.
    [ACCOUNT]: {
      scope: "interactive",
      label: text("Your GitHub account", "Dein GitHub-Konto", "Tu cuenta de GitHub", "Votre compte GitHub"),
      fields: [],
      flow: {
        ...GITHUB_OAUTH,
        after_connect: { request: rest("GET", `"/user"`, { connection: null }), map: `{"account_label": response.body.login}` },
        revoke: "github_grant",
        revoke_url: `${API}/applications/{vendor.client_id}/grant`,
      },
      access_hint: {
        api: "GitHub",
        scopes: Object.entries(PERMISSIONS).map(([permission, level]) => `${permission}:${level}`),
      },
    },
  },

  // Initiative receives the GitHub App's webhook deliveries, checks them, and
  // for every community whose organization connection holds the installation
  // a delivery came from, announces what it says and notes the installation
  // being removed, suspended or restored.
  webhooks: {
    verify: {
      scheme: "hmac_sha256",
      header: "X-Hub-Signature-256",
      prefix: "sha256=",
      encoding: "hex",
      secret: "{vendor.webhook_secret}",
    },
    dedup: "X-GitHub-Delivery",
    route: { path: "installation.id", connection: WORKSPACE, field: "installation_id" },
    events: EVENTS,
    status: [
      { when: installation("deleted"), connection: WORKSPACE, state: "removed" },
      { when: installation("suspend"), connection: WORKSPACE, state: "suspended" },
      { when: installation("unsuspend"), connection: WORKSPACE, state: "ok" },
    ],
  },

  endpoints: {
    [READ.listRepositories]: listRepositories,
    [READ.listAssignees]: listAssignees,
    [READ.listBranches]: listBranches,
    [READ.listLabels]: listLabels,
    [READ.listMilestones]: listMilestones,
    [READ.getIssue]: getIssue,
    [READ.findIssues]: findIssues,
    [READ.issueThroughput]: issueThroughput,
    [READ.getPullRequest]: getPullRequest,
    [READ.findPullRequests]: findPullRequests,
    [READ.reviewQueue]: reviewQueue,
    [READ.listAlerts]: listAlerts,
    [READ.listProjects]: listProjects,
    [READ.listProjectFields]: listProjectFields,
    [READ.listProjectOptions]: listProjectOptions,
    [READ.findProjectItem]: findProjectItem,
    [WRITE.openIssue]: openIssue,
    [WRITE.comment]: comment,
    [WRITE.closeIssue]: closeIssue,
    [WRITE.reopenIssue]: reopenIssue,
    [WRITE.label]: label,
    [WRITE.requestReview]: requestReview,
    [WRITE.moveProjectItem]: moveProjectItem,
    ...EMIT_ENDPOINTS,
  },

  // The four dashboard tiles. Each is one read endpoint, drawn by its template
  // (src/widgets/*.html) in Initiative; the endpoint shapes the data and the
  // template lays it out, in the widget's own words.
  widgets: {
    "open-issues": {
      meta: {
        name: { en: "Open issues", de: "Offene Issues", es: "Incidencias abiertas", fr: "Tickets ouverts" },
        description: {
          en: "How many issues are open.",
          de: "Wie viele Issues offen sind.",
          es: "Cuántas incidencias están abiertas.",
          fr: "Combien de tickets sont ouverts.",
        },
      },
      endpoint: READ.findIssues,
      template: "src/widgets/open-issues.html",
      strings: {
        ...WHY_NOTHING,
        open_issues: text("Open issues", "Offene Issues", "Incidencias abiertas", "Tickets ouverts"),
      },
      sample_data: { numbers: [812], titles: ["Cache the issue counts"], count: 1, total: 42 },
      requires: { all_of: [WORKSPACE] },
    },
    "review-queue": {
      meta: {
        name: { en: "Waiting on you", de: "Wartet auf dich", es: "Esperando por ti", fr: "En attente de vous" },
        description: {
          en: "Pull requests that asked for your review.",
          de: "Pull Requests, die deine Review angefragt haben.",
          es: "Pull requests que pidieron tu revisión.",
          fr: "Pull requests qui ont demandé votre revue.",
        },
      },
      endpoint: READ.reviewQueue,
      template: "src/widgets/review-queue.html",
      strings: {
        ...WHY_NOTHING,
        pull_request: text("Pull request", "Pull Request", "Pull request", "Pull request"),
        nothing_waiting: text(
          "Nothing is waiting on you",
          "Nichts wartet auf dich",
          "Nada te está esperando",
          "Rien ne vous attend"
        ),
      },
      sample_data: {
        numbers: [812, 809],
        titles: ["Cache the issue counts", "Drop the unused index"],
        urls: ["#", "#"],
        count: 2,
        total: 2,
      },
      requires: { all_of: [WORKSPACE, ACCOUNT] },
    },
    "dependabot-alerts": {
      meta: {
        name: { en: "Dependabot alerts", de: "Dependabot-Warnungen", es: "Alertas de Dependabot", fr: "Alertes Dependabot" },
        description: {
          en: "Open dependency alerts by severity, worst first.",
          de: "Offene Abhängigkeitswarnungen nach Schwere, die schlimmsten zuerst.",
          es: "Alertas de dependencias abiertas por severidad, las peores primero.",
          fr: "Alertes de dépendances ouvertes par gravité, les pires d'abord.",
        },
      },
      endpoint: READ.listAlerts,
      template: "src/widgets/dependabot-alerts.html",
      strings: {
        ...WHY_NOTHING,
        alerts: text("Alerts", "Warnungen", "Alertas", "Alertes"),
        critical: text("Critical", "Kritisch", "Crítica", "Critique"),
        high: text("High", "Hoch", "Alta", "Haute"),
        medium: text("Medium", "Mittel", "Media", "Moyenne"),
        low: text("Low", "Niedrig", "Baja", "Faible"),
        no_alerts: text(
          "No open Dependabot alerts",
          "Keine offenen Dependabot-Warnungen",
          "No hay alertas de Dependabot abiertas",
          "Aucune alerte Dependabot ouverte"
        ),
      },
      sample_data: {
        severities: ["critical", "high", "high", "medium", "medium", "medium", "medium"],
        packages: ["left-pad", "lodash", "lodash", "minimist", "minimist", "qs", "qs"],
        count: 7,
        total: 7,
        url: "#",
      },
      requires: { all_of: [WORKSPACE] },
    },
    "issue-throughput": {
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
      endpoint: READ.issueThroughput,
      template: "src/widgets/issue-throughput.html",
      strings: {
        ...WHY_NOTHING,
        opened: text("Opened", "Geöffnet", "Abiertas", "Ouverts"),
        closed: text("Closed", "Geschlossen", "Cerradas", "Fermés"),
        quiet: text(
          "Nothing opened or closed in this window",
          "In diesem Zeitraum wurde nichts geöffnet oder geschlossen",
          "No se abrió ni cerró nada en este periodo",
          "Rien n'a été ouvert ni fermé sur cette période"
        ),
      },
      sample_data: { days: ["2026-08-17", "2026-08-18", "2026-08-19"], opened: [2, 1, 1], closed: [1, 0, 1] },
      requires: { all_of: [WORKSPACE] },
    },
  },

  // Every tile is pointed at a repository where it sits: a repository is one
  // community's, so none is named here.
  dashboards: [
    {
      uid: DASHBOARD_UID,
      public_id: "beyonders-studio.github-overview",
      name: "GitHub overview",
      description: "A repository at a glance: open issues, reviews, alerts and throughput.",
      layout: { columns: 12 },
      widgets: [
        {
          id: "open",
          type: "open-issues",
          title: "Open issues",
          grid: { x: 0, y: 0, w: 3, h: 3 },
          binding: { endpoint_id: READ.findIssues, params: { state: "open", limit: 1 } },
        },
        {
          id: "reviews",
          type: "review-queue",
          title: "Waiting on your review",
          grid: { x: 3, y: 0, w: 6, h: 3 },
          binding: { endpoint_id: READ.reviewQueue, params: { state: "open", limit: 10 } },
        },
        {
          id: "alerts",
          type: "dependabot-alerts",
          title: "Dependabot alerts",
          grid: { x: 9, y: 0, w: 3, h: 3 },
          binding: { endpoint_id: READ.listAlerts },
        },
        {
          id: "throughput",
          type: "issue-throughput",
          title: "Opened and closed",
          grid: { x: 0, y: 3, w: 12, h: 4 },
          binding: { endpoint_id: READ.issueThroughput, params: { since_days: 14, limit: 100 } },
        },
      ],
    },
  ],

  // The registry listing. The "GitHub overview" dashboard is not a listing
  // of its own: it is bundled in the manifest, and a deployment publishes it
  // from there.
  listing: {
    publisher: "beyonders-studio",
    summary: "Your organization's issues, reviews and dependency alerts, on a dashboard and in your automations.",
    description: [
      "Bring a GitHub organization into your community.",
      "",
      "An admin connects the organization once, on GitHub's own install page, and picks the repositories the plug-in may see. Dashboards then show open issues, pull requests waiting on review, Dependabot alerts and a fortnight of throughput for everyone, with nobody pasting a token.",
      "",
      "Members who connect their own GitHub account get their own review queue, and automations can open, comment on, close, label and move issues as them.",
    ].join("\n"),
    avatar: "assets/avatar.png",
    version: "4.0.0",
    // The oldest Initiative that runs a plug-in's calls to GitHub itself, and an
    // after_connect in steps; an older one refuses this manifest.
    minAppVersion: "0.75.0",
    releaseNotes:
      "Renamed for Initiative's plug-ins: the endpoint and event ids are now plugin.beyonders-studio.github.*, and another plug-in asks for plugins:beyonders-studio.github. Needs an Initiative that speaks plug-ins.",
  },
});
