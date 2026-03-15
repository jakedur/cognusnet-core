import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadLiveClientConfig } from "./live-client";

const { Client } = require("../../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js");
const { StdioClientTransport } = require("../../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js");

interface VerifyResult {
  ok: boolean;
  checks: string[];
  logsPath: string;
  tools: string[];
  retrievalSelectedCount?: number;
  retrievalIncludesRationale?: boolean;
}

export async function verifyMcp(env: NodeJS.ProcessEnv = process.env): Promise<VerifyResult> {
  const config = loadLiveClientConfig(env);
  const tempDir = mkdtempSync(join(tmpdir(), "cognusnet-mcp-verify-"));
  const logsPath = join(tempDir, "mcp-diagnostics.log");
  const transport = new StdioClientTransport({
    command: "node",
    args: ["./node_modules/tsx/dist/cli.mjs", "src/scripts/mcp-server.ts"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      COGNUSNET_BASE_URL: config.baseUrl,
      COGNUSNET_API_KEY: config.apiKey,
      COGNUSNET_TENANT_ID: config.tenantId,
      COGNUSNET_ACTOR_ID: config.actorId,
      ...(config.scopes.workspaceId ? { COGNUSNET_WORKSPACE_ID: config.scopes.workspaceId } : {}),
      ...(config.scopes.projectId ? { COGNUSNET_PROJECT_ID: config.scopes.projectId } : {}),
      ...(config.scopes.repositoryId ? { COGNUSNET_REPOSITORY_ID: config.scopes.repositoryId } : {}),
      COGNUSNET_MCP_LOG_PATH: logsPath
    }
  });
  const client = new Client({
    name: "cognusnet-mcp-verifier",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const checks: string[] = [];
    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools.map((tool: { name: string }) => tool.name);
    checks.push("connected_to_mcp_server");

    const requiredTools = ["prepare_coding_context", "record_coding_intent", "record_coding_outcome"];
    for (const tool of requiredTools) {
      if (!tools.includes(tool)) {
        throw new Error(`Missing required MCP tool: ${tool}`);
      }
    }
    checks.push("required_tools_present");

    const idSuffix = Date.now().toString();
    const intent = await client.callTool({
      name: "record_coding_intent",
      arguments: {
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement", "omit rationale from code"],
        path: "scripts/verify-intent.py",
        idempotencyKey: `verify-intent-${idSuffix}`
      }
    });
    const intentResult = intent.structuredContent as Record<string, unknown>;
    if (intentResult.acceptedCount !== 1 && intentResult.extractionStatus !== "duplicate") {
      throw new Error("record_coding_intent did not accept or deduplicate the write");
    }
    checks.push("record_coding_intent_succeeded");

    const outcome = await client.callTool({
      name: "record_coding_outcome",
      arguments: {
        artifactType: "prompt_response",
        query: "Make a python script that prints ahhh.",
        answer: "print('ahhh')",
        path: "scripts/verify-intent.py",
        idempotencyKey: `verify-outcome-${idSuffix}`
      }
    });
    const outcomeResult = outcome.structuredContent as Record<string, unknown>;
    if (outcomeResult.acceptedCount !== 1 && outcomeResult.extractionStatus !== "duplicate") {
      throw new Error("record_coding_outcome did not accept or deduplicate the write");
    }
    checks.push("record_coding_outcome_succeeded");

    const retrieval = await client.callTool({
      name: "prepare_coding_context",
      arguments: {
        query: "Why was the print ahhh?",
        path: "src/other/verify-context.py"
      }
    });
    const retrievalResult = retrieval.structuredContent as {
      contextBlock?: string;
      trace?: { selectedCount?: number };
    };
    const retrievalIncludesRationale = retrievalResult.contextBlock?.includes("because the sky is blue") ?? false;
    const retrievalSelectedCount = retrievalResult.trace?.selectedCount ?? 0;
    if (!retrievalIncludesRationale) {
      throw new Error("prepare_coding_context did not return the expected rationale");
    }
    checks.push("prepare_coding_context_returned_rationale");

    return {
      ok: true,
      checks,
      logsPath,
      tools,
      retrievalSelectedCount,
      retrievalIncludesRationale
    };
  } finally {
    await client.close().catch(() => undefined);
    const logsExist = readLogSafely(logsPath);
    if (!logsExist) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function readLogSafely(logsPath: string): string | null {
  try {
    return readFileSync(logsPath, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const result = await verifyMcp();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const logs = readLogSafely(result.logsPath);
  if (logs) {
    process.stdout.write(`\nDiagnostics log:\n${logs}`);
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown verification error";
    process.stderr.write(`[cognusnet-core:mcp-verify] ${message}\n`);
    process.exit(1);
  });
}
