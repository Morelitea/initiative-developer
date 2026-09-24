import { graphql } from "../github/http.js";
import {
  COUNT_OUT,
  many,
  out,
  READ_IDS,
  REPO,
  text,
  TOTAL_OUT,
  UNAVAILABLE,
  URL_OUT,
  WORKSPACE,
} from "../vocabulary.js";
import {
  isResult,
  lower,
  nodes,
  PAGE,
  readFailure,
  repoAccess,
  unavailable,
  type Connection,
  type Read,
} from "./support.js";

interface Alert {
  number?: number;
  securityVulnerability?: { severity?: string; package?: { name?: string } } | null;
}

export const listAlerts: Read = {
  declaration: {
    id: READ_IDS.listAlerts,
    direction: "read",
    label: text("Dependabot alerts", "Dependabot-Warnungen", "Alertas de Dependabot", "Alertes Dependabot"),
    description: text(
      "Open dependency alerts, with the severity and package of each.",
      "Offene Abhängigkeitswarnungen, mit Schwere und Paket zu jeder.",
      "Alertas de dependencias abiertas, con la severidad y el paquete de cada una.",
      "Alertes de dépendances ouvertes, avec la gravité et le paquet de chacune."
    ),
    group: "security",
    actors: ["installation"],
    cache_ttl_seconds: 300,
    params: [REPO],
    returns: [
      many(out("numbers", "int", { label: text("Alert numbers", "Warnungsnummern", "Números de alerta", "Numéros d'alerte") })),
      many(out("severities", "string")),
      many(out("packages", "string")),
      many(out("urls", "url")),
      COUNT_OUT,
      TOTAL_OUT,
      URL_OUT,
      UNAVAILABLE,
    ],
    requires: { all_of: [WORKSPACE] },
  },

  async run(call) {
    const access = await repoAccess(call);
    if (isResult(access)) return { actor: "installation", result: access };
    const answer = await graphql<{ repository: { vulnerabilityAlerts: Connection<Alert> | null } | null }>(
      call.context.github.http,
      access.token,
      `query Alerts($owner: String!, $repo: String!, $first: Int!) {
         repository(owner: $owner, name: $repo) {
           vulnerabilityAlerts(first: $first, states: [OPEN]) {
             totalCount
             nodes { number securityVulnerability { severity package { name } } }
           }
         }
       }`,
      { owner: access.owner, repo: access.repo, first: PAGE }
    );
    if (!answer.ok) return { actor: "installation", result: readFailure(answer.failure) };
    const found = answer.body.repository?.vulnerabilityAlerts;
    if (!found) return { actor: "installation", result: unavailable("not-found") };

    const alerts = nodes(found);
    const page = `${call.context.config.github.webBase}/${access.owner}/${access.repo}/security/dependabot`;
    return {
      actor: "installation",
      result: {
        numbers: alerts.map((alert) => alert.number ?? 0),
        // GraphQL says MODERATE where the rest of GitHub says medium.
        severities: alerts.map((alert) => {
          const severity = lower(alert.securityVulnerability?.severity);
          return severity === "moderate" ? "medium" : (severity ?? "");
        }),
        packages: alerts.map((alert) => alert.securityVulnerability?.package?.name ?? ""),
        urls: alerts.map((alert) => `${page}/${alert.number ?? ""}`),
        count: alerts.length,
        total: found.totalCount ?? alerts.length,
        url: page,
      },
    };
  },
};
