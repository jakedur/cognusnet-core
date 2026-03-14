import type {
  FeedbackRequest,
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
}
