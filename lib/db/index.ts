import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<any, typeof schema>;

const g = globalThis as unknown as { __dbPromise?: Promise<Db> };

/**
 * Returns the singleton database.
 *  - DATABASE_URL set  -> node-postgres (production / docker compose)
 *  - otherwise         -> PGlite, an embedded Postgres stored in ./.data/pglite
 * Migrations in ./drizzle are applied on first connection.
 */
export function getDb(): Promise<Db> {
  if (!g.__dbPromise) {
    g.__dbPromise = init().catch((err) => {
      g.__dbPromise = undefined;
      throw err;
    });
  }
  return g.__dbPromise;
}

async function init(): Promise<Db> {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const db = drizzle(new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX) || 10 }), { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.resolve(process.cwd(), ".data", "pglite");
  if (dir !== "memory") fs.mkdirSync(dir, { recursive: true }); // PGlite does not create parent folders
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export { schema };
