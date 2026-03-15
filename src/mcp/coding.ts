import type { RetrieveMemoryResponse, WriteMemoryResponse } from "../domain/types";
import type { CognusNetClient } from "../sdk/client";

export interface CodingMcpToolDefinition {
  name: "prepare_coding_context" | "record_coding_intent" | "record_coding_outcome";
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
    private readonly client: Pick<CognusNetClient, "prepareCodingContext" | "recordCodingIntent" | "recordCodingOutcome">,
    private readonly defaults: CodingMcpDefaults
  ) {}

  listTools(): CodingMcpToolDefinition[] {
    return [
      {
        name: "prepare_coding_context",
        description:
          "Always call this before substantive coding work and before why/where/how follow-up answers. Retrieve the most relevant coding memory for the current query and repository path before generating a response.",
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
        name: "record_coding_intent",
        description:
          "Call this immediately when the user gives explicit task intent, rationale, or constraints that may not appear in the final code. Persist that intent before code generation.",
        inputSchema: {
          type: "object",
          required: ["task"],
          properties: {
            task: { type: "string" },
            rationale: { type: "string" },
            constraints: {
              type: "array",
              items: { type: "string" }
            },
            workspaceId: { type: "string" },
            projectId: { type: "string" },
            repositoryId: { type: "string" },
            path: { type: "string" },
            idempotencyKey: { type: "string" }
          }
        }
      },
      {
        name: "record_coding_outcome",
        description:
          "Always call this after producing code, documentation, or a technical explanation. Write back the outcome of the work after execution so later prompts can retrieve it.",
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
    name: "prepare_coding_context" | "record_coding_intent" | "record_coding_outcome",
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

    if (name === "record_coding_intent") {
      return this.client.recordCodingIntent({
        tenantId: this.defaults.tenantId,
        actorId: this.defaults.actorId,
        scopes,
        artifact: {
          artifactType: "coding_intent",
          task: this.requiredString(args.task, "task"),
          rationale: this.pickString(args.rationale),
          constraints: this.pickStringArray(args.constraints)
        },
        idempotencyKey: this.pickString(args.idempotencyKey)
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

  private pickStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const normalized = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }
}
