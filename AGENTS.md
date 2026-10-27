# Project: Search & Discovery Mini App

A small, timeboxed search and discovery project. See `requirements.md` for the brief, `SOLUTION.md` for a summary of design decisions and trade-offs, `README.md` for setup and API docs, and the `okf/` knowledge bundle (see "Documentation" below) for full depth.

## What this is

A small full-stack app for a delivery marketplace: free-text search over a local catalog, one category filter, one sort (relevance/price/popularity), and results enriched with live availability, price, and delivery estimate from a simulated upstream provider. Implemented: server, client, unit tests, and e2e tests all in place and passing.

## Stack

- TypeScript 7 (strict mode)
- Node.js 24 (latest LTS)
- Express 5 for the API
- Hand-rolled vanilla TS client (no framework)
- Vite for dev/build/serve
- Vitest for unit tests, Playwright for e2e tests
- In-memory data only, no database

## Project structure

```
server/src/         Express API
  search.ts           tokenise, inverted index, weighted relevance ranking
  upstream.ts         simulated upstream provider (latency + failure)
  routes/search.ts     GET /api/search, /api/suggestions, /api/categories, /api/metrics
  app.ts, errors.ts   app wiring, AppError class, one JSON error-handling middleware
  catalog.ts          loads data/catalog.seed.json (override with CATALOG_PATH)
  metrics.ts          per-app request counters and log lines, read by GET /api/metrics
server/test/        Vitest: search/ranking, upstream provider, API routes, metrics (real app on a random port)
client/src/         Vanilla TS SPA
  main.ts             state, debounced search, URL sync + Back/Forward, orchestration
  api.ts              typed fetch wrapper (Result<T>)
  components/         result card, keyed-diffing results list, pagination, typeahead suggestions
e2e/                Playwright e2e tests
shared/api-types.ts CatalogItem, EnrichedItem (discriminated union), ApiError, SearchResponse, SORT_OPTIONS (imported by both sides)
scripts/generate-catalog.ts   Faker-based catalog generator
scripts/okf-view.mjs          OKF bundle validator + graph viewer (npm run okf:validate / okf:view)
data/               catalog.seed.json (committed), catalog.random.json (gitignored)
docs/               a standalone HTML explainer of the search architecture
okf/                Open Knowledge Format v0.2 bundle: architecture, domain model, API
                    contract, search/ranking design, ADRs, AI-assistance record
```

## Architecture notes

- Catalog: `data/catalog.seed.json`, ~36 items across 5 categories
- Search: inverted index (token → itemId → field weight), prefix-fallback matching, weighted relevance scoring. Full design and worked example in `okf/app/search-ranking.md`
- Sort by price uses `basePrice` (known without calling upstream), not the live enriched `price`, so pagination never has to enrich more than the current page. The displayed price can therefore differ slightly from sort order; this is a documented trade-off, not a bug
- Upstream provider: in-process (`server/src/upstream.ts`), 80-400ms latency, ~8% failure rate per item
- Server-side pagination, filtering, and sorting
- Enrichment failures degrade per item (`enrichmentFailed: true`); a failing upstream call never fails the whole search
- Public endpoints, no auth

## Ports

Defaults: API on `3000`, Vite client dev server on `5173` (proxies `/api`). Override with `PORT` / `VITE_PORT` env vars if those are taken locally, e.g. `PORT=3001 VITE_PORT=5175 npm run dev`.

## Documentation

Architecture, domain model, API contract, the search/ranking algorithm, ADRs, and the
AI-assistance record live in `okf/`, an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle. Start at `okf/index.md`. Check it against the spec with `npm run okf:validate`; browse
it with `npm run okf:view` (writes `okf/viz.html`, gitignored, regenerate after edits).
`SOLUTION.md` stays a short summary that links into the bundle; add design detail to the
bundle, not `SOLUTION.md`.

## References

- For advanced TypeScript typing (generics, conditional types, mapped types, utility types), use the `typescript-advanced-types` skill.
- For anything Express-related (routing, middleware, error handling, param validation), use the `express-backend` skill, which points into `references/express/examples`.
- For the vanilla client (components, routing, API calls, error handling, search/filter/sort), use the `hand-rolled-web-client` skill.
- For unit/integration tests, use the `vitest` skill. For e2e tests, use the `playwright-cli` skill.
- For generating catalog seed data, use the `faker` skill (`@faker-js/faker`, `scripts/generate-catalog.ts`).

## Workflows

### Pi Agent Harness

Multi-agent feature work in this repo runs through the saved Pi workflow
`feature_fanout_reference`. Run it by name (`workflow(name: "feature_fanout_reference", args: {...})` or
`/workflows run feature_fanout_reference`), with `concurrency: 4` (the local model
server has 4 parallel slots) and `agentRetries: 1`.

Args: `spec` (the fixed contract, pinned verbatim: endpoint shape, shared types,
caps, error cases), `commonContext` (conventions shared by every agent),
`workers: [{label, scope, task}]` (parallel implementers, each fenced to
non-overlapping paths), optional `contractTask` / `verifyTask` / `docsTask`
overrides, and `model` (the model every agent uses, which defaults to the local
model).

The pattern: shared contract types first, parallel scoped implementers, then a
verify gate with fix authority (typecheck, unit, e2e; re-run until green), and
docs last so they describe verified behaviour. After a run, re-calling
`workflow` with `resumeFromRunId` and an edited script replays unchanged agent
calls from cache, so one phase can be redone without restarting.

## Writing conventions

- Use South African English spelling throughout (e.g. "prioritise", "organise", "colour", "licence" as a noun).
- Never use em dashes. Use a comma, colon, period, or parentheses instead.
- Be concise. Prefer short, direct sentences over padded or repetitive ones, in docs, comments, and commit messages alike.
