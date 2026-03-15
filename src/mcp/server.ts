import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { appendFileSync } from "node:fs";
import { z } from "zod";

import type { RetrieveMemoryResponse, WriteMemoryResponse } from "../domain/types";
import { CognusNetClient } from "../sdk/client";
import { CodingMcpAdapter, type CodingMcpDefaults } from "./coding";

const DEFAULT_SERVER_NAME = "cognusnet-core-coding";
const DEFAULT_SERVER_VERSION = "0.1.0";
const prepareCodingContextSchema = z.object({
  query: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  recencyDays: z.number().positive().optional()
});
const recordCodingIntentSchema = z.object({
  task: z.string().min(1),
  rationale: z.string().min(1).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional()
});
const recordCodingOutcomeSchema = z.object({
  artifactType: z.enum(["prompt_response", "code_snippet", "code_diff", "documentation"]),
  query: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional()
});

export interface CodingMcpRuntimeConfig extends CodingMcpDefaults {
  baseUrl: string;
  apiKey: string;
  logPath?: string;
}

export interface McpDiagnosticsLogger {
  log(event: string, details?: Record<string, unknown>): void;
}

export function loadCodingMcpConfig(env: NodeJS.ProcessEnv = process.env): CodingMcpRuntimeConfig {
  return {
    baseUrl: requireEnv(env, "COGNUSNET_BASE_URL"),
    apiKey: requireEnv(env, "COGNUSNET_API_KEY"),
    tenantId: requireEnv(env, "COGNUSNET_TENANT_ID"),
    actorId: requireEnv(env, "COGNUSNET_ACTOR_ID"),
    workspaceId: pickEnv(env, "COGNUSNET_WORKSPACE_ID"),
    projectId: pickEnv(env, "COGNUSNET_PROJECT_ID"),
    repositoryId: pickEnv(env, "COGNUSNET_REPOSITORY_ID"),
    logPath: pickEnv(env, "COGNUSNET_MCP_LOG_PATH")
  };
}

export function createCodingMcpServer(input: {
  client: Pick<CognusNetClient, "prepareCodingContext" | "recordCodingIntent" | "recordCodingOutcome">;
  defaults: CodingMcpDefaults;
  serverName?: string;
  serverVersion?: string;
  logger?: McpDiagnosticsLogger;
}): McpServer {
  const adapter = new CodingMcpAdapter(input.client, input.defaults);
  const logger = input.logger ?? createMcpDiagnosticsLogger();
  const server = new McpServer({
    name: input.serverName ?? DEFAULT_SERVER_NAME,
    version: input.serverVersion ?? DEFAULT_SERVER_VERSION
  });
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: {
      description: string;
      inputSchema: unknown;
    },
    cb: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      structuredContent: Record<string, unknown>;
    }>
  ) => void;

  registerTool(
    "prepare_coding_context",
    {
      description:
        "Always call this before substantive coding work and before why/where/how follow-up answers. Retrieve the most relevant coding memory for the current query and repository path before generating a response.",
      inputSchema: prepareCodingContextSchema
    },
    async (args) => runLoggedToolCall(logger, "prepare_coding_context", args, async () => formatToolResult(await adapter.callTool("prepare_coding_context", args)))
  );

  registerTool(
    "record_coding_intent",
    {
      description:
        "Call this immediately when the user gives explicit task intent, rationale, or constraints that may not appear in the final code. Persist that intent before code generation.",
      inputSchema: recordCodingIntentSchema
    },
    async (args) => runLoggedToolCall(logger, "record_coding_intent", args, async () => formatToolResult(await adapter.callTool("record_coding_intent", args)))
  );

  registerTool(
    "record_coding_outcome",
    {
      description:
        "Always call this after producing code, documentation, or a technical explanation. Write back the outcome of the work after execution so later prompts can retrieve it.",
      inputSchema: recordCodingOutcomeSchema
    },
    async (args) => runLoggedToolCall(logger, "record_coding_outcome", args, async () => formatToolResult(await adapter.callTool("record_coding_outcome", args)))
  );

  logger.log("mcp_server_created", {
    serverName: input.serverName ?? DEFAULT_SERVER_NAME,
    serverVersion: input.serverVersion ?? DEFAULT_SERVER_VERSION,
    defaults: summarizeDefaults(input.defaults)
  });

  return server;
}

export async function startCodingMcpServer(config: CodingMcpRuntimeConfig): Promise<McpServer> {
  const logger = createMcpDiagnosticsLogger(config.logPath);
  const client = new CognusNetClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey
  });
  const server = createCodingMcpServer({
    client,
    defaults: config,
    logger
  });
  const transport = new StdioServerTransport();
  transport.onerror = (error: Error) => {
    logger.log("transport_error", { message: error.message });
  };
  logger.log("mcp_server_starting", {
    baseUrl: config.baseUrl,
    defaults: summarizeDefaults(config),
    logPath: config.logPath ?? null
  });
  await server.connect(transport);
  logger.log("mcp_server_connected");
  return server;
}

function formatToolResult(payload: RetrieveMemoryResponse | WriteMemoryResponse) {
  return {
    content: [
      {
        type: "text" as const,
        text: summarizePayload(payload)
      }
    ],
    structuredContent: payload as unknown as Record<string, unknown>
  };
}

function summarizePayload(payload: RetrieveMemoryResponse | WriteMemoryResponse): string {
  if ("contextBlock" in payload) {
    return [
      `Selected ${payload.trace.selectedCount} memories from ${payload.trace.candidateCount} candidates.`,
      payload.contextBlock
    ].join("\n\n");
  }

  return [
    `Recorded event ${payload.eventId}.`,
    `Extraction status: ${payload.extractionStatus}.`,
    `Accepted ${payload.acceptedCount} memories and queued ${payload.queuedCount}.`
  ].join(" ");
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = pickEnv(env, key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function pickEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function summarizeDefaults(defaults: CodingMcpDefaults): Record<string, unknown> {
  return {
    tenantId: defaults.tenantId,
    actorId: defaults.actorId,
    workspaceId: defaults.workspaceId ?? null,
    projectId: defaults.projectId ?? null,
    repositoryId: defaults.repositoryId ?? null
  };
}

async function runLoggedToolCall(
  logger: McpDiagnosticsLogger,
  toolName: string,
  args: Record<string, unknown>,
  handler: () => Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent: Record<string, unknown>;
  }>
) {
  logger.log("tool_call_started", {
    toolName,
    args: sanitizeArgs(args)
  });

  try {
    const result = await handler();
    logger.log("tool_call_succeeded", {
      toolName,
      result: summarizeStructuredContent(result.structuredContent)
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool error";
    logger.log("tool_call_failed", {
      toolName,
      args: sanitizeArgs(args),
      message
    });
    throw error;
  }
}

export function createMcpDiagnosticsLogger(logPath?: string): McpDiagnosticsLogger {
  let warnedAboutLogPathFailure = false;

  return {
    log(event, details) {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        source: "cognusnet-core:mcp",
        event,
        ...(details ? { details } : {})
      });
      process.stderr.write(`${line}\n`);
      if (logPath) {
        try {
          appendFileSync(logPath, `${line}\n`, "utf8");
        } catch (error) {
          if (!warnedAboutLogPathFailure) {
            warnedAboutLogPathFailure = true;
            const message = error instanceof Error ? error.message : "Unknown log write error";
            process.stderr.write(
              `${JSON.stringify({
                ts: new Date().toISOString(),
                source: "cognusnet-core:mcp",
                event: "mcp_log_path_write_failed",
                details: {
                  logPath,
                  message
                }
              })}\n`
            );
          }
        }
      }
    }
  };
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (key === "answer" || key === "content") {
        return [key, typeof value === "string" ? truncateValue(value) : value];
      }
      if (key === "constraints" && Array.isArray(value)) {
        return [key, value.map((item) => (typeof item === "string" ? truncateValue(item) : item))];
      }
      return [key, value];
    })
  );
}

function summarizeStructuredContent(content: Record<string, unknown>): Record<string, unknown> {
  if ("contextBlock" in content && "trace" in content) {
    const trace = typeof content.trace === "object" && content.trace ? (content.trace as Record<string, unknown>) : {};
    return {
      kind: "retrieve",
      selectedCount: trace.selectedCount ?? null,
      candidateCount: trace.candidateCount ?? null,
      contextPreview: typeof content.contextBlock === "string" ? truncateValue(content.contextBlock) : null
    };
  }

  return {
    kind: "write",
    eventId: content.eventId ?? null,
    extractionStatus: content.extractionStatus ?? null,
    acceptedCount: content.acceptedCount ?? null,
    queuedCount: content.queuedCount ?? null
  };
}

function truncateValue(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}...`;
}
