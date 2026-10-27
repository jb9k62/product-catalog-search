import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import path from "node:path";
import type { ApiError } from "../../shared/api-types.ts";
import { loadCatalog } from "./catalog.ts";
import { AppError } from "./errors.ts";
import { createMetrics } from "./metrics.ts";
import { createSearchRouter } from "./routes/search.ts";
import { buildIndex } from "./search.ts";

export function createApp(options: { logRequests?: boolean } = {}) {
  const app = express();

  // Load and index once at startup. Every request reuses both.
  const catalog = loadCatalog();
  const index = buildIndex(catalog);
  const metrics = createMetrics({ logRequests: options.logRequests ?? false });

  // Mounted before the routes it counts, and scoped to /api so static asset
  // requests don't show up in the metrics.
  app.use("/api", metrics.middleware);

  app.use("/api", createSearchRouter(catalog, index, metrics));

  app.get("/api/metrics", (_req: Request, res: Response) => {
    res.json(metrics.snapshot());
  });

  // JSON 404 for any unmatched /api/* route, so API clients never get an HTML error page.
  app.use("/api", (_req: Request, res: Response) => {
    res
      .status(404)
      .json({ code: "NOT_FOUND", message: "Not found" } satisfies ApiError);
  });

  // Production only (`npm start` after `npm run build`). In dev, Vite serves the client.
  app.use(express.static(path.join(import.meta.dirname, "../../dist/client")));

  // Express recognises error middleware by its four parameters. It must be
  // registered after every route, or their errors never reach it.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    // Headers already sent means the response is part-written; only Express's
    // default handler can clean that up (it closes the connection).
    if (res.headersSent) return next(err);

    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ code: err.code, message: err.message } satisfies ApiError);
      return;
    }

    // Anything else is a bug, not a bad request: log the details here, and send
    // a generic message rather than leaking internals to the client.
    console.error(err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    } satisfies ApiError);
  });

  return app;
}
