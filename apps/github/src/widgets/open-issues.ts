/** How many issues are open. */

import type { Scene, WidgetData } from "initiative-app-sdk/widget";

import type { findIssues } from "../endpoints/issues.js";
import { missing } from "./missing.js";

export function render(data: WidgetData<typeof findIssues>): Scene {
  const nothing = missing(data.values);
  if (nothing) return nothing;
  const total = data.values.total;
  return { v: 1, scene: { kind: "metric", value: typeof total === "number" ? total : data.rows.length, label: "Open issues" } };
}
