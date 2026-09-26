/** Open dependency alerts by severity, worst first. */

import type { Scene, WidgetData } from "initiative-app-sdk/widget";

import type { listAlerts } from "../endpoints/security.js";
import { missing } from "./missing.js";

export function render(data: WidgetData<typeof listAlerts>): Scene {
  const nothing = missing(data.values);
  if (nothing) return nothing;
  const counts: Record<string, number> = {};
  for (const row of data.rows) {
    if (row.severities) counts[row.severities] = (counts[row.severities] || 0) + 1;
  }
  const shown = ["critical", "high", "medium", "low"].filter((severity) => counts[severity]);
  if (!shown.length) return { v: 1, scene: { kind: "empty", message: "No open Dependabot alerts" } };
  return {
    v: 1,
    scene: {
      kind: "series",
      mark: "bar",
      series: [
        {
          name: "Alerts",
          points: shown.map((severity) => ({ x: severity.charAt(0).toUpperCase() + severity.slice(1), y: counts[severity] })),
        },
      ],
    },
  };
}
