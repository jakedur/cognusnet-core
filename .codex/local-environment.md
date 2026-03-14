# CognusNet Codex Local Environment

Use these values when creating a local environment for this repository in ChatGPT Codex.

## Workspace

- Path: `C:\Users\jaked\git\cognusnet`

## Setup Script

```sh
npm install
npm run build
```

Keep database startup and seeding as manual actions instead of automatic setup so new sessions do not always start Docker or mutate local state.

## Actions

### Test

```sh
npm test
```

### Typecheck

```sh
npm run typecheck
```

### Build

```sh
npm run build
```

### Start Postgres

```sh
docker compose up -d
```

### Apply Schema

```sh
Get-Content src\infra\postgres\migrations\001_init.sql -Raw | docker exec -i cognusnet-postgres-1 psql -U postgres -d cognusnet
```

### Seed Database

```sh
npm run seed
```

### Start App

```sh
npm start
```

### Health Check

```sh
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health | Select-Object -ExpandProperty Content
```

### Live Retrieve

```sh
npm run client -- retrieve --query "Where is the auth middleware?"
```

## Local Defaults

These are the current seeded local values:

- `baseUrl`: `http://127.0.0.1:3000`
- `apiKey`: `test-api-key`
- `tenantId`: `tenant-alpha`
- `actorId`: `actor-1`
- `workspaceId`: `workspace-1`
- `projectId`: `project-1`
- `repositoryId`: `repository-1`

## Suggested UI Labels

- Environment name: `CognusNet Local`
- Setup script: use the script above
- Actions: add the actions above as separate entries
