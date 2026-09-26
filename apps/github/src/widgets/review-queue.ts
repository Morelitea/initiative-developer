/** Pull requests that asked for the viewer's review. */

import type { Scene, WidgetData } from "initiative-app-sdk/widget";

import type { findPullRequests } from "../endpoints/pulls.js";
import { missing } from "./missing.js";

export function render(data: WidgetData<typeof findPullRequests>): Scene {
  const nothing = missing(data.values);
  if (nothing) return nothing;
  if (!data.rows.length) return { v: 1, scene: { kind: "empty", message: "Nothing is waiting on you" } };
  return {
    v: 1,
    scene: {
      kind: "table",
      columns: [
        { key: "number", label: "#", align: "end" },
        { key: "title", label: "Pull request" },
      ],
      rows: data.rows.slice(0, 10).map((row) => ({ number: row.numbers || "", title: row.titles || "" })),
    },
  };
}
