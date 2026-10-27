import type { EnrichedItem } from "../../../shared/api-types.ts";

export interface ResultCardComponent {
  el: HTMLLIElement;
  update: (item: EnrichedItem) => void;
}

// Created once and shared: building an Intl formatter is the expensive part, formatting is cheap.
const currency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

// The card starts blank. The caller fills it with update(), the same call that
// refreshes a card it keeps, so there is one code path for both.
export function createResultCard(
  template: HTMLTemplateElement,
): ResultCardComponent {
  // The <template> markup is parsed once by the browser and stays inert until
  // cloned, which is cheaper and safer than building HTML strings.
  const el = template.content.firstElementChild!.cloneNode(
    true,
  ) as HTMLLIElement;

  // Look each slot up once. update() then only writes text.
  const nameEl = el.querySelector<HTMLElement>("[data-name]")!;
  const categoryEl = el.querySelector<HTMLElement>("[data-category]")!;
  const tagsEl = el.querySelector<HTMLElement>("[data-tags]")!;
  const priceEl = el.querySelector<HTMLElement>("[data-price]")!;
  const availabilityEl = el.querySelector<HTMLElement>("[data-availability]")!;
  const deliveryEl = el.querySelector<HTMLElement>("[data-delivery]")!;

  // Updates in place, so a card that survives a new search keeps its DOM node.
  // textContent (never innerHTML) means catalog text can't inject markup.
  function update(item: EnrichedItem): void {
    nameEl.textContent = item.name;
    categoryEl.textContent = item.category;
    tagsEl.textContent = item.tags.join(", ");

    // Checking the discriminant narrows price, availability, and delivery
    // together (see EnrichedItem), so no null checks per field.
    if (item.enrichmentFailed) {
      priceEl.textContent = "Price unavailable";
      availabilityEl.textContent = "Availability unknown";
      deliveryEl.textContent = "";
    } else {
      priceEl.textContent = currency.format(item.price);
      availabilityEl.textContent = item.availability;
      deliveryEl.textContent = `Delivery: ${item.deliveryEstimate}`;
    }
    el.classList.toggle("is-degraded", item.enrichmentFailed);
  }

  return { el, update };
}
