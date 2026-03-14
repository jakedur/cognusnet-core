import type { RetrieveMemoryResponse, WriteMemoryResponse } from "../domain/types";
import type { CognusNetClient } from "../sdk/client";

export interface CodingMcpToolDefinition {
  name: "prepare_coding_context" | "record_coding_outcome";
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CodingMcpDefaults {
  tenantId: string;
  actorId: string;
  workspaceId?: string;
  projectId?: string;
  repositoryId?: string;
}

export class CodingMcpAdapter {
  constructor(
    private readonly client: Pick<CognusNetClient, "prepareCodingContext" | "recordCodingOutcome">,
    private readonly defaults: CodingMcpDefaults
  ) {}

  listTools(): CodingMcpToolDefinition[] {
    return [
      {
        name: "prepare_coding_context",
        description: "Retrieve the most relevant coding memory for a query and repository path before AI execution.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            workspaceId: { type: "string" },
            projectId: { type: "string" },
            repositoryId: { type: "string" },
            path: { type: "string" },
            recencyDays: { type: "number" }
          }
        }
      },
      {
        name: "record_coding_outcome",
        description: "Write coding memory automatically from prompt responses, code artifacts, or documentation after execution.",
        inputSchema: {
          type: "object",
          required: ["artifactType"],
          properties: {
            artifactType: {
              type: "string",
              enum: ["prompt_response", "code_snippet", "code_diff", "documentation"]
            },
            query: { type: "string" },
            answer: { type: "string" },
            content: { type: "string" },
            workspaceId: { type: "string" },
            projectId: { type: "string" },
            repositoryId: { type: "string" },
            path: { type: "string" },
            idempotencyKey: { type: "string" }
          }
        }
      }
    ];
  }

  async callTool(
    name: "prepare_coding_context" | "record_coding_outcome",
    args: Record<string, unknown>
  ): Promise<RetrieveMemoryResponse | WriteMemoryResponse> {
    const scopes = {
      workspaceId: this.pickString(args.workspaceId, this.defaults.workspaceId),
      projectId: this.pickString(args.projectId, this.defaults.projectId),
      repositoryId: this.pickString(args.repositoryId, this.defaults.repositoryId),
      path: this.pickString(args.path)
    };

    if (name === "prepare_coding_context") {
      const query = this.requiredString(args.query, "query");
      return this.client.prepareCodingContext({
        tenantId: this.defaults.tenantId,
        actorId: this.defaults.actorId,
        scopes,
        query,
        recencyDays: typeof args.recencyDays === "number" ? args.recencyDays : undefined
      });
    }

    const artifactType = this.requiredString(args.artifactType, "artifactType");
    if (artifactType === "prompt_response") {
      return this.client.recordCodingOutcome({
        tenantId: this.defaults.tenantId,
        actorId: this.defaults.actorId,
        scopes,
        artifact: {
          artifactType: "prompt_response",
          query: this.requiredString(args.query, "query"),
          answer: this.requiredString(args.answer, "answer")
        },
        idempotencyKey: this.pickString(args.idempotencyKey)
      });
    }

    if (artifactType === "code_snippet" || artifactType === "code_diff" || artifactType === "documentation") {
      return this.client.recordCodingOutcome({
        tenantId: this.defaults.tenantId,
        actorId: this.defaults.actorId,
        scopes,
        artifact: {
          artifactType,
          content: this.requiredString(args.content, "content")
        },
        idempotencyKey: this.pickString(args.idempotencyKey)
      });
    }

    throw new Error(`Unsupported coding artifact type: ${artifactType}`);
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${field} is required`);
    }
    return value;
  }

  private pickString(value: unknown, fallback?: string): string | undefined {
    return typeof value === "string" && value.trim() ? value : fallback;
  }
}
