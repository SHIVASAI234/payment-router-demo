import pg, { type PoolClient } from 'pg';

const globalDb = globalThis as unknown as { routerPool?: pg.Pool; simulatorPool?: pg.Pool };
const options = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, idleTimeoutMillis: 20000 };
export const pool = globalDb.routerPool ??= new pg.Pool({ ...options, max: 12 });
// A separate pool prevents a burst of callers holding router row locks from
// starving the external-provider simulator of connections.
export const simulatorPool = globalDb.simulatorPool ??= new pg.Pool({ ...options, max: 4 });
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>, target = pool): Promise<T> {
  const db = await target.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}
