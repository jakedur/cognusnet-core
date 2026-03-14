import { describe, expect, it } from "vitest";

import { CodingMcpAdapter, CognusNetClient, coreManifest, loadConfig } from "../../src/public";

describe("public api", () => {
  it("exposes a safe package entrypoint for consumers", () => {
    expect(coreManifest.repoRole).toBe("core");
    expect(coreManifest.endpoints).toContain("/v1/memory/retrieve");
    expect(coreManifest.capabilities).toContain("mcp_coding_tools");

    const client = new CognusNetClient({
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "test-api-key",
      fetchImpl: fetch
    });

    expect(client).toBeInstanceOf(CognusNetClient);
    expect(new CodingMcpAdapter(client, { tenantId: "tenant-alpha", actorId: "actor-1" })).toBeInstanceOf(CodingMcpAdapter);
    expect(loadConfig({}).port).toBe(3000);
  });
});
