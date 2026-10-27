export interface SuggestionsComponent {
  open: (items: string[]) => void;
  close: () => void;
  moveHighlight: (direction: -1 | 1) => void;
  clearHighlight: () => void;
  selectHighlighted: () => string | null;
  isOpen: () => boolean;
}

// Binds to the static <ul id="suggestions"> and the search input, and manages
// the listbox as the searchbox's aria-activedescendant target. Options are
// rebuilt from the given names each time; the list is small (max 8), so the
// cost is negligible. Highlight lives here so keyboard, pointer and styling
// share one source of truth.
export function createSuggestions(
  root: HTMLUListElement,
  input: HTMLInputElement,
  onSelect: (name: string) => void,
): SuggestionsComponent {
  let items: string[] = [];
  let highlighted = -1;

  // Static relationship: the listbox is the input's popup, and
  // aria-activedescendant tracks the highlighted option as it opens and closes.
  // aria-expanded is deliberately omitted: the searchbox role this input uses
  // does not support it, so assistive tech would ignore it.
  input.setAttribute("aria-controls", root.id);

  // Pressing on the list would move focus off the input, and blur closes the
  // list, so a slow click or a scrollbar drag would lose it. Cancelling
  // mousedown keeps focus on the input; the click still fires.
  root.addEventListener("mousedown", (event) => event.preventDefault());

  function render(): void {
    root.replaceChildren(
      ...items.map((name, index) => {
        const option = document.createElement("li");
        option.id = `suggestion-${index}`;
        option.setAttribute("role", "option");
        option.textContent = name;
        option.addEventListener("click", () => onSelect(name));
        // pointermove, not pointerenter: a list opening under a still pointer
        // must not highlight an option, or Enter would pick it.
        option.addEventListener("pointermove", () => {
          if (highlighted !== index) highlight(index);
        });
        return option;
      }),
    );
  }

  function highlight(index: number): void {
    highlighted = index;
    for (const [i, option] of [...root.children].entries()) {
      const active = i === index;
      option.classList.toggle("is-highlighted", active);
      option.setAttribute("aria-selected", String(active));
      if (active) option.scrollIntoView({ block: "nearest" });
    }
    if (index >= 0)
      input.setAttribute("aria-activedescendant", `suggestion-${index}`);
    else input.removeAttribute("aria-activedescendant");
  }

  // Opens with nothing highlighted, so Enter still searches the typed text.
  // Only an arrow key or the pointer picks an option.
  function open(next: string[]): void {
    items = next;
    if (items.length === 0) {
      close();
      return;
    }
    render();
    highlight(-1);
    root.hidden = false;
  }

  function close(): void {
    root.hidden = true;
    highlight(-1);
    items = [];
  }

  function moveHighlight(direction: -1 | 1): void {
    if (items.length === 0) return;
    // From no highlight, Down starts at the first option and Up at the last.
    // After that, wrap around, so holding Down cycles back to the first.
    const start = highlighted < 0 ? (direction === 1 ? -1 : 0) : highlighted;
    highlight((start + direction + items.length) % items.length);
  }

  function selectHighlighted(): string | null {
    return items[highlighted] ?? null;
  }

  return {
    open,
    close,
    moveHighlight,
    clearHighlight: () => highlight(-1),
    selectHighlighted,
    isOpen: () => !root.hidden,
  };
}
