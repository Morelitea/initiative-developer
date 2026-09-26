/** The container's entry point: read the settings and serve. */

import { createApp, serve } from "initiative-app-sdk/server";

import app from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { consoleLogger, createContext } from "./context.js";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const server = serve(
    createApp(app, {
      baseUrl: config.initiative.baseUrl,
      key: { privateKey: config.initiative.privateKey, kid: config.initiative.keyId },
      context: createContext(config),
      log: consoleLogger,
    }),
    { port: config.port }
  );
  server.on("listening", () => console.log(`initiative-github listening on ${config.port}`));

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
