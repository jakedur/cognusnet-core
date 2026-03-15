import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodingMcpServer, loadCodingMcpConfig } from "../../src/mcp/server";

const { Client } = require("../../node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js");
const { InMemoryTransport } = require("../../node_modules/@modelcontextprotocol/sdk/dist/cjs/inMemory.js");

describe("coding MCP server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads required Codex MCP environment variables", () => {
    const config = loadCodingMcpConfig({
      COGNUSNET_BASE_URL: "http://127.0.0.1:3000",
      COGNUSNET_API_KEY: "test-api-key",
      COGNUSNET_TENANT_ID: "tenant-alpha",
      COGNUSNET_ACTOR_ID: "actor-1",
      COGNUSNET_WORKSPACE_ID: "workspace-1",
      COGNUSNET_PROJECT_ID: "project-1",
      COGNUSNET_REPOSITORY_ID: "repository-1"
    });

    expect(config).toEqual({
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "test-api-key",
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      repositoryId: "repository-1"
    });
  });

  it("fails fast when required MCP environment variables are missing", () => {
    expect(() =>
      loadCodingMcpConfig({
        COGNUSNET_API_KEY: "test-api-key",
        COGNUSNET_TENANT_ID: "tenant-alpha",
        COGNUSNET_ACTOR_ID: "actor-1"
      })
    ).toThrow("Missing required environment variable: COGNUSNET_BASE_URL");
  });

  it("serves coding tools over MCP and routes them through the adapter", async () => {
    const upstream = {
      prepareCodingContext: vi.fn().mockResolvedValue({
        memoryRecords: [],
        contextBlock: "Use src/api/server.ts for auth middleware context.",
        trace: {
          candidateCount: 3,
          selectedCount: 1,
          queryEmbeddingDimensions: 12,
          selectedMatches: []
        }
      }),
      recordCodingIntent: vi.fn().mockResolvedValue({
        eventId: "event-intent-1",
        extractionStatus: "processed",
        acceptedCount: 1,
        queuedCount: 0
      }),
      recordCodingOutcome: vi.fn().mockResolvedValue({
        eventId: "event-1",
        extractionStatus: "processed",
        acceptedCount: 1,
        queuedCount: 0
      })
    };

    const server = createCodingMcpServer({
      client: upstream,
      defaults: {
        tenantId: "tenant-alpha",
        actorId: "actor-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        repositoryId: "repository-1"
      }
    });
    const client = new Client({
      name: "mcp-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "prepare_coding_context",
      "record_coding_intent",
      "record_coding_outcome"
    ]);

    const prepare = await client.callTool({
      name: "prepare_coding_context",
      arguments: {
        query: "Where is auth middleware?",
        path: "src/api/server.ts"
      }
    });
    const record = await client.callTool({
      name: "record_coding_intent",
      arguments: {
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement"],
        path: "scripts/demo.py",
        idempotencyKey: "mcp-intent-1"
      }
    });
    const outcome = await client.callTool({
      name: "record_coding_outcome",
      arguments: {
        artifactType: "prompt_response",
        query: "Where is auth middleware?",
        answer: "It lives in src/api/server.ts.",
        path: "src/api/server.ts",
        idempotencyKey: "mcp-1"
      }
    });

    expect(prepare.content[0]).toMatchObject({
      type: "text"
    });
    expect(prepare.structuredContent).toMatchObject({
      contextBlock: "Use src/api/server.ts for auth middleware context."
    });
    expect(record.structuredContent).toMatchObject({
      eventId: "event-intent-1",
      extractionStatus: "processed"
    });
    expect(outcome.structuredContent).toMatchObject({
      eventId: "event-1",
      extractionStatus: "processed"
    });

    expect(upstream.prepareCodingContext).toHaveBeenCalledWith({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        repositoryId: "repository-1",
        path: "src/api/server.ts"
      },
      query: "Where is auth middleware?",
      recencyDays: undefined
    });
    expect(upstream.recordCodingIntent).toHaveBeenCalledWith({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        repositoryId: "repository-1",
        path: "scripts/demo.py"
      },
      artifact: {
        artifactType: "coding_intent",
        task: "Print ahhh",
        rationale: "because the sky is blue",
        constraints: ["single print statement"]
      },
      idempotencyKey: "mcp-intent-1"
    });
    expect(upstream.recordCodingOutcome).toHaveBeenCalledWith({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: {
        workspaceId: "workspace-1",
        projectId: "project-1",
        repositoryId: "repository-1",
        path: "src/api/server.ts"
      },
      artifact: {
        artifactType: "prompt_response",
        query: "Where is auth middleware?",
        answer: "It lives in src/api/server.ts."
      },
      idempotencyKey: "mcp-1"
    });

    await Promise.all([client.close(), server.close()]);
  });

  it("emits diagnostic logs for tool calls", async () => {
    const upstream = {
      prepareCodingContext: vi.fn().mockResolvedValue({
        memoryRecords: [],
        contextBlock: "Use src/api/server.ts for auth middleware context.",
        trace: {
          candidateCount: 3,
          selectedCount: 1,
          queryEmbeddingDimensions: 12,
          selectedMatches: []
        }
      }),
      recordCodingIntent: vi.fn(),
      recordCodingOutcome: vi.fn()
    };
    const logger = {
      log: vi.fn()
    };

    const server = createCodingMcpServer({
      client: upstream,
      defaults: {
        tenantId: "tenant-alpha",
        actorId: "actor-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        repositoryId: "repository-1"
      },
      logger
    });
    const client = new Client({
      name: "mcp-test-client",
      version: "1.0.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({
      name: "prepare_coding_context",
      arguments: {
        query: "Where is auth middleware?",
        path: "src/api/server.ts"
      }
    });

    expect(logger.log).toHaveBeenCalledWith(
      "mcp_server_created",
      expect.objectContaining({
        defaults: expect.objectContaining({
          tenantId: "tenant-alpha"
        })
      })
    );
    expect(logger.log).toHaveBeenCalledWith(
      "tool_call_started",
      expect.objectContaining({
        toolName: "prepare_coding_context"
      })
    );
    expect(logger.log).toHaveBeenCalledWith(
      "tool_call_succeeded",
      expect.objectContaining({
        toolName: "prepare_coding_context",
        result: expect.objectContaining({
          kind: "retrieve",
          selectedCount: 1
        })
      })
    );

    await Promise.all([client.close(), server.close()]);
  });
});
