/** Keys for the tests, generated once per run. None of them is ever written to disk. */

import { createSign } from "node:crypto";

import { generateAppKeys, loadPrivateKey, publicJwks } from "initiative-app-kit";

/** The deployment's platform key: signs context and lifecycle tokens. */
export const platform = generateAppKeys({ alg: "RS256", kid: "platform-1" });

/** The app's own key, registered with Initiative. */
export const appKey = generateAppKeys({ alg: "ES256", kid: "app-1" });

/** A key the deployment never published. */
export const stranger = generateAppKeys({ alg: "RS256", kid: "platform-1" });

export const platformJwks = publicJwks(loadPrivateKey(platform.privateKeyPem, platform.kid));

/** An RS256 JWT, as Initiative signs one. */
export function signRs256(privateKeyPem: string, kid: string, claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(input).sign(privateKeyPem).toString("base64url");
  return `${input}.${signature}`;
}
