/**
 * The deployment's settings, read once from the environment.
 *
 * Every secret this app holds arrives here: the GitHub App's private key,
 * client secret and webhook secret, and the app's own key for Initiative.
 * None of them is ever written anywhere else.
 */

export interface Config {
  port: number;
  /** Browser-facing address of this app, and where GitHub sends people and deliveries. */
  publicUrl: string;
  initiative: {
    /** Initiative's API base as this container reaches it, e.g. `http://initiative:8173/api/v1`. */
    baseUrl: string;
    /** The app's own signing key (PEM), registered with Initiative as a JWKS. */
    privateKey: string;
    /** The `kid` that key was registered under. */
    keyId: string;
  };
  github: {
    clientId: string;
    clientSecret: string;
    /** The GitHub App's private key (PEM). */
    privateKey: string;
    webhookSecret: string;
    /** The GitHub App's slug. Read from GitHub when absent. */
    appSlug: string | null;
    apiBase: string;
    webBase: string;
  };
  syncIntervalSeconds: number;
}

/** Every variable, and whether the app refuses to start without it. */
export const ENVIRONMENT = {
  required: [
    "APP_PUBLIC_URL",
    "INITIATIVE_BASE_URL",
    "INITIATIVE_APP_PRIVATE_KEY",
    "INITIATIVE_APP_KEY_ID",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
  ],
  optional: [
    "PORT",
    "GITHUB_APP_SLUG",
    "GITHUB_API_BASE",
    "GITHUB_WEB_BASE",
    "SYNC_INTERVAL_SECONDS",
  ],
} as const;

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const missing = ENVIRONMENT.required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new ConfigError(`missing required settings: ${missing.join(", ")}`);
  }
  const value = (name: string) => env[name]!.trim();

  return {
    port: integer(env.PORT, "PORT", 8080),
    publicUrl: trimSlashes(url(value("APP_PUBLIC_URL"), "APP_PUBLIC_URL")),
    initiative: {
      baseUrl: trimSlashes(url(value("INITIATIVE_BASE_URL"), "INITIATIVE_BASE_URL")),
      privateKey: pem(value("INITIATIVE_APP_PRIVATE_KEY"), "INITIATIVE_APP_PRIVATE_KEY"),
      keyId: value("INITIATIVE_APP_KEY_ID"),
    },
    github: {
      clientId: value("GITHUB_CLIENT_ID"),
      clientSecret: value("GITHUB_CLIENT_SECRET"),
      privateKey: pem(value("GITHUB_APP_PRIVATE_KEY"), "GITHUB_APP_PRIVATE_KEY"),
      webhookSecret: value("GITHUB_WEBHOOK_SECRET"),
      appSlug: env.GITHUB_APP_SLUG?.trim() || null,
      apiBase: trimSlashes(url(env.GITHUB_API_BASE?.trim() || "https://api.github.com", "GITHUB_API_BASE")),
      webBase: trimSlashes(url(env.GITHUB_WEB_BASE?.trim() || "https://github.com", "GITHUB_WEB_BASE")),
    },
    syncIntervalSeconds: integer(env.SYNC_INTERVAL_SECONDS, "SYNC_INTERVAL_SECONDS", 300),
  };
}

/** A PEM as written, with `\n` typed literally, or base64 of the PEM. */
export function pem(raw: string, name: string): string {
  const text = raw.includes("-----BEGIN")
    ? raw.replaceAll("\\n", "\n")
    : Buffer.from(raw, "base64").toString("utf-8");
  if (!text.includes("-----BEGIN") || !text.includes("PRIVATE KEY-----")) {
    throw new ConfigError(`${name} is not a PEM private key`);
  }
  return text;
}

function integer(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive whole number`);
  }
  return parsed;
}

function url(raw: string, name: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
  } catch {
    throw new ConfigError(`${name} must be an http(s) URL`);
  }
  return raw;
}

export function trimSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}
