---
type: Reference
title: AI assistance
description: How Claude and local models were used, from early planning to the typeahead stretch goal, and which calls the author made.
tags: [ai, process, transparency]
generated: { by: claude-opus-5, at: 2026-09-13 }
sources:
  - resource: SOLUTION.md
  - resource: git log
    title: Commits 268ff54 to 69c2651
---

# AI assistance

Claude was used throughout: planning, `SOLUTION.md`, the API, the client, both test suites,
and a bug-hunting review. `SOLUTION.md` has the short version. This is the full account.

## Planning

Before the brief was in hand, the author explored delivery-app search with Claude: turning
restaurant menus and grocery listings into one search index, ranking on more than text match
(delivery time, seller quality, promotions, past orders), and personalisation with a default
for new users. The resulting plan was then cut down to fit the brief:

| First plan                                      | Built                      | Why                                               |
| ----------------------------------------------- | -------------------------- | ------------------------------------------------- |
| Node's built-in SQLite                          | In-memory JSON catalog     | The brief rules out a database.                   |
| TypeScript 5.x                                  | TypeScript 7               | `requirements.md` asks for the latest TypeScript. |
| Discovery, ranking, and personalisation modules | Discovery and ranking only | Personalisation isn't in the brief.               |

The inverted index, weighted scoring, and seeded Faker data carried through unchanged.

## Building

Claude proposed the architecture (inverted index, shared types, error handling, component
patterns), mostly from the project skills in `.agents/skills/`. The author made the calls with
no single right answer: a vanilla client over Svelte, sorting by `basePrice`, prefix-fallback
matching, and TypeScript 7. The two bugs Claude introduced and then caught while writing tests
were both in the e2e suite: a regex that was too narrow, and a DOM read that ran before an
async re-render finished.

Commits up to `b77cf35` are co-authored with Claude Sonnet 5. The last of them stopped a taken
port (`EADDRINUSE`) crashing the server with a stack trace.

## Bug-hunting review (`69c2651`)

The author then had Claude Opus 5 review the whole codebase looking for bugs, confirming each
one in the running app before fixing it. The commit touched 27 files (+1094/-692).

| Area           | Problem                                                                                                 | Fix                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tokenising     | Categories and tags weren't split into words, so `kitchen` and `wicking` missed; accents split words    | One `tokenise()` for every field; strip accent marks after NFKD                                 |
| Query handling | Stopword or single-letter queries matched nothing, blanking results; out-of-range pages came back empty | No searchable words means no text filter; clamp to the last page                                |
| Validation     | Repeated or malformed params were quietly replaced with defaults                                        | Reject them with `400 BAD_REQUEST`                                                              |
| Server errors  | Unexpected errors were returned as `UPSTREAM_ERROR`; `AppError` was only an interface                   | `AppError` is a class checked with `instanceof`; anything else is a logged `500 INTERNAL_ERROR` |
| Cancellation   | Upstream calls kept running after the client disconnected                                               | Abort enrichment when the response closes early                                                 |
| Pagination     | Buttons were rebuilt on every render, losing keyboard focus                                             | Update the controls in place                                                                    |
| Navigation     | Back/Forward didn't restore searches                                                                    | `pushState`/`replaceState` plus a `popstate` listener                                           |
| Client errors  | Timeouts and network failures showed the same error                                                     | Separate `TIMEOUT` and `NETWORK_ERROR` results                                                  |
| URL state      | A link with an unknown category filtered by a value the dropdown couldn't show                          | Drop the unknown category once categories load                                                  |
| Types          | `EnrichedItem` had separately nullable fields; each side defined its own sort options                   | Discriminated union; shared `SORT_OPTIONS` and `isSortOption`                                   |
| Catalog        | Odd or duplicate names ("Electronic Sandal")                                                            | Hand-picked, unique names and balanced categories; `CATALOG_PATH` selects a dataset             |
| Tests          | No route-level tests; some e2e assertions didn't retry                                                  | Added `server/test/api.test.ts` and retrying assertions; covered focus and Back                 |

The review also turned on `erasableSyntaxOnly` and `verbatimModuleSyntax`, and moved every
results-list DOM change inside the View Transition.

## Instrumentation stretch goal

Claude Opus 5 researched the options for lightweight request metrics (see
[ADR-0005](/adr/0005-hand-rolled-request-metrics.md)) and planned the design, then handed it to
a Claude Sonnet 5 subagent to build: `server/src/metrics.ts`, the `Server-Timing` header on
search, and their tests.

## Typeahead stretch goal

A first attempt through the Pi agent harness with a local Gemma model stopped before the client
was built. The feature was then built through the same harness with a local Qwen model
(`d501ed3`, `09608a1`). Claude Opus 5 made the follow-up fixes from an adversarial review of the
typeahead request races (`b8313d5`).

After the merge, Claude Opus 5 reviewed it again and fixed what it found: Enter picked the first
suggestion instead of searching the typed text, a slow click on an option was lost, suggestions
included items that only matched on a tag or category, and the open list pushed the results down.
