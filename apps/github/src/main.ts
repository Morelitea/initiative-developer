/** The container's entry point: read the settings and serve. */

import { ConfigError, loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { createAppServer } from "./server.js";

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

  const server = createAppServer(createContext(config));

  server.listen(config.port, () => {
    console.log(`initiative-github listening on ${config.port}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
