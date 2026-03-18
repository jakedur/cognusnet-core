# cognusnet-core

Open source CognusNet core runtime for shared AI memory.

This repo is the portable, developer-facing layer of CognusNet:

- memory API and domain model
- TypeScript SDK
- local/server reference implementation
- local MCP server for coding workflows
- Postgres schema and local dev stack
- seed scripts, live client, and tests
- basic review and feedback APIs

## Docs

- [Architecture](docs/architecture.md)

## V1 Service

This repository contains the open source TypeScript v1 scaffold for CognusNet core:

- Fastify HTTP service with `POST /v1/memory/retrieve`, `POST /v1/memory/write`, and `POST /v1/memory/feedback`
- TypeScript SDK client
- Postgres + `pgvector` schema
- TDD-focused test suite covering unit, contract, integration, SDK, and schema checks

## Local Setup

Quickstart:

1. Start Postgres:

```sh
docker compose up -d
```

2. Copy `.env.example` to `.env`.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```sh
cp .env.example .env
```

3. Install dependencies, create the database if needed, apply migrations, and seed the local tenant:

```sh
npm install
npm run db:setup
npm run seed
```

4. Start the service:

```sh
npm run dev
```

5. Validate the repo:

```sh
npm test
npm run typecheck
npm run build
```

The schema step is required before seeding. `npm run seed` inserts into tables like `tenants`, so it will fail with `relation "tenants" does not exist` if you skip the migration.

Cross-platform database commands:

- `npm run db:create`: create the repo's default database if it does not exist
- `npm run db:migrate`: apply all SQL migrations
- `npm run db:setup`: create the database if needed, then apply any new migrations

The full two-repo setup, including `cognusnet`, is documented in the `cognusnet` repo at `docs/local-dev.md`.

## Live Client

Use the reference client against the running local service:

```powershell
npm run client -- retrieve --query "Where is the auth middleware?"
npm run client -- write --type conversation --text "Decision: auth middleware lives in api/server.ts"
npm run client -- ask --query "Where is the auth middleware?" --answer "It lives in api/server.ts"
npm run client -- record_coding_intent --task "Print ahhh" --rationale "because the sky is blue" --constraints "single print statement;omit rationale from code" --path scripts/demo.py
npm run client -- smoke_intent_roundtrip
```

Defaults target the local seeded records:

- `baseUrl`: `http://127.0.0.1:3000`
- `apiKey`: `test-api-key`
- `tenantId`: `tenant-alpha`
- `actorId`: `actor-1`
- `workspaceId`: `workspace-1`
- `projectId`: `project-1`
- `repositoryId`: `repository-1`

Override them with environment variables like `COGNUSNET_BASE_URL`, `COGNUSNET_API_KEY`, `COGNUSNET_TENANT_ID`, `COGNUSNET_WORKSPACE_ID`, `COGNUSNET_PROJECT_ID`, and `COGNUSNET_REPOSITORY_ID`.

## Codex MCP Beta

This repo also includes a local stdio MCP server for coding memory so Codex can call CognusNet directly during a session.

1. Start the core API with `npm run dev`.
2. In another shell, make sure these environment variables are available:

```powershell
$env:COGNUSNET_BASE_URL="http://127.0.0.1:3000"
$env:COGNUSNET_API_KEY="test-api-key"
$env:COGNUSNET_TENANT_ID="tenant-alpha"
$env:COGNUSNET_ACTOR_ID="actor-1"
$env:COGNUSNET_WORKSPACE_ID="workspace-1"
$env:COGNUSNET_PROJECT_ID="project-1"
$env:COGNUSNET_REPOSITORY_ID="repository-1"
```

3. Run the MCP server:

```powershell
npm run mcp
```

The coding MCP surface now includes:

- `prepare_coding_context`
- `record_coding_intent`
- `record_coding_outcome`

Use `record_coding_intent` whenever the user gives explicit rationale or constraints that might not appear in the final code. `coding_intent` writes are promoted to a repository-scoped `operational_note` so later retrieval from a different file path in the same repository can still recall the rationale.

For coding retrieval, the core now prefers narrower path matches and higher-signal coding memories when multiple memories overlap:

- exact file-path matches rank above ancestor and repository-scoped matches
- same-query coding memories dedupe by merge key after ranking, so broader duplicates do not crowd the prompt context
- low-signal `conversation_summary` memories are excluded from default coding retrieval unless the caller explicitly asks for them
- the returned `contextBlock` is formatted as path-aware retrieved context instead of numbered `Memory 1`, `Memory 2` entries

You can verify the end-to-end failure case that motivated this beta with:

```powershell
npm run client -- smoke_intent_roundtrip
```

That command records intent for “print `ahhh` because the sky is blue,” writes a code-only outcome, retrieves from another file path, and reports whether the rationale was returned in the retrieved context.

## MCP Diagnostics

To verify that a separate Codex environment is actually reaching the MCP server and the core API, run:

```powershell
npm run verify:mcp
```

That script:

- spawns the stdio MCP server with the current environment
- confirms the required tools are present
- calls `record_coding_intent`, `record_coding_outcome`, and `prepare_coding_context`
- prints a diagnostics log path plus the emitted log lines

You can also persist MCP diagnostics from normal Codex use by setting:

```powershell
$env:COGNUSNET_MCP_LOG_PATH="C:\path\to\cognusnet-mcp.log"
```

The MCP server writes JSON lines to stderr and, when `COGNUSNET_MCP_LOG_PATH` is set, also appends them to that file. The most useful events are:

- `mcp_server_starting`
- `mcp_server_connected`
- `tool_call_started`
- `tool_call_succeeded`
- `tool_call_failed`
- `transport_error`

If another environment still fails, the presence or absence of these events tells you whether the problem is configuration, tool invocation, write failure, or retrieval miss.

For Codex desktop, add this to `C:\Users\jaked\.codex\config.toml`:

```toml
[mcp_servers.cognusnet]
command = "node"
args = ["./node_modules/tsx/dist/cli.mjs", "src/scripts/mcp-server.ts"]
cwd = "C:\\Users\\jaked\\git\\cognusnet-core"
env = { COGNUSNET_BASE_URL = "http://127.0.0.1:3000", COGNUSNET_API_KEY = "test-api-key", COGNUSNET_TENANT_ID = "tenant-alpha", COGNUSNET_ACTOR_ID = "actor-1", COGNUSNET_WORKSPACE_ID = "workspace-1", COGNUSNET_PROJECT_ID = "project-1", COGNUSNET_REPOSITORY_ID = "repository-1" }
```

The MCP process must not write non-protocol output to stdout. This server only writes startup and failure messages to stderr so it is safe to launch from Codex.
