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
});
