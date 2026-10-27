import type { EnrichedItem } from "../../../shared/api-types.ts";
import { createResultCard, type ResultCardComponent } from "./resultCard.ts";

export interface ResultsList {
  render: (items: EnrichedItem[], options?: { animate?: boolean }) => void;
}

// Keyed rendering: cards are matched to items by id, so a card whose item is
// still in the results is updated and moved, never destroyed and rebuilt.
// Only new items create DOM and only departed items remove it. This is the job
// a framework's virtual DOM "key" prop does.
export function createResultsList(
  container: HTMLElement,
  template: HTMLTemplateElement,
): ResultsList {
  const cards = new Map<string, ResultCardComponent>();

  function render(items: EnrichedItem[], { animate = true } = {}): void {
    const apply = () => {
      const ids = new Set(items.map((item) => item.id));
      for (const [id, card] of cards) {
        if (ids.has(id)) continue;
        card.el.remove();
        cards.delete(id); // deleting the current entry while iterating a Map is safe
      }

      for (const item of items) {
        let card = cards.get(item.id);
        if (!card) {
          card = createResultCard(template);
          cards.set(item.id, card);
        }
        card.update(item);
        // append() on a node already in the container moves it to the end, so
        // this loop also puts existing cards into the new order.
        container.append(card.el);
      }
    };

    // Every DOM change happens inside the callback: the browser snapshots the
    // old state, runs the callback, then cross-fades to the new state. Changes
    // made before the call would leak into the "old" snapshot.
    // Feature-detected even though Chrome is the only target: it costs nothing.
    if (animate && typeof document.startViewTransition === "function") {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  return { render };
}
