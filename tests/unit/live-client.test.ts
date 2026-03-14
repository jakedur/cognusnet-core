import { describe, expect, it, vi } from "vitest";

import { loadLiveClientConfig, runLiveClient } from "../../src/scripts/live-client";

describe("loadLiveClientConfig", () => {
  it("uses seeded defaults for local development", () => {
    const config = loadLiveClientConfig({});
    expect(config.baseUrl).toBe("http://127.0.0.1:3000");
    expect(config.apiKey).toBe("test-api-key");
    expect(config.tenantId).toBe("tenant-alpha");
    expect(config.scopes.repositoryId).toBe("repository-1");
  });
});

describe("runLiveClient", () => {
  it("formats retrieve requests through the SDK transport", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        memoryRecords: [],
        contextBlock: "No prior memory found.",
        trace: {
          candidateCount: 0,
          selectedCount: 0,
          queryEmbeddingDimensions: 12,
          selectedMatches: []
        }
      })
    });

    const output = await runLiveClient(["retrieve", "--query", "auth middleware"], {}, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/v1/memory/retrieve");
    expect(output).toContain("No prior memory found.");
  });

  it("prints usage for unknown commands", async () => {
    const output = await runLiveClient(["unknown"]);
    expect(output).toContain("CognusNet live client");
    expect(output).toContain("npm run client -- retrieve");
  });
});
