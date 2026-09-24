/**
 * `POST /v1/endpoints`: Initiative calling one of the app's endpoints.
 *
 * The context token says which community and which endpoint; the body names
 * the endpoint and its parameters. A read runs on the organization's
 * installation. A write runs on the credential of the member it is done for,
 * which the token names by handle, and never falls back to the app.
 */

import {
  bearerToken,
  ContextTokenError,
  parseInvoke,
  verifyContextToken,
  type ContextClaims,
} from "initiative-app-kit";

import type { AppContext } from "./context.js";
import { memberToken } from "./credentials.js";
import { ENDPOINTS, READ_HANDLERS, WRITE_HANDLERS } from "./endpoints/index.js";
import { grants } from "./github/app.js";
import type { Call, Write } from "./endpoints/support.js";
import { ACCOUNT, PUBLIC_ID } from "./vocabulary.js";

export interface Answer {
  status: number;
  body: unknown;
}

const refuse = (status: number, error: string, detail?: string): Answer => ({
  status,
  body: detail ? { error, detail } : { error },
});

export async function verifyCall(
  context: AppContext,
  headers: Record<string, string | string[] | undefined>
): Promise<ContextClaims | Answer> {
  const token = bearerToken(headers);
  if (!token) return refuse(401, "unauthorized", "a context token is required");
  try {
    return await verifyContextToken(token, {
      publicId: PUBLIC_ID,
      baseUrl: context.config.initiative.baseUrl,
      jwks: context.jwks,
      now: context.now,
    });
  } catch (error) {
    if (error instanceof ContextTokenError) return refuse(401, "unauthorized", error.message);
    throw error;
  }
}

export async function invoke(
  context: AppContext,
  headers: Record<string, string | string[] | undefined>,
  body: unknown
): Promise<Answer> {
  const claims = await verifyCall(context, headers);
  if ("status" in claims) return claims;

  const parsed = parseInvoke(body, ENDPOINTS, claims);
  if (!parsed.ok) return refuse(400, "invalid-request", parsed.error);

  const { endpoint, params } = parsed.request;
  const call: Call = { context, installation: claims.guild_ref, claims, params };

  const read = READ_HANDLERS.get(endpoint);
  if (read) {
    const outcome = await read.run(call);
    return { status: 200, body: { endpoint, actor: outcome.actor, result: outcome.result } };
  }

  const write = WRITE_HANDLERS.get(endpoint);
  if (!write) return refuse(400, "invalid-request", `'${endpoint}' is not called`);
  return runWrite(call, write);
}

async function runWrite(call: Call, write: Write): Promise<Answer> {
  const endpoint = write.declaration.id;
  const snapshot = await call.context.installs.snapshot(call.installation);
  if (!snapshot.workspace) return refuse(409, "not-configured");

  // The member this write is done for, by the handle the token carries.
  const ref = call.claims.connection_refs?.[ACCOUNT];
  const token = ref ? await memberToken(call.context, call.installation, ref) : null;
  if (!token) return refuse(409, "not-connected", "the member has no connected GitHub account");

  // Refused here, naming the permission, when the organization never granted it.
  const minted = await call.context.github.installationToken(snapshot.workspace.installationId);
  if (!minted) return refuse(409, "installation-unavailable");
  if (minted.grant && !write.needs.some((permission) => grants(minted.grant!, permission, "write"))) {
    return refuse(403, "missing-permission", write.needs.join(" or "));
  }

  const outcome = await write.run(call, token, { ...snapshot.workspace, grant: minted.grant });
  if (!outcome.ok) return refuse(outcome.status, outcome.error, outcome.detail);
  return { status: 200, body: { endpoint, actor: "member", result: outcome.result } };
}

/** `GET /v1/endpoints`: what the app declares. */
export function listEndpoints(): Answer {
  return { status: 200, body: { endpoints: ENDPOINTS } };
}
