import type { AuthenticatedActor, RetrievedMemory, RetrieveMemoryRequest, RetrieveMemoryResponse } from "../../domain/types";
import type { MemoryRepository } from "../../ports/repositories";
import type { EmbeddingProvider } from "../embeddings/provider";
import { AuditService } from "../audit/service";
import { rankMemories } from "./ranker";
import { ScopeResolver } from "../tenancy/scope";

export class RetrievalService {
  constructor(
    private readonly memories: MemoryRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly audits: AuditService,
    private readonly scopeResolver: ScopeResolver
  ) {}

  async retrieve(request: RetrieveMemoryRequest, actor: AuthenticatedActor): Promise<RetrieveMemoryResponse> {
    const normalizedScopes = this.scopeResolver.normalizeScope(request.scopes);
    this.scopeResolver.ensureScoped(normalizedScopes);
    const memoryTypes = request.memoryTypes ?? defaultMemoryTypes(request.interactionMode);
    const normalizedRequest: RetrieveMemoryRequest = {
      ...request,
      scopes: normalizedScopes,
      memoryTypes
    };
    const queryEmbedding = await this.embeddings.embed(normalizedRequest.query);
    const tenantMemories = await this.memories.listByTenant(normalizedRequest.tenantId);

    const filtered = tenantMemories.filter((memory) => {
      if (normalizedRequest.memoryTypes && !normalizedRequest.memoryTypes.includes(memory.type)) {
        return false;
      }

      if (!this.scopeResolver.isAccessible(normalizedRequest.scopes, memory.scopes)) {
        return false;
      }

      if (normalizedRequest.recencyDays) {
        const ageInDays = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays > normalizedRequest.recencyDays) {
          return false;
        }
      }

      return true;
    });

    const ranked = dedupeRankedMemories(rankMemories({
      request: normalizedRequest,
      queryEmbedding,
      candidates: filtered,
      scopeResolver: this.scopeResolver
    }), normalizedRequest).slice(0, 8);

    await this.audits.record({
      tenantId: normalizedRequest.tenantId,
      actorId: normalizedRequest.actorId,
      action: "memory.retrieve",
      resourceType: "memory_query",
      resourceId: normalizedRequest.query,
      metadata: {
        apiKeyId: actor.apiKeyId,
        candidateCount: filtered.length,
        selectedCount: ranked.length
      }
    });

    return {
      memoryRecords: ranked,
      contextBlock: ranked.length
        ? ranked
            .map((item) => formatContextItem(item, normalizedRequest, this.scopeResolver))
            .join("\n\n")
        : "No prior memory found.",
      trace: {
        candidateCount: filtered.length,
        selectedCount: ranked.length,
        queryEmbeddingDimensions: queryEmbedding.length,
        selectedMatches: ranked.map((item) => ({
          memoryId: item.memory.id,
          scopeKey: this.scopeResolver.scopeKey(item.memory.scopes),
          scopeDistance: item.scopeDistance,
          pathMatch: this.scopeResolver.describePathMatch(normalizedRequest.scopes, item.memory.scopes)
        }))
      }
    };
  }
}

function defaultMemoryTypes(
  interactionMode: RetrieveMemoryRequest["interactionMode"]
): RetrieveMemoryRequest["memoryTypes"] | undefined {
  if (interactionMode !== "coding") {
    return undefined;
  }

  return ["fact", "decision", "code_pattern", "document_summary", "operational_note"];
}

function dedupeRankedMemories(
  items: RetrievedMemory[],
  request: RetrieveMemoryRequest
): RetrievedMemory[] {
  if (request.interactionMode !== "coding") {
    return items;
  }

  const seenMergeKeys = new Set<string>();
  const deduped: RetrievedMemory[] = [];
  const latestByMergeKey = new Map<string, RetrievedMemory>();

  for (const item of items) {
    const mergeKey = typeof item.memory.attributes.mergeKey === "string"
      ? item.memory.attributes.mergeKey
      : undefined;

    if (!mergeKey) {
      continue;
    }

    const existing = latestByMergeKey.get(mergeKey);
    if (!existing || isNewerMemory(item, existing)) {
      latestByMergeKey.set(mergeKey, item);
    }
  }

  for (const item of items) {
    const mergeKey = typeof item.memory.attributes.mergeKey === "string"
      ? item.memory.attributes.mergeKey
      : undefined;

    if (mergeKey) {
      if (latestByMergeKey.get(mergeKey)?.memory.id !== item.memory.id) {
        continue;
      }
      if (seenMergeKeys.has(mergeKey)) {
        continue;
      }
      seenMergeKeys.add(mergeKey);
    }

    deduped.push(item);
  }

  return deduped;
}

function isNewerMemory(left: RetrievedMemory, right: RetrievedMemory): boolean {
  const leftCapturedAt = latestCapturedAtMs(left);
  const rightCapturedAt = latestCapturedAtMs(right);

  if (Number.isFinite(leftCapturedAt) && Number.isFinite(rightCapturedAt) && leftCapturedAt !== rightCapturedAt) {
    return leftCapturedAt > rightCapturedAt;
  }

  const leftUpdatedAt = Date.parse(left.memory.updatedAt);
  const rightUpdatedAt = Date.parse(right.memory.updatedAt);

  if (Number.isFinite(leftUpdatedAt) && Number.isFinite(rightUpdatedAt) && leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt > rightUpdatedAt;
  }

  return left.score > right.score;
}

function latestCapturedAtMs(item: RetrievedMemory): number {
  let latest = Number.NaN;

  for (const source of item.memory.sources) {
    const capturedAt = Date.parse(source.capturedAt);
    if (Number.isFinite(capturedAt) && (!Number.isFinite(latest) || capturedAt > latest)) {
      latest = capturedAt;
    }
  }

  return latest;
}

function formatContextItem(
  item: RetrievedMemory,
  request: RetrieveMemoryRequest,
  scopeResolver: ScopeResolver
): string {
  const pathMatch = scopeResolver.describePathMatch(request.scopes, item.memory.scopes);
  const lines = [`Path match: ${pathMatch}`];

  if (item.memory.scopes.path) {
    lines.push(`${pathLabel(pathMatch)}: ${item.memory.scopes.path}`);
  }

  lines.push(`Type: ${item.memory.type}`);
  lines.push(`Title: ${item.memory.title}`);
  lines.push(`Content: ${item.memory.content}`);
  return lines.join("\n");
}

function pathLabel(pathMatch: ReturnType<ScopeResolver["describePathMatch"]>): string {
  switch (pathMatch) {
    case "exact":
      return "Exact path";
    case "ancestor":
      return "Ancestor path";
    case "broader":
      return "Broader path";
    case "repository":
    case "none":
      return "Path";
  }
}
