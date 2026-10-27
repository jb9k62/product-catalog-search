// Shared request/response contract, imported by both server and client.
// See okf/app/domain-model.md for the reasoning.

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  tags: string[];
  basePopularity: number;
  // Reference/list price, known without calling the upstream provider.
  // Sorting by "price" uses this so pagination never has to enrich more
  // than the current page. The live `price` on EnrichedItem (which may
  // differ slightly, e.g. a live discount) is what's actually displayed.
  basePrice: number;
}

export type Availability = "In stock" | "Low stock" | "Backordered";

// A discriminated union on `enrichmentFailed`, rather than one shape with every
// live field nullable. The compiler then rules out impossible states (a price
// alongside enrichmentFailed: true, or nulls on a successful item), and one
// check of `item.enrichmentFailed` narrows all three live fields at once.
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
  // UPSTREAM_* are what the provider throws internally. The search route
  // absorbs them per item (see EnrichedItem), so they never reach the client
  // as an error response today.
  code:
    | "BAD_REQUEST"
    | "NOT_FOUND"
    | "INTERNAL_ERROR"
    | "UPSTREAM_TIMEOUT"
    | "UPSTREAM_ERROR";
  message: string;
}

// One runtime list that the type, the server's validation, and the client's
// URL parsing all derive from, so they can't drift apart.
export const SORT_OPTIONS = ["relevance", "price", "popularity"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

// A type guard: returning `value is SortOption` lets TypeScript narrow an
// untrusted string (query param, URL, <select> value) without a cast.
export function isSortOption(value: unknown): value is SortOption {
  return SORT_OPTIONS.includes(value as SortOption);
}

export interface SearchResponse {
  items: EnrichedItem[];
  total: number;
  // The page actually served. Can be lower than the one requested, e.g. a
  // stale ?page=9 link after the result set shrank.
  page: number;
  pageSize: number;
}

// Item names only, no enrichment, capped at 8, ranked by relevance.
// See GET /api/suggestions in the typeahead contract.
export interface SuggestionsResponse {
  suggestions: string[];
}
