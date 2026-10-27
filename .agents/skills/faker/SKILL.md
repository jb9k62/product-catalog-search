---
name: faker
description: Use @faker-js/faker v10 (the modular API documented at fakerjs.dev) to generate realistic fake data. Use when writing or reviewing the catalog seed generator or any other Faker-based script in this project.
---

# Faker.js

**This project uses `@faker-js/faker` v10** (`10.6.0`, installed as a devDependency). The API below is the real, currently-installed v10 API, confirmed against the package at runtime.

A note on versioning, since it's easy to get confused here: `fakerjs.dev` documents stable v10 (what we use); `next.fakerjs.dev` documents the `next` branch, an unreleased v11. Today, npm's `next` dist-tag still resolves to the same `10.6.0` as `latest`, i.e. v11 hasn't actually shipped anything different yet. Before ever bumping this dependency, re-check `npm view @faker-js/faker dist-tags` and next.fakerjs.dev's changelog: v11 may introduce breaking changes once it diverges from stable for real.

## When to Use This Skill

- Writing or changing the catalog seed generator script
- Adding any other script that needs realistic fake data
- Deciding how to get deterministic vs. random output from Faker

## Core API (v10)

```typescript
import { faker } from "@faker-js/faker";
```

Everything hangs off one namespaced instance, grouped by domain module: `faker.person`, `faker.commerce`, `faker.location`, `faker.date`, `faker.string`, `faker.number`, `faker.helpers`. There is no old-style flat API (`faker.name.findName()` from v5 and earlier no longer exists).

Methods relevant to this project:

```typescript
faker.string.uuid();                                  // "5fb9220d-9b0f-4d32-a248-6492457c3890"
faker.commerce.productName();                         // "Ergonomic Aluminum Towels"
faker.commerce.department();                          // "Toys" — a category-like word, but prefer an explicit category pool (see below)
faker.commerce.price({ min: 100, max: 2000, dec: 2 }); // "1635.99" (string; Number() it)
faker.number.int({ min: 0, max: 100 });                // deterministic integer in range
faker.helpers.arrayElement(["a", "b", "c"]);           // one random element from a fixed list
faker.helpers.arrayElements(tagPool, { min: 2, max: 4 }); // 2-4 random elements, no duplicates
faker.helpers.multiple(factory, { count: 5 });         // call a factory function 5 times, collect results
```

`faker.commerce.department()` returns a real word but not one you control the vocabulary of. For the catalog, prefer an explicit category list (`faker.helpers.arrayElement(CATEGORIES)`) so the categories match a controlled taxonomy the search index and filter UI already know about, rather than whatever Commerce module happens to generate.

## Determinism: `faker.seed()`

```typescript
faker.seed(42);
const a = faker.number.int();

faker.seed(42);
const b = faker.number.int(); // a === b
```

Seeding fixes the sequence, not individual calls: call `faker.seed(n)` once, before generating the whole dataset, not per item. Calling it per item would make every item draw from the same starting point in the sequence and produce correlated, not independent, fake values.

Skip the call entirely (or seed from `Date.now()`) for non-deterministic output.

## Templating with `faker.helpers.fake`

For composing a sentence from multiple modules in one call:

```typescript
faker.helpers.fake("{{commerce.productAdjective}} {{commerce.product}} for {{commerce.department}}");
```

Useful for descriptions; not needed for this project's structured `CatalogItem` fields.

## Locale and instance notes (unlikely to matter here, but know they exist)

- `import { fakerDE as faker } from "@faker-js/faker"` swaps the whole instance to a locale.
- `import { simpleFaker } from "@faker-js/faker"` gives a locale-independent instance (UUIDs, numbers) with a smaller bundle, for when no localized text is needed at all.
- A custom locale-fallback instance can be built via `new Faker({ locale: [...] })` if a locale needs a non-English fallback.

None of this project's data needs a non-default locale; `import { faker } from "@faker-js/faker"` is enough.

## Applying this to the catalog seed generator

Per `SOLUTION.md`'s "Test data: seeded and regenerable" design: one item-factory function, called under `faker.seed(42)` for the committed baseline and without a fixed seed for ad hoc regeneration. See `scripts/generate-catalog.ts`.
