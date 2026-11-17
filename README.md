# ResumeMatch v2

Resume vs job-description analysis on MERN + LangGraph.js, where every score is backed by a
quote that code verifies really exists in the resume.

> Status: **Phase 1 of 5** (skeleton + ingestion) complete.

## Layout

```
apps/api        Express REST API (auth, document upload)
packages/core   Shared logic: text extraction, normalisation, line IDs, token guard
```

## Run locally

Requires Node 22 and pnpm (`corepack pnpm ...` works without a global install).

```bash
cp .env.example .env            # set JWT_SECRET
pnpm install
pnpm dev:api                    # needs MongoDB on localhost:27017
```

Or the whole stack with Docker:

```bash
docker compose up --build       # API on http://localhost:4000
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## API (so far)

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | Returns a JWT |
| POST | `/api/documents` | Resume as multipart `file` (PDF/DOCX, 5 MB) or JD as `{kind:"jd", text}`; returns `documentId` and line-numbered text |
