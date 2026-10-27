import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../../shared/api-types.ts";
import {
  buildIndex,
  scoreCandidates,
  searchCatalog,
  tokenise,
  type SearchParams,
} from "../src/search.ts";

function item(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: "Item",
    category: "Misc",
    tags: [],
    basePopularity: 0,
    basePrice: 0,
    ...overrides,
  };
}

describe("tokenise", () => {
  it("lowercases, strips punctuation, and drops stopwords/short tokens", () => {
    expect(tokenise("Trail-Running Shoes, for the Win!")).toEqual([
      "trail",
      "running",
      "shoes",
      "win",
    ]);
  });

  it("folds accents instead of splitting the word", () => {
    expect(tokenise("Crème Brûlée")).toEqual(["creme", "brulee"]);
  });

  it("returns an empty array for an empty or whitespace-only string", () => {
    expect(tokenise("   ")).toEqual([]);
  });
});

describe("scoreCandidates (okf/app/search-ranking.md worked example)", () => {
  const i1 = item({
    id: "i1",
    name: "Trail Running Shoe",
    category: "Footwear",
    tags: ["trail", "lightweight"],
  });
  const i2 = item({
    id: "i2",
    name: "Running Shorts",
    category: "Apparel",
    tags: ["breathable"],
  });
  const i3 = item({
    id: "i3",
    name: "Trail Backpack",
    category: "Outdoor",
    tags: ["trail", "lightweight"],
  });
  const index = buildIndex([i1, i2, i3]);

  it("scores 'trail running' with i1 highest, matching both query tokens by name", () => {
    const scores = scoreCandidates("trail running", index);
    expect(scores?.get("i1")).toBe(6);
    expect(scores?.get("i2")).toBe(3);
    expect(scores?.get("i3")).toBe(3);
  });

  it("falls back to a prefix match for a token with no exact key", () => {
    const scores = scoreCandidates("runn", index); // no exact "runn" token in the index
    expect(scores?.get("i1")).toBe(3); // "running" name match
    expect(scores?.get("i2")).toBe(3);
    expect(scores?.has("i3")).toBe(false);
  });

  it("counts a repeated query word once", () => {
    expect(scoreCandidates("trail trail running", index)).toEqual(
      scoreCandidates("trail running", index),
    );
  });

  it("doesn't count a key twice when a prefix word and an exact word both reach it", () => {
    expect(scoreCandidates("runn running", index)).toEqual(
      scoreCandidates("running", index),
    );
  });

  it("scores nested prefix words the same whatever order they're typed in", () => {
    const idx = buildIndex([
      item({ id: "a", name: "Short Shoe" }),
      item({ id: "b", name: "Shoe" }),
    ]);
    // Both items match "sho", but only "a" also matches "shor", so it ranks higher.
    expect(scoreCandidates("sho shor", idx)).toEqual(
      new Map([
        ["a", 6],
        ["b", 3],
      ]),
    );
    expect(scoreCandidates("shor sho", idx)).toEqual(
      scoreCandidates("sho shor", idx),
    );
  });

  it("credits the strongest field once for a token matching multiple fields on the same item", () => {
    const tagAndName = item({
      id: "i4",
      name: "Trail Trail",
      category: "Outdoor",
      tags: ["trail"],
    });
    // "trail" appears in the name (weight 3) and as a tag (weight 1); Math.max keeps it at 3, not 4.
    expect(scoreCandidates("trail", buildIndex([tagAndName]))?.get("i4")).toBe(
      3,
    );
  });

  it("indexes each word of multi-word categories and hyphenated tags", () => {
    const mug = item({
      id: "mug",
      name: "Coffee Mug",
      category: "Home & Kitchen",
      tags: ["eco-friendly"],
    });
    const idx = buildIndex([mug]);
    expect(scoreCandidates("kitchen", idx)?.get("mug")).toBe(2); // category weight
    expect(scoreCandidates("friendly", idx)?.get("mug")).toBe(1); // tag weight
  });

  it("returns null (no text filter) for a query with no searchable tokens", () => {
    expect(scoreCandidates("the & a", index)).toBeNull();
  });
});

describe("searchCatalog", () => {
  const catalog: CatalogItem[] = [
    item({
      id: "shoe",
      name: "Trail Running Shoe",
      category: "Footwear",
      tags: ["trail"],
      basePopularity: 50,
      basePrice: 100,
    }),
    item({
      id: "boot",
      name: "Hiking Boot",
      category: "Footwear",
      tags: ["trail"],
      basePopularity: 90,
      basePrice: 50,
    }),
    item({
      id: "shorts",
      name: "Running Shorts",
      category: "Apparel",
      basePopularity: 10,
      basePrice: 20,
    }),
  ];
  const index = buildIndex(catalog);

  function search(overrides: Partial<SearchParams>) {
    return searchCatalog(catalog, index, {
      query: "",
      category: null,
      sort: "relevance",
      page: 1,
      pageSize: 10,
      ...overrides,
    });
  }

  const ids = (items: CatalogItem[]) => items.map((i) => i.id);

  it("filters by category", () => {
    const { items, total } = search({ category: "Footwear" });
    expect(total).toBe(2);
    expect(ids(items).sort()).toEqual(["boot", "shoe"]);
  });

  it("sorts by popularity descending", () => {
    expect(ids(search({ sort: "popularity" }).items)).toEqual([
      "boot",
      "shoe",
      "shorts",
    ]);
  });

  it("sorts by price ascending using basePrice, never requiring enrichment", () => {
    expect(ids(search({ sort: "price" }).items)).toEqual([
      "shorts",
      "boot",
      "shoe",
    ]);
  });

  it("combines free-text search with relevance ranking", () => {
    const { items, total } = search({ query: "trail" });
    expect(total).toBe(2);
    expect(ids(items)).toEqual(["shoe", "boot"]); // "shoe" matches "trail" by name (3), "boot" only by tag (1)
  });

  it("combines free-text search with the category filter", () => {
    expect(
      ids(search({ query: "running", category: "Apparel" }).items),
    ).toEqual(["shorts"]);
  });

  it("paginates results", () => {
    const page1 = search({ sort: "popularity", pageSize: 2 });
    const page2 = search({ sort: "popularity", page: 2, pageSize: 2 });

    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(ids(page2.items)).toEqual(["shorts"]);
  });

  it("clamps a page past the end to the last page", () => {
    const { items, page } = search({
      sort: "popularity",
      page: 99,
      pageSize: 2,
    });
    expect(page).toBe(2);
    expect(ids(items)).toEqual(["shorts"]);
  });

  it("returns no items for a query that matches nothing", () => {
    const { items, total } = search({ query: "zzz-no-match" });
    expect(total).toBe(0);
    expect(items).toEqual([]);
  });

  it("treats a query with only stopwords or single characters as no text filter", () => {
    expect(search({ query: "t" }).total).toBe(3);
  });
});
