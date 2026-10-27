# Bundle Update Log

## 2026-09-18

- **Update**: Fixed the typeahead review findings. Enter searches the typed text unless an option
  is highlighted, and typing drops the highlight. A press on the list no longer blurs the input,
  so a slow click or a scrollbar drag keeps it open. The list covers the results instead of
  pushing them down, and the pointer and keyboard share one highlight, marked with
  `aria-selected`. Suggestions are now limited to names that hold a query word, as
  [ADR-0006](/adr/0006-typeahead-suggestions.md) says. Scoring counts each index key once per
  query, whatever the word order ([search & ranking](/app/search-ranking.md)).
- **Update**: ADR-0006 and [AI assistance](/app/ai-assistance.md) now credit the typeahead build
  to a local Qwen model through the Pi harness, with Claude Opus 5 making the review fixes.
- **Update**: Formatted every concept with Prettier. Only tables, list markers and code examples
  changed.

## 2026-09-17

- **Update**: Fixed the typeahead request races found in review. Every dismissal of the suggestion
  list now aborts the in-flight request, and a response only renders while the input still holds
  the query it answers, so a stale response can no longer re-open the list after an Escape, blur,
  or backspace to a short prefix, nor overwrite a newer memo hit. `suggestItems` now dedups by name
  before the cap, and the searchbox no longer sets the unsupported aria-expanded state. See
  [ADR-0006](/adr/0006-typeahead-suggestions.md).
- **Update**: Follow-up review fixes. The suggestion list now only opens while the input still has
  focus, so a response that lands after the field was left can no longer pop the list back open
  over it, and a memo hit drops the request still in flight for the prefix it replaces. The local
  gemma model-run log is no longer tracked in the repo; the AI-assistance record stays in
  [ai-assistance](/app/ai-assistance.md).

## 2026-09-15

- **Update**: Added a section to [Architecture](/app/architecture.md#why-the-response-waits-for-enrichment)
  on why the search response waits for enrichment rather than filling in prices later.
- **Update**: Documented the typeahead stretch goal. New `GET /api/suggestions` endpoint
  (reuses the inverted index, no upstream enrichment, capped at 8 names), the client's
  request-avoidance wiring (shared 200ms debounce, 2-character minimum, per-query memo,
  aborting stale requests, and the searchbox-plus-listbox roles) in [api.md](/app/api.md) and
  [ADR-0006](/adr/0006-typeahead-suggestions.md), and linked it from the index.

## 2026-09-14

- **Update**: Added [ADR-0005](/adr/0005-hand-rolled-request-metrics.md) for the lightweight
  instrumentation stretch goal (request counters, `GET /api/metrics`, and a `Server-Timing`
  header on search), and updated the API and architecture docs to match.

## 2026-09-13

- **Update**: Checked every concept against the code, git history, and brief, fixed the
  errors, and shortened the text. Links to files outside the bundle became plain paths or
  `sources`. Rewrote the ADR guide as a short index, and added
  [ADR-0004](/adr/0004-document-design-as-okf-bundle.md) on why the docs use OKF. Removed
  `verified` until the author reviews the new text.
- **Creation**: Created the bundle from `SOLUTION.md`, which now summarises and links here,
  with concepts under `/app/` and `/adr/`. Folded `AIContributions.md` and the early planning
  conversation into [AI assistance](/app/ai-assistance.md).
