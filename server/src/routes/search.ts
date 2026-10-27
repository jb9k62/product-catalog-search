import { Router, type Response } from "express";
import {
  isSortOption,
  SORT_OPTIONS,
  type CatalogItem,
  type EnrichedItem,
  type SearchResponse,
  type SuggestionsResponse,
} from "../../../shared/api-types.ts";
import { AppError } from "../errors.ts";
import type { Metrics } from "../metrics.ts";
import {
  searchCatalog,
  suggestItems,
  type InvertedIndex,
  type SearchParams,
} from "../search.ts";
import { fetchEnrichment } from "../upstream.ts";

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
// Total time allowed to enrich a whole page, shared by every item's upstream
// call. Far above the simulated 400ms worst case, so it only fires if a real
// provider hangs. Whatever hasn't answered by then is returned degraded.
const ENRICHMENT_BUDGET_MS = 3000;

export function createSearchRouter(
  catalog: CatalogItem[],
  index: InvertedIndex,
  metrics: Metrics,
): Router {
  const router = Router();
  // The catalog never changes at runtime, so work this out once, not per request.
  const categories = [...new Set(catalog.map((item) => item.category))].sort();

  // No try/catch + next(err) needed: Express 5 forwards an error thrown (or a
  // promise rejected) inside an async handler to the error middleware itself.
  router.get("/search", async (req, res) => {
    const params = parseSearchParams(req.query);

    const t0 = performance.now();
    const { items, total, page } = searchCatalog(catalog, index, params);
    const t1 = performance.now();

    const signal = abortOnDisconnect(res);
    const enrichedItems = await enrichPage(items, signal);
    const t2 = performance.now();
    // Items cut short by our own disconnect handling are not upstream
    // failures, so leave them out of the failure count.
    if (!signal.aborted) metrics.recordEnrichment(enrichedItems);

    res.set(
      "Server-Timing",
      `search;dur=${(t1 - t0).toFixed(1)};desc="Catalog search", enrich;dur=${(t2 - t1).toFixed(1)};desc="Upstream enrichment"`,
    );
    res.json({
      items: enrichedItems,
      total,
      page,
      pageSize: params.pageSize,
    } satisfies SearchResponse);
  });

  router.get("/categories", (_req, res) => {
    res.json(categories);
  });

  // Typeahead suggestions: exact item names, ranked by relevance, capped at 8.
  // No enrichment, so no upstream calls and no disconnect handling needed.
  router.get("/suggestions", (req, res) => {
    // stringParam turns a repeated key (?q=a&q=b) into a 400 automatically.
    const q = stringParam(req.query, "q") ?? "";
    if (q === "") {
      res.json({ suggestions: [] } satisfies SuggestionsResponse);
      return;
    }

    // suggestItems already returns distinct names, capped at 8, best match first.
    const names = suggestItems(catalog, index, q, 8).map((item) => item.name);
    res.json({ suggestions: names } satisfies SuggestionsResponse);
  });

  return router;
}

// Validate once, at the boundary: everything past here can trust SearchParams.
// Bad input is a 400, not a silent default, so a broken link or client bug is
// visible rather than quietly showing the wrong results.
function parseSearchParams(query: Record<string, unknown>): SearchParams {
  const sort = stringParam(query, "sort") ?? "relevance";
  if (!isSortOption(sort)) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      `sort must be one of: ${SORT_OPTIONS.join(", ")}`,
    );
  }

  return {
    query: stringParam(query, "q") ?? "",
    category: stringParam(query, "category") || null, // ?category= (empty) means all categories
    sort,
    page: positiveIntParam(query, "page") ?? 1,
    // Capped rather than rejected: a big page size is a reasonable request we can partly honour.
    pageSize: Math.min(
      positiveIntParam(query, "pageSize") ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
  };
}

// Express's query parser turns a repeated key (?sort=a&sort=b) into an array,
// so "is this a string" has to be checked, not assumed.
function stringParam(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new AppError(400, "BAD_REQUEST", `${name} must be a single value`);
  return value;
}

function positiveIntParam(
  query: Record<string, unknown>,
  name: string,
): number | undefined {
  const value = stringParam(query, name);
  if (value === undefined) return undefined;
  // Digits only: Number.parseInt would quietly accept "2abc" as 2 and "1.5" as 1.
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < 1 || !Number.isSafeInteger(parsed)) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      `${name} must be a positive integer`,
    );
  }
  return parsed;
}

// Aborts if the browser goes away before we respond, e.g. the client cancelled
// a stale search because the user kept typing. That stops upstream calls for a
// response nobody will read, completing the cancellation chain from browser to provider.
function abortOnDisconnect(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    // "close" also fires after a normal response. Only an early close is a disconnect.
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

// Enrichment is best-effort per item: a slow or failing upstream call
// degrades that one item rather than failing the whole search.
async function enrichPage(
  items: CatalogItem[],
  disconnected: AbortSignal,
): Promise<EnrichedItem[]> {
  // One deadline for the whole page, not one per item, so response time is
  // bounded however many items are slow.
  const signal = AbortSignal.any([
    AbortSignal.timeout(ENRICHMENT_BUDGET_MS),
    disconnected,
  ]);

  // Every call starts at once, so a page costs its slowest item, not the sum of
  // all of them. Each call catches its own failure, so Promise.all never rejects.
  return Promise.all(
    items.map(async (item): Promise<EnrichedItem> => {
      try {
        return {
          ...item,
          ...(await fetchEnrichment(item, signal)),
          enrichmentFailed: false,
        };
      } catch {
        return {
          ...item,
          price: null,
          availability: null,
          deliveryEstimate: null,
          enrichmentFailed: true,
        };
      }
    }),
  );
}
