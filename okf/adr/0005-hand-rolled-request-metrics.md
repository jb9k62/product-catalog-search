---
type: Architectural Decision
title: "ADR-0005: Hand-rolled request metrics, no library"
description: Why request instrumentation is a small hand-rolled middleware instead of a metrics library.
tags: [instrumentation, metrics, express, adr]
generated: { by: claude-sonnet-5, at: 2026-09-14 }
sources:
  - resource: server/src/metrics.ts
  - resource: server/src/routes/search.ts
  - resource: server/test/metrics.test.ts
---

# ADR-0005: Hand-rolled request metrics, no library

- **Status:** accepted
- **Date:** 2026-09-14
- **Deciders:** Jordan Hunt, with Claude Opus 5 (research) and Claude Sonnet 5 (build)

## Context

The brief's stretch goals ask for lightweight instrumentation (timing logs or request counts)
and a way to view it, and warn against over-engineering. Express 5 has no built-in metrics.
Support for Node's `diagnostics_channel` is still an open issue on Express itself
(expressjs/express#6353), not something to build on today. Express is also the only runtime
dependency the app has; adding one for this would be a bigger change than the feature. The
number worth seeing here is how much of a search's time is catalog search versus upstream
enrichment, since enrichment is the slow, unreliable part.

## Decision

We will hand-roll request instrumentation: one Express middleware with per-app in-memory
counters, a `GET /api/metrics` endpoint that returns them as JSON, one log line per `/api`
request in the terminal, and a `Server-Timing` header on `GET /api/search` split into `search`
and `enrich`.

## Consequences

### Positive

- No new dependency.
- Chrome DevTools shows the search/enrich split in the Network tab's Timing panel with no
  extra tooling.
- Counters live inside `createMetrics()`'s closure, so each `createApp()` (and each test) gets
  its own state, easy to assert on.
- Aborted searches are counted separately, which shows the client's cancellation actually
  reaching the server.

### Trade-offs

- Counters reset on restart and live in one process: no history, and no combined total across
  multiple instances.
- Only average and max per route, no percentiles.
- Not Prometheus's text format, so moving to real monitoring later means replacing this, not
  extending it. The counters map onto prom-client metrics cleanly enough if that day comes.
- `/api/metrics` is public, like the rest of the API. Fine for local use and this project,
  but it should be locked down or removed before running this in production.

## Alternatives considered

| Option                                                     | Why rejected                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `morgan`                                                   | Logs only: no counters and no `/api/metrics` endpoint. We would still be building those ourselves, so it saves nothing.                                                                 |
| `prom-client` + `express-prom-bundle`                      | The standard choice, but Prometheus text output needs Prometheus and Grafana to be readable at all. Over-engineered for a four-hour brief.                                              |
| Node `diagnostics_channel` (`http.server.response.finish`) | No middleware needed, but the HTTP channels are marked Experimental in the Node docs, and give raw URLs rather than routes, so query strings would need the same grouping logic anyway. |
| `express-status-monitor`                                   | Last published 2022, and pulls in socket.io 2 and axios 0.26.                                                                                                                           |
| OpenTelemetry auto-instrumentation                         | Large dependency tree, and needs a collector running before any of it is visible.                                                                                                       |
