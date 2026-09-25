/**
 * The app's manifest. `npm run manifest` writes it to `manifest.json` after the
 * kit has validated it.
 */

import type { Manifest } from "initiative-app-kit";

import { ENDPOINTS } from "./endpoints/index.js";
import { PERMISSIONS } from "./github/app.js";
import {
  ACCOUNT,
  DASHBOARD_UID,
  PATHS,
  PUBLIC_ID,
  READ_IDS,
  SCOPES,
  text,
  WORKSPACE,
} from "./vocabulary.js";
import { WIDGETS } from "./widgets.js";

export const manifest: Manifest = {
  app_kind: "service",
  service: { public_id: PUBLIC_ID, protocol: 1, scopes: [...SCOPES] },
  features: ["dashboards", "endpoints", "widgets"],
  default_name: "GitHub",

  connections: [
    {
      // The community's GitHub installation. An admin connects it once, on
      // GitHub's own install page; both values are written back by the app.
      id: WORKSPACE,
      scope: "static",
      connect_path: PATHS.install,
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
    },
    {
      // Each member's own GitHub authorization, for what the app does as them.
      id: ACCOUNT,
      scope: "interactive",
      connect_path: PATHS.connect,
      label: text("Your GitHub account", "Dein GitHub-Konto", "Tu cuenta de GitHub", "Votre compte GitHub"),
      fields: [
        {
          key: "access_token",
          type: "secret",
          required: true,
          managed: true,
          label: text("Access token", "Zugriffstoken", "Token de acceso", "Jeton d'accès"),
        },
        {
          key: "refresh_token",
          type: "secret",
          managed: true,
          label: text("Refresh token", "Aktualisierungstoken", "Token de actualización", "Jeton de renouvellement"),
        },
        {
          key: "expires_at",
          type: "int",
          managed: true,
          label: text("Expires", "Läuft ab", "Caduca", "Expire"),
        },
        {
          key: "refresh_expires_at",
          type: "int",
          managed: true,
          label: text("Renewable until", "Erneuerbar bis", "Renovable hasta", "Renouvelable jusqu'au"),
        },
      ],
      access_hint: {
        api: "GitHub",
        scopes: Object.entries(PERMISSIONS).map(([permission, level]) => `${permission}:${level}`),
      },
    },
  ],

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
