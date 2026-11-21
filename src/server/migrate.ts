import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, simulatorPool } from './db';
export async function migrate() {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => console.log('PostgreSQL schema ready')).finally(async () => { await pool.end(); await simulatorPool.end(); });
}
