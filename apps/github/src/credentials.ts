/**
 * A member's own GitHub token, asked of Initiative by the handle a context
 * token names. Initiative holds the authorization and renews it; the token is
 * used for one call and not kept, so a member who disconnects or is blocked
 * stops at the next call.
 *
 * Whose token a call runs on is read from the context token. Another app's
 * call through Initiative names its actor: `member` carries that member's
 * `account` handle, `installation` carries the community's `workspace` one and
 * no member's. Initiative's own call for a widget names no actor and carries
 * the viewing member's `account` handle when they have connected one.
 */

import { InitiativeApiError, type Client } from "initiative-app-sdk/client";
import type { AppContext } from "initiative-app-sdk/manifest";

import type { Call } from "./endpoints/support.js";
import { ACCOUNT } from "./vocabulary.js";

/**
 * The member's token, or why there is none: `not-connected` when the member
 * has not connected, was blocked, or must connect again; `unavailable` when
 * Initiative could not renew it with GitHub or could not be reached;
 * `no-member` when the call is the community's, so there is no member to act
 * as.
 */
export type MemberToken =
  | { ok: true; token: string }
  | { ok: false; reason: "not-connected" | "unavailable" | "no-member" };

/** Initiative's answers that mean the member has no usable connection. */
const NOT_CONNECTED = new Set([403, 404, 409]);

export async function memberToken(context: AppContext, client: Client, connectionRef: string): Promise<MemberToken> {
  try {
    const { accessToken } = await client.connectionToken(connectionRef);
    return { ok: true, token: accessToken };
  } catch (error) {
    if (error instanceof InitiativeApiError && NOT_CONNECTED.has(error.status)) {
      return { ok: false, reason: "not-connected" };
    }
    context.log.warn(`no member token for ${client.installation}: ${(error as Error).message}`);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The token of the member a call is for: the `account` handle the context
 * token carries. A call made as the community has none.
 */
export async function callerToken(call: Call): Promise<MemberToken> {
  if (call.caller !== null && call.actor.kind === "installation") return { ok: false, reason: "no-member" };
  const ref = call.connections[ACCOUNT];
  if (!ref) return { ok: false, reason: "not-connected" };
  return memberToken(call.context, call.client, ref);
}
