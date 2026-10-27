---
type: Application
title: Search & Discovery Mini App
description: What the app does, what it leaves out, and where to read next.
tags: [overview, search]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: requirements.md
---

# Search & Discovery Mini App

A slice of a delivery app's customer search, built as a small, timeboxed project. A customer searches a local catalog, filters by category, sorts, and sees each
result with a live price, availability, and delivery estimate from a simulated upstream
provider.

## What it does

- Free-text search over 36 catalog items (name, category, and tags), ranked by relevance.
- One category filter and one sort: relevance, price, or popularity.
- Filtering, sorting, and pagination on the server.
- Live data per item: if an item's upstream call fails, the item still shows without it, and
  the search still works.
- Loading and error states, cancelling of out-of-date searches, and search state kept in the
  URL, so links and Back/Forward work.

## What it leaves out

- Personalisation (user profiles, order history). Explored in early planning, then cut to fit
  the brief, see [AI assistance](/app/ai-assistance.md).
- A database and authentication, both out of scope per `requirements.md`.
- Browsers other than the latest Chrome.

## Stack

TypeScript 7 (strict), Node.js 24, Express 5, a hand-rolled TypeScript client
([ADR-0001](/adr/0001-vanilla-ts-client-over-svelte.md)), Vite, Vitest, and Playwright.

## Reading paths

- **Reviewer**: this page, the [decision records](/adr/readme.md), and
  [AI assistance](/app/ai-assistance.md).
- **Developer**: [Architecture](/app/architecture.md), then
  [Domain model](/app/domain-model.md), [Search API](/app/api.md), and
  [Search & ranking](/app/search-ranking.md).
