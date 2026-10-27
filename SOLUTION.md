# Solution

Design choices and trade-offs for the Search & Discovery Mini App. See `requirements.md` for
the brief. This is a summary. The full detail (diagrams, worked examples, code) lives in the
[OKF knowledge bundle](okf/index.md): browse it with `npm run okf:view`, or start at
[`okf/app/overview.md`](okf/app/overview.md).

## Documentation: an OKF knowledge bundle

**Decision:** keep this file short, and put the detail in `okf/`, an
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF) v0.2 bundle. OKF is a small spec for writing knowledge as markdown: one topic per file,
linked together, with YAML frontmatter that records each file's type, its sources, who wrote
it, and whether a person has checked it. Because that metadata has a fixed shape, tools can use
it: `npm run okf:validate` checks the bundle against the spec, and `npm run okf:view` builds a
single HTML file with a clickable map of the docs next to a reading pane that renders every
diagram. Full record: [ADR-0004](okf/adr/0004-document-design-as-okf-bundle.md).

## Client: hand-rolled vanilla TS vs Svelte

**Decision:** hand-rolled vanilla TypeScript, no framework. The brief allows either. Vanilla is
the stack I know best, so the four-hour budget goes into search, the API, and tests rather
than learning a framework, and I can explain every choice with confidence in the video demo.
Full record: [ADR-0001](okf/adr/0001-vanilla-ts-client-over-svelte.md).

## Test data: seeded and regenerable

**Decision:** one Faker item factory, used two ways. A fixed seed produces the committed
catalog (`data/catalog.seed.json`) that tests and the default `dev` run use. The same factory
without a fixed seed writes a fresh, gitignored catalog, for trying search on data it wasn't
tuned on. Full record: [ADR-0003](okf/adr/0003-dual-seeded-and-random-catalog-generation.md).

## Data model: one shared shape, not three

**Decision:** `CatalogItem`, `EnrichedItem`, `ApiError`, and `SearchResponse` live once in
`shared/api-types.ts`, imported by both server and client. `EnrichedItem` is a discriminated
union on `enrichmentFailed` rather than separately nullable fields, so impossible states (a
price on a failed item) don't type-check. Full detail: [domain model](okf/app/domain-model.md).

## Search: inverted index, then ranked

**Decision:** at startup the server builds a weighted inverted index (word → item → field
weight), so search is a lookup, not a scan. One `tokenise()` function handles both item text
and queries, and a prefix fallback matches partial words. Full design and a worked example:
[search & ranking](okf/app/search-ranking.md).

## Typeahead suggestions, cheap by design

**Decision:** a `GET /api/suggestions` endpoint reuses the inverted index to return up to 8
exact item names, never calling the upstream provider, so it is cheap enough to fetch on every
debounce tick. The client avoids unnecessary requests with the shared 200ms debounce, a
2-character minimum, a per-query memo, and aborting stale requests. Full record:
[ADR-0006](okf/adr/0006-typeahead-suggestions.md).

## Sorting by price without enriching the whole catalog

**Decision:** sort by `basePrice` (known without calling upstream), not the live `price`, so
only the current page ever needs enriching. Trade-off: two items with close base prices can
show out of order, because their live prices vary separately. Full record:
[ADR-0002](okf/adr/0002-sort-by-base-price-not-live-price.md).

## Waiting for enrichment before responding

**Decision:** the search response waits for the current page's enrichment, rather than sending
results first and filling in prices later. The brief says the UI must degrade gracefully rather
than block on enrichment, which may fail per item. It does: an item whose upstream call fails
still shows, marked "Price unavailable", and the rest of the list renders as normal. The wait is
short and has a limit (all calls on a page run at once, 80-400ms, with a 3-second cap), and the
UI stays usable while it runs. Trade-off: results show a fraction of a second later than they
could. Full detail: [architecture](okf/app/architecture.md#why-the-response-waits-for-enrichment).

## Cancellation and error handling

Cancellation runs end to end (client `AbortController` → server disconnect check → upstream
signal), so older searches stop when a fast typist starts a new one. Errors fall into three
kinds: an upstream failure affects only its item; invalid input is a 400 through one
`AppError` and error-middleware path; anything unexpected is logged and returned as a generic
`INTERNAL_ERROR`. Full detail: [architecture](okf/app/architecture.md).

## Instrumentation without a library

**Decision:** hand-roll request metrics rather than add a dependency. A middleware on `/api`
counts requests per route, logs one line per request, and serves the counts as JSON at
`GET /api/metrics`. `GET /api/search` also carries a `Server-Timing` header split into catalog
search time and upstream enrichment time, visible in Chrome DevTools' Network tab. Full record:
[ADR-0005](okf/adr/0005-hand-rolled-request-metrics.md).

## AI assistance

I built this with Claude from start to finish. Before the brief arrived, a planning chat about
delivery-app search (catalog, ranking, personalisation) produced a first plan with Node's built-in
SQLite, TypeScript 5.x, and a personalisation module. I cut that down to the brief: in-memory
JSON, TypeScript 7, and no personalisation. The inverted index and the seeded test data carried
through.

Claude proposed the architecture; I made the trade-off calls and reviewed the result. A later
bug-hunting review by Claude Opus 5 found and fixed real bugs in tokenising, validation,
cancellation, pagination, navigation, and test coverage. Full account, with a table of every
fix: [AI assistance](okf/app/ai-assistance.md).
