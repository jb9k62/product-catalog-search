---
name: hand-rolled-web-client
description: Build a framework-free TypeScript SPA client (components, routing, API calls, error handling, search/filter/sort) using modern browser APIs, targeting Chrome latest only. Use when writing or reviewing any code under the web client for this project.
---

# Hand-Rolled Web Client (Vanilla TS SPA)

No framework. Chrome latest is the only target, so we lean on native browser APIs instead of reaching for libraries that exist to paper over missing platform features.

## When to Use This Skill

- Structuring components in the vanilla client
- Wiring up client-side routing or SPA-like navigation
- Writing the API client (fetch wrapper, typed requests/responses)
- Handling loading, partial, and error states in the UI
- Implementing free-text search, filtering, or sorting on the client
- Deciding whether a modern browser API replaces a hand-rolled utility

## Components: factory + template pattern

No JSX, no vdom. Use plain functions that clone a `<template>`, wire up listeners, and return an element plus an `update` function. Light DOM only (no Shadow DOM) so plain CSS keeps working without scoping gymnastics.

```typescript
type Component<Props> = {
  el: HTMLElement;
  update: (props: Props) => void;
};

function ResultCard(initial: EnrichedItem): Component<EnrichedItem> {
  const tpl = document.getElementById("result-card-tpl") as HTMLTemplateElement;
  const el = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;

  const price = el.querySelector<HTMLElement>("[data-price]")!;
  const availability = el.querySelector<HTMLElement>("[data-availability]")!;

  function update(item: EnrichedItem) {
    el.querySelector("[data-name]")!.textContent = item.name;
    price.textContent = item.price
      ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(item.price)
      : "Price unavailable";
    availability.textContent = item.availability ?? "Checking availability…";
    el.classList.toggle("is-degraded", item.enrichmentFailed === true);
  }

  update(initial);
  return { el, update };
}
```

Rules of thumb:
- One factory per component. It owns its DOM fragment and never reaches outside it.
- `update()` re-renders in place; don't tear down and rebuild the subtree on every state change.
- For lists (search results), diff by key (item id): reuse existing component instances, only create/remove what changed. Full list wipe-and-redraw is the main perf/flicker risk in a hand-rolled SPA.
- Use `<template>` + `content.cloneNode(true)` for all repeated markup. It's parsed once, inert until cloned, and keeps HTML out of template-string soup.

See `references/details.md` for a full keyed-list renderer.

## SPA-like navigation: Navigation API

Chrome latest supports the Navigation API (`window.navigation`). Prefer it over manual `history.pushState` + `popstate` juggling:

```typescript
navigation.addEventListener("navigate", (event: NavigateEvent) => {
  if (!event.canIntercept || event.hashChange) return;
  const url = new URL(event.destination.url);
  if (url.pathname !== "/") return;

  event.intercept({
    handler: () => renderSearchView(url.searchParams),
  });
});
```

This gets back/forward, link interception, and URL-synced state (search query, filter, sort as `URLSearchParams`) with no router library. Wrap the results-area update in `document.startViewTransition()` so filter/sort changes cross-fade instead of popping:

```typescript
function renderResults(items: EnrichedItem[]) {
  const apply = () => resultsList.replaceChildren(...items.map(renderCard));
  document.startViewTransition ? document.startViewTransition(apply) : apply();
}
```

Always feature-detect `startViewTransition` and `navigation` even though we only target Chrome latest — it keeps the code honest about what it depends on and avoids a hard crash on a Chrome version without it.

## API client: shared types, one fetch wrapper

Define request/response shapes once in a shared module imported by both server and client (e.g. `shared/api-types.ts`), never redeclared. That module is the contract.

```typescript
// shared/api-types.ts — imported by both server and client
export interface SearchResponse {
  items: EnrichedItem[];
  total: number;
  page: number;
}

export interface ApiError {
  code: "UPSTREAM_TIMEOUT" | "UPSTREAM_ERROR" | "BAD_REQUEST" | "NOT_FOUND";
  message: string;
}
```

Client fetch wrapper: typed, one abort/timeout strategy, one error shape.

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function apiFetch<T>(path: string, signal: AbortSignal): Promise<Result<T>> {
  try {
    const res = await fetch(`/api${path}`, { signal });
    if (!res.ok) {
      const error: ApiError = await res.json();
      return { ok: false, error };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err; // let caller ignore cancelled requests
    return { ok: false, error: { code: "UPSTREAM_ERROR", message: "Network request failed" } };
  }
}
```

Callers combine a per-request `AbortController` (for cancelling stale searches) with a timeout signal via `AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])`, so a slow upstream can't hang the UI indefinitely.

## Error handling: typed results, not thrown exceptions across boundaries

- The API client returns `Result<T>`, never throws for expected failure modes (timeout, upstream down, bad request). Callers branch on `ok`.
- Distinguish **total failure** (search itself failed: show a retry banner, keep the last good results if any) from **partial failure** (search succeeded, enrichment failed for some/all items: show items with a "price unavailable" state per card, per the requirement that enrichment is best-effort).
- Reserve `throw`/`try-catch` for truly exceptional, programmer-error cases (e.g. a missing DOM node). Expected runtime failure is data, not a control-flow exception.
- Every error state needs a visible UI affordance: don't just log to console.

## Free-text search

- `<input type="search">` for the built-in clear button and semantics.
- Debounce on `input` (150-250ms is enough; don't over-tune this).
- Guard against out-of-order responses: tag each request with an incrementing generation counter, drop any response whose generation isn't the latest.
- Cancel the in-flight request on every new keystroke via `AbortController.abort()` before firing the next one — combined with the generation guard, this eliminates flicker from a slow, stale response arriving after a fast, fresh one.

## Filter and sort

- One state object (`{ query, filter, sort, page }`) is the single source of truth. Every control (search input, filter select, sort select) writes to it and triggers one re-fetch + re-render path — no parallel state per control.
- Reflect that state to the URL via `URLSearchParams` on every change (ties into the optional URL-synced-state stretch goal, and makes results shareable/bookmarkable for free).
- Filter and sort controls are native `<select>`/`<input>` elements wired to `change` events. Don't build custom dropdowns unless the native control genuinely can't do the job — if a custom dropdown is needed, use the Popover API (`popover` attribute) rather than a hand-rolled positioned `<div>` with manual outside-click handling.

## Modern browser API reference (Chrome latest)

| Need | API | Notes |
|---|---|---|
| SPA routing | `window.navigation` (Navigation API) | Replaces manual `history`/`popstate` wiring |
| Smooth UI transitions | `document.startViewTransition()` | Feature-detect; wrap list/section updates |
| Cancel stale requests | `AbortController` | One per in-flight search |
| Request timeout | `AbortSignal.timeout(ms)` | Combine with `AbortSignal.any()` |
| Combine abort reasons | `AbortSignal.any([...])` | User-cancel + timeout in one signal |
| Repeated markup | `<template>` + `content.cloneNode(true)` | Parsed once, cloned per item |
| Custom dropdowns/menus | Popover API (`popover` attribute) | Avoids manual positioning/outside-click code |
| Modals | `<dialog>` + `.showModal()` | Native focus trap and `::backdrop` |
| Currency/number formatting | `Intl.NumberFormat` | Locale-aware price display |
| Relative time (delivery estimate) | `Intl.RelativeTimeFormat` | "in 2 days" style copy |
| Deep-cloning state snapshots | `structuredClone()` | For undo/debug snapshots if ever needed |
| Responsive components | Container queries (`@container`) | Component-driven layout, not just viewport |
| Conditional styling by content | `:has()` | e.g. style a result card differently when it `:has([data-degraded])` |

## Best Practices

1. Feature-detect even Chrome-only APIs (`if ("startViewTransition" in document)`) — cheap insurance, no downside.
2. Keep one state object and one render path per view; avoid scattered mutable module-level variables.
3. Never redeclare API types on the client — import from the shared module.
4. Treat expected failures (timeout, upstream error, empty results) as render-able states, not exceptions.
5. Prefer native elements (`<dialog>`, `<select>`, popover) over rebuilding browser behaviour by hand.
6. Keep components small and DOM-fragment-scoped; a component never queries outside its own root element.

## Common Pitfalls

1. Rebuilding the entire results list on every keystroke — causes flicker and loses focus/scroll position. Diff by key instead.
2. Not cancelling superseded search requests — leads to stale results flashing in after newer ones.
3. Throwing for expected upstream failures instead of returning a typed error result.
4. Duplicating request/response types between client and server instead of sharing one module.
5. Reaching for a router or state-management library "just in case" — the Navigation API and one state object cover this app's scope.
6. Building a custom dropdown with manual outside-click/escape handling instead of the Popover API.

Full worked examples (keyed list diffing, a complete router setup, the generation-counter search guard) live in `references/details.md`.
