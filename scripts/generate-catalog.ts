import { writeFileSync } from "node:fs";
import { faker } from "@faker-js/faker";
import { format } from "prettier";
import type { CatalogItem } from "../shared/api-types.ts";

interface CategoryProfile {
  category: string;
  nouns: string[];
  tags: string[];
}

// Faker's commerce helpers aren't category-aware: productName() gives things
// like "Bespoke Wooden Tuna" under Apparel, and productAdjective() gives "Tasty
// Hoodie" or "Electronic Sandal". So names and tags are curated here, and Faker
// only makes the (seedable) random choices.
const CATEGORY_PROFILES: CategoryProfile[] = [
  {
    category: "Footwear",
    nouns: ["Running Shoe", "Hiking Boot", "Sandal", "Sneaker", "Trail Shoe"],
    tags: ["trail", "waterproof", "lightweight", "cushioned", "breathable"],
  },
  {
    category: "Apparel",
    nouns: ["T-Shirt", "Shorts", "Jacket", "Leggings", "Hoodie"],
    tags: ["breathable", "moisture-wicking", "compression", "quick-dry"],
  },
  {
    category: "Outdoor",
    nouns: [
      "Backpack",
      "Tent",
      "Sleeping Bag",
      "Water Bottle",
      "Camping Chair",
    ],
    tags: ["trail", "lightweight", "durable", "weatherproof"],
  },
  {
    category: "Electronics",
    nouns: [
      "Wireless Earbuds",
      "Bluetooth Speaker",
      "Power Bank",
      "Smart Watch",
      "Charging Cable",
    ],
    tags: ["wireless", "rechargeable", "compact", "durable"],
  },
  {
    category: "Home & Kitchen",
    nouns: [
      "Blender",
      "Cutting Board",
      "Coffee Mug",
      "Storage Container",
      "Kitchen Towel",
    ],
    tags: ["compact", "durable", "eco-friendly"],
  },
];

// Neutral enough to fit any category's nouns.
const ADJECTIVES = [
  "Classic",
  "Essential",
  "Everyday",
  "Premium",
  "Pro",
  "Ultra",
  "Signature",
  "Deluxe",
  "Original",
  "Select",
];

const ITEM_COUNT = 36;

function createCatalogItem(profile: CategoryProfile): CatalogItem {
  return {
    id: faker.string.uuid(),
    name: `${faker.helpers.arrayElement(ADJECTIVES)} ${faker.helpers.arrayElement(profile.nouns)}`,
    category: profile.category,
    tags: faker.helpers.arrayElements(profile.tags, { min: 2, max: 4 }),
    basePopularity: faker.number.int({ min: 0, max: 100 }),
    basePrice: faker.number.float({ min: 100, max: 3000, fractionDigits: 2 }),
  };
}

function generateCatalog(): CatalogItem[] {
  const items: CatalogItem[] = [];
  const names = new Set<string>();

  while (items.length < ITEM_COUNT) {
    // Round-robin over categories, so every filter option has a similar number of items.
    const profile = CATEGORY_PROFILES[items.length % CATEGORY_PROFILES.length]!;
    const item = createCatalogItem(profile);
    // Re-roll duplicate names: identical cards are indistinguishable in the UI and in tests.
    if (names.has(item.name)) continue;
    names.add(item.name);
    items.push(item);
  }

  // Shuffle so the catalog's natural order (what "relevance" shows with no
  // query) isn't a visible category rotation.
  return faker.helpers.shuffle(items);
}

const random = process.argv.includes("--random");
const fileName = random ? "catalog.random.json" : "catalog.seed.json";
// Resolved from this script's location, so it works from any working directory.
const outPath = new URL(`../data/${fileName}`, import.meta.url);

// Seeding makes every Faker call deterministic, so the committed catalog
// regenerates byte-for-byte identically.
if (!random) faker.seed(42);

const catalog = generateCatalog();
// Written through Prettier, so a regenerated file matches `prettier --write`.
writeFileSync(
  outPath,
  await format(JSON.stringify(catalog, null, 2), { parser: "json" }),
);

console.log(
  `Wrote ${catalog.length} items to data/${fileName}${random ? " (random)" : " (seed 42)"}`,
);
