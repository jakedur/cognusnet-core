export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/cognusnet",
    logLevel: env.LOG_LEVEL ?? "info"
  };
}
