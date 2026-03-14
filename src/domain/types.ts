export type MemoryType =
  | "fact"
  | "decision"
  | "code_pattern"
  | "document_summary"
  | "conversation_summary"
  | "operational_note";

export type ArtifactType =
  | "conversation"
  | "prompt_response"
  | "tool_output"
  | "code_snippet"
  | "code_diff"
  | "documentation"
  | "user_feedback";

export type FeedbackAction = "keep" | "edit" | "forget" | "pin" | "mark_stale";
export type ReviewStatus = "pending" | "accepted" | "rejected";
export type ReviewDecisionAction = "accept" | "reject" | "edit_and_accept";
export type ApiKeyRole = "tenant_admin" | "service";

export interface Scope {
  workspaceId?: string;
  projectId?: string;
  repositoryId?: string;
  path?: string;
  userPrivateId?: string;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  key: string;
  role: ApiKeyRole;
  createdAt: string;
}

export interface AuthenticatedActor {
  apiKeyId: string;
  tenantId: string;
  role: ApiKeyRole;
}

export interface Provenance {
  sourceKind: ArtifactType | "memory_feedback";
  sourceLabel: string;
  sourceUri?: string;
  actorId: string;
  capturedAt: string;
}

export interface RawEvent {
  id: string;
  tenantId: string;
  scopes: Scope;
  actorId: string;
  artifactType: ArtifactType;
  artifactPayload: unknown;
  normalizedText: string;
  provenance: Provenance;
  idempotencyKey?: string;
  createdAt: string;
}

export interface MemorySource {
  eventId: string;
  sourceKind: Provenance["sourceKind"];
  sourceLabel: string;
  sourceUri?: string;
  actorId: string;
  capturedAt: string;
}

export interface MemoryRecord {
  id: string;
  tenantId: string;
  scopes: Scope;
  actorId: string;
  type: MemoryType;
  title: string;
  content: string;
  attributes: Record<string, unknown>;
  confidence: number;
  freshness: number;
  pinned: boolean;
  stale: boolean;
  status: "active" | "forgotten";
  sourceIds: string[];
  sources: MemorySource[];
  embedding: number[];
  createdAt: string;
  updatedAt: string;
}

export interface CandidateMemory {
  tenantId: string;
  scopes: Scope;
  actorId: string;
  type: MemoryType;
  title: string;
  content: string;
  attributes: Record<string, unknown>;
  confidence: number;
  freshness: number;
}

export interface ReviewItem {
  id: string;
  tenantId: string;
  scopes: Scope;
  eventId: string;
  candidate: CandidateMemory;
  reason: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RetrieveMemoryRequest {
  tenantId: string;
  actorId: string;
  scopes: Scope;
  query: string;
  interactionMode: "coding" | "support" | "personal" | "enterprise";
  memoryTypes?: MemoryType[];
  recencyDays?: number;
  entityIds?: string[];
}

export interface RetrievedMemory {
  memory: MemoryRecord;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  scopeDistance: number;
}

export interface RetrieveMemoryResponse {
  memoryRecords: RetrievedMemory[];
  contextBlock: string;
  trace: {
    candidateCount: number;
    selectedCount: number;
    queryEmbeddingDimensions: number;
    selectedMatches: Array<{
      memoryId: string;
      scopeKey: string;
      scopeDistance: number;
      pathMatch: "exact" | "ancestor" | "repository" | "broader" | "none";
    }>;
  };
}

export interface WriteMemoryRequest {
  tenantId: string;
  actorId: string;
  scopes: Scope;
  artifactType: ArtifactType;
  artifactPayload: unknown;
  provenance: Provenance;
  idempotencyKey?: string;
}

export interface WriteMemoryResponse {
  eventId: string;
  extractionStatus: "processed" | "duplicate";
  acceptedCount: number;
  queuedCount: number;
}

export interface FeedbackRequest {
  tenantId: string;
  actorId: string;
  scopes: Scope;
  memoryId: string;
  action: FeedbackAction;
  content?: string;
}

export interface ReviewListRequest {
  tenantId: string;
  actorId: string;
  scopes: Scope;
}

export interface ReviewListResponse {
  reviewItems: ReviewItem[];
}

export interface ReviewDecisionRequest {
  tenantId: string;
  actorId: string;
  scopes: Scope;
  reviewId: string;
  action: ReviewDecisionAction;
  content?: string;
}

export interface ReviewDecisionResponse {
  reviewItem: ReviewItem;
  promotedMemoryId?: string;
}

export type CodingArtifactType = "prompt_response" | "code_snippet" | "code_diff" | "documentation";

export interface PrepareCodingContextInput {
  tenantId: string;
  actorId: string;
  scopes: Scope;
  query: string;
  memoryTypes?: MemoryType[];
  recencyDays?: number;
  entityIds?: string[];
}

export type CodingOutcomeArtifact =
  | {
      artifactType: "prompt_response";
      query: string;
      answer: string;
      sourceLabel?: string;
      sourceUri?: string;
    }
  | {
      artifactType: "code_snippet" | "code_diff";
      content: string;
      sourceLabel?: string;
      sourceUri?: string;
    }
  | {
      artifactType: "documentation";
      content: string;
      sourceLabel?: string;
      sourceUri?: string;
    };

export interface RecordCodingOutcomeInput {
  tenantId: string;
  actorId: string;
  scopes: Scope;
  artifact: CodingOutcomeArtifact;
  idempotencyKey?: string;
  capturedAt?: string;
}
