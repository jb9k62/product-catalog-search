import type { CatalogItem, SortOption } from "../../shared/api-types.ts";

const STOPWORDS = new Set(["a", "an", "the", "and", "or", "for", "with", "of"]);

/**
 * The one tokeniser for both item text (at index time) and the query (at
 * search time). Running both sides through the same function is what
 * guarantees a query word can ever equal an index key.
 *
 * "Trail-Running Shoes, for the Win!" -> ["trail", "running", "shoes", "win"]
 */
export function tokenise(text: string): string[] {
  return (
    text
      .toLowerCase()
      // NFKD splits "é" into "e" plus a separate combining accent mark. Removing
      // the marks folds accents ("crème" -> "creme"). Without this step the
      // punctuation replace below would turn each mark into a space, splitting
      // the word in two ("cre me").
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      // Anything that isn't a letter, digit, or whitespace becomes a word
      // break, so "moisture-wicking" yields "moisture" and "wicking".
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      // Single characters and stopwords match nearly everything: noise, not signal.
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
  );
}

// Where a word appears says how strongly it describes the item: a word in the
// name beats the category, which beats a descriptive tag.
const FIELD_WEIGHT = { name: 3, category: 2, tag: 1 } as const;

// token -> (itemId -> field weight). A Map of Maps gives O(1) lookup of every
// item carrying a token. Weights are stored at build time so the query path is
// only lookups and additions.
export type InvertedIndex = Map<string, Map<string, number>>;

function addToken(
  index: InvertedIndex,
  token: string,
  itemId: string,
  weight: number,
): void {
  const postings = index.get(token) ?? new Map<string, number>();
  // Math.max: a word in both the name and a tag counts once, at the stronger weight.
  postings.set(itemId, Math.max(postings.get(itemId) ?? 0, weight));
  index.set(token, postings);
}

// Built once at startup. Every field goes through tokenise(), so multi-word
// values ("Home & Kitchen", "quick-dry") are searchable by each of their words.
export function buildIndex(items: CatalogItem[]): InvertedIndex {
  const index: InvertedIndex = new Map();
  for (const item of items) {
    for (const token of tokenise(item.name))
      addToken(index, token, item.id, FIELD_WEIGHT.name);
    for (const token of tokenise(item.category))
      addToken(index, token, item.id, FIELD_WEIGHT.category);
    for (const token of item.tags.flatMap(tokenise))
      addToken(index, token, item.id, FIELD_WEIGHT.tag);
  }
  return index;
}

// Only used when a query word has no exact key, so partial words still match
// while typing ("runn" -> "running"). It's a linear scan over the keys, but
// that's a few dozen strings at this catalog size.
// Skips keys already in `counted` and adds the ones it uses, so no key is
// scored twice in one query.
// Known limitation: an exact key skips the scan, so if both "shoe" and "shoes"
// were keys, "shoe" wouldn't match "shoes". There's no stemming either.
function matchByPrefix(
  index: InvertedIndex,
  token: string,
  counted: Set<string>,
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const [key, postings] of index) {
    if (!key.startsWith(token) || counted.has(key)) continue;
    counted.add(key);
    for (const [itemId, weight] of postings) {
      merged.set(itemId, Math.max(merged.get(itemId) ?? 0, weight));
    }
  }
  return merged;
}

/**
 * Scores every item matching at least one query word. Words are OR'd: an
 * item's score is the sum of its best field weight for each word it matches,
 * so items matching more of the query rank higher.
 *
 * Returns null when the query has no searchable words (empty, or only
 * stopwords and single characters). That means "no text filter", not "no
 * matches": typing "t" shouldn't flash an empty state.
 */
export function scoreCandidates(
  query: string,
  index: InvertedIndex,
): Map<string, number> | null {
  const tokens = tokenise(query);
  if (tokens.length === 0) return null;

  // Each index key counts once per query, so "trail trail" or "runn running"
  // can't score the same word twice. Exact words claim their keys first. Longer
  // words go first too, so when one prefix word sits inside another ("sho",
  // "shor") the scores don't depend on which was typed first.
  const words = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  const counted = new Set(words.filter((word) => index.has(word)));

  const scores = new Map<string, number>(); // itemId -> score
  for (const word of words) {
    const postings = index.get(word) ?? matchByPrefix(index, word, counted);
    for (const [itemId, weight] of postings) {
      scores.set(itemId, (scores.get(itemId) ?? 0) + weight);
    }
  }
  return scores;
}

export interface SearchParams {
  query: string;
  category: string | null;
  sort: SortOption;
  page: number;
  pageSize: number;
}

export interface SearchResult {
  items: CatalogItem[];
  total: number;
  page: number; // after clamping to the last page
}

// Typed as a Record keyed by SortOption, so adding a sort option without a
// comparator is a compile error. Each returns a negative number when `a` comes first.
const SORT_COMPARATORS: Record<
  SortOption,
  (a: CatalogItem, b: CatalogItem, scores: Map<string, number> | null) => number
> = {
  relevance: (a, b, scores) =>
    (scores?.get(b.id) ?? 0) - (scores?.get(a.id) ?? 0), // best match first
  price: (a, b) => a.basePrice - b.basePrice, // cheapest first
  popularity: (a, b) => b.basePopularity - a.basePopularity, // most popular first
};

// Search, filter, sort, paginate: all in memory, all before enrichment. The
// route then enriches only the page returned here.
export function searchCatalog(
  catalog: CatalogItem[],
  index: InvertedIndex,
  params: SearchParams,
): SearchResult {
  const scores = scoreCandidates(params.query, index);

  const candidates = catalog.filter(
    (item) =>
      (!scores || scores.has(item.id)) &&
      (!params.category || item.category === params.category),
  );

  // filter() already returned a new array, so sorting in place can't mutate the
  // shared catalog. Array.prototype.sort is stable (guaranteed since ES2019),
  // so ties keep catalog order and the same query always paginates identically.
  candidates.sort((a, b) => SORT_COMPARATORS[params.sort](a, b, scores));

  // Clamp rather than return an empty page, so a stale deep link still shows results.
  const pageCount = Math.max(1, Math.ceil(candidates.length / params.pageSize)); // 100 / 25 = 4 pages, 101 / 25 = 5 pages, always at least 1 page
  const page = Math.min(params.page, pageCount); // 1-based, so page 0 is clamped to 1 and page 5 of 4 is clamped to 4
  const start = (page - 1) * params.pageSize;

  return {
    items: candidates.slice(start, start + params.pageSize),
    total: candidates.length,
    page,
  };
}

// Top relevance matches, no pagination or enrichment: the typeahead path. It
// reuses scoreCandidates and the relevance sort, so suggestions rank the same
// way as search results. Only names are suggested that hold a query word (or a
// word starting with one): an item found only through a tag or category would
// suggest a name that doesn't contain what was typed. Returns at most `limit`
// distinct names, best match first, ties in catalog order. A query with no
// searchable words (empty, or only stopwords) matches nothing.
export function suggestItems(
  catalog: CatalogItem[],
  index: InvertedIndex,
  query: string,
  limit: number,
): CatalogItem[] {
  const scores = scoreCandidates(query, index);
  if (!scores) return [];

  const words = tokenise(query);
  const matches = catalog.filter(
    (item) =>
      scores.has(item.id) &&
      tokenise(item.name).some((token) =>
        words.some((word) => token.startsWith(word)),
      ),
  );
  // filter() returned a new array, so sorting in place can't mutate the shared
  // catalog. The sort is stable, so ties keep catalog order.
  matches.sort((a, b) => SORT_COMPARATORS.relevance(a, b, scores));

  // Dedup by name before capping, so the limit is on the distinct names shown
  // rather than on rows (two items sharing a name would otherwise waste a slot
  // and push a real suggestion past the cap).
  const seen = new Set<string>();
  const unique: CatalogItem[] = [];
  for (const item of matches) {
    if (unique.length >= limit) break; // checked first, so a limit of 0 returns none
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    unique.push(item);
  }
  return unique;
}
