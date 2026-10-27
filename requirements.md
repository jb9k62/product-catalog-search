# Search & Discovery Mini App

A focused slice of a delivery app's customer search and discovery experience: a small, end-to-end app that lets customers find items and see live availability and pricing.

## Goal

Deliver a full-stack mini app where customers can search for items and view real-time availability and pricing.

## Core Requirements

- Free-text search across a small local catalog
- At least one filter (e.g. category)
- At least one sort option (e.g. price or popularity)
- Enrichment of results with availability and pricing from a simulated upstream provider
- Responsive UX with clear loading and error states
- Design the API contracts, data model, component structure, error handling, and overall architecture

## Tasks

### Task 1: Search & Enrichment Service (API)

- Load the catalog dataset; support free-text search across at least item name and category
- Support one filter and one sort option
- Enrich results by calling a simulated upstream provider for availability and price
- Handle errors gracefully and return useful information to the UI
- Document endpoints in the README (example requests/responses; curl scripts are a nice-to-have)

### Task 2: Web UI

- SPA that renders a search form and results list
- Refine results via one filter and one sort control
- Display enriched info (availability, price, delivery estimate) when available: enrichment may fail per item, so the UI must degrade gracefully rather than block on it
- Stay responsive under slow or flaky upstream responses
- Keep styling minimal, prioritising functionality and clarity over visual polish

### Task 3: Quality & Developer Experience

- Automated test for at least one core path (e.g. search + filter/sort logic)
- `package.json` scripts for `dev`, `build`, `start`, `test`
- `SOLUTION.md` documenting key design choices, trade-offs, and any AI assistance used

## Stretch Goals (Optional)

Only pursue these if the core requirements and tasks are complete:

- Typeahead suggestions that avoid unnecessary requests
- URL-synced state so a link can restore query and filters
- Lightweight instrumentation (e.g. timing logs or request counts) and how to view them
- Small client-side or server-side caching to improve responsiveness

## Design

- CRUD-style app: keep it simple, update state on success. No optimistic updates or rollback at this stage
- Server-side pagination, filtering, and sorting, to keep the client fast regardless of catalog size

## Constraints

- Catalog: local JSON dataset of ~30–40 items across multiple categories; no external database
- Upstream provider: simple, in-process simulation with variable latency and occasional failure
- UI must stay responsive during slow/flaky upstream responses, with visible loading and error states
- Avoid over-engineering: focus on the core search flow, one filter, one sort
- Browser target: Chrome latest only. No cross-browser support or polyfills required

## Stack

| Layer                  | Choice                           |
| ---------------------- | -------------------------------- |
| Language               | TypeScript (latest, strict mode) |
| Runtime                | Node.js 24 (latest LTS)          |
| Server framework       | Express (latest)                 |
| Client                 | Hand-rolled (vanilla) web client |
| Styling                | Plain CSS, no preprocessor       |
| Build/dev/test tooling | Vite                             |
| E2E testing            | Playwright                       |
| Data storage           | In-memory only, no database      |
| Browser target         | Chrome latest only               |

**Why hand-rolled over Svelte:** avoids ramp-up time on an unfamiliar framework, keeping focus on architecture and decision-making, which is what's being assessed.

## Assumptions

- The catalog has product data but no live pricing/availability; the upstream provider supplies real-time price, availability, and delivery estimate
- Endpoints are public: authentication is out of scope

## Deliverables

1. GitHub repository containing all source code, a `README.md` (run instructions, API docs), and a `SOLUTION.md` (design decisions and trade-offs)
2. A 5–10 minute video demo (Loom or similar) covering the working app, architecture, key decisions, and any notable implementation details

## Time Estimate

±4 hours. Take as long as you actually need.
