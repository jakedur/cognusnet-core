import { Pool } from "pg";

import { createApp } from "./app";
import { loadConfig } from "./config";
import { PostgresRepositories } from "./infra/postgres/repositories";

async function main() {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl
  });
  const repositories = new PostgresRepositories(pool);
  const app = createApp({ repositories });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    await repositories.close();
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    await repositories.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
