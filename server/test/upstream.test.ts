import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors.ts";
import { fetchEnrichment } from "../src/upstream.ts";

afterEach(() => vi.restoreAllMocks());

describe("fetchEnrichment", () => {
  const item = { basePrice: 1000 };

  it("resolves with a price derived from basePrice, plus availability and delivery estimate", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // stays above FAILURE_RATE, so this is the success path

    const result = await fetchEnrichment(item, AbortSignal.timeout(2000));

    expect(result.price).toBeCloseTo(1000 * (1 + (0.99 * 0.1 - 0.05)), 2);
    expect(typeof result.availability).toBe("string");
    expect(typeof result.deliveryEstimate).toBe("string");
  });

  it("rejects with an UPSTREAM_ERROR AppError on a simulated failure", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // below FAILURE_RATE, so this always fails

    const pending = fetchEnrichment(item, AbortSignal.timeout(2000));
    // instanceof matters: it's how the error middleware recognises a deliberate error.
    await expect(pending).rejects.toBeInstanceOf(AppError);
    await expect(pending).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_ERROR",
    } satisfies Partial<AppError>);
  });

  it("rejects immediately with UPSTREAM_TIMEOUT when the signal is already aborted", async () => {
    await expect(
      fetchEnrichment(item, AbortSignal.abort()),
    ).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_TIMEOUT",
    } satisfies Partial<AppError>);
  });

  it("rejects with UPSTREAM_TIMEOUT if aborted mid-flight", async () => {
    const controller = new AbortController();
    const pending = fetchEnrichment(item, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
    } satisfies Partial<AppError>);
  });
});
