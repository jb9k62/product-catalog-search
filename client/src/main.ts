import { isSortOption, type EnrichedItem } from "../../shared/api-types.ts";
import {
  fetchCategories,
  fetchSuggestions,
  searchItems,
  type SearchQuery,
} from "./api.ts";
import { createPagination } from "./components/pagination.ts";
import { createResultsList } from "./components/resultsList.ts";
import { createSuggestions } from "./components/suggestions.ts";

const DEBOUNCE_MS = 200;
const THEME_STORAGE_KEY = "search-discovery-theme";
// Longer than the server's 3s enrichment budget plus search time, so the client
// never gives up on a response the server is about to send (with degraded items).
const SEARCH_TIMEOUT_MS = 8000;
const CATEGORIES_TIMEOUT_MS = 5000;

// The single source of truth for what's on screen. Controls change it through
// setState(), and the URL mirrors it so a shared link restores the same view.
const state: SearchQuery = readStateFromUrl();

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const form = $<HTMLFormElement>("#search-form");
const themeToggle = $<HTMLButtonElement>("#theme-toggle");
const queryInput = $<HTMLInputElement>("#query");
const categorySelect = $<HTMLSelectElement>("#category");
const sortSelect = $<HTMLSelectElement>("#sort");
const statusEl = $<HTMLElement>("#status");
const resultsEl = $<HTMLUListElement>("#results");
const template = $<HTMLTemplateElement>("#result-card-tpl");
const suggestionsRoot = $<HTMLUListElement>("#suggestions");

const resultsList = createResultsList(resultsEl, template);
const pagination = createPagination($<HTMLElement>("#pagination"), (page) =>
  setState({ page }),
);

let controller: AbortController | undefined;
let generation = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// Typeahead bookkeeping. The memo means re-typing an already-answered prefix
// (or going Back/Forward across it) renders from memory instead of re-fetching.
const suggestionsMemo = new Map<string, string[]>();
let suggestionsController: AbortController | undefined;

const suggestions = createSuggestions(
  suggestionsRoot,
  queryInput,
  selectSuggestion,
);

// The one path for picking a suggestion, by click or by Enter. Same as typing
// + Enter: the choice lands in state and the URL, so a shared link restores
// the same search.
function selectSuggestion(name: string): void {
  closeSuggestions();
  clearTimeout(debounceTimer);
  queryInput.value = name;
  setState({ query: name, page: 1 });
}

// Every dismissal goes through here rather than suggestions.close() directly:
// aborting the in-flight request as well stops its stale response from re-opening
// the list after the user has closed it. An aborted fetch rejects with AbortError,
// which updateSuggestions swallows, so that response's .then never runs.
function closeSuggestions(): void {
  suggestionsController?.abort();
  suggestionsController = undefined;
  suggestions.close();
}

// The list only ever opens under the caret. Blur closes it, but a debounce
// started before the blur can still fire after that, so without this check a
// suggestion list would pop back open over a field the user has left.
function openSuggestions(items: string[]): void {
  if (document.activeElement !== queryInput) return;
  suggestions.open(items);
}

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent =
    theme === "dark" ? "Use light mode" : "Use dark mode";
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The current theme still applies when storage is unavailable.
  }
}

applyTheme(getInitialTheme());

themeToggle.addEventListener("click", () => {
  const nextTheme: Theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  saveTheme(nextTheme);
});

function readStateFromUrl(): SearchQuery {
  const params = new URLSearchParams(location.search);
  const sort = params.get("sort");
  const page = Number.parseInt(params.get("page") ?? "", 10);
  return {
    query: params.get("q") ?? "",
    category: params.get("category") ?? "",
    sort: isSortOption(sort) ? sort : "relevance",
    // URLs can be hand-edited: anything that isn't a positive integer means page 1.
    page: page > 0 ? page : 1,
  };
}

// A single view, so there's no route for the Navigation API to intercept:
// history.pushState/replaceState plus a popstate listener is all this needs.
// Discrete choices (page, filter, sort, Enter) push an entry so Back undoes them.
// Typing replaces the current entry, or every debounced keystroke would be a Back step.
function writeStateToUrl(mode: "push" | "replace"): void {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.category) params.set("category", state.category);
  if (state.sort !== "relevance") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));

  const search = params.toString() ? `?${params}` : "";
  if (search === location.search) return; // unchanged: don't add a duplicate Back step
  history[mode === "push" ? "pushState" : "replaceState"](
    null,
    "",
    search || location.pathname,
  );
}

// Reflects state into the form controls: on first load, and on Back/Forward.
function syncControls(): void {
  queryInput.value = state.query;
  categorySelect.value = state.category;
  sortSelect.value = state.sort;
}

// The one path from "state changed" to "screen updated".
function setState(
  patch: Partial<SearchQuery>,
  historyMode: "push" | "replace" = "push",
): void {
  Object.assign(state, patch);
  writeStateToUrl(historyMode);
  void runSearch();
}

async function runSearch(): Promise<void> {
  // Cancel the previous request: its answer is already out of date, and the
  // server stops that request's upstream calls when it sees the disconnect.
  controller?.abort();
  controller = new AbortController();
  // Either we cancel (newer search) or the timeout fires, whichever comes first.
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  ]);
  // abort() cancels the network work, but a response that had already finished
  // arriving can still resolve after a newer search started. The generation
  // check guarantees only the latest search ever renders.
  const gen = ++generation;

  setStatus("loading", "Searching…");

  let result;
  try {
    result = await searchItems(state, signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return; // superseded by a newer search
    throw err;
  }

  if (gen !== generation) return; // a newer search has started since

  if (!result.ok) {
    // The previous results stay on screen; the status line reports the failure.
    // Pressing Enter re-runs the search, so it doubles as a retry.
    setStatus("error", `Something went wrong: ${result.error.message}`);
    return;
  }

  const { items, total, page, pageSize } = result.data;
  if (page !== state.page) {
    // The server clamped an out-of-range page (e.g. a stale ?page=9 link). Adopt its answer.
    state.page = page;
    writeStateToUrl("replace");
  }
  // No cross-fade while the suggestions list is open. The list covers the
  // results, so they would fade over it, and while a transition starts the
  // browser sends every click to the page root, so a pick could be lost.
  resultsList.render(items, { animate: !suggestions.isOpen() });
  pagination.update(page, Math.ceil(total / pageSize));
  setStatus("idle", describeResults(items, total));
}

function setStatus(status: "loading" | "idle" | "error", text: string): void {
  statusEl.dataset.state = status;
  statusEl.textContent = text;
  // style.css dims the stale results while this is "true".
  resultsEl.setAttribute("aria-busy", String(status === "loading"));
}

function describeResults(items: EnrichedItem[], total: number): string {
  if (total === 0) return "No items match your search.";
  const failedCount = items.filter((item) => item.enrichmentFailed).length;
  const pricingNote =
    failedCount > 0 ? ` Live pricing unavailable for ${failedCount}.` : "";
  return `${total} item${total === 1 ? "" : "s"} found.${pricingNote}`;
}

async function populateCategories(): Promise<void> {
  const result = await fetchCategories(
    AbortSignal.timeout(CATEGORIES_TIMEOUT_MS),
  );
  // On failure the filter just offers "All categories". Search itself still works.
  if (!result.ok) return;

  categorySelect.append(...result.data.map((c) => new Option(c, c)));

  if (state.category && !result.data.includes(state.category)) {
    // A link with a category that doesn't exist: drop it, rather than the
    // control showing "All categories" while results are filtered by something else.
    setState({ category: "", page: 1 }, "replace");
  }
  categorySelect.value = state.category;
}

// Keeps the typeahead in step with the input, sharing the existing debounce so
// rapid typing coalesces into one request. A failed or aborted suggestion must
// never break search, so it only ever closes the list.
function updateSuggestions(rawText: string): void {
  const normalised = rawText.trim().toLowerCase();
  if (normalised.length < 2) {
    closeSuggestions();
    return;
  }

  // Memo hit: an already-answered prefix renders instantly, no request.
  const memoised = suggestionsMemo.get(normalised);
  if (memoised) {
    // Any request still in flight answers an older prefix that is no longer on
    // screen, so drop it rather than leave it to land unused.
    suggestionsController?.abort();
    suggestionsController = undefined;
    openSuggestions(memoised);
    return;
  }

  // A newer query supersedes the previous one: drop its in-flight request.
  suggestionsController?.abort();
  suggestionsController = new AbortController();
  const signal = suggestionsController.signal;

  fetchSuggestions(normalised, signal)
    .then((result) => {
      if (!result.ok) {
        closeSuggestions();
        return;
      }
      // The answer to `normalised` is correct no matter what the user has since
      // typed, so it is always worth remembering for the next time they type it.
      suggestionsMemo.set(normalised, result.data.suggestions);
      // But only display it while the input still holds that query. A response
      // for an older prefix must not overwrite what the user is now typing: a
      // memo hit can open the list for a new prefix before this response lands.
      if (queryInput.value.trim().toLowerCase() !== normalised) return;
      openSuggestions(result.data.suggestions);
    })
    .catch((err) => {
      // A superseded or dismissed request rejects with AbortError; that is
      // expected, so ignore it. apiFetch returns a Result for every other
      // failure, so anything else is a bug: rethrow it so it reaches the console.
      if (!(err instanceof DOMException && err.name === "AbortError"))
        throw err;
    });
}

queryInput.addEventListener("input", () => {
  // The open list still answers the old text until the debounce refreshes it,
  // so drop its highlight: Enter now searches what was typed.
  suggestions.clearHighlight();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateSuggestions(queryInput.value);
    // Skip the request if the text is back to what's already showing (e.g. typed then deleted a letter).
    if (queryInput.value === state.query) return;
    setState({ query: queryInput.value, page: 1 }, "replace");
  }, DEBOUNCE_MS);
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    // Only intercept while the list is open, and stop the caret jumping.
    if (!suggestions.isOpen()) return;
    event.preventDefault();
    suggestions.moveHighlight(event.key === "ArrowDown" ? 1 : -1);
    return;
  }

  if (event.key === "Enter" && suggestions.isOpen()) {
    // No highlighted option: fall through to the form submit, which searches
    // the typed text and closes the list.
    const selected = suggestions.selectHighlighted();
    if (selected === null) return;
    // preventDefault stops the form from also submitting, so there is exactly one search.
    event.preventDefault();
    selectSuggestion(selected);
    return;
  }

  if (event.key === "Escape") {
    const wasOpen = suggestions.isOpen();
    // Always abort the in-flight request, so a response that is still on its
    // way cannot re-open the list after a dismiss. Only swallow the event when
    // the list was open; that also stops type="search" from clearing the field
    // along with the suggestions. With the list closed, the browser's default
    // (clear the field) still applies.
    closeSuggestions();
    if (wasOpen) event.preventDefault();
  }
});

// Pressing on the list doesn't blur the input (see components/suggestions.ts),
// so a blur means focus really left, and the list can close straight away.
queryInput.addEventListener("blur", closeSuggestions);

form.addEventListener("submit", (event) => {
  event.preventDefault(); // stay on the page; the <form> is here for Enter-to-search and role="search"
  clearTimeout(debounceTimer);
  closeSuggestions();
  setState({ query: queryInput.value, page: 1 });
});

categorySelect.addEventListener("change", () => {
  setState({ category: categorySelect.value, page: 1 });
});

sortSelect.addEventListener("change", () => {
  if (isSortOption(sortSelect.value))
    setState({ sort: sortSelect.value, page: 1 });
});

// Back/Forward changed the URL, so read state from it (not the other way round).
window.addEventListener("popstate", () => {
  clearTimeout(debounceTimer);
  closeSuggestions();
  Object.assign(state, readStateFromUrl());
  syncControls();
  void runSearch();
});

syncControls();
void populateCategories();
void runSearch();
