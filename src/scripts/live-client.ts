import { randomUUID } from "node:crypto";

import type { ArtifactType, FeedbackAction, Scope } from "../domain/types";
import { CognusNetClient } from "../sdk/client";

interface LiveClientConfig {
  baseUrl: string;
  apiKey: string;
  tenantId: string;
  actorId: string;
  scopes: Scope;
}

interface ParsedCommand {
  command: "write" | "retrieve" | "feedback" | "ask" | "prepare_coding_context" | "record_coding_outcome" | "help";
  flags: Record<string, string>;
  values: string[];
}

function parseArgs(argv: string[]): ParsedCommand {
  const [rawCommand = "help", ...rest] = argv;
  const flags: Record<string, string> = {};
  const values: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }

    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[index + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = "true";
        continue;
      }

      flags[key] = next;
      index += 1;
      continue;
    }

    values.push(token);
  }

  if (
    rawCommand === "write" ||
    rawCommand === "retrieve" ||
    rawCommand === "feedback" ||
    rawCommand === "ask" ||
    rawCommand === "prepare_coding_context" ||
    rawCommand === "record_coding_outcome"
  ) {
    return { command: rawCommand, flags, values };
  }

  return { command: "help", flags, values };
}

export function loadLiveClientConfig(env: NodeJS.ProcessEnv = process.env): LiveClientConfig {
  return {
    baseUrl: env.COGNUSNET_BASE_URL ?? "http://127.0.0.1:3000",
    apiKey: env.COGNUSNET_API_KEY ?? env.SEED_API_KEY ?? "test-api-key",
    tenantId: env.COGNUSNET_TENANT_ID ?? env.SEED_TENANT_ID ?? "tenant-alpha",
    actorId: env.COGNUSNET_ACTOR_ID ?? env.SEED_ACTOR_ID ?? "actor-1",
    scopes: {
      workspaceId: env.COGNUSNET_WORKSPACE_ID ?? env.SEED_WORKSPACE_ID ?? "workspace-1",
      projectId: env.COGNUSNET_PROJECT_ID ?? env.SEED_PROJECT_ID ?? "project-1",
      repositoryId: env.COGNUSNET_REPOSITORY_ID ?? env.SEED_REPOSITORY_ID ?? "repository-1"
    }
  };
}

function usage(): string {
  return [
    "CognusNet live client",
    "",
    "Commands:",
    "  npm run client -- retrieve --query \"Where is the auth middleware?\"",
    "  npm run client -- write --type conversation --text \"Decision: auth middleware lives in api/server.ts\"",
    "  npm run client -- feedback --memory-id <id> --action pin",
    "  npm run client -- ask --query \"Where is the auth middleware?\" --answer \"It lives in api/server.ts\"",
    "  npm run client -- prepare_coding_context --query \"Where is the auth middleware?\" --path src/api/server.ts",
    "  npm run client -- record_coding_outcome --type prompt_response --query \"Where is the auth middleware?\" --answer \"It lives in src/api/server.ts.\" --path src/api/server.ts",
    "",
    "Optional flags:",
    "  --workspace-id <id>",
    "  --project-id <id>",
    "  --repository-id <id>",
    "  --path <repository-relative-path>"
  ].join("\n");
}

function resolveScopes(config: LiveClientConfig, flags: Record<string, string>): Scope {
  return {
    workspaceId: flags["workspace-id"] ?? config.scopes.workspaceId,
    projectId: flags["project-id"] ?? config.scopes.projectId,
    repositoryId: flags["repository-id"] ?? config.scopes.repositoryId,
    path: flags.path ?? undefined,
    userPrivateId: flags["user-private-id"] ?? undefined
  };
}

export async function runLiveClient(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): Promise<string> {
  const parsed = parseArgs(argv);
  if (parsed.command === "help") {
    return usage();
  }

  const config = loadLiveClientConfig(env);
  const client = new CognusNetClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetchImpl
  });
  const scopes = resolveScopes(config, parsed.flags);

  if (parsed.command === "retrieve") {
    const query = parsed.flags.query ?? parsed.values.join(" ");
    if (!query) {
      throw new Error("retrieve requires --query");
    }

    const response = await client.retrieveMemory({
      tenantId: config.tenantId,
      actorId: config.actorId,
      scopes,
      query,
      interactionMode: "coding"
    });

    return JSON.stringify(response, null, 2);
  }

  if (parsed.command === "prepare_coding_context") {
    const query = parsed.flags.query ?? parsed.values.join(" ");
    if (!query) {
      throw new Error("prepare_coding_context requires --query");
    }

    const response = await client.prepareCodingContext({
      tenantId: config.tenantId,
      actorId: config.actorId,
      scopes,
      query
    });

    return JSON.stringify(response, null, 2);
  }

  if (parsed.command === "write") {
    const artifactType = (parsed.flags.type ?? "conversation") as ArtifactType;
    const text = parsed.flags.text ?? parsed.values.join(" ");
    if (!text) {
      throw new Error("write requires --text");
    }

    const response = await client.writeMemoryEvent({
      tenantId: config.tenantId,
      actorId: config.actorId,
      scopes,
      artifactType,
      artifactPayload: text,
      provenance: {
        sourceKind: artifactType,
        sourceLabel: parsed.flags.label ?? "Live client write",
        sourceUri: parsed.flags.uri,
        actorId: config.actorId,
        capturedAt: new Date().toISOString()
      },
      idempotencyKey: parsed.flags["idempotency-key"] ?? `live-client-${randomUUID()}`
    });

    return JSON.stringify(response, null, 2);
  }

  if (parsed.command === "feedback") {
    const memoryId = parsed.flags["memory-id"];
    const action = parsed.flags.action as FeedbackAction | undefined;
    if (!memoryId || !action) {
      throw new Error("feedback requires --memory-id and --action");
    }

    const response = await client.submitMemoryFeedback({
      tenantId: config.tenantId,
      actorId: config.actorId,
      scopes,
      memoryId,
      action,
      content: parsed.flags.content
    });

    return JSON.stringify(response, null, 2);
  }

  if (parsed.command === "record_coding_outcome") {
    const artifactType = (parsed.flags.type ?? "prompt_response") as "prompt_response" | "code_snippet" | "code_diff" | "documentation";
    const response =
      artifactType === "prompt_response"
        ? await client.recordCodingOutcome({
            tenantId: config.tenantId,
            actorId: config.actorId,
            scopes,
            artifact: {
              artifactType,
              query: parsed.flags.query ?? "",
              answer: parsed.flags.answer ?? ""
            },
            idempotencyKey: parsed.flags["idempotency-key"] ?? `live-client-coding-${randomUUID()}`
          })
        : await client.recordCodingOutcome({
            tenantId: config.tenantId,
            actorId: config.actorId,
            scopes,
            artifact: {
              artifactType,
              content: parsed.flags.content ?? parsed.flags.text ?? parsed.values.join(" ")
            },
            idempotencyKey: parsed.flags["idempotency-key"] ?? `live-client-coding-${randomUUID()}`
          });

    return JSON.stringify(response, null, 2);
  }

  const query = parsed.flags.query;
  const answer = parsed.flags.answer;
  if (!query) {
    throw new Error("ask requires --query");
  }

  const retrieval = await client.retrieveMemory({
    tenantId: config.tenantId,
    actorId: config.actorId,
    scopes,
    query,
    interactionMode: "coding"
  });

  const responseBody: Record<string, unknown> = {
    request: {
      query
    },
    retrievedContext: retrieval.contextBlock,
    memoryRecords: retrieval.memoryRecords
  };

  if (answer) {
    responseBody.answer = answer;
    responseBody.writeBack = await client.writeMemoryEvent({
      tenantId: config.tenantId,
      actorId: config.actorId,
      scopes,
      artifactType: "prompt_response",
      artifactPayload: `Query: ${query}\nAnswer: ${answer}`,
      provenance: {
        sourceKind: "prompt_response",
        sourceLabel: "Live client ask",
        actorId: config.actorId,
        capturedAt: new Date().toISOString()
      },
      idempotencyKey: parsed.flags["idempotency-key"] ?? `live-client-ask-${randomUUID()}`
    });
  }

  return JSON.stringify(responseBody, null, 2);
}

async function main() {
  const output = await runLiveClient(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
}

if (require.main === module) {
  void main();
}
