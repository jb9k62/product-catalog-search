import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricsSnapshot } from "../src/metrics.ts";
import { createApp } from "../src/app.ts";
import { fetchEnrichment } from "../src/upstream.ts";

// Same spy pattern as api.test.ts: wraps the real provider so a test can tell
// when an upstream call has actually started.
vi.mock(import("../src/upstream.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchEnrichment: vi.fn(actual.fetchEnrichment) };
});

// A fresh app (and fresh metrics closure) per test, so counts are exact.
let server: Server;
let baseUrl: string;

async function startApp(options: { logRequests?: boolean } = {}) {
  server = createApp(options).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
}

async function snapshot(): Promise<MetricsSnapshot> {
  const res = await fetch(`${baseUrl}/api/metrics`);
  return (await res.json()) as MetricsSnapshot;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("request counting", () => {
  beforeEach(() => startApp());

  it("counts search requests, including a client error", async () => {
    await fetch(`${baseUrl}/api/search?q=shoe`);
    await fetch(`${baseUrl}/api/search?q=bag`);
    await fetch(`${baseUrl}/api/search?sort=bogus`);

    const stats = (await snapshot()).routes["GET /api/search"];

    expect(stats).toMatchObject({
      count: 3,
      clientErrors: 1,
      serverErrors: 0,
      aborted: 0,
    });
    expect(stats!.avgMs).toBeGreaterThan(0);
    expect(stats!.maxMs).toBeGreaterThanOrEqual(stats!.avgMs);
  });

  it("shares one key across different query strings", async () => {
    await fetch(`${baseUrl}/api/search?q=shoe`);
    await fetch(`${baseUrl}/api/search?q=completely-different-query`);

    const body = await snapshot();

    expect(
      Object.keys(body.routes).filter((k) => k.startsWith("GET /api/search")),
    ).toEqual(["GET /api/search"]);
    expect(body.routes["GET /api/search"]).toMatchObject({ count: 2 });
  });

  it("shares one key across letter case and a trailing slash", async () => {
    for (const path of ["/api/search", "/api/Search", "/API/search/"]) {
      await fetch(`${baseUrl}${path}?q=shoe`);
    }

    const body = await snapshot();

    expect(
      Object.keys(body.routes).filter((k) =>
        k.toLowerCase().startsWith("get /api/search"),
      ),
    ).toEqual(["GET /api/search"]);
    expect(body.routes["GET /api/search"]).toMatchObject({ count: 3 });
  });

  it("buckets unmatched routes under one key", async () => {
    await fetch(`${baseUrl}/api/nope1`);
    await fetch(`${baseUrl}/api/nope2`);

    const body = await snapshot();

    expect(body.routes["GET (unmatched)"]).toMatchObject({ count: 2 });
    expect(body.routes["GET /api/nope1"]).toBeUndefined();
    expect(body.routes["GET /api/nope2"]).toBeUndefined();
  });

  it("sends a Server-Timing header split into search and enrich", async () => {
    const res = await fetch(`${baseUrl}/api/search?q=shoe`);
    const header = res.headers.get("server-timing");

    expect(header).toBeTruthy();
    const search = /search;dur=([\d.]+)/.exec(header!);
    const enrich = /enrich;dur=([\d.]+)/.exec(header!);

    expect(search).not.toBeNull();
    expect(enrich).not.toBeNull();
    expect(Number(search![1])).toBeGreaterThanOrEqual(0);
    expect(Number(enrich![1])).toBeGreaterThanOrEqual(0);
  });

  it("counts enrichment failures", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // below FAILURE_RATE: every upstream call fails

    await fetch(`${baseUrl}/api/search?pageSize=3`);

    const body = await snapshot();
    expect(body.enrichment).toEqual({ items: 3, failed: 3 });
  });

  it("counts a disconnected request as aborted, not as a completed search or enrichment", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // ~400ms latency, no simulated failures

    const controller = new AbortController();
    const request = fetch(`${baseUrl}/api/search`, {
      signal: controller.signal,
    }).catch(() => {});
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalled());
    controller.abort();
    await request;

    const body = await vi.waitFor(async () => {
      const snap = await snapshot();
      expect(snap.routes["GET /api/search"]?.aborted).toBe(1);
      return snap;
    });

    expect(body.routes["GET /api/search"]).toMatchObject({
      count: 0,
      aborted: 1,
    });
    expect(body.enrichment).toEqual({ items: 0, failed: 0 });
  });
});

describe("request logging", () => {
  it("logs one line per request when enabled", async () => {
    await startApp({ logRequests: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const lineRe = /^GET \/api\/categories 200 \d+\.\dms$/;

    await fetch(`${baseUrl}/api/categories`);

    await vi.waitFor(() =>
      expect(logSpy.mock.calls.some(([line]) => lineRe.test(line))).toBe(true),
    );
  });

  it("logs nothing by default", async () => {
    await startApp();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await fetch(`${baseUrl}/api/categories`);
    await snapshot(); // round-trip to be sure the "close" handler has had time to run

    expect(logSpy).not.toHaveBeenCalled();
  });
});
