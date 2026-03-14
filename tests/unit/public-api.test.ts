import { describe, expect, it } from "vitest";

import { CognusNetClient, coreManifest, loadConfig } from "../../src/public";

describe("public api", () => {
  it("exposes a safe package entrypoint for consumers", () => {
    expect(coreManifest.repoRole).toBe("core");
    expect(coreManifest.endpoints).toContain("/v1/memory/retrieve");

    const client = new CognusNetClient({
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "test-api-key",
      fetchImpl: fetch
    });

    expect(client).toBeInstanceOf(CognusNetClient);
    expect(loadConfig({}).port).toBe(3000);
  });
});
