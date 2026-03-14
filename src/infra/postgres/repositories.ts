import { Pool } from "pg";

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

function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function toScopeColumns(scope: Scope): Array<string | null> {
  return [scope.workspaceId ?? null, scope.projectId ?? null, scope.repositoryId ?? null, scope.userPrivateId ?? null];
}

function rowToScope(row: Record<string, unknown>): Scope {
  return {
    workspaceId: (row.workspace_id as string | null) ?? undefined,
    projectId: (row.project_id as string | null) ?? undefined,
    repositoryId: (row.repository_id as string | null) ?? undefined,
    userPrivateId: (row.user_private_id as string | null) ?? undefined
  };
}

export class PostgresRepositories implements Repositories {
  private readonly scopeResolver = new ScopeResolver();

  constructor(private readonly pool: Pool) {}

  apiKeys = {
    findByKey: async (key: string): Promise<ApiKeyRecord | null> => {
      const result = await this.pool.query(
        `SELECT id, tenant_id, name, key_hash AS key, role, created_at
         FROM api_keys
         WHERE key_hash = $1`,
        [key]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        key: row.key,
        role: row.role,
        createdAt: row.created_at.toISOString()
      };
    }
  };

  rawEvents = {
    findById: async (id: string): Promise<RawEvent | null> => {
      const result = await this.pool.query(`SELECT * FROM raw_events WHERE id = $1`, [id]);
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        tenantId: row.tenant_id,
        scopes: rowToScope(row),
        actorId: row.actor_id,
        artifactType: row.artifact_type,
        artifactPayload: row.artifact_payload,
        normalizedText: row.normalized_text,
        provenance: row.provenance,
        idempotencyKey: row.idempotency_key ?? undefined,
        createdAt: row.created_at.toISOString()
      };
    },
    findByIdempotencyKey: async (tenantId: string, idempotencyKey: string): Promise<RawEvent | null> => {
      const result = await this.pool.query(`SELECT * FROM raw_events WHERE tenant_id = $1 AND idempotency_key = $2`, [
        tenantId,
        idempotencyKey
      ]);
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        tenantId: row.tenant_id,
        scopes: rowToScope(row),
        actorId: row.actor_id,
        artifactType: row.artifact_type,
        artifactPayload: row.artifact_payload,
        normalizedText: row.normalized_text,
        provenance: row.provenance,
        idempotencyKey: row.idempotency_key ?? undefined,
        createdAt: row.created_at.toISOString()
      };
    },
    save: async (event: RawEvent): Promise<void> => {
      await this.pool.query(
        `INSERT INTO raw_events (
          id, tenant_id, actor_id, workspace_id, project_id, repository_id, user_private_id,
          artifact_type, artifact_payload, normalized_text, provenance, idempotency_key, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9::jsonb, $10, $11::jsonb, $12, $13
        )`,
        [
          event.id,
          event.tenantId,
          event.actorId,
          ...toScopeColumns(event.scopes),
          event.artifactType,
          JSON.stringify(event.artifactPayload),
          event.normalizedText,
          JSON.stringify(event.provenance),
          event.idempotencyKey ?? null,
          event.createdAt
        ]
      );
    }
  };

  memories = {
    save: async (memory: MemoryRecord): Promise<void> => {
      await this.pool.query(
        `INSERT INTO memory_records (
          id, tenant_id, actor_id, workspace_id, project_id, repository_id, user_private_id,
          memory_type, title, content, attributes, confidence, freshness, pinned, stale, status,
          embedding, source_ids, sources, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16,
          $17::vector, $18, $19::jsonb, $20, $21
        )`,
        [
          memory.id,
          memory.tenantId,
          memory.actorId,
          ...toScopeColumns(memory.scopes),
          memory.type,
          memory.title,
          memory.content,
          JSON.stringify(memory.attributes),
          memory.confidence,
          memory.freshness,
          memory.pinned,
          memory.stale,
          memory.status,
          toPgVector(memory.embedding),
          memory.sourceIds,
          JSON.stringify(memory.sources),
          memory.createdAt,
          memory.updatedAt
        ]
      );
    },
    update: async (memory: MemoryRecord): Promise<void> => {
      await this.pool.query(
        `UPDATE memory_records
         SET title = $2,
             content = $3,
             attributes = $4::jsonb,
             confidence = $5,
             freshness = $6,
             pinned = $7,
             stale = $8,
             status = $9,
             embedding = $10::vector,
             source_ids = $11,
             sources = $12::jsonb,
             updated_at = $13
         WHERE id = $1`,
        [
          memory.id,
          memory.title,
          memory.content,
          JSON.stringify(memory.attributes),
          memory.confidence,
          memory.freshness,
          memory.pinned,
          memory.stale,
          memory.status,
          toPgVector(memory.embedding),
          memory.sourceIds,
          JSON.stringify(memory.sources),
          memory.updatedAt
        ]
      );
    },
    findById: async (id: string): Promise<MemoryRecord | null> => {
      const result = await this.pool.query(`SELECT * FROM memory_records WHERE id = $1`, [id]);
      return this.mapMemory(result.rows[0]);
    },
    listByTenant: async (tenantId: string): Promise<MemoryRecord[]> => {
      const result = await this.pool.query(`SELECT * FROM memory_records WHERE tenant_id = $1`, [tenantId]);
      return result.rows
        .map((row: Record<string, unknown>) => this.mapMemory(row))
        .filter((row): row is MemoryRecord => row !== null);
    },
    findDuplicate: async (input: {
      tenantId: string;
      scopes: Scope;
      type: MemoryRecord["type"];
      title: string;
    }): Promise<MemoryRecord | null> => {
      const result = await this.pool.query(
        `SELECT * FROM memory_records WHERE tenant_id = $1 AND memory_type = $2 AND title = $3`,
        [input.tenantId, input.type, input.title]
      );

      for (const row of result.rows) {
        const memory = this.mapMemory(row);
        if (memory && this.scopeResolver.scopeKey(memory.scopes) === this.scopeResolver.scopeKey(input.scopes)) {
          return memory;
        }
      }

      return null;
    }
  };

  reviews = {
    enqueue: async (item: ReviewItem): Promise<void> => {
      await this.pool.query(
        `INSERT INTO review_queue (
          id, tenant_id, event_id, workspace_id, project_id, repository_id, user_private_id,
          candidate, reason, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::jsonb, $9, $10, $11, $12
        )`,
        [
          item.id,
          item.tenantId,
          item.eventId,
          ...toScopeColumns(item.scopes),
          JSON.stringify(item.candidate),
          item.reason,
          item.status,
          item.createdAt,
          item.updatedAt
        ]
      );
    },
    listPending: async (tenantId?: string): Promise<ReviewItem[]> => {
      const result = tenantId
        ? await this.pool.query(`SELECT * FROM review_queue WHERE tenant_id = $1 AND status = 'pending'`, [tenantId])
        : await this.pool.query(`SELECT * FROM review_queue WHERE status = 'pending'`);

      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        tenantId: row.tenant_id as string,
        scopes: rowToScope(row),
        eventId: row.event_id as string,
        candidate: row.candidate as ReviewItem["candidate"],
        reason: row.reason as string,
        status: row.status as ReviewItem["status"],
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: (row.updated_at as Date).toISOString()
      }));
    },
    findById: async (id: string): Promise<ReviewItem | null> => {
      const result = await this.pool.query(`SELECT * FROM review_queue WHERE id = $1`, [id]);
      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id as string,
        tenantId: row.tenant_id as string,
        scopes: rowToScope(row),
        eventId: row.event_id as string,
        candidate: row.candidate as ReviewItem["candidate"],
        reason: row.reason as string,
        status: row.status as ReviewItem["status"],
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: (row.updated_at as Date).toISOString()
      };
    },
    update: async (item: ReviewItem): Promise<void> => {
      await this.pool.query(
        `UPDATE review_queue SET candidate = $2::jsonb, reason = $3, status = $4, updated_at = $5 WHERE id = $1`,
        [item.id, JSON.stringify(item.candidate), item.reason, item.status, item.updatedAt]
      );
    }
  };

  audits = {
    save: async (entry: AuditLogEntry): Promise<void> => {
      await this.pool.query(
        `INSERT INTO audit_logs (
          id, tenant_id, actor_id, action, resource_type, resource_id, metadata, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8
        )`,
        [
          entry.id,
          entry.tenantId,
          entry.actorId,
          entry.action,
          entry.resourceType,
          entry.resourceId,
          JSON.stringify(entry.metadata),
          entry.createdAt
        ]
      );
    },
    listRecent: async (tenantId: string, limit = 25): Promise<AuditLogEntry[]> => {
      const result = await this.pool.query(
        `SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [tenantId, limit]
      );
      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        tenantId: row.tenant_id as string,
        actorId: row.actor_id as string,
        action: row.action as string,
        resourceType: row.resource_type as string,
        resourceId: row.resource_id as string,
        metadata: row.metadata as AuditLogEntry["metadata"],
        createdAt: (row.created_at as Date).toISOString()
      }));
    }
  };

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapMemory(row: Record<string, unknown> | undefined): MemoryRecord | null {
    if (!row) {
      return null;
    }

    const embeddingValue = row.embedding;
    const embedding =
      typeof embeddingValue === "string"
        ? embeddingValue
            .replace("[", "")
            .replace("]", "")
            .split(",")
            .filter(Boolean)
            .map((value) => Number(value))
        : [];

    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      scopes: rowToScope(row),
      actorId: row.actor_id as string,
      type: row.memory_type as MemoryRecord["type"],
      title: row.title as string,
      content: row.content as string,
      attributes: row.attributes as Record<string, unknown>,
      confidence: Number(row.confidence),
      freshness: Number(row.freshness),
      pinned: Boolean(row.pinned),
      stale: Boolean(row.stale),
      status: row.status as MemoryRecord["status"],
      sourceIds: (row.source_ids as string[]) ?? [],
      sources: (row.sources as MemoryRecord["sources"]) ?? [],
      embedding,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString()
    };
  }
}
