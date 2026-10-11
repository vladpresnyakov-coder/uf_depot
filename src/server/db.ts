import "server-only";
import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("База данных не настроена (DATABASE_URL).");
  if (!pool) {
    // Railway: внутренняя сеть без TLS; внешний адрес — с TLS.
    const internal = /\.railway\.internal|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: internal ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
