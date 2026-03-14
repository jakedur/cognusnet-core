import { afterEach, describe, expect, it } from "vitest";

import { createTestContext } from "../helpers/test-context";

describe("tenant security", () => {
  let app: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("rejects mismatched tenant requests", async () => {
    const testContext = createTestContext();
    app = testContext.app;

    const response = await testContext.app.inject({
      method: "POST",
      url: "/v1/memory/retrieve",
      headers: { "x-api-key": testContext.apiKey },
      payload: {
        tenantId: "tenant-other",
        actorId: testContext.actorId,
        scopes: { workspaceId: "w1" },
        query: "auth middleware",
        interactionMode: "coding"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toContain("Tenant mismatch");
  });
});
