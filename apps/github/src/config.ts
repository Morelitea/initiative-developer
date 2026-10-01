/**
 * The deployment's settings, read once from the environment.
 *
 * Every secret given to this app arrives here: the GitHub App's client secret,
 * and the app's own key for Initiative when one is given. None of them is ever
 * written anywhere else. With no key given, the SDK generates one on first
 * start and keeps it in `INITIATIVE_APP_DATA_DIR`. The GitHub App's private key
 * and webhook secret are not among them: Initiative holds both, mints the
 * organization's installation tokens, and checks GitHub's webhook deliveries.
 */

export interface Config {
  port: number;
  initiative: {
    /** Initiative's API base as this container reaches it, e.g. `http://initiative:8173/api/v1`. */
    baseUrl: string;
    /**
     * The app's own signing key (PEM) and the `kid` it is registered under
     * (default: its thumbprint). Unset, the SDK's generated key is used.
     */
    key?: { privateKey: string; kid?: string };
  };
  github: {
    /** The GitHub App's client ID and secret, for ending a member's authorization. */
    clientId: string;
    clientSecret: string;
    apiBase: string;
    webBase: string;
  };
}

/** Every variable, and whether the app refuses to start without it. */
export const ENVIRONMENT = {
  required: [
    "INITIATIVE_BASE_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ],
  optional: [
    "PORT",
    "INITIATIVE_APP_PRIVATE_KEY",
    "INITIATIVE_APP_KEY_ID",
    "INITIATIVE_APP_DATA_DIR",
    "GITHUB_API_BASE",
    "GITHUB_WEB_BASE",
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
  const privateKey = env.INITIATIVE_APP_PRIVATE_KEY?.trim();

  return {
    port: integer(env.PORT, "PORT", 8080),
    initiative: {
      baseUrl: trimSlashes(url(value("INITIATIVE_BASE_URL"), "INITIATIVE_BASE_URL")),
      key: privateKey
        ? { privateKey: pem(privateKey, "INITIATIVE_APP_PRIVATE_KEY"), kid: env.INITIATIVE_APP_KEY_ID?.trim() || undefined }
        : undefined,
    },
    github: {
      clientId: value("GITHUB_CLIENT_ID"),
      clientSecret: value("GITHUB_CLIENT_SECRET"),
      apiBase: trimSlashes(url(env.GITHUB_API_BASE?.trim() || "https://api.github.com", "GITHUB_API_BASE")),
      webBase: trimSlashes(url(env.GITHUB_WEB_BASE?.trim() || "https://github.com", "GITHUB_WEB_BASE")),
    },
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
