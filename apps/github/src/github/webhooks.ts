/**
 * `POST /github/webhook`: GitHub's deliveries, verified by their signature and
 * turned into the app's announcements for each community bound to the
 * installation they came from. Initiative delivers them onward.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { track, type AppContext } from "../context.js";
import { translate } from "../endpoints/emissions.js";

export const EVENT_HEADER = "x-github-event";
export const SIGNATURE_HEADER = "x-hub-signature-256";
export const DELIVERY_HEADER = "x-github-delivery";

/** How many delivery ids are remembered, so a redelivery announces nothing twice. */
const REMEMBERED_DELIVERIES = 1000;

/** `X-Hub-Signature-256`: `sha256=` and an HMAC-SHA256 of the raw body under the webhook secret. */
export function verifySignature(secret: string, body: Uint8Array, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const offered = Buffer.from(header.slice("sha256=".length), "hex");
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

export interface DeliveryResult {
  emitted: number;
  reason?: "repeat" | "nothing-to-say" | "no-installation" | "unbound" | "lifecycle";
}

const seen = new WeakMap<AppContext, Set<string>>();

function firstTime(context: AppContext, deliveryId: string): boolean {
  if (!deliveryId) return true;
  let ids = seen.get(context);
  if (!ids) seen.set(context, (ids = new Set()));
  if (ids.has(deliveryId)) return false;
  ids.add(deliveryId);
  if (ids.size > REMEMBERED_DELIVERIES) ids.delete(ids.values().next().value!);
  return true;
}

export async function handleDelivery(
  context: AppContext,
  event: string,
  payload: Record<string, unknown>,
  deliveryId: string
): Promise<DeliveryResult> {
  if (!firstTime(context, deliveryId)) return { emitted: 0, reason: "repeat" };

  const id = (payload.installation as { id?: unknown } | undefined)?.id;
  const installationId = typeof id === "number" ? id : null;

  if (event === "installation" || event === "installation_repositories") {
    if (installationId === null) return { emitted: 0, reason: "no-installation" };
    lifecycle(context, installationId, String(payload.action ?? ""));
    return { emitted: 0, reason: "lifecycle" };
  }

  const announcement = translate(event, payload);
  if (!announcement) return { emitted: 0, reason: "nothing-to-say" };
  if (installationId === null) return { emitted: 0, reason: "no-installation" };

  const bound = context.installs.boundTo(installationId);
  if (!bound.length) return { emitted: 0, reason: "unbound" };

  const sent = await Promise.allSettled(
    bound.map((installation) => context.auth.emitEvent(installation, announcement))
  );
  sent.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      context.log.error(`could not announce ${announcement.eventType} to ${bound[index]}`, outcome.reason);
    }
  });
  return { emitted: sent.filter((outcome) => outcome.status === "fulfilled").length };
}

/**
 * An installation changed at GitHub: what is cached for it is stale. One that
 * was removed or suspended is reported to each community bound to it, so its
 * admins see the configuration no longer works.
 */
function lifecycle(context: AppContext, installationId: number, action: string): void {
  if (action === "added" || action === "removed") {
    context.github.forgetRepositories(installationId);
    return;
  }
  context.github.forget(installationId);
  if (action !== "deleted" && action !== "suspend") return;
  for (const installation of context.installs.boundTo(installationId)) {
    track(
      context,
      context.auth.reportConfigStatus(installation, {
        state: "invalid",
        detail: action === "deleted" ? "github_installation_removed" : "github_installation_suspended",
      }),
      `report the configuration of ${installation}`
    );
  }
}
