import type { MemoryRecord, RetrievedMemory, RetrieveMemoryRequest } from "../../domain/types";
import { cosineSimilarity } from "../embeddings/provider";
import { ScopeResolver } from "../tenancy/scope";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [];
}

export function lexicalScore(query: string, candidate: string): number {
  const queryTokens = new Set(tokenize(query));
  const candidateTokens = tokenize(candidate);

  if (queryTokens.size === 0 || candidateTokens.length === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.size;
}

export function rankMemories(input: {
  request: RetrieveMemoryRequest;
  queryEmbedding: number[];
  candidates: MemoryRecord[];
  scopeResolver: ScopeResolver;
}): RetrievedMemory[] {
  const { request, queryEmbedding, candidates, scopeResolver } = input;

  return candidates
    .map((memory) => {
      const scopeDistance = scopeResolver.scopeDistance(request.scopes, memory.scopes);
      if (!Number.isFinite(scopeDistance) || memory.status !== "active" || memory.stale) {
        return null;
      }

      const pathMatch = scopeResolver.describePathMatch(request.scopes, memory.scopes);
      const lexical = lexicalScore(request.query, `${memory.scopes.path ?? ""}\n${memory.title}\n${memory.content}`);
      const semantic = cosineSimilarity(queryEmbedding, memory.embedding);
      const scopeWeight = Math.max(0, 1 - scopeDistance * 0.18);
      const pathBonus = pathMatchScore(request.interactionMode, pathMatch);
      const typeBonus = typeScore(request.interactionMode, memory.type);
      const score =
        lexical * 0.38 +
        semantic * 0.2 +
        Math.max(memory.confidence, 0.1) * 0.14 +
        Math.max(memory.freshness, 0.1) * 0.1 +
        scopeWeight * 0.06 +
        pathBonus +
        typeBonus +
        (memory.pinned ? 0.12 : 0);

      return {
        memory,
        score: Number(score.toFixed(6)),
        lexicalScore: Number(lexical.toFixed(6)),
        semanticScore: Number(semantic.toFixed(6)),
        scopeDistance,
        pathMatch,
        updatedAtMs: new Date(memory.updatedAt).getTime()
      };
    })
    .filter((item): item is RetrievedMemory & {
      pathMatch: ReturnType<ScopeResolver["describePathMatch"]>;
      updatedAtMs: number;
    } => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const pathPriorityDelta = pathPriority(left.pathMatch) - pathPriority(right.pathMatch);
      if (pathPriorityDelta !== 0) {
        return pathPriorityDelta;
      }

      if (right.updatedAtMs !== left.updatedAtMs) {
        return right.updatedAtMs - left.updatedAtMs;
      }

      return left.scopeDistance - right.scopeDistance;
    })
    .map(({ memory, score, lexicalScore, semanticScore, scopeDistance }) => ({
      memory,
      score,
      lexicalScore,
      semanticScore,
      scopeDistance
    }));
}

function pathMatchScore(
  interactionMode: RetrieveMemoryRequest["interactionMode"],
  pathMatch: ReturnType<ScopeResolver["describePathMatch"]>
): number {
  if (interactionMode !== "coding") {
    switch (pathMatch) {
      case "exact":
        return 0.08;
      case "ancestor":
        return 0.04;
      case "repository":
        return 0.01;
      case "broader":
        return -0.02;
      case "none":
        return 0;
    }
  }

  switch (pathMatch) {
    case "exact":
      return 0.28;
    case "ancestor":
      return 0.14;
    case "repository":
      return 0.04;
    case "broader":
      return -0.04;
    case "none":
      return 0;
  }
}

function typeScore(
  interactionMode: RetrieveMemoryRequest["interactionMode"],
  memoryType: MemoryRecord["type"]
): number {
  if (interactionMode !== "coding") {
    return 0;
  }

  switch (memoryType) {
    case "fact":
      return 0.08;
    case "decision":
      return 0.05;
    case "code_pattern":
      return 0.05;
    case "document_summary":
      return 0.02;
    case "operational_note":
      return 0.01;
    case "conversation_summary":
      return -0.08;
  }
}

function pathPriority(pathMatch: ReturnType<ScopeResolver["describePathMatch"]>): number {
  switch (pathMatch) {
    case "exact":
      return 0;
    case "ancestor":
      return 1;
    case "repository":
      return 2;
    case "broader":
      return 3;
    case "none":
      return 4;
  }
}
