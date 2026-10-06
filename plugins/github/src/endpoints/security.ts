import { defineEndpoint } from "initiative-plugin-sdk/manifest";

import { COUNT_OUT, many, out, REPO, text, TOTAL_OUT, UNAVAILABLE, URL_OUT } from "../vocabulary.js";
import { graphql, needs, NEEDS_REPO, PAGE, PUBLIC_READ, quote, REPO_VARIABLES, WEB } from "./support.js";

export const listAlerts = defineEndpoint({
  direction: "read",
  label: text("Dependabot alerts", "Dependabot-Warnungen", "Alertas de Dependabot", "Alertes Dependabot"),
  description: text(
    "Open dependency alerts, with the severity and package of each.",
    "Offene Abhängigkeitswarnungen, mit Schwere und Paket zu jeder.",
    "Alertas de dependencias abiertas, con la severidad y el paquete de cada una.",
    "Alertes de dépendances ouvertes, avec la gravité et le paquet de chacune."
  ),
  group: "security",
  ...PUBLIC_READ,
  cache_ttl_seconds: 300,
  params: { ...REPO },
  returns: {
    numbers: many(out("int", { label: text("Alert numbers", "Warnungsnummern", "Números de alerta", "Numéros d'alerte") })),
    severities: many(out("string")),
    packages: many(out("string")),
    urls: many(out("url")),
    ...COUNT_OUT,
    ...TOTAL_OUT,
    ...URL_OUT,
    ...UNAVAILABLE,
  },
  request: graphql(
    `query Alerts($owner: String!, $repo: String!, $first: Int!) {
       repository(owner: $owner, name: $repo) {
         name
         owner { login }
         vulnerabilityAlerts(first: $first, states: [OPEN]) {
           totalCount
           nodes { number securityVulnerability { severity package { name } } }
         }
       }
     }`,
    `{${REPO_VARIABLES}, "first": ${PAGE}}`
  ),
  ...needs(NEEDS_REPO),
  // GraphQL says MODERATE where the rest of GitHub says medium.
  map: `(
    $repository := response.body.data.repository;
    $found := $repository.vulnerabilityAlerts;
    $page := ${quote(`${WEB}/`)} & $repository.owner.login & "/" & $repository.name & "/security/dependabot";
    $alerts := $found.nodes[$type($) = "object"];
    $found ? {
      "numbers": [$alerts.(number ? number : 0)],
      "severities": [$alerts.(
        $severity := securityVulnerability.severity ? $lowercase(securityVulnerability.severity) : "";
        $severity = "moderate" ? "medium" : $severity
      )],
      "packages": [$alerts.(securityVulnerability.package.name ? securityVulnerability.package.name : "")],
      "urls": [$alerts.($page & "/" & (number ? number : ""))],
      "count": $count($alerts),
      "total": $found.totalCount,
      "url": $page
    } : {"unavailable": "not-found"}
  )`,
});
