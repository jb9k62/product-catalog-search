---
type: Architectural Decision
title: "ADR-0002: Sort by base price, not live price"
description: Why price sort uses the catalog's basePrice instead of the enriched live price, and the side effect users can see.
tags: [search, sort, enrichment, adr]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: server/src/search.ts
  - resource: server/src/upstream.ts
  - resource: e2e/search.spec.ts
---

# ADR-0002: Sort by base price, not live price

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Jordan Hunt, with Claude Sonnet 5

## Context

Only the current page is enriched, so upstream calls stay limited however many items match
([Architecture](/app/architecture.md)). Sorting by the live `price` would break that: every
matching item would need enriching before the page could even be chosen.

## Decision

We will sort by `basePrice`, a catalog price known without calling upstream. The simulated live
price stays within 5% of it, so the order is a close stand-in at no extra upstream cost.

## Consequences

### Positive

- Enrichment stays limited to one page for every sort.
- Sort order is the same every time, whatever upstream does.

### Trade-offs

- Two items with close base prices can show out of order, because their live prices vary
  separately. The first e2e price-sort test checked that displayed prices go up, and failed for
  exactly this reason. It now checks that the rendered order matches the server's response.

## Alternatives considered

| Option                            | Why rejected                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Sort by live `price`              | Enriches every match on every request, so cost grows with the result count.                          |
| Enrich all matches once and cache | The cache goes stale as live prices and availability change, for no clear gain in a four-hour build. |
