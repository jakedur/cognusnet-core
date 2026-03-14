import type {
  ApiKeyRecord,
  AuditLogEntry,
  MemoryRecord,
  RawEvent,
  ReviewItem,
  Scope
} from "../domain/types";

export interface ApiKeyRepository {
  findByKey(key: string): Promise<ApiKeyRecord | null>;
}

export interface RawEventRepository {
  findById(id: string): Promise<RawEvent | null>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<RawEvent | null>;
  save(event: RawEvent): Promise<void>;
}

export interface MemoryRepository {
  save(memory: MemoryRecord): Promise<void>;
  update(memory: MemoryRecord): Promise<void>;
  findById(id: string): Promise<MemoryRecord | null>;
  listByTenant(tenantId: string): Promise<MemoryRecord[]>;
  findDuplicate(input: {
    tenantId: string;
    scopes: Scope;
    type: MemoryRecord["type"];
    title: string;
  }): Promise<MemoryRecord | null>;
}

export interface ReviewQueueRepository {
  enqueue(item: ReviewItem): Promise<void>;
  listPending(tenantId?: string): Promise<ReviewItem[]>;
  findById(id: string): Promise<ReviewItem | null>;
  update(item: ReviewItem): Promise<void>;
}

export interface AuditRepository {
  save(entry: AuditLogEntry): Promise<void>;
  listRecent(tenantId: string, limit?: number): Promise<AuditLogEntry[]>;
}

export interface Repositories {
  apiKeys: ApiKeyRepository;
  rawEvents: RawEventRepository;
  memories: MemoryRepository;
  reviews: ReviewQueueRepository;
  audits: AuditRepository;
}
