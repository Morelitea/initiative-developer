/** A fortnight of issues opened against issues closed, by day. */

import type { Scene, WidgetData } from "initiative-app-sdk/widget";

import type { findIssues } from "../endpoints/issues.js";
import { missing } from "./missing.js";

export function render(data: WidgetData<typeof findIssues>): Scene {
  const nothing = missing(data.values);
  if (nothing) return nothing;
  const days: Record<string, { opened: number; closed: number }> = {};
  const bucket = (iso: string) => {
    const day = String(iso).slice(0, 10);
    if (!days[day]) days[day] = { opened: 0, closed: 0 };
    return days[day];
  };
  for (const row of data.rows) {
    if (row.created_at) bucket(row.created_at).opened += 1;
    if (row.closed_at) bucket(row.closed_at).closed += 1;
  }
  const ordered = Object.keys(days).sort();
  if (!ordered.length) return { v: 1, scene: { kind: "empty", message: "Nothing opened or closed in this window" } };
  return {
    v: 1,
    scene: {
      kind: "series",
      mark: "line",
      series: [
        { name: "Opened", points: ordered.map((day) => ({ x: day, y: days[day].opened })) },
        { name: "Closed", points: ordered.map((day) => ({ x: day, y: days[day].closed })) },
      ],
    },
  };
}
