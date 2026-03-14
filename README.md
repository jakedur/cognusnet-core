# cognusnet-core

Open source CognusNet core runtime for shared AI memory.

This repo is the portable, developer-facing layer of CognusNet:

- memory API and domain model
- TypeScript SDK
- local/server reference implementation
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

1. Install Node.js 20+
2. Copy `.env.example` to `.env`
3. Start Postgres with `docker compose up -d`
4. Install dependencies with `npm install`
5. Apply the SQL in `src/infra/postgres/migrations/001_init.sql`
6. Seed the local tenant with `npm run seed`
7. Run tests with `npm test`
8. Start the service with `npm run dev`

The schema step is required before seeding. `npm run seed` inserts into tables like `tenants`, so it will fail with `relation "tenants" does not exist` if you skip the migration.

From the repo root, the simplest schema apply command is:

```powershell
Get-Content src\infra\postgres\migrations\001_init.sql -Raw | docker exec -i cognusnet-core-postgres-1 psql -U postgres -d cognusnet
```

If your container name differs, check it with:

```powershell
docker ps
```

If you already have `psql` installed locally, you can apply the schema without `docker exec`:

```powershell
Get-Content src\infra\postgres\migrations\001_init.sql -Raw | psql "postgres://postgres:postgres@localhost:5432/cognusnet"
```

Then seed the local records:

```powershell
npm run seed
```

## Live Client

Use the reference client against the running local service:

```powershell
npm run client -- retrieve --query "Where is the auth middleware?"
npm run client -- write --type conversation --text "Decision: auth middleware lives in api/server.ts"
npm run client -- ask --query "Where is the auth middleware?" --answer "It lives in api/server.ts"
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
