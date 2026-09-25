/** The container's entry point: read the settings, serve, and sync. */

import { ConfigError, loadConfig } from "./config.js";
import { createContext, settle } from "./context.js";
import { createAppServer } from "./server.js";
import { InstallationSync, schedule } from "./sync.js";

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

  const context = createContext(config);
  const sync = new InstallationSync(context);
  const server = createAppServer(context, { ready: () => sync.ready });
  const stop = schedule(sync, config.syncIntervalSeconds);

  server.listen(config.port, () => {
    console.log(`initiative-github listening on ${config.port}`);
  });

  const shutdown = () => {
    stop();
    server.close(() => {
      void settle(context).finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
