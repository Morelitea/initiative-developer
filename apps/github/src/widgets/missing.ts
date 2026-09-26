/**
 * Every read answers why it has nothing in `unavailable`, and every tile says
 * so in words rather than drawing a zero.
 */

import type { Scene } from "initiative-app-sdk/widget";

const WHY: Record<string, string> = {
  "repository-required": "Choose a repository for this tile",
  "repository-not-listed": "This tile names a repository the installation does not cover",
  "not-configured": "No GitHub organization is connected yet",
  "installation-unavailable": "GitHub would not let the app into the organization",
  "not-connected": "Connect your GitHub account to see this",
  "not-found": "That repository is not there, or not visible to the app",
  forbidden: "The organization has not granted the app this",
  "vendor-error": "GitHub did not answer",
  "rate-limited": "GitHub is limiting requests; this tile will fill in shortly",
};

/** The empty tile saying why there is nothing, or null when there is an answer. */
export function missing(values: { unavailable?: string | null }): Scene | null {
  const why = values.unavailable;
  if (!why) return null;
  return { v: 1, scene: { kind: "empty", message: WHY[why] || "There is nothing to show" } };
}
