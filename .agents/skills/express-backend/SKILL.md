---
name: express-backend
description: Express.js server patterns (routing, middleware, error handling, param validation, JSON APIs) for this project's API. Use when writing or reviewing anything under the server/backend, before inventing an approach from scratch.
---

# Express Backend

Before writing Express code for this project, check `references/express/examples` (a git submodule of the official `expressjs/express` repo) for a worked example. It is the canonical source of idiomatic Express patterns, kept in sync with the actual framework version in use. This skill maps this project's needs to the specific examples worth reading, adapted to TypeScript and our JSON API shape.

## When to Use This Skill

- Structuring the Express app (routes, middleware order, app setup)
- Validating or transforming route params (`:query`, `:id`, etc.)
- Writing error-handling middleware and consistent JSON error responses
- Building the search/filter/sort/enrichment JSON endpoints
- Deciding how to split routes across files as the server grows

## Relevant examples in `references/express/examples`

| Example | Why it matters here |
|---|---|
| `web-service/index.js` | Closest match to this project: JSON-only API, a shared error-handling middleware, a JSON 404 fallback. Model our `/api/search` route and error shape on this. |
| `error/index.js` | Canonical 4-arg error-handling middleware (`(err, req, res, next)`), placed after all routes. Shows both thrown errors and `next(err)`. |
| `params/index.js` | `app.param()` for validating/coercing route params (e.g. parsing and rejecting a bad `:id`) before the route handler runs. |
| `route-middleware/index.js` | Composable middleware functions (`loadX`, `restrictToY`) chained per-route instead of duplicated logic in handlers. |
| `route-separation/index.js` | Splitting routes into per-resource modules (`user.js`, `post.js`) exporting handler functions, mounted from one `index.js`. |
| `search/index.js` | Shape of a search endpoint and the pattern for calling an async data source and forwarding failures to `next(err)`. |

## Applying these patterns to this project

**Route structure.** Follow `route-separation`: one module per concern (e.g. `routes/search.ts`, `routes/catalog.ts`), each exporting an `express.Router()`, mounted in a single `app.ts`. Don't put all routes in one file once there is more than one concern.

**Error handling.** Follow `web-service` + `error`: one error-handling middleware, registered last, that maps a typed application error to a JSON body and status code. Route handlers call `next(err)` (or `next(appError(...))`) rather than sending error responses inline, so every failure path (bad request, upstream timeout, upstream failure, not found) produces the same JSON shape. Match the client's expected `ApiError` shape from the `hand-rolled-web-client` skill's shared types module, don't invent a second error format.

```typescript
interface AppError extends Error {
  status: number;
  code: ApiError["code"];
}

function appError(status: number, code: ApiError["code"], message: string): AppError {
  const err = new Error(message) as AppError;
  err.status = status;
  err.code = code;
  return err;
}

// last middleware, after all routes
app.use((err: AppError, req: Request, res: Response, next: NextFunction) => {
  res.status(err.status ?? 500).json({ code: err.code ?? "UPSTREAM_ERROR", message: err.message } satisfies ApiError);
});
```

**Param/query validation.** Follow `params/index.js`: validate and coerce query params (`q`, `filter`, `sort`, `page`) once, up front, either via `app.param()` for path params or a small validation step at the top of the route handler for query params, calling `next(appError(400, "BAD_REQUEST", ...))` on failure rather than letting a bad param silently produce a wrong result.

**Async handlers.** Every route handler here is async (catalog search, upstream enrichment call). Wrap the body in try/catch and pass failures to `next(err)`, exactly as `search/index.js` does with its Redis calls; don't let a rejected promise go unhandled.

**Upstream provider simulation.** Keep it as an in-process module (per `requirements.md`), not a separate route hit over HTTP, and have it reject/throw with a recognisable error (e.g. an `AppError` with `code: "UPSTREAM_TIMEOUT"`) on simulated latency/failure, so the same error-handling middleware covers it.

## Best Practices

1. Read the matching example in `references/express/examples` before writing a new route or middleware pattern, don't guess at Express idioms.
2. One error-handling middleware, registered last, producing one JSON error shape.
3. Validate params/query once, at the boundary, not scattered through handler logic.
4. Split routes into per-resource modules once there's more than one concern.
5. Every async handler forwards rejected promises to `next(err)`.

## Common Pitfalls

1. Sending error responses directly from route handlers instead of funnelling through `next(err)` and one error middleware, leading to inconsistent error shapes.
2. Registering the error-handling middleware before routes, so it never receives their errors.
3. An unhandled promise rejection in an async route handler (missing try/catch around `await`).
4. Duplicating the `ApiError` shape here instead of importing it from the shared types module used by the client.
