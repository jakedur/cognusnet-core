import { loadCodingMcpConfig, startCodingMcpServer } from "../mcp/server";

async function main(): Promise<void> {
  const config = loadCodingMcpConfig();
  const server = await startCodingMcpServer(config);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown MCP startup error";
  process.stderr.write(`[cognusnet-core:mcp] ${message}\n`);
  process.exit(1);
});
