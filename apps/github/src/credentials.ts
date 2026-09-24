/**
 * A member's own GitHub credential: found through their connection, renewed
 * when it is about to lapse, written back to Initiative when it changes, and
 * ended at GitHub when Initiative no longer holds it.
 */

import type { AppContext } from "./context.js";
import { refreshGrant, revokeGrant } from "./github/oauth.js";
import { CLEARED_VALUES, valuesOf, type MemberCredential } from "./installs.js";
import { ACCOUNT } from "./vocabulary.js";

/** A user token is renewed this long before it expires. */
export const REFRESH_SKEW_MS = 120_000;

const renewing = new WeakMap<AppContext, Map<string, Promise<string | null>>>();

/**
 * The GitHub token of the member a connection handle names, renewed if it is
 * about to lapse. Null when the member has no usable credential.
 */
export async function memberToken(
  context: AppContext,
  installation: string,
  connectionRef: string
): Promise<string | null> {
  let snapshot = await context.installs.snapshot(installation);
  let credential = snapshot.members.get(connectionRef);
  if (!credential) {
    // Connected since the snapshot was read: read it once more.
    snapshot = await context.installs.refresh(installation);
    credential = snapshot.members.get(connectionRef);
  }
  if (!credential) return null;
  if (credential.expiresAt === null || credential.expiresAt - REFRESH_SKEW_MS > context.now()) {
    return credential.accessToken;
  }

  let inflight = renewing.get(context);
  if (!inflight) renewing.set(context, (inflight = new Map()));
  const key = `${installation}\u0000${connectionRef}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = renew(context, installation, credential).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/**
 * The GitHub token of a member another app named by its subject: resolved to
 * this app's own handle for them, then read as above.
 */
export async function delegatedMemberToken(
  context: AppContext,
  installation: string,
  delegate: { delegate: string; subject: string }
): Promise<string | null> {
  let resolved;
  try {
    resolved = await context.auth.resolveConnection(installation, {
      delegate: delegate.delegate,
      subject: delegate.subject,
      connection: ACCOUNT,
    });
  } catch {
    return null;
  }
  if (resolved.blocked || !resolved.connectionRef) return null;
  return memberToken(context, installation, resolved.connectionRef);
}

async function renew(
  context: AppContext,
  installation: string,
  credential: MemberCredential
): Promise<string | null> {
  const renewable =
    credential.refreshToken !== null &&
    (credential.refreshExpiresAt === null || credential.refreshExpiresAt > context.now());

  if (renewable) {
    const answer = await refreshGrant(context.oauth, credential.refreshToken!);
    if (answer.ok) {
      const next: MemberCredential = {
        connectionRef: credential.connectionRef,
        accessToken: answer.grant.accessToken,
        refreshToken: answer.grant.refreshToken ?? credential.refreshToken,
        expiresAt: answer.grant.expiresAt,
        refreshExpiresAt: answer.grant.refreshExpiresAt ?? credential.refreshExpiresAt,
      };
      context.installs.setMember(installation, next);
      try {
        await context.auth.writeConnection(installation, credential.connectionRef, {
          values: valuesOf(next),
          status: "connected",
        });
      } catch (error) {
        // The renewed token still works; the next renewal writes it again.
        context.log.error(`could not store a renewed credential for ${installation}`, error);
      }
      return next.accessToken;
    }
    if (answer.reason === "unreachable") {
      // GitHub said nothing about this grant. Keep what there is.
      context.log.warn(`could not renew a member credential: ${answer.detail}`);
      return credential.accessToken;
    }
  }

  // The authorization is finished at GitHub. The member connects again.
  context.installs.dropMember(installation, credential.connectionRef);
  try {
    await context.auth.writeConnection(installation, credential.connectionRef, {
      values: CLEARED_VALUES,
      status: "pending",
    });
  } catch (error) {
    context.log.error(`could not clear a lapsed credential for ${installation}`, error);
  }
  return null;
}

/**
 * End a member's authorization of this app at GitHub: the grant, so the
 * refresh token goes with the access token. A token that has lapsed is renewed
 * first when it can be, because GitHub identifies the grant by a live token.
 */
export async function revokeMember(
  context: AppContext,
  credential: MemberCredential
): Promise<boolean> {
  let token = credential.accessToken;
  const lapsed = credential.expiresAt !== null && credential.expiresAt <= context.now();
  if (
    lapsed &&
    credential.refreshToken &&
    (credential.refreshExpiresAt === null || credential.refreshExpiresAt > context.now())
  ) {
    const answer = await refreshGrant(context.oauth, credential.refreshToken);
    if (answer.ok) token = answer.grant.accessToken;
  }
  const revoked = await revokeGrant(context.oauth, token);
  if (!revoked) context.log.warn("GitHub did not confirm the end of a member's authorization");
  return revoked;
}
