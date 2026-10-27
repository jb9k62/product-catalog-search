---
type: Architectural Decision
title: "ADR-0003: One catalog factory, two seeds"
description: Why one generator writes both a committed fixed-seed catalog and a gitignored random one.
tags: [test-data, faker, adr]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: scripts/generate-catalog.ts
  - resource: server/src/catalog.ts
---

# ADR-0003: One catalog factory, two seeds

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Jordan Hunt, with Claude Sonnet 5

## Context

Tests and the default dev run need the same data every time. But search tuned against one fixed
dataset can look right only because of that dataset's particular names and tags.

## Decision

We will generate the catalog with one `@faker-js/faker` factory in `scripts/generate-catalog.ts`,
run two ways. Both outputs hold 36 items of the same shape.

```mermaid
flowchart LR
  Factory["Item factory"] -->|"npm run seed, faker.seed(42)"| Baseline["catalog.seed.json, committed"]
  Factory -->|"npm run seed:random"| Fresh["catalog.random.json, gitignored"]
  Baseline --> Tests["Tests and default dev run"]
  Fresh -->|"CATALOG_PATH"| Manual["Manual testing"]

  classDef process fill:#87CEEB,stroke:#333,stroke-width:2px,color:darkblue
  classDef data fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
  classDef usage fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen

  class Factory process
  class Baseline,Fresh data
  class Tests,Manual usage
```

## Consequences

### Positive

- A fresh clone, `npm test`, and `npm run dev` all see the same catalog.
- `npm run seed:random`, then `CATALOG_PATH=data/catalog.random.json npm run dev`, tries
  search on data it wasn't tuned on.
- One factory defines the item shape, so the two datasets can't drift apart.

### Trade-offs

- Two dataset files. The random one is gitignored, so it's never mistaken for the fixture.

## Alternatives considered

| Option                   | Why rejected                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| One fixed dataset        | Simpler, but search could end up tuned to that one dataset without anyone noticing. |
| Random data on every run | Tests would get different data each run, and bugs would be hard to reproduce.       |
