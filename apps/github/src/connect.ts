/**
 * The two browser trips Initiative starts at this app.
 *
 * - **A member connects their GitHub account** (`/connect/github`): they
 *   authorize this GitHub App, and the token pair GitHub issues is written
 *   into their `account` connection in Initiative's custody.
 * - **An admin installs the app on a GitHub organization**
 *   (`/install/github`): they choose the account and repositories on GitHub's
 *   own install page, then authorize once so GitHub can confirm that the
 *   installation they chose is one they hold. The account and installation
 *   id are written into the community's `workspace` connection.
 *
 * Both begin with the connect return Initiative signed, verified with the
 * kit, and both end by sending the person to the return address it carried
 * with an `outcome` added.
 */

import { ContextTokenError, verifyConnectReturn } from "initiative-app-kit";

import { track, type AppContext } from "./context.js";
import type { Flow } from "./flows.js";
import {
  authorizeUrl,
  exchangeCode,
  pkce,
  randomState,
  userInstallations,
} from "./github/oauth.js";
import { valuesOf } from "./installs.js";
import { ACCOUNT, PATHS, PUBLIC_ID, WORKSPACE } from "./vocabulary.js";

export type Outcome = "connected" | "refused" | "expired" | "not_recorded" | "awaiting_approval";

export type BrowserAnswer =
  | { status: 302; location: string }
  | { status: 400 | 502; message: string };

const redirect = (location: string): BrowserAnswer => ({ status: 302, location });

/** The return address with `outcome` added, keeping what it already carries. */
export function landing(returnUrl: string, outcome: Outcome): string {
  const url = new URL(returnUrl);
  url.searchParams.set("outcome", outcome);
  return url.toString();
}

/** A trip that cannot go on and has nowhere to go back to. */
const stranded = (message: string): BrowserAnswer => ({ status: 400, message });

/**
 * Check the connect return a trip starts with, and that it is for the
 * connection this route serves. Each is taken once.
 */
async function arrival(
  context: AppContext,
  query: URLSearchParams,
  connectionId: string
): Promise<{ installation: string; connectionRef: string; returnUrl: string } | BrowserAnswer> {
  const token = query.get("return_token");
  if (!token) return stranded("This link is missing its return token. Start again from Initiative.");
  let claims;
  try {
    claims = await verifyConnectReturn(token, {
      publicId: PUBLIC_ID,
      baseUrl: context.config.initiative.baseUrl,
      jwks: context.jwks,
      now: context.now,
    });
  } catch (error) {
    if (error instanceof ContextTokenError) {
      return stranded("This link could not be verified or has expired. Start again from Initiative.");
    }
    throw error;
  }
  const named = query.get("connection_ref");
  const guild = query.get("guild_ref");
  if (
    claims.connection_id !== connectionId ||
    (named !== null && named !== claims.connection_ref) ||
    (guild !== null && guild !== claims.guild_ref)
  ) {
    return stranded("This link is for a different connection. Start again from Initiative.");
  }
  if (!context.flows.burn(claims.jti, claims.exp)) {
    return redirect(landing(claims.return_url, "expired"));
  }
  return { installation: claims.guild_ref, connectionRef: claims.connection_ref, returnUrl: claims.return_url };
}

const callback = (context: AppContext, path: string) => `${context.config.publicUrl}${path}`;

// --- a member's own account --------------------------------------------------

export async function beginConnect(context: AppContext, query: URLSearchParams): Promise<BrowserAnswer> {
  const arrived = await arrival(context, query, ACCOUNT);
  if ("status" in arrived) return arrived;
  const state = randomState();
  const challenge = pkce();
  context.flows.begin(state, { kind: "connect", ...arrived, verifier: challenge.verifier });
  return redirect(
    authorizeUrl(context.oauth, {
      state,
      redirectUri: callback(context, PATHS.connectCallback),
      challenge: challenge.challenge,
    })
  );
}

export async function completeConnect(context: AppContext, query: URLSearchParams): Promise<BrowserAnswer> {
  const flow = context.flows.take(query.get("state"), "connect");
  if (!flow) return stranded("This sign-in has expired or was already used. Start again from Initiative.");
  const code = query.get("code");
  if (!code) return redirect(landing(flow.returnUrl, "refused"));

  const exchanged = await exchangeCode(context.oauth, {
    code,
    redirectUri: callback(context, PATHS.connectCallback),
    verifier: flow.verifier ?? "",
  });
  if (!exchanged.ok) {
    context.log.warn(`a member's authorization did not complete: ${exchanged.detail}`);
    return redirect(landing(flow.returnUrl, "refused"));
  }

  try {
    await context.auth.writeConnection(flow.installation, flow.connectionRef, {
      values: valuesOf(exchanged.grant),
      status: "connected",
    });
  } catch (error) {
    context.log.error(`could not store a member's credential for ${flow.installation}`, error);
    return redirect(landing(flow.returnUrl, "not_recorded"));
  }
  context.installs.setMember(flow.installation, { connectionRef: flow.connectionRef, ...exchanged.grant });
  return redirect(landing(flow.returnUrl, "connected"));
}

// --- the organization's installation ------------------------------------------

export async function beginInstall(context: AppContext, query: URLSearchParams): Promise<BrowserAnswer> {
  const arrived = await arrival(context, query, WORKSPACE);
  if ("status" in arrived) return arrived;
  const page = await context.github.installUrl();
  if (!page) {
    context.log.error("GitHub would not name this app's registration");
    return redirect(landing(arrived.returnUrl, "not_recorded"));
  }
  const state = randomState();
  context.flows.begin(state, { kind: "install", ...arrived });
  return redirect(`${page}?${new URLSearchParams({ state }).toString()}`);
}

/**
 * GitHub's setup URL. The installation it names is confirmed before it is
 * recorded: the admin authorizes once, and the installation must be among the
 * ones GitHub says they hold.
 */
export async function completeInstall(context: AppContext, query: URLSearchParams): Promise<BrowserAnswer> {
  const flow = context.flows.take(query.get("state"), "install");
  if (!flow) return stranded("This installation has expired or was already used. Start again from Initiative.");

  // A member of an organization asked an owner to approve. Nothing is installed yet.
  if (query.get("setup_action") === "request") return redirect(landing(flow.returnUrl, "awaiting_approval"));

  const claimed = Number(query.get("installation_id"));
  if (!Number.isSafeInteger(claimed) || claimed <= 0) return redirect(landing(flow.returnUrl, "refused"));

  const state = randomState();
  const challenge = pkce();
  const next: Omit<Flow, "expiresAt"> = {
    kind: "verify",
    installation: flow.installation,
    connectionRef: flow.connectionRef,
    returnUrl: flow.returnUrl,
    verifier: challenge.verifier,
    claimedInstallation: claimed,
  };
  context.flows.begin(state, next);
  return redirect(
    authorizeUrl(context.oauth, {
      state,
      redirectUri: callback(context, PATHS.installVerify),
      challenge: challenge.challenge,
    })
  );
}

/**
 * The end of an installation: the claim checked, and the account and
 * installation written into the community's configuration. The token used for
 * the check is not kept.
 */
export async function completeVerify(context: AppContext, query: URLSearchParams): Promise<BrowserAnswer> {
  const flow = context.flows.take(query.get("state"), "verify");
  if (!flow || flow.claimedInstallation === undefined) {
    return stranded("This installation has expired or was already used. Start again from Initiative.");
  }
  const code = query.get("code");
  if (!code) return redirect(landing(flow.returnUrl, "refused"));

  const exchanged = await exchangeCode(context.oauth, {
    code,
    redirectUri: callback(context, PATHS.installVerify),
    verifier: flow.verifier ?? "",
  });
  if (!exchanged.ok) return redirect(landing(flow.returnUrl, "refused"));

  const held = await userInstallations(context.github.http, exchanged.grant.accessToken);
  if (!held) return redirect(landing(flow.returnUrl, "not_recorded"));
  const owner = held.get(flow.claimedInstallation);
  if (!owner) {
    context.log.warn(`installation ${flow.claimedInstallation} is not among the ones the admin holds`);
    return redirect(landing(flow.returnUrl, "refused"));
  }

  try {
    await context.auth.writeConnection(flow.installation, flow.connectionRef, {
      values: { owner, installation_id: flow.claimedInstallation },
    });
  } catch (error) {
    context.log.error(`could not record the installation for ${flow.installation}`, error);
    return redirect(landing(flow.returnUrl, "not_recorded"));
  }

  context.github.forget(flow.claimedInstallation);
  const installation = flow.installation;
  track(
    context,
    context.installs.refresh(installation).then(() => context.auth.reportConfigStatus(installation, { state: "ok" })),
    `report the configuration of ${installation}`
  );
  return redirect(landing(flow.returnUrl, "connected"));
}
