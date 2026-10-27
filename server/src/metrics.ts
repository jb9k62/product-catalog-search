import type { NextFunction, Request, Response } from "express";
import type { EnrichedItem } from "../../shared/api-types.ts";

interface RouteStats {
  count: number;
  totalMs: number;
  maxMs: number;
  clientErrors: number;
  serverErrors: number;
  aborted: number;
}

function newRouteStats(): RouteStats {
  return {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    clientErrors: 0,
    serverErrors: 0,
    aborted: 0,
  };
}

export interface MetricsSnapshot {
  since: string;
  routes: Record<
    string,
    {
      count: number;
      clientErrors: number;
      serverErrors: number;
      aborted: number;
      avgMs: number;
      maxMs: number;
    }
  >;
  enrichment: { items: number; failed: number };
}

// Built from originalUrl, minus the query string, so ?q=a and ?q=b share a key.
// Express changes req.path and req.baseUrl while routing, so they can't be
// trusted by the time "close" fires.
// Lower-cased and without a trailing slash, because Express matches routes the
// same way: /api/Search/ is the same route as /api/search, so it shares a key.
function routeKey(req: Request): string {
  const [pathname = "/"] = req.originalUrl.split("?");
  return `${req.method} ${pathname.toLowerCase().replace(/\/+$/, "") || "/"}`;
}

export function createMetrics(options: { logRequests: boolean }) {
  const since = new Date();
  const routes = new Map<string, RouteStats>();
  const enrichment = { items: 0, failed: 0 };

  function statsFor(key: string): RouteStats {
    let stats = routes.get(key);
    if (!stats) {
      stats = newRouteStats();
      routes.set(key, stats);
    }
    return stats;
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const start = performance.now();
    const key = routeKey(req);

    res.on("close", () => {
      const durationMs = performance.now() - start;
      // Every 404 shares one key, so requests for random paths can't grow the map without limit.
      const stats = statsFor(
        res.statusCode === 404 ? `${req.method} (unmatched)` : key,
      );

      // "close" also fires after a normal response. Only an early close is a disconnect.
      if (!res.writableFinished) {
        stats.aborted++;
        if (options.logRequests) {
          console.log(
            `${req.method} ${req.originalUrl} aborted ${durationMs.toFixed(1)}ms`,
          );
        }
        return;
      }

      stats.count++;
      stats.totalMs += durationMs;
      stats.maxMs = Math.max(stats.maxMs, durationMs);
      if (res.statusCode >= 500) stats.serverErrors++;
      else if (res.statusCode >= 400) stats.clientErrors++;

      if (options.logRequests) {
        console.log(
          `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
        );
      }
    });

    next();
  }

  function recordEnrichment(items: EnrichedItem[]): void {
    enrichment.items += items.length;
    enrichment.failed += items.filter((item) => item.enrichmentFailed).length;
  }

  function snapshot(): MetricsSnapshot {
    const routesOut: MetricsSnapshot["routes"] = {};
    for (const [key, stats] of routes) {
      routesOut[key] = {
        count: stats.count,
        clientErrors: stats.clientErrors,
        serverErrors: stats.serverErrors,
        aborted: stats.aborted,
        avgMs: stats.count === 0 ? 0 : round1(stats.totalMs / stats.count),
        maxMs: round1(stats.maxMs),
      };
    }

    return {
      since: since.toISOString(),
      routes: routesOut,
      enrichment: { items: enrichment.items, failed: enrichment.failed },
    };
  }

  return { middleware, recordEnrichment, snapshot };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export type Metrics = ReturnType<typeof createMetrics>;
