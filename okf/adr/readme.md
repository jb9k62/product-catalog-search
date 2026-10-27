---
type: Reference
title: Decision records
description: What an ADR is, the decisions recorded so far, and how to add one.
tags: [adr, architecture, decisions]
generated: { by: claude-opus-5, at: 2026-09-13 }
---

# Decision records

An Architectural Decision Record (ADR) captures one significant decision: its context, the
choice, the alternatives rejected, and the consequences accepted. With ADRs, "why is it like
this?" never needs someone who was there. The format follows Michael Nygard's _Documenting
Architecture Decisions_.

## Recorded decisions

| ADR                                                            | Decision                                    | Status   |
| -------------------------------------------------------------- | ------------------------------------------- | -------- |
| [0001](/adr/0001-vanilla-ts-client-over-svelte.md)             | Hand-rolled TypeScript client, not Svelte   | Accepted |
| [0002](/adr/0002-sort-by-base-price-not-live-price.md)         | Sort by `basePrice`, not the live price     | Accepted |
| [0003](/adr/0003-dual-seeded-and-random-catalog-generation.md) | One catalog factory, fixed and random seeds | Accepted |
| [0004](/adr/0004-document-design-as-okf-bundle.md)             | Document the design as an OKF bundle        | Accepted |
| [0005](/adr/0005-hand-rolled-request-metrics.md)               | Hand-rolled request metrics, no library     | Accepted |
| [0006](/adr/0006-typeahead-suggestions.md)                     | Typeahead suggestions, cheap by design      | Accepted |

ADRs 0001-0003 started as sections of `SOLUTION.md`, written as the decisions were made.

## Adding one

- Copy the [template](/adr/template.md) to `NNNN-short-title.md` and add it to the table above.
- Record one decision, with at least one rejected alternative and why. Without alternatives, an
  ADR explains nothing.
- Keep it to about a page, written for a reader who doesn't share your context.
- Record choices that are costly to reverse or likely to be questioned (stack, module
  boundaries, data model, API contract), not every small one.
- Statuses: **proposed**, **accepted**, **superseded** (link the replacement), or
  **deprecated**. Update the status instead of rewriting history.
