/**
 * Every read answers why it has nothing in `unavailable`, and every tile says
 * so in words rather than drawing a zero.
 */

import type { Scene } from "initiative-plugin-sdk/widget";

const WHY: Record<string, string> = {
  "repository-required": "Choose a repository for this tile",
  "not-found": "That repository is not there, or not visible to the app",
  "not-authorized": "The organization has not granted the app this",
};

/** The empty tile saying why there is nothing, or null when there is an answer. */
export function missing(values: { unavailable?: string | null }): Scene | null {
  const why = values.unavailable;
  if (!why) return null;
  return { v: 1, scene: { kind: "empty", message: WHY[why] || "There is nothing to show" } };
}
