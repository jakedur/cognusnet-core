import type {
  FeedbackRequest,
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

  async writeMemoryEvent(request: WriteMemoryRequest): Promise<WriteMemoryResponse> {
    return this.post<WriteMemoryResponse>("/v1/memory/write", request);
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
}
