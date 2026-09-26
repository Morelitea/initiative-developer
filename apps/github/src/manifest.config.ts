/**
 * The app's manifest. `npm run manifest` writes it to `manifest.json` after the
 * kit has validated it.
 */

import type { ConnectionFlow, Manifest } from "initiative-app-kit";

import { ENDPOINTS } from "./endpoints/index.js";
import { PERMISSIONS } from "./github/app.js";
import {
  ACCOUNT,
  CHECK_INSTALLATION,
  DASHBOARD_UID,
  PUBLIC_ID,
  READ_IDS,
  SCOPES,
  text,
  WORKSPACE,
} from "./vocabulary.js";
import { WIDGETS } from "./widgets.js";

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

export const manifest: Manifest = {
  app_kind: "service",
  service: { public_id: PUBLIC_ID, protocol: 1, scopes: [...SCOPES] },
  features: ["dashboards", "endpoints", "widgets"],
  default_name: "GitHub",

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

  connections: [
    {
      // The community's GitHub installation. An admin connects it once:
      // Initiative sends them to GitHub's install page, then through one
      // authorization so the app's after_connect hook can check the
      // installation is theirs. Initiative mints its tokens from the GitHub
      // App's key.
      id: WORKSPACE,
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
    {
      // Each member's own GitHub authorization, for what the app does as
      // them. Initiative holds it and renews it; the after_connect hook names
      // the account, and the revoke hook ends it at GitHub.
      id: ACCOUNT,
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
  ],

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

  // Initiative calls the schedule hook for each community on this interval.
  schedules: [{ id: CHECK_INSTALLATION, every: "15m" }],

  endpoints: [...ENDPOINTS],
  widgets: [...WIDGETS],

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
          binding: { endpoint_id: READ_IDS.findIssues, params: { state: "open", limit: 1 } },
        },
        {
          id: "reviews",
          type: "review-queue",
          title: "Waiting on your review",
          grid: { x: 3, y: 0, w: 6, h: 3 },
          binding: {
            endpoint_id: READ_IDS.findPullRequests,
            params: { review_requested: "@me", state: "open", limit: 10 },
          },
        },
        {
          id: "alerts",
          type: "dependabot-alerts",
          title: "Dependabot alerts",
          grid: { x: 9, y: 0, w: 3, h: 3 },
          binding: { endpoint_id: READ_IDS.listAlerts },
        },
        {
          id: "throughput",
          type: "issue-throughput",
          title: "Opened and closed",
          grid: { x: 0, y: 3, w: 12, h: 4 },
          binding: {
            endpoint_id: READ_IDS.findIssues,
            params: { state: "all", since_days: 14, limit: 100, sort: "updated" },
          },
        },
      ],
    },
  ],
};
