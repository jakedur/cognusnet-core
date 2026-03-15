import type {
  CodingIntentArtifact,
  CodingOutcomeArtifact,
  FeedbackRequest,
  PrepareCodingContextInput,
  RecordCodingIntentInput,
  RecordCodingOutcomeInput,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  ReviewListRequest,
  ReviewListResponse,
  RetrieveMemoryRequest,
  RetrieveMemoryResponse,
  WriteMemoryRequest,
  WriteMemoryResponse
} from "../domain/types";

export interface CognusNetClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class CognusNetClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CognusNetClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async retrieveMemory(request: RetrieveMemoryRequest): Promise<RetrieveMemoryResponse> {
    return this.post<RetrieveMemoryResponse>("/v1/memory/retrieve", request);
  }

  async prepareCodingContext(request: PrepareCodingContextInput): Promise<RetrieveMemoryResponse> {
    return this.retrieveMemory({
      ...request,
      interactionMode: "coding"
    });
  }

  async writeMemoryEvent(request: WriteMemoryRequest): Promise<WriteMemoryResponse> {
    return this.post<WriteMemoryResponse>("/v1/memory/write", request);
  }

  async recordCodingOutcome(input: RecordCodingOutcomeInput): Promise<WriteMemoryResponse> {
    const artifact = this.toWriteArtifact(input.artifact);
    return this.writeMemoryEvent({
      tenantId: input.tenantId,
      actorId: input.actorId,
      scopes: input.scopes,
      artifactType: artifact.artifactType,
      artifactPayload: artifact.artifactPayload,
      provenance: {
        sourceKind: artifact.artifactType,
        sourceLabel: artifact.sourceLabel,
        sourceUri: artifact.sourceUri,
        actorId: input.actorId,
        capturedAt: input.capturedAt ?? new Date().toISOString()
      },
      idempotencyKey: input.idempotencyKey
    });
  }

  async recordCodingIntent(input: RecordCodingIntentInput): Promise<WriteMemoryResponse> {
    const artifact = this.toIntentArtifact(input.artifact);
    return this.writeMemoryEvent({
      tenantId: input.tenantId,
      actorId: input.actorId,
      scopes: input.scopes,
      artifactType: artifact.artifactType,
      artifactPayload: artifact.artifactPayload,
      provenance: {
        sourceKind: artifact.artifactType,
        sourceLabel: artifact.sourceLabel,
        sourceUri: artifact.sourceUri,
        actorId: input.actorId,
        capturedAt: input.capturedAt ?? new Date().toISOString()
      },
      idempotencyKey: input.idempotencyKey
    });
  }

  async submitMemoryFeedback(request: FeedbackRequest): Promise<{ memory: unknown; auditReference: string }> {
    return this.post("/v1/memory/feedback", request);
  }

  async listReviewItems(request: ReviewListRequest): Promise<ReviewListResponse> {
    const search = new URLSearchParams({
      tenantId: request.tenantId,
      actorId: request.actorId,
      ...(request.scopes.workspaceId ? { workspaceId: request.scopes.workspaceId } : {}),
      ...(request.scopes.projectId ? { projectId: request.scopes.projectId } : {}),
      ...(request.scopes.repositoryId ? { repositoryId: request.scopes.repositoryId } : {}),
      ...(request.scopes.userPrivateId ? { userPrivateId: request.scopes.userPrivateId } : {})
    });

    return this.get<ReviewListResponse>(`/v1/review/items?${search.toString()}`);
  }

  async decideReviewItem(request: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
    return this.post<ReviewDecisionResponse>(`/v1/review/items/${request.reviewId}/decision`, request);
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`CognusNet request failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "x-api-key": this.options.apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`CognusNet request failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  private toWriteArtifact(input: CodingOutcomeArtifact): {
    artifactType: WriteMemoryRequest["artifactType"];
    artifactPayload: unknown;
    sourceLabel: string;
    sourceUri?: string;
  } {
    if (input.artifactType === "prompt_response") {
      return {
        artifactType: "prompt_response",
        artifactPayload: {
          query: input.query,
          answer: input.answer
        },
        sourceLabel: input.sourceLabel ?? "Coding outcome",
        sourceUri: input.sourceUri
      };
    }

    return {
      artifactType: input.artifactType,
      artifactPayload: input.content,
      sourceLabel:
        input.sourceLabel ??
        (input.artifactType === "documentation" ? "Coding documentation" : "Coding artifact"),
      sourceUri: input.sourceUri
    };
  }

  private toIntentArtifact(input: CodingIntentArtifact): {
    artifactType: WriteMemoryRequest["artifactType"];
    artifactPayload: unknown;
    sourceLabel: string;
    sourceUri?: string;
  } {
    return {
      artifactType: "coding_intent",
      artifactPayload: {
        task: input.task,
        ...(input.rationale ? { rationale: input.rationale } : {}),
        ...(input.constraints?.length ? { constraints: input.constraints } : {})
      },
      sourceLabel: input.sourceLabel ?? "Coding intent",
      sourceUri: input.sourceUri
    };
  }
}
