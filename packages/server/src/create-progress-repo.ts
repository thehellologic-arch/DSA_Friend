import { Pool } from "pg";
import { MemoryProgressRepository } from "./memory-progress-repository.js";
import { runMigrations } from "./migrate.js";
import { isMongoConfigured } from "./mongo.js";
import { createMongoProgressRepository } from "./mongo-progress-repository.js";
import { PostgresProgressRepository } from "./postgres-progress-repository.js";
import type { ProgressRepository } from "./progress-repository.js";

export async function createProgressRepository(): Promise<ProgressRepository> {
  if (isMongoConfigured()) {
    try {
      const repo = await createMongoProgressRepository();
      console.info("Using MongoDB progress store");
      return repo;
    } catch (err) {
      console.warn(
        "MongoDB progress unavailable; trying PostgreSQL / memory",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL unset; using in-memory progress store");
    return new MemoryProgressRepository();
  }
  const pool = new Pool({ connectionString: url });
  try {
    await runMigrations(pool);
    return new PostgresProgressRepository(pool);
  } catch (err) {
    console.warn(
      "PostgreSQL unavailable; using in-memory progress store",
      err instanceof Error ? err.message : err,
    );
    await pool.end().catch(() => undefined);
    return new MemoryProgressRepository();
  }
}
