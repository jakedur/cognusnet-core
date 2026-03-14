import { randomUUID } from "node:crypto";

import { createApp } from "../../src/app";
import { InMemoryStore } from "../../src/infra/testing/in-memory-store";

export function createTestContext() {
  const store = new InMemoryStore();
  const tenantId = "tenant-alpha";
  const apiKey = "test-api-key";
  const actorId = "actor-1";

  store.seedApiKey({
    id: randomUUID(),
    tenantId,
    name: "Test Key",
    key: apiKey,
    role: "tenant_admin",
    createdAt: new Date().toISOString()
  });

  return {
    store,
    tenantId,
    actorId,
    apiKey,
    app: createApp({ repositories: store })
  };
}
