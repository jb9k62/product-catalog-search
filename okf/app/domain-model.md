---
type: Data Model
title: Domain model
description: The request and response types in shared/api-types.ts, imported by both server and client.
tags: [types, data-model, contract]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: shared/api-types.ts
---

# Domain model

`shared/api-types.ts` defines the contract once. Server and client both import it, so they
can't drift apart.

```typescript
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  tags: string[];
  basePopularity: number;
  basePrice: number; // reference price, known without calling upstream
}

export type Availability = "In stock" | "Low stock" | "Backordered";

export type EnrichedItem = CatalogItem &
  (
    | {
        enrichmentFailed: false;
        price: number;
        availability: Availability;
        deliveryEstimate: string;
      }
    | {
        enrichmentFailed: true;
        price: null;
        availability: null;
        deliveryEstimate: null;
      }
  );

export interface ApiError {
  code:
    | "BAD_REQUEST"
    | "NOT_FOUND"
    | "INTERNAL_ERROR"
    | "UPSTREAM_TIMEOUT"
    | "UPSTREAM_ERROR";
  message: string;
}

export const SORT_OPTIONS = ["relevance", "price", "popularity"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export function isSortOption(value: unknown): value is SortOption {
  return SORT_OPTIONS.includes(value as SortOption);
}

export interface SearchResponse {
  items: EnrichedItem[];
  total: number;
  page: number; // the page actually served, after clamping
  pageSize: number;
}
```

## Why `EnrichedItem` is a discriminated union

Enrichment is best-effort per item, so the live fields can be missing. Making each one
nullable on its own would allow impossible states, such as a price on a failed item. The union
on `enrichmentFailed` rules those out, and one `if (item.enrichmentFailed)` check narrows all
three fields.

## One source for sort options

`SORT_OPTIONS` drives the `SortOption` type, the `isSortOption` guard, the server's `sort`
validation, and the client's URL parsing. The server's comparators are typed
`Record<SortOption, ...>`, so a new option without a comparator doesn't compile.

## Internal error codes

`UPSTREAM_TIMEOUT` and `UPSTREAM_ERROR` are only thrown inside the server. The search route
absorbs them per item ([Architecture](/app/architecture.md)), so clients never receive them.
