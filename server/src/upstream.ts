import { setTimeout as sleep } from "node:timers/promises";
import type { Availability, CatalogItem } from "../../shared/api-types.ts";
import { AppError } from "./errors.ts";

export interface UpstreamEnrichment {
  price: number;
  availability: Availability;
  deliveryEstimate: string;
}

const AVAILABILITY_OPTIONS: readonly Availability[] = [
  "In stock",
  "Low stock",
  "Backordered",
];
const DELIVERY_OPTIONS = ["1-2 days", "3-5 days", "1 week", "2 weeks"] as const;

const MIN_LATENCY_MS = 80;
const MAX_LATENCY_MS = 400;
const FAILURE_RATE = 0.08; // chance that any single call fails
const PRICE_VARIANCE = 0.05; // live price moves up to +/-5% from basePrice

function randomFrom<T>(options: readonly T[]): T {
  // The cast is safe: the index is always in range. It's only needed because
  // `noUncheckedIndexedAccess` types every array read as `T | undefined`.
  return options[Math.floor(Math.random() * options.length)] as T;
}

/**
 * Simulates a third-party provider: variable latency and an occasional
 * failure, in-process rather than a separate service (per requirements.md).
 *
 * Takes an AbortSignal, as a real `fetch` would, so the caller decides when to
 * give up: a time budget, or the browser disconnecting.
 */
export async function fetchEnrichment(
  item: Pick<CatalogItem, "basePrice">,
  signal: AbortSignal,
): Promise<UpstreamEnrichment> {
  const latencyMs =
    MIN_LATENCY_MS + Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS);
  try {
    // The promise-based timer rejects as soon as `signal` aborts (immediately
    // if it already has) and cleans up its own abort listener either way.
    await sleep(latencyMs, undefined, { signal });
  } catch {
    throw new AppError(504, "UPSTREAM_TIMEOUT", "Upstream request aborted");
  }

  if (Math.random() < FAILURE_RATE) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "Upstream provider failed to respond",
    );
  }

  const variance = 1 + (Math.random() * 2 - 1) * PRICE_VARIANCE; // somewhere in [0.95, 1.05)
  return {
    price: Math.round(item.basePrice * variance * 100) / 100, // round to cents
    availability: randomFrom(AVAILABILITY_OPTIONS),
    deliveryEstimate: randomFrom(DELIVERY_OPTIONS),
  };
}
