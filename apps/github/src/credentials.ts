/**
 * A member's own GitHub token, asked of Initiative by the handle a context
 * token names. Initiative holds the authorization and renews it; the token is
 * used for one call and not kept, so a member who disconnects or is blocked
 * stops at the next call.
 */

import { InitiativeApiError } from "initiative-app-kit";

import type { AppContext } from "./context.js";
import { ACCOUNT } from "./vocabulary.js";

/**
 * The member's token, or why there is none: `not-connected` when the member
 * has not connected, was blocked, or must connect again; `unavailable` when
 * Initiative could not renew it with GitHub or could not be reached.
 */
export type MemberToken =
  | { ok: true; token: string }
  | { ok: false; reason: "not-connected" | "unavailable" };

/** Initiative's answers that mean the member has no usable connection. */
const NOT_CONNECTED = new Set([403, 404, 409]);

export async function memberToken(
  context: AppContext,
  installation: string,
  connectionRef: string
): Promise<MemberToken> {
  try {
    const { accessToken } = await context.auth.connectionToken(installation, connectionRef);
    return { ok: true, token: accessToken };
  } catch (error) {
    if (error instanceof InitiativeApiError && NOT_CONNECTED.has(error.status)) {
      return { ok: false, reason: "not-connected" };
    }
    context.log.warn(`no member token for ${installation}: ${(error as Error).message}`);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The GitHub token of a member another app named by its subject: resolved to
 * this app's own handle for them, then asked for as above.
 */
export async function delegatedMemberToken(
  context: AppContext,
  installation: string,
  delegate: { delegate: string; subject: string }
): Promise<MemberToken> {
  let resolved;
  try {
    resolved = await context.auth.resolveConnection(installation, {
      delegate: delegate.delegate,
      subject: delegate.subject,
      connection: ACCOUNT,
    });
  } catch {
    return { ok: false, reason: "not-connected" };
  }
  if (resolved.blocked || !resolved.connectionRef) return { ok: false, reason: "not-connected" };
  return memberToken(context, installation, resolved.connectionRef);
}
