import type {
  ApiError,
  SearchResponse,
  SortOption,
  SuggestionsResponse,
} from "../../shared/api-types.ts";

// Failures that happen before any server response exists. Kept out of the
// shared ApiError type, because the server never sends them.
export type ClientError =
  ApiError | { code: "NETWORK_ERROR" | "TIMEOUT"; message: string };

// Expected failures come back as data the caller has to branch on, rather than
// as exceptions that are easy to forget to catch.
export type Result<T> =
  { ok: true; data: T } | { ok: false; error: ClientError };

async function apiFetch<T>(
  path: string,
  signal: AbortSignal,
): Promise<Result<T>> {
  try {
    const res = await fetch(`/api${path}`, { signal });
    // Every API error response carries an ApiError JSON body (see server/src/app.ts).
    if (!res.ok) return { ok: false, error: (await res.json()) as ApiError };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    // The one case that still throws: a request we cancelled on purpose because
    // a newer search replaced it. It's not an error to show, so callers ignore it.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // AbortSignal.timeout() rejects with a TimeoutError, not an AbortError.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return {
        ok: false,
        error: { code: "TIMEOUT", message: "The request timed out" },
      };
    }
    // Network failure, or a non-JSON body (e.g. the dev proxy's page when the API is down).
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: "Could not reach the server" },
    };
  }
}

export interface SearchQuery {
  query: string;
  category: string; // "" means all categories
  sort: SortOption;
  page: number;
}

export function searchItems(
  search: SearchQuery,
  signal: AbortSignal,
): Promise<Result<SearchResponse>> {
  const params = new URLSearchParams({
    q: search.query,
    sort: search.sort,
    page: String(search.page),
  });
  if (search.category) params.set("category", search.category);
  return apiFetch<SearchResponse>(`/search?${params}`, signal);
}

export function fetchCategories(
  signal: AbortSignal,
): Promise<Result<string[]>> {
  return apiFetch<string[]>("/categories", signal);
}

export function fetchSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<Result<SuggestionsResponse>> {
  const params = new URLSearchParams({ q: query });
  return apiFetch<SuggestionsResponse>(`/suggestions?${params}`, signal);
}
