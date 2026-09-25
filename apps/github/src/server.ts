/**
 * The HTTP surface, on `node:http`.
 *
 * | Route | Who calls it |
 * |---|---|
 * | `GET /healthz`, `GET /readyz` | the container runtime |
 * | `GET, POST /v1/endpoints` | Initiative, with a context token |
 * | `POST /v1/hooks/after_connect`, `/v1/hooks/revoke` | Initiative, with a lifecycle token |
 * | `POST /github/webhook` | GitHub, signed with the webhook secret |
 * | `GET /.well-known/jwks.json` | a deployment that registers the app's key by address |
 *
 * Nobody's browser comes here: Initiative runs the GitHub connections at its
 * own addresses.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { ENDPOINTS_PATH, handleHook, HOOKS_PATH } from "initiative-app-kit";

import type { AppContext } from "./context.js";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  handleDelivery,
  SIGNATURE_HEADER,
  verifySignature,
} from "./github/webhooks.js";
import { hookHandlers } from "./hooks.js";
import { invoke, listEndpoints } from "./invoke.js";
import { PATHS, PUBLIC_ID } from "./vocabulary.js";

/** The most a request body may carry. GitHub's deliveries are capped at 25 MB; ours are far smaller. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface ServerOptions {
  /** Whether the first installations sync has completed. */
  ready: () => boolean;
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function empty(res: ServerResponse, status: number): void {
  res.writeHead(status, { "Cache-Control": "no-store" });
  res.end();
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf-8"));
  } catch {
    return undefined;
  }
}

export function createAppServer(context: AppContext, options: ServerOptions): Server {
  return createServer((req, res) => {
    handle(context, options, req, res).catch((error) => {
      if (error instanceof TooLarge) {
        json(res, 413, { error: "too-large" });
        return;
      }
      context.log.error(`${req.method} ${req.url} failed`, error);
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.end();
    });
  });
}

async function handle(
  context: AppContext,
  options: ServerOptions,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/healthz") return json(res, 200, { ok: true });
  if (method === "GET" && path === "/readyz") {
    return options.ready() ? json(res, 200, { ok: true }) : json(res, 503, { ok: false });
  }
  if (method === "GET" && path === PATHS.jwks) return json(res, 200, context.publicJwks);

  if (path === ENDPOINTS_PATH) {
    if (method === "GET") {
      const answer = listEndpoints();
      return json(res, answer.status, answer.body);
    }
    if (method === "POST") {
      const body = parseJson(await readBody(req));
      if (body === undefined) return json(res, 400, { error: "invalid-request", detail: "expected a json object" });
      const answer = await invoke(context, req.headers, body);
      return json(res, answer.status, answer.body);
    }
  }

  if (method === "POST" && path.startsWith(`${HOOKS_PATH}/`)) {
    const body = parseJson(await readBody(req));
    const answer = await handleHook({ path, headers: req.headers, body }, hookHandlers(context), {
      publicId: PUBLIC_ID,
      baseUrl: context.config.initiative.baseUrl,
      jwks: context.jwks,
      now: context.now,
    });
    return answer.body === undefined ? empty(res, answer.status) : json(res, answer.status, answer.body);
  }

  if (method === "POST" && path === PATHS.webhook) {
    const raw = await readBody(req);
    const signature = req.headers[SIGNATURE_HEADER];
    if (!verifySignature(context.config.github.webhookSecret, raw, Array.isArray(signature) ? signature[0] : signature)) {
      return json(res, 401, { error: "bad-signature" });
    }
    const payload = parseJson(raw);
    if (typeof payload !== "object" || payload === null) return json(res, 400, { error: "invalid-request" });
    const result = await handleDelivery(
      context,
      String(req.headers[EVENT_HEADER] ?? ""),
      payload as Record<string, unknown>,
      String(req.headers[DELIVERY_HEADER] ?? "")
    );
    return json(res, 200, result);
  }

  json(res, 404, { error: "not-found" });
}
