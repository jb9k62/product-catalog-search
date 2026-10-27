import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ApiError, SearchResponse } from "../../shared/api-types.ts";
import { createApp } from "../src/app.ts";
import { fetchEnrichment } from "../src/upstream.ts";

// Wrap the real provider in a spy (same behaviour), so a test can inspect the
// AbortSignal each upstream call received.
vi.mock(import("../src/upstream.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchEnrichment: vi.fn(actual.fetchEnrichment) };
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0); // port 0: the OS picks a free one
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  vi.restoreAllMocks(); // undo Math.random spies
  vi.clearAllMocks(); // reset the fetchEnrichment call history
});

describe("GET /api/search", () => {
  it("returns a page of enriched results", async () => {
    const res = await fetch(`${baseUrl}/api/search?pageSize=5`);
    const body = (await res.json()) as SearchResponse;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 5 });
    expect(body.items).toHaveLength(5);
    expect(body.total).toBeGreaterThan(5);
  });

  it("degrades items whose enrichment fails instead of failing the search", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // below FAILURE_RATE: every upstream call fails

    const res = await fetch(`${baseUrl}/api/search?pageSize=3`);
    const body = (await res.json()) as SearchResponse;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(3);
    for (const item of body.items) {
      expect(item).toMatchObject({
        enrichmentFailed: true,
        price: null,
        availability: null,
        deliveryEstimate: null,
      });
    }
  });

  it("serves the last page when asked for one past the end", async () => {
    const res = await fetch(`${baseUrl}/api/search?page=999&pageSize=50`);
    const body = (await res.json()) as SearchResponse;

    expect(body.page).toBe(1); // the whole catalog fits on one 50-item page
    expect(body.items).toHaveLength(body.total);
  });

  it.each([
    ["sort=bogus", "sort must be one of"],
    ["sort=price&sort=popularity", "sort must be a single value"],
    ["page=abc", "page must be a positive integer"],
    ["page=0", "page must be a positive integer"],
    ["pageSize=1.5", "pageSize must be a positive integer"],
  ])("rejects ?%s with a 400 BAD_REQUEST", async (query, message) => {
    const res = await fetch(`${baseUrl}/api/search?${query}`);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(message),
    });
  });

  it("aborts in-flight upstream calls when the client disconnects", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // ~400ms latency per call, and no simulated failures

    const controller = new AbortController();
    const request = fetch(`${baseUrl}/api/search`, {
      signal: controller.signal,
    }).catch(() => {});
    await vi.waitFor(() => expect(fetchEnrichment).toHaveBeenCalled());
    controller.abort();
    await request;

    const [, signal] = vi.mocked(fetchEnrichment).mock.calls[0]!;
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
  });
});

describe("unknown API routes", () => {
  it("return a JSON 404 rather than HTML", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "NOT_FOUND",
      message: "Not found",
    } satisfies ApiError);
  });
});
