import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(here, "..", "data", "analytics.db");

// Readonly connection — defense-in-depth against destructive queries
// even if the SQL guard is somehow bypassed.
export function openDb() {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}
