import { describe, expect, it, vi } from "vitest";

import { CognusNetClient } from "../../src/sdk/client";

describe("CognusNetClient", () => {
  it("sends the API key and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memoryRecords: [], contextBlock: "No prior memory found.", trace: { candidateCount: 0, selectedCount: 0, queryEmbeddingDimensions: 12 } })
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
});
