import { describe, expect, it, vi } from "vitest";

import { CodingMcpAdapter } from "../../src/mcp/coding";

describe("CodingMcpAdapter", () => {
  it("lists coding tools and routes calls through the client helpers", async () => {
    const client = {
      prepareCodingContext: vi.fn().mockResolvedValue({
        memoryRecords: [],
        contextBlock: "No prior memory found.",
        trace: { candidateCount: 0, selectedCount: 0, queryEmbeddingDimensions: 12, selectedMatches: [] }
      }),
      recordCodingOutcome: vi.fn().mockResolvedValue({
        eventId: "event-1",
        extractionStatus: "processed",
        acceptedCount: 1,
        queuedCount: 0
      })
    };

    const adapter = new CodingMcpAdapter(client, {
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      workspaceId: "w1",
      projectId: "p1",
      repositoryId: "r1"
    });

    expect(adapter.listTools().map((tool) => tool.name)).toEqual(["prepare_coding_context", "record_coding_outcome"]);

    await adapter.callTool("prepare_coding_context", {
      query: "Where is the auth middleware?",
      path: "src/api/server.ts"
    });
    await adapter.callTool("record_coding_outcome", {
      artifactType: "prompt_response",
      query: "Where is the auth middleware?",
      answer: "It lives in src/api/server.ts.",
      path: "src/api/server.ts",
      idempotencyKey: "mcp-1"
    });

    expect(client.prepareCodingContext).toHaveBeenCalledWith({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: {
        workspaceId: "w1",
        projectId: "p1",
        repositoryId: "r1",
        path: "src/api/server.ts"
      },
      query: "Where is the auth middleware?",
      recencyDays: undefined
    });
    expect(client.recordCodingOutcome).toHaveBeenCalledWith({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: {
        workspaceId: "w1",
        projectId: "p1",
        repositoryId: "r1",
        path: "src/api/server.ts"
      },
      artifact: {
        artifactType: "prompt_response",
        query: "Where is the auth middleware?",
        answer: "It lives in src/api/server.ts."
      },
      idempotencyKey: "mcp-1"
    });
  });
});
