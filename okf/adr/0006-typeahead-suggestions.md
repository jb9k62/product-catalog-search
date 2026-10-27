---
type: Architectural Decision
title: "ADR-0006: Typeahead suggestions, cheap by design"
description: Why suggestions are one endpoint reusing the inverted index with no enrichment, and how the client avoids unnecessary requests.
tags: [typeahead, suggestions, api, search, adr]
generated: { by: qwen (Pi harness), at: 2026-09-15 }
sources:
  - resource: server/src/routes/search.ts
  - resource: server/src/search.ts
  - resource: client/src/main.ts
  - resource: server/test/suggestions.test.ts
---

# ADR-0006: Typeahead suggestions, cheap by design

- **Status:** accepted
- **Date:** 2026-09-15
- **Deciders:** Jordan Hunt, with a local Qwen model through the Pi agent harness (build) and
  Claude Opus 5 (review fixes)

## Context

The brief lists typeahead suggestions that avoid unnecessary requests as a stretch goal,
pursued only once the core requirements are complete. Suggestions fire on every debounce tick,
so they must be fast and must not add load to the upstream provider, which is already the slow,
unreliable part of a search.

## Decision

We will add one `GET /api/suggestions?q=` endpoint on the existing search router. It reuses
the inverted index via `suggestItems` (the same ranking that drives search results) and never
calls the upstream provider, so it returns instantly and cannot fail enrichment. The client
avoids unnecessary requests with the existing 200ms debounce, a 2-character minimum, a per-query
memo (re-typing an answered prefix renders from memory, no request), and aborting stale
suggestion requests. The input keeps its `role="search"` searchbox, with a separate listbox
for suggestions rather than a combobox. The list opens with nothing highlighted, so Enter
searches the typed text unless an option was picked with the arrow keys or the pointer.

## Consequences

### Positive

- Suggestions share the search ranking, so the two feel consistent.
- No enrichment means no upstream load, no failures, and no disconnect handling on this route.
- The client's memo and aborting together mean rapid typing and Back/Forward never re-fetch an
  already-answered prefix.

### Trade-offs

- A combobox role would expose the full autocomplete contract to assistive tech, but the brief
  targets Chrome latest only and the searchbox-plus-listbox keeps the roles separate and simple.
  The input therefore keeps its searchbox role, and aria-expanded (a state the searchbox role does
  not support) is omitted; aria-activedescendant and aria-selected mark the active option.
- Suggestions only return item names that hold a query word, so a query that matches only a tag
  or category suggests nothing even though search would find items.
- The memo is unbounded in memory (one entry per typed prefix); trivial at this catalog size.

## Alternatives considered

| Option                                                                             | Why rejected                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combobox role (`role="combobox"` with `aria-expanded` and `aria-activedescendant`) | The correct full ARIA autocomplete pattern, but more surface to get wrong; the searchbox with a separate listbox covers the keyboard interactions we need and keeps the input's searchbox role. |
| Enrich suggestions through the upstream provider                                   | Adds the slow, failing provider to every keystroke for no benefit; suggestions are plain names, so there is nothing to enrich.                                                                  |
| Generate suggestions client-side from a downloaded catalog                         | Duplicates the ranking and index on the client, and the catalog would need to be shipped to the browser.                                                                                        |
