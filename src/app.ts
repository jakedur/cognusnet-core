import Fastify from "fastify";
import { z } from "zod";

import type {
  FeedbackRequest,
  RetrieveMemoryRequest,
  ReviewDecisionRequest,
  ReviewListRequest,
  WriteMemoryRequest
} from "./domain/types";
import { AuthService } from "./modules/auth/service";
import { AuditService } from "./modules/audit/service";
import { DeterministicEmbeddingProvider, type EmbeddingProvider } from "./modules/embeddings/provider";
import { EventService } from "./modules/events/service";
import { ExtractionService } from "./modules/extraction/service";
import { MemoryService } from "./modules/memory/service";
import { ReviewService } from "./modules/review/service";
import { RetrievalService } from "./modules/retrieval/service";
import { ScopeResolver } from "./modules/tenancy/scope";
import type { Repositories } from "./ports/repositories";

const scopeSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    repositoryId: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    userPrivateId: z.string().min(1).optional()
  })
  .refine((scope) => Boolean(scope.workspaceId || scope.projectId || scope.repositoryId || scope.userPrivateId), {
    message: "At least one scope level is required"
  });

const retrieveSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  scopes: scopeSchema,
  query: z.string().min(1),
  interactionMode: z.enum(["coding", "support", "personal", "enterprise"]),
  memoryTypes: z
    .array(
      z.enum([
        "fact",
        "decision",
        "code_pattern",
        "document_summary",
        "conversation_summary",
        "operational_note"
      ])
    )
    .optional(),
  recencyDays: z.number().int().positive().optional(),
  entityIds: z.array(z.string()).optional()
});

const writeSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  scopes: scopeSchema,
  artifactType: z.enum([
    "conversation",
    "prompt_response",
    "tool_output",
    "code_snippet",
    "code_diff",
    "documentation",
    "user_feedback"
  ]),
  artifactPayload: z.unknown(),
  provenance: z.object({
    sourceKind: z.enum([
      "conversation",
      "prompt_response",
      "tool_output",
      "code_snippet",
      "code_diff",
      "documentation",
      "user_feedback",
      "memory_feedback"
    ]),
    sourceLabel: z.string().min(1),
    sourceUri: z.string().url().optional(),
    actorId: z.string().min(1),
    capturedAt: z.string().datetime()
  }),
  idempotencyKey: z.string().min(1).optional()
});

const feedbackSchema = z
  .object({
    tenantId: z.string().min(1),
    actorId: z.string().min(1),
    scopes: scopeSchema,
    memoryId: z.string().min(1),
    action: z.enum(["keep", "edit", "forget", "pin", "mark_stale"]),
    content: z.string().min(1).optional()
  })
  .refine((input) => input.action !== "edit" || Boolean(input.content), {
    message: "Content is required when action is edit",
    path: ["content"]
  });

const reviewDecisionSchema = z
  .object({
    tenantId: z.string().min(1),
    actorId: z.string().min(1),
    scopes: scopeSchema,
    reviewId: z.string().min(1),
    action: z.enum(["accept", "reject", "edit_and_accept"]),
    content: z.string().min(1).optional()
  })
  .refine((input) => input.action !== "edit_and_accept" || Boolean(input.content), {
    message: "Content is required when action is edit_and_accept",
    path: ["content"]
  });

export function createApp(input: { repositories: Repositories; embeddingProvider?: EmbeddingProvider }) {
  const app = Fastify({ logger: false });
  const embeddings = input.embeddingProvider ?? new DeterministicEmbeddingProvider();
  const scopeResolver = new ScopeResolver();
  const auth = new AuthService(input.repositories.apiKeys);
  const audits = new AuditService(input.repositories.audits);
  const memoryService = new MemoryService(input.repositories.memories, input.repositories.reviews, embeddings, scopeResolver);
  const retrieval = new RetrievalService(input.repositories.memories, embeddings, audits, scopeResolver);
  const events = new EventService(input.repositories.rawEvents, new ExtractionService(), memoryService, audits, scopeResolver);
  const reviews = new ReviewService(input.repositories.reviews, input.repositories.rawEvents, memoryService, audits, scopeResolver);

  app.get("/health", async () => ({ ok: true }));

  app.post("/v1/memory/retrieve", async (request, reply) => {
    try {
      const body = retrieveSchema.parse(request.body) as RetrieveMemoryRequest;
      const actor = await auth.authenticate(request.headers["x-api-key"] as string | undefined, body.tenantId);
      return reply.send(await retrieval.retrieve(body, actor));
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post("/v1/memory/write", async (request, reply) => {
    try {
      const body = writeSchema.parse(request.body) as WriteMemoryRequest;
      const actor = await auth.authenticate(request.headers["x-api-key"] as string | undefined, body.tenantId);
      return reply.send(await events.ingest(body, actor));
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post("/v1/memory/feedback", async (request, reply) => {
    try {
      const body = feedbackSchema.parse(request.body) as FeedbackRequest;
      await auth.authenticate(request.headers["x-api-key"] as string | undefined, body.tenantId);
      const memory = await memoryService.applyFeedback(body);
      await audits.record({
        tenantId: body.tenantId,
        actorId: body.actorId,
        action: `memory.feedback.${body.action}`,
        resourceType: "memory_record",
        resourceId: body.memoryId,
        metadata: {
          scopeKey: scopeResolver.scopeKey(body.scopes)
        }
      });
      return reply.send({
        memory,
        auditReference: `${body.tenantId}:${body.memoryId}:${body.action}`
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get("/v1/review/items", async (request, reply) => {
    try {
      const query = z
        .object({
          tenantId: z.string().min(1),
          actorId: z.string().min(1),
          workspaceId: z.string().min(1).optional(),
          projectId: z.string().min(1).optional(),
          repositoryId: z.string().min(1).optional(),
          path: z.string().min(1).optional(),
          userPrivateId: z.string().min(1).optional()
        })
        .parse(request.query);
      const body: ReviewListRequest = {
        tenantId: query.tenantId,
        actorId: query.actorId,
          scopes: {
            workspaceId: query.workspaceId,
            projectId: query.projectId,
            repositoryId: query.repositoryId,
            path: query.path,
            userPrivateId: query.userPrivateId
          }
      };
      await auth.authenticate(request.headers["x-api-key"] as string | undefined, body.tenantId);
      return reply.send(await reviews.list(body));
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post("/v1/review/items/:reviewId/decision", async (request, reply) => {
    try {
      const params = z.object({ reviewId: z.string().min(1) }).parse(request.params);
      const body = reviewDecisionSchema.parse({
        ...(request.body as Record<string, unknown>),
        reviewId: params.reviewId
      }) as ReviewDecisionRequest;
      await auth.authenticate(request.headers["x-api-key"] as string | undefined, body.tenantId);
      return reply.send(await reviews.decide(body));
    } catch (error) {
      return handleError(reply, error);
    }
  });

  return app;
}

function handleError(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const statusCode = /Missing API key|Invalid API key|Tenant mismatch/.test(message)
    ? 401
    : /Forbidden/.test(message)
      ? 403
    : /not found/i.test(message)
      ? 404
      : 400;
  return reply.code(statusCode).send({ error: message });
}
