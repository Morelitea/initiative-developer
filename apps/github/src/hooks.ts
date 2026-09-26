/**
 * `POST /v1/hooks/{name}`: what Initiative asks the app while it runs the
 * GitHub connections.
 *
 * - **`after_connect`** for `workspace`: an admin installed the GitHub App and
 *   authorized once. The installation they came back with must be one GitHub
 *   says they hold; its account and id become the community's configuration.
 * - **`after_connect`** for `account`: a member authorized. Their login is
 *   what Initiative shows for the connection.
 * - **`revoke`** for `account`: a member's connection ended. Their
 *   authorization of the GitHub App is ended at GitHub.
 * - **`webhook`**: a GitHub delivery for the community's installation, which
 *   Initiative has checked and routed. It becomes one of the six
 *   announcements, emitted in that community.
 * - **`schedule`** for `check-installation`: whether the organization's
 *   installation still exists at GitHub, reported as the configuration's
 *   status when that changes.
 *
 * The kit verifies the lifecycle token and the body; these handlers do only
 * the GitHub work. A handler that throws answers 500, which Initiative reads
 * as the hook failing: a connection is then not recorded, and a revocation or
 * a scheduled check is tried again.
 */

import type {
  AfterConnectAnswer,
  AfterConnectCall,
  HookHandlers,
  RevokeCall,
  ScheduleCall,
  WebhookCall,
} from "initiative-app-kit";

import type { AppContext } from "./context.js";
import { translate } from "./endpoints/emissions.js";
import { endAuthorization, userInstallations, userLogin } from "./github/oauth.js";
import { ACCOUNT, CHECK_INSTALLATION, WORKSPACE } from "./vocabulary.js";

const REFUSE: AfterConnectAnswer = { refuse: true };

/**
 * Checks in a row on which Initiative could get no token for an installation
 * before it is reported as unavailable. One such check may be GitHub having a
 * bad minute.
 */
export const UNAVAILABLE_CHECKS = 2;

/** The details this app reports an installation as invalid with. */
export const DETAILS = {
  removed: "github_installation_removed",
  suspended: "github_installation_suspended",
  unavailable: "github_installation_unavailable",
} as const;

export function hookHandlers(context: AppContext): HookHandlers {
  return {
    after_connect: (call) => logged(context, `after_connect for ${call.connection}`, afterConnect(context, call)),
    revoke: (call) => logged(context, `revoke for ${call.connection}`, revoke(context, call)),
    webhook: (call, claims) =>
      logged(context, `webhook ${call.headers["x-github-event"]}`, delivered(context, call, claims.guild_ref)),
    schedule: (call, claims) => logged(context, `schedule ${call.schedule}`, scheduled(context, call, claims.guild_ref)),
  };
}

/** The kit answers a handler that throws with 500 and says no more, so the reason is logged here. */
async function logged<T>(context: AppContext, what: string, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    context.log.error(`${what} failed`, error);
    throw error;
  }
}

async function afterConnect(context: AppContext, call: AfterConnectCall): Promise<AfterConnectAnswer> {
  if (call.connection === WORKSPACE && call.actor === "installation") return installed(context, call);
  if (call.connection === ACCOUNT && call.actor === "member") return authorized(context, call);
  return REFUSE;
}

/** The organization's installation, checked against the ones the admin holds. */
async function installed(context: AppContext, call: AfterConnectCall): Promise<AfterConnectAnswer> {
  const claimed = Number(call.params.installation_id);
  if (!Number.isSafeInteger(claimed) || claimed <= 0) return REFUSE;

  const held = await userInstallations(context.http, call.access_token);
  if (!held) throw new Error("GitHub would not list the admin's installations");
  const owner = held.get(claimed);
  if (!owner) {
    context.log.warn(`installation ${claimed} is not among the ones the admin holds`);
    return REFUSE;
  }
  // Whatever was cached for this installation predates this connection.
  context.github.forget(claimed);
  return { values: { owner, installation_id: claimed }, account_label: owner };
}

/** A member's own account, named by its login. */
async function authorized(context: AppContext, call: AfterConnectCall): Promise<AfterConnectAnswer> {
  const login = await userLogin(context.http, call.access_token);
  if (!login) throw new Error("GitHub would not name the member's account");
  return { account_label: login };
}

/** A member's authorization of the GitHub App, ended at GitHub. */
async function revoke(context: AppContext, call: RevokeCall): Promise<void> {
  if (call.connection !== ACCOUNT) return;
  const outcome = await endAuthorization(context.oauth, {
    accessToken: call.access_token ?? null,
    refreshToken: call.refresh_token ?? null,
  });
  if (outcome === "nothing-to-end") {
    context.log.info("a member's GitHub authorization had already ended");
  }
}

/** A GitHub delivery, announced in the community it was routed to. */
async function delivered(context: AppContext, call: WebhookCall, installation: string): Promise<void> {
  const event = call.headers["x-github-event"] ?? "";
  const payload = JSON.parse(call.body) as Record<string, unknown>;
  if (event === "installation" || event === "installation_repositories") {
    return changed(context, installation, payload);
  }
  const announcement = translate(event, payload);
  if (announcement) await context.auth.emitEvent(installation, announcement);
}

/**
 * The installation changed at GitHub: what is cached for it is stale. One
 * that was removed or suspended is reported, so the community's admins see
 * the configuration no longer works.
 */
async function changed(context: AppContext, installation: string, payload: Record<string, unknown>): Promise<void> {
  const installationId = Number((payload.installation as { id?: unknown } | undefined)?.id);
  const action = String(payload.action ?? "");
  if (action === "added" || action === "removed") {
    context.github.forgetRepositories(installationId);
    return;
  }
  context.github.forget(installationId);
  if (action !== "deleted" && action !== "suspend") return;
  await context.auth.reportConfigStatus(installation, {
    state: "invalid",
    detail: action === "deleted" ? DETAILS.removed : DETAILS.suspended,
  });
}

async function scheduled(context: AppContext, call: ScheduleCall, installation: string): Promise<void> {
  if (call.schedule === CHECK_INSTALLATION) await checkInstallation(context, installation);
}

/** Whether the community's GitHub installation still exists, reported when the verdict changes. */
async function checkInstallation(context: AppContext, installation: string): Promise<void> {
  const snapshot = await context.installs.refresh(installation);
  if (!snapshot.workspace) return;
  const lookup = await context.github.check(installation, snapshot.workspace);
  if (lookup.state === "unknown") throw new Error(`could not check the installation: ${lookup.detail}`);

  let detail: string | null;
  if (lookup.state === "unavailable") {
    const checks = (context.unavailable.get(installation) ?? 0) + 1;
    context.unavailable.set(installation, checks);
    // A removal or suspension already reported says more than this does.
    const known = Object.values(DETAILS) as string[];
    if (checks < UNAVAILABLE_CHECKS || known.includes(snapshot.configStateDetail ?? "")) return;
    detail = DETAILS.unavailable;
  } else {
    context.unavailable.delete(installation);
    detail = lookup.state === "gone" ? DETAILS.removed : lookup.state === "suspended" ? DETAILS.suspended : null;
  }

  const state = detail ? "invalid" : "ok";
  if (snapshot.configState === state && snapshot.configStateDetail === detail) return;
  await context.auth.reportConfigStatus(installation, detail ? { state: "invalid", detail } : { state: "ok" });
}
