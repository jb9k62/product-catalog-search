# Hand-Rolled Web Client: Worked Examples

## Keyed list diffing for search results

Avoid wiping and rebuilding the results list on every render. Keep a `Map` of item id to component instance, reconcile against the new list order.

```typescript
const instances = new Map<string, Component<EnrichedItem>>();

function renderList(container: HTMLElement, items: EnrichedItem[]) {
  const seen = new Set<string>();

  for (const item of items) {
    seen.add(item.id);
    let instance = instances.get(item.id);
    if (!instance) {
      instance = ResultCard(item);
      instances.set(item.id, instance);
    } else {
      instance.update(item);
    }
  }

  // Remove instances no longer present
  for (const [id, instance] of instances) {
    if (!seen.has(id)) {
      instance.el.remove();
      instances.delete(id);
    }
  }

  // Re-order DOM to match the new item order
  const apply = () => {
    for (const item of items) {
      container.appendChild(instances.get(item.id)!.el);
    }
  };
  document.startViewTransition ? document.startViewTransition(apply) : apply();
}
```

`appendChild` on a node already in the DOM moves it rather than duplicating it, so this reorders in place without touching untouched nodes.

## Search controller: debounce, cancel, and out-of-order guard

```typescript
class SearchController {
  private generation = 0;
  private controller: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onResult: (result: Result<SearchResponse>) => void) {}

  search(state: { query: string; filter: string; sort: string; page: number }) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.run(state), 200);
  }

  private async run(state: { query: string; filter: string; sort: string; page: number }) {
    this.controller?.abort();
    this.controller = new AbortController();
    const gen = ++this.generation;

    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)]);
    const params = new URLSearchParams({
      q: state.query,
      filter: state.filter,
      sort: state.sort,
      page: String(state.page),
    });

    try {
      const result = await apiFetch<SearchResponse>(`/search?${params}`, signal);
      if (gen !== this.generation) return; // superseded by a newer search
      this.onResult(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // cancelled, ignore
      throw err;
    }
  }
}
```

## Navigation API: full route setup

```typescript
type Route = (url: URL) => void;

const routes: Record<string, Route> = {
  "/": (url) => renderSearchView(url.searchParams),
};

function initRouter() {
  navigation.addEventListener("navigate", (event: NavigateEvent) => {
    if (!event.canIntercept || event.hashChange || event.downloadRequest) return;

    const url = new URL(event.destination.url);
    const route = routes[url.pathname];
    if (!route) return; // let the browser handle unknown paths normally

    event.intercept({ handler: () => route(url) });
  });

  // Initial render on page load
  routes[location.pathname]?.(new URL(location.href));
}

function pushState(params: URLSearchParams) {
  const url = new URL(location.href);
  url.search = params.toString();
  navigation.navigate(url.toString(), { history: "replace" });
}
```

Use `{ history: "replace" }` for incremental filter/sort/search changes (don't fill up back-history with every keystroke); use the default `"push"` only for genuinely distinct navigations (e.g. opening an item detail view, if one is added later).

## Popover-based custom dropdown (only if a native `<select>` won't do)

```html
<button popovertarget="sort-menu">Sort ▾</button>
<div id="sort-menu" popover>
  <button data-sort="price">Price</button>
  <button data-sort="popularity">Popularity</button>
</div>
```

The `popover` attribute gives light-dismiss (click outside, Escape key), top-layer stacking, and no manual z-index or outside-click listener code.
