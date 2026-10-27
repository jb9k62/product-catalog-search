import { readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogItem } from "../../shared/api-types.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function loadCatalog(): CatalogItem[] {
  // CATALOG_PATH swaps in another dataset without code changes, e.g. the output
  // of `npm run seed:random`: CATALOG_PATH=data/catalog.random.json npm run dev
  // A relative path resolves from the repo root, so it works from any folder.
  // `||`, not `??`, so an empty CATALOG_PATH falls back to the seed file.
  const catalogPath = path.resolve(
    REPO_ROOT,
    process.env.CATALOG_PATH || "data/catalog.seed.json",
  );
  // A cast, not runtime validation: the file is generated from the same
  // CatalogItem type by scripts/generate-catalog.ts. Data from outside the
  // repo would deserve a schema check here.
  return JSON.parse(readFileSync(catalogPath, "utf-8")) as CatalogItem[];
}
