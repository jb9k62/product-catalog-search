---
type: API Reference
title: Search API
description: HTTP contract for GET /api/search, /api/suggestions, /api/categories, and /api/metrics, including errors.
tags: [api, http, contract]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: server/src/routes/search.ts
  - resource: server/src/app.ts
  - resource: server/src/metrics.ts
  - resource: README.md
---

# Search API

Base URL `http://localhost:3000/api` (port set by `PORT`). `README.md` has more curl examples.

## `GET /api/search`

| Param      | Type                               | Default     | Notes                                                                                                                                                                         |
| ---------- | ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`        | string                             | `""`        | Matched word by word against name, category, and tags. Words are OR'd; more matching words rank higher. A query with no searchable words (`the`, `t`) applies no text filter. |
| `category` | string                             | all         | Exact match. An unknown value returns no items.                                                                                                                               |
| `sort`     | `relevance`, `price`, `popularity` | `relevance` | `relevance` only matters when `q` has searchable words. `price` sorts by `basePrice` ([ADR-0002](/adr/0002-sort-by-base-price-not-live-price.md)).                            |
| `page`     | positive integer                   | `1`         | A page past the end returns the last page, so read `page` in the response.                                                                                                    |
| `pageSize` | positive integer                   | `12`        | Capped at 50.                                                                                                                                                                 |

A repeated parameter, an unknown `sort`, or a `page` or `pageSize` that isn't a positive
integer returns `400 BAD_REQUEST`. Unknown parameters are ignored.

```bash
curl "http://localhost:3000/api/search?q=running&category=Footwear&sort=price&page=2&pageSize=1"
```

```json
{
  "items": [
    {
      "id": "31285d63-9b22-40ba-97dc-9d31408e017e",
      "name": "Ultra Running Shoe",
      "category": "Footwear",
      "tags": ["cushioned", "breathable"],
      "basePopularity": 0,
      "basePrice": 2860.26,
      "price": 2723.98,
      "availability": "In stock",
      "deliveryEstimate": "1 week",
      "enrichmentFailed": false
    }
  ],
  "total": 2,
  "page": 2,
  "pageSize": 1
}
```

When an item's upstream call fails, it has `enrichmentFailed: true` and `price`,
`availability`, and `deliveryEstimate` are `null` ([Domain model](/app/domain-model.md)).
Otherwise `availability` is `In stock`, `Low stock`, or `Backordered`.

The response carries a `Server-Timing` header split into the two costs that make up the
request: `search` (the catalog lookup and ranking) and `enrich` (the upstream calls for the
current page). Chrome DevTools shows both under Network → the request → Timing. See
[ADR-0005](/adr/0005-hand-rolled-request-metrics.md).

## `GET /api/suggestions`

Typeahead suggestions for the search box: item names that hold a query word, or a word starting
with one. They're ranked by the same relevance scoring as `GET /api/search`, deduplicated, and
capped at 8. An item that matches only through a tag or category isn't suggested, because its
name wouldn't contain what was typed.

| Param | Type   | Default | Notes                                                                                                              |
| ----- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `q`   | string | `""`    | Free-text query, matched like `q` in `GET /api/search`. A missing or empty `q` returns an empty list, not an error |

A repeated `q` (`?q=a&q=b`) returns `400 BAD_REQUEST`, like the other endpoints. Unknown
parameters are ignored.

```bash
curl "http://localhost:3000/api/suggestions?q=trail"
```

```json
{ "suggestions": ["Everyday Trail Shoe", "Pro Trail Shoe"] }
```

Empty result (blank or missing `q`, or a query that matches nothing, e.g. only a stopword):

```json
{ "suggestions": [] }
```

Suggestions never call the upstream provider, so there is no enrichment to fail and no
`Server-Timing` header ([Architecture](/app/architecture.md)). That is why they are cheap
enough for the client to fetch on every debounce tick. They reuse the inverted index via
`suggestItems`, so the same exact-key plus prefix fallback and field weighting that drive
search results drive suggestions. See [ADR-0006](/adr/0006-typeahead-suggestions.md).

## `GET /api/categories`

The distinct category names, sorted, for the filter control.

```json
["Apparel", "Electronics", "Footwear", "Home & Kitchen", "Outdoor"]
```

## `GET /api/metrics`

In-memory request counters, reset whenever the server restarts. See
[ADR-0005](/adr/0005-hand-rolled-request-metrics.md).

```json
{
  "since": "2026-09-14T10:00:00.000Z",
  "routes": {
    "GET /api/search": {
      "count": 3,
      "clientErrors": 1,
      "serverErrors": 0,
      "aborted": 0,
      "avgMs": 210.4,
      "maxMs": 398.2
    }
  },
  "enrichment": { "items": 24, "failed": 2 }
}
```

- `since`: when the process (and its counters) started.
- `routes`: one entry per `${method} ${path}` (query strings dropped, so `?q=a` and `?q=b`
  share a key). Every unmatched `/api/*` route shares one key, `GET (unmatched)`, so requests
  for random paths can't grow this map without limit.
- `count`, `clientErrors` (4xx), `serverErrors` (5xx): completed responses only.
- `aborted`: requests where the client disconnected before the response finished. Counted
  separately from `count`, not as a failure.
- `avgMs`, `maxMs`: rounded to one decimal, over completed responses; `0` when `count` is `0`.
- `enrichment`: `items` enriched and `failed` (upstream calls that failed), across every search,
  not broken down by route.

## Errors

Every error body is an `ApiError`:

```json
{
  "code": "BAD_REQUEST",
  "message": "sort must be one of: relevance, price, popularity"
}
```

| Code             | Status | When                                                   |
| ---------------- | ------ | ------------------------------------------------------ |
| `BAD_REQUEST`    | 400    | Invalid query parameter                                |
| `NOT_FOUND`      | 404    | Unmatched `/api/*` route                               |
| `INTERNAL_ERROR` | 500    | Unexpected server error (logged, details not returned) |

Upstream failures never produce an error response ([Architecture](/app/architecture.md)).
