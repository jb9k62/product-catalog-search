import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CatalogItem,
  SuggestionsResponse,
} from "../../shared/api-types.ts";
import { createApp } from "../src/app.ts";
import { buildIndex, suggestItems } from "../src/search.ts";

function item(
  id: string,
  name: string,
  category = "Misc",
  tags: string[] = [],
): CatalogItem {
  return { id, name, category, tags, basePopularity: 1, basePrice: 1 };
}

describe("suggestItems (direct helper)", () => {
  it("suggests items whose names contain the matching word via prefix fallback", () => {
    const catalog = [
      item("ultra", "Ultra Running Shoe"),
      item("essential", "Essential Running Shoe"),
      item("camp", "Camping Chair"),
    ];
    const index = buildIndex(catalog);

    const names = suggestItems(catalog, index, "runn", 8).map((i) => i.name);

    // "runn" has no exact key, so prefix fallback finds "running". "Camping
    // Chair" doesn't match. The two matches tie, so catalog order holds.
    expect(names).toEqual(["Ultra Running Shoe", "Essential Running Shoe"]);
    expect(names.every((name) => name.toLowerCase().includes("running"))).toBe(
      true,
    );
  });

  it("ranks a strong match before a weaker one", () => {
    const catalog = [
      item("run", "Running"),
      item("shoe", "Running Shoe"), // matches both query words
    ];
    const index = buildIndex(catalog);

    const names = suggestItems(catalog, index, "running shoe", 8).map(
      (i) => i.name,
    );

    // "Running Shoe" scores for both words; "Running" for one.
    expect(names).toEqual(["Running Shoe", "Running"]);
  });

  it("returns at most limit items, ties in catalog order", () => {
    const catalog = Array.from({ length: 10 }, (_, i) =>
      item(`w${i}`, `Widget ${i}`),
    );
    const index = buildIndex(catalog);

    const items = suggestItems(catalog, index, "widget", 8);

    expect(items).toHaveLength(8);
    // All ten match with equal score, so the first eight in catalog order win.
    expect(items.map((i) => i.id)).toEqual([
      "w0",
      "w1",
      "w2",
      "w3",
      "w4",
      "w5",
      "w6",
      "w7",
    ]);
  });

  it("returns unique names (a Set of the result is unchanged)", () => {
    const catalog = Array.from({ length: 10 }, (_, i) =>
      item(`w${i}`, `Widget ${i}`),
    );
    const index = buildIndex(catalog);

    const names = suggestItems(catalog, index, "widget", 8).map((i) => i.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("dedups by name before capping, so the limit is on distinct names", () => {
    const catalog = [
      item("a1", "Trail Shoe"),
      item("a2", "Trail Shoe"), // same name and score as a1
      item("b1", "Trail Hat"),
      item("c1", "Trail Sock"),
    ];
    const index = buildIndex(catalog);

    const names = suggestItems(catalog, index, "trail", 2).map((i) => i.name);

    // All four match with equal score, so catalog order holds. Capping at 2
    // distinct names skips the duplicate "Trail Shoe" rather than returning it
    // twice, so a real third name ("Trail Hat") still makes the cut.
    expect(names).toEqual(["Trail Shoe", "Trail Hat"]);
  });

  it("doesn't suggest an item found only through a tag or category", () => {
    const catalog = [
      item("shoe", "Trail Shoe"),
      item("chair", "Camping Chair", "Outdoor", ["trail"]),
      item("boot", "Hiking Boot", "Footwear"),
    ];
    const index = buildIndex(catalog);

    const names = (q: string) =>
      suggestItems(catalog, index, q, 8).map((i) => i.name);

    // Search would find the chair (tag) and the boot (category), but neither
    // name holds the typed word, so neither is suggested.
    expect(names("trail")).toEqual(["Trail Shoe"]);
    expect(names("foot")).toEqual([]);
  });

  it("returns [] for a limit of 0", () => {
    const catalog = [item("run", "Running Shoe")];
    const index = buildIndex(catalog);

    expect(suggestItems(catalog, index, "running", 0)).toEqual([]);
  });

  it("returns [] when the query has no searchable words", () => {
    const catalog = [item("run", "Running Shoe")];
    const index = buildIndex(catalog);

    expect(suggestItems(catalog, index, "the", 8)).toEqual([]); // stopword only
    expect(suggestItems(catalog, index, "", 8)).toEqual([]);
  });
});

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0); // port 0: the OS picks a free one
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("GET /api/suggestions", () => {
  it("suggests exact item names for a matching prefix", async () => {
    const res = await fetch(`${baseUrl}/api/suggestions?q=runn`);
    const body = (await res.json()) as SuggestionsResponse;

    expect(res.status).toBe(200);
    expect(body.suggestions).toContain("Ultra Running Shoe");
    expect(body.suggestions).toContain("Essential Running Shoe");
    // Names only: no enrichment, so no live price/availability fields leak in.
    expect(body.suggestions.every((name) => typeof name === "string")).toBe(
      true,
    );
  });

  it("caps at 8 suggestions and never repeats a name", async () => {
    // A short, common token matches a lot of the catalog (e.g. "trail" in names
    // and tags), so this exercises both the cap and the dedup Set.
    const res = await fetch(`${baseUrl}/api/suggestions?q=trail`);
    const body = (await res.json()) as SuggestionsResponse;

    expect(res.status).toBe(200);
    expect(body.suggestions.length).toBeLessThanOrEqual(8);
    expect(new Set(body.suggestions).size).toBe(body.suggestions.length);
  });

  it("returns { suggestions: [] } for an empty q", async () => {
    const res = await fetch(`${baseUrl}/api/suggestions?q=`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: [],
    } satisfies SuggestionsResponse);
  });

  it("returns { suggestions: [] } when q is missing", async () => {
    const res = await fetch(`${baseUrl}/api/suggestions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: [],
    } satisfies SuggestionsResponse);
  });

  it("rejects a repeated q param with a 400", async () => {
    const res = await fetch(`${baseUrl}/api/suggestions?q=a&q=b`);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "BAD_REQUEST",
      message: "q must be a single value",
    });
  });
});
