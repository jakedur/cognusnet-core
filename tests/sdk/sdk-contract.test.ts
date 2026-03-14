import { describe, expect, it, vi } from "vitest";

import { CognusNetClient } from "../../src/sdk/client";

describe("CognusNetClient", () => {
  it("sends the API key and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        memoryRecords: [],
        contextBlock: "No prior memory found.",
        trace: { candidateCount: 0, selectedCount: 0, queryEmbeddingDimensions: 12, selectedMatches: [] }
      })
    });

    const client = new CognusNetClient({
      baseUrl: "http://localhost:3000",
      apiKey: "test-api-key",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const response = await client.retrieveMemory({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: { workspaceId: "w1" },
      query: "auth middleware",
      interactionMode: "coding"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/v1/memory/retrieve",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "test-api-key"
        })
      })
    );
    expect(response.contextBlock).toContain("No prior memory found");
  });

  it("supports review list and decision requests", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reviewItems: [{ id: "review-1", status: "pending" }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reviewItem: { id: "review-1", status: "accepted" }, promotedMemoryId: "memory-1" })
      });

    const client = new CognusNetClient({
      baseUrl: "http://localhost:3000",
      apiKey: "test-api-key",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const list = await client.listReviewItems({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" }
    });
    const decision = await client.decideReviewItem({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1" },
      reviewId: "review-1",
      action: "accept"
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/v1/review/items?tenantId=tenant-alpha&actorId=actor-1&workspaceId=w1&projectId=p1&repositoryId=r1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-api-key": "test-api-key"
        })
      })
    );
    expect(list.reviewItems[0]?.id).toBe("review-1");
    expect(decision.promotedMemoryId).toBe("memory-1");
  });

  it("supports coding prepare and coding outcome helpers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          memoryRecords: [],
          contextBlock: "No prior memory found.",
          trace: { candidateCount: 0, selectedCount: 0, queryEmbeddingDimensions: 12, selectedMatches: [] }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eventId: "event-1", extractionStatus: "processed", acceptedCount: 1, queuedCount: 0 })
      });

    const client = new CognusNetClient({
      baseUrl: "http://localhost:3000",
      apiKey: "test-api-key",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await client.prepareCodingContext({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      query: "Where is the auth middleware?"
    });
    await client.recordCodingOutcome({
      tenantId: "tenant-alpha",
      actorId: "actor-1",
      scopes: { workspaceId: "w1", projectId: "p1", repositoryId: "r1", path: "src/api/server.ts" },
      artifact: {
        artifactType: "prompt_response",
        query: "Where is the auth middleware?",
        answer: "It lives in src/api/server.ts."
      },
      idempotencyKey: "coding-1"
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/v1/memory/write",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-api-key"
        })
      })
    );
    const secondRequest = fetchImpl.mock.calls[1]?.[1];
    expect(secondRequest).toBeDefined();
    const parsedBody = JSON.parse((secondRequest as { body: string }).body);
    expect(parsedBody.scopes.path).toBe("src/api/server.ts");
    expect(parsedBody.artifactPayload).toEqual({
      query: "Where is the auth middleware?",
      answer: "It lives in src/api/server.ts."
    });
  });
});
