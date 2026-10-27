---
type: Architectural Decision
title: "ADR-0001: Vanilla TS client over Svelte"
description: Why the client is hand-rolled TypeScript rather than Svelte, which the brief also allowed.
tags: [client, stack, adr]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: SOLUTION.md
---

# ADR-0001: Vanilla TS client over Svelte

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Jordan Hunt

## Context

The brief allows a Svelte or plain JavaScript client, estimates about four hours of work, and
ends with a video demo in which the author walks through and defends the code.

## Decision

We will build the client in hand-rolled, framework-free TypeScript, the stack the author knows
best.

## Consequences

### Positive

- No framework ramp-up, so the time goes into search, the API, and tests.
- The author can explain every line in the demo with confidence.

### Trade-offs

- No built-in reactivity or component model. A few deliberate patterns cover the gap: one
  state object, component factory functions, and results diffed by item id. Browser APIs do
  the rest: `AbortController` for cancellation, View Transitions for result updates, and the
  History API for Back/Forward. See [Architecture](/app/architecture.md).

## Alternatives considered

| Option | Why rejected                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| Svelte | Allowed by the brief, but learning it would eat into a four-hour budget better spent on the work being assessed. |
