import { randomUUID } from "node:crypto";

import type { AuditLogEntry } from "../../domain/types";
import type { AuditRepository } from "../../ports/repositories";

export class AuditService {
  constructor(private readonly audits: AuditRepository) {}

  async record(input: Omit<AuditLogEntry, "id" | "createdAt">): Promise<void> {
    await this.audits.save({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    });
  }

  async listRecent(tenantId: string, limit = 25): Promise<AuditLogEntry[]> {
    return this.audits.listRecent(tenantId, limit);
  }
}
