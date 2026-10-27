---
okf_version: "0.2"
---

# Search & Discovery Mini App

Architecture, contracts, and decisions for the app, in
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
Start at the overview and follow links down to the detail you need.

## Application

- [Overview](/app/overview.md) - what the app does, what it leaves out, and reading paths
- [Architecture](/app/architecture.md) - components, cancellation, and error handling
- [Domain model](/app/domain-model.md) - the types shared by server and client
- [Search API](/app/api.md) - `GET /api/search`, `/api/suggestions`, `/api/categories`, `/api/metrics`
- [Search & ranking](/app/search-ranking.md) - the inverted index, with a worked example
- [AI assistance](/app/ai-assistance.md) - how Claude was used and what the review fixed

## Decisions

- [Decision records](/adr/readme.md) - what an ADR is, and how to add one
- [ADR template](/adr/template.md) - starting point for a new record
- [ADR-0001: Vanilla TS client over Svelte](/adr/0001-vanilla-ts-client-over-svelte.md) - client stack
- [ADR-0002: Sort by base price, not live price](/adr/0002-sort-by-base-price-not-live-price.md) - price sort
- [ADR-0003: One catalog factory, two seeds](/adr/0003-dual-seeded-and-random-catalog-generation.md) - test data
- [ADR-0004: Document the design as an OKF bundle](/adr/0004-document-design-as-okf-bundle.md) - documentation
- [ADR-0005: Hand-rolled request metrics, no library](/adr/0005-hand-rolled-request-metrics.md) - instrumentation
- [ADR-0006: Typeahead suggestions, cheap by design](/adr/0006-typeahead-suggestions.md) - typeahead

## Viewer

`npm run okf:validate` checks the bundle against the spec. `npm run okf:view` also writes `okf/viz.html`
(gitignored): a concept graph beside a reading pane. Open it in a browser; its libraries load
from a CDN.

Update history: [log.md](/log.md).
