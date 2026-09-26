/**
 * The app, declared once: what it asks a community for, the GitHub
 * connections Initiative runs for it, its endpoints, hooks, schedule, widgets
 * and dashboard, and its registry listing. `npm run manifest` builds
 * `manifest.json` and the registry source from it.
 */

import { defineApp, type ConnectionFlow } from "initiative-app-sdk/manifest";

import { EMIT_ENDPOINTS } from "./endpoints/emissions.js";
import { closeIssue, comment, findIssues, getIssue, label, listLabels, listMilestones, openIssue, reopenIssue } from "./endpoints/issues.js";
import { findProjectItem, listProjectFields, listProjectOptions, listProjects, moveProjectItem } from "./endpoints/projects.js";
import { findPullRequests, getPullRequest, requestReview } from "./endpoints/pulls.js";
import { listAssignees, listBranches, listRepositories } from "./endpoints/repositories.js";
import { listAlerts } from "./endpoints/security.js";
import { PERMISSIONS } from "./github/app.js";
import { checkInstallation, hooks } from "./hooks.js";
import {
  ACCOUNT,
  CHECK_INSTALLATION,
  DASHBOARD_UID,
  LISTING_UID,
  PUBLIC_ID,
  READ,
  SCOPES,
  text,
  WORKSPACE,
  WRITE,
} from "./vocabulary.js";

const GITHUB_WEB = "https://github.com";
const GITHUB_API = "https://api.github.com";

/** GitHub's user authorization for the GitHub App, which both connections run. */
const GITHUB_OAUTH: ConnectionFlow = {
  type: "oauth2",
  authorize_url: `${GITHUB_WEB}/login/oauth/authorize`,
  token_url: `${GITHUB_WEB}/login/oauth/access_token`,
  client_id: "{vendor.client_id}",
  client_secret: "{vendor.client_secret}",
  pkce: true,
};

export default defineApp({
  publicId: PUBLIC_ID,
  uid: LISTING_UID,
  name: "GitHub",
  scopes: [...SCOPES],

  // What the operator supplies once per deployment for the GitHub App: the
  // flows and the installation token below name them as {vendor.<key>}.
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
  },

  connections: {
    // The community's GitHub installation. An admin connects it once:
    // Initiative sends them to GitHub's install page, then through one
    // authorization so the app's after_connect hook can check the
    // installation is theirs. Initiative mints its tokens from the GitHub
    // App's key.
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
        install_url: `${GITHUB_WEB}/apps/{vendor.app_slug}/installations/new`,
        after_connect: true,
      },
      token: {
        type: "jwt_bearer",
        exchange_url: `${GITHUB_API}/app/installations/{installation_id}/access_tokens`,
        iss: "{vendor.app_id}",
        key: "{vendor.private_key}",
        alg: "RS256",
        lifetime: 540,
      },
    },
    // Each member's own GitHub authorization, for what the app does as
    // them. Initiative holds it and renews it; the after_connect hook names
    // the account, and the revoke hook ends it at GitHub.
    [ACCOUNT]: {
      scope: "interactive",
      label: text("Your GitHub account", "Dein GitHub-Konto", "Tu cuenta de GitHub", "Votre compte GitHub"),
      fields: [],
      flow: {
        ...GITHUB_OAUTH,
        after_connect: true,
        revoke: "hook",
      },
      access_hint: {
        api: "GitHub",
        scopes: Object.entries(PERMISSIONS).map(([permission, level]) => `${permission}:${level}`),
      },
    },
  },

  // Initiative receives the GitHub App's webhook deliveries, checks them, and
  // forwards each to the webhook hook of every community whose organization
  // connection holds the installation it came from.
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
  },

  // Initiative calls this for each community on this interval.
  schedules: { [CHECK_INSTALLATION]: { every: "15m", run: checkInstallation } },

  endpoints: {
    [READ.listRepositories]: listRepositories,
    [READ.listAssignees]: listAssignees,
    [READ.listBranches]: listBranches,
    [READ.listLabels]: listLabels,
    [READ.listMilestones]: listMilestones,
    [READ.getIssue]: getIssue,
    [READ.findIssues]: findIssues,
    [READ.getPullRequest]: getPullRequest,
    [READ.findPullRequests]: findPullRequests,
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

  hooks,

  // The four dashboard tiles. Each module runs in Initiative's sandbox with
  // one data source, the endpoint its tile is bound to, and returns a scene.
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
      endpoints: [READ.findIssues],
      module: "src/widgets/open-issues.ts",
      sample_data: {
        [READ.findIssues]: { numbers: [812], titles: ["Cache the issue counts"], count: 1, total: 42 },
      },
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
      endpoints: [READ.findPullRequests],
      module: "src/widgets/review-queue.ts",
      sample_data: {
        [READ.findPullRequests]: {
          numbers: [812, 809],
          titles: ["Cache the issue counts", "Drop the unused index"],
          urls: ["#", "#"],
          count: 2,
          total: 2,
        },
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
      endpoints: [READ.listAlerts],
      module: "src/widgets/dependabot-alerts.ts",
      sample_data: {
        [READ.listAlerts]: {
          severities: ["critical", "high", "high", "medium", "medium", "medium", "medium"],
          packages: ["left-pad", "lodash", "lodash", "minimist", "minimist", "qs", "qs"],
          count: 7,
          total: 7,
          url: "#",
        },
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
      endpoints: [READ.findIssues],
      module: "src/widgets/issue-throughput.ts",
      sample_data: {
        [READ.findIssues]: {
          created_at: ["2026-08-17T09:00:00Z", "2026-08-17T11:00:00Z", "2026-08-18T09:00:00Z", "2026-08-19T09:00:00Z"],
          closed_at: ["2026-08-17T15:00:00Z", "2026-08-19T15:00:00Z", "", ""],
          count: 4,
          total: 4,
        },
      },
      requires: { all_of: [WORKSPACE] },
    },
  },

  // Every tile is pointed at a repository where it sits: a repository is one
  // community's, so none is named here.
  dashboards: [
    {
      uid: DASHBOARD_UID,
      public_id: "morelitea.github-overview",
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
          binding: {
            endpoint_id: READ.findPullRequests,
            params: { review_requested: "@me", state: "open", limit: 10 },
          },
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
          binding: {
            endpoint_id: READ.findIssues,
            params: { state: "all", since_days: 14, limit: 100, sort: "updated" },
          },
        },
      ],
    },
  ],

  // The registry listing. `image` is the digest the image workflow printed for
  // this version, and `jwks` the public half of the key the app signs its
  // token requests with. The "GitHub overview" dashboard is not a listing of
  // its own: it is bundled in the manifest, and a deployment publishes it from
  // there.
  listing: {
    publisher: "morelitea",
    summary: "Your organization's issues, reviews and dependency alerts, on a dashboard and in your automations.",
    description: [
      "Bring a GitHub organization into your community.",
      "",
      "An admin connects the organization once, on GitHub's own install page, and picks the repositories the app may see. Dashboards then show open issues, pull requests waiting on review, Dependabot alerts and a fortnight of throughput for everyone, with nobody pasting a token.",
      "",
      "Members who connect their own GitHub account get their own review queue, and automations can open, comment on, close, label and move issues as them.",
    ].join("\n"),
    avatar: "assets/avatar.png",
    version: "2.3.0",
    // The oldest Initiative that runs this app's connections. Development
    // builds report the last release until the next one, and no release before
    // the next one follows the registry, so this admits development builds and
    // every later release.
    minAppVersion: "0.72.0",
    releaseNotes:
      "Initiative now calls the app every 15 minutes to check each installation, so the app keeps no timer of its own and is ready as soon as it starts.",
    image: "ghcr.io/morelitea/initiative-github@sha256:dfd2348327b7d57b67ad0d668285090056d89d081e70ede00584286e569ec8bb",
    jwks: {
      keys: [
        {
          kty: "EC",
          kid: "github-1",
          alg: "ES256",
          use: "sig",
          crv: "P-256",
          x: "AnzMCoYTwqIVaUH3j-djW2xSDIf3TAH1GyKkxMGqkcs",
          y: "4BuzhHAZZ8LS7CZcb_Pz415ae8tD01N7cwGERgJgujk",
        },
      ],
    },
  },
});
