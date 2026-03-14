import type {
  ApiKeyRecord,
  AuditLogEntry,
  MemoryRecord,
  RawEvent,
  ReviewItem,
  Scope
} from "../../domain/types";
import { ScopeResolver } from "../../modules/tenancy/scope";
import type { Repositories } from "../../ports/repositories";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryStore implements Repositories {
  private readonly scopeResolver = new ScopeResolver();
  private readonly apiKeyRows = new Map<string, ApiKeyRecord>();
  private readonly rawEventRows = new Map<string, RawEvent>();
  private readonly memoryRows = new Map<string, MemoryRecord>();
  private readonly reviewRows = new Map<string, ReviewItem>();
  private readonly auditRows: AuditLogEntry[] = [];

  apiKeys = {
    findByKey: async (key: string): Promise<ApiKeyRecord | null> => {
      const record = this.apiKeyRows.get(key);
      return record ? clone(record) : null;
    }
  };

  rawEvents = {
    findById: async (id: string): Promise<RawEvent | null> => {
      const event = this.rawEventRows.get(id);
      return event ? clone(event) : null;
    },
    findByIdempotencyKey: async (tenantId: string, idempotencyKey: string): Promise<RawEvent | null> => {
      for (const event of this.rawEventRows.values()) {
        if (event.tenantId === tenantId && event.idempotencyKey === idempotencyKey) {
          return clone(event);
        }
      }

      return null;
    },
    save: async (event: RawEvent): Promise<void> => {
      this.rawEventRows.set(event.id, clone(event));
    }
  };

  memories = {
    save: async (memory: MemoryRecord): Promise<void> => {
      this.memoryRows.set(memory.id, clone(memory));
    },
    update: async (memory: MemoryRecord): Promise<void> => {
      this.memoryRows.set(memory.id, clone(memory));
    },
    findById: async (id: string): Promise<MemoryRecord | null> => {
      const record = this.memoryRows.get(id);
      return record ? clone(record) : null;
    },
    listByTenant: async (tenantId: string): Promise<MemoryRecord[]> => {
      return [...this.memoryRows.values()]
        .filter((memory) => memory.tenantId === tenantId)
        .map((memory) => clone(memory));
    },
    findDuplicate: async (input: {
      tenantId: string;
      scopes: Scope;
      type: MemoryRecord["type"];
      title: string;
    }): Promise<MemoryRecord | null> => {
      for (const memory of this.memoryRows.values()) {
        if (
          memory.tenantId === input.tenantId &&
          memory.type === input.type &&
          memory.title === input.title &&
          this.scopeResolver.scopeKey(memory.scopes) === this.scopeResolver.scopeKey(input.scopes)
        ) {
          return clone(memory);
        }
      }

      return null;
    }
  };

  reviews = {
    enqueue: async (item: ReviewItem): Promise<void> => {
      this.reviewRows.set(item.id, clone(item));
    },
    listPending: async (tenantId?: string): Promise<ReviewItem[]> => {
      return [...this.reviewRows.values()]
        .filter((item) => item.status === "pending" && (!tenantId || item.tenantId === tenantId))
        .map((item) => clone(item));
    },
    findById: async (id: string): Promise<ReviewItem | null> => {
      const record = this.reviewRows.get(id);
      return record ? clone(record) : null;
    },
    update: async (item: ReviewItem): Promise<void> => {
      this.reviewRows.set(item.id, clone(item));
    }
  };

  audits = {
    save: async (entry: AuditLogEntry): Promise<void> => {
      this.auditRows.push(clone(entry));
    },
    listRecent: async (tenantId: string, limit = 25): Promise<AuditLogEntry[]> => {
      return this.auditRows
        .filter((entry) => entry.tenantId === tenantId)
        .slice(-limit)
        .reverse()
        .map((entry) => clone(entry));
    }
  };

  seedApiKey(record: ApiKeyRecord): void {
    this.apiKeyRows.set(record.key, clone(record));
  }

  seedMemory(record: MemoryRecord): void {
    this.memoryRows.set(record.id, clone(record));
  }

  snapshot() {
    return {
      rawEvents: [...this.rawEventRows.values()].map((value) => clone(value)),
      memories: [...this.memoryRows.values()].map((value) => clone(value)),
      reviews: [...this.reviewRows.values()].map((value) => clone(value)),
      audits: this.auditRows.map((value) => clone(value))
    };
  }
}
