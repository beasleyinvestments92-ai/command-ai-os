import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/index.js';
import { validateConfig } from '../src/config.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function migrate(pool = getPool()) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(path.join(root, 'migrations'))).filter((file) => file.endsWith('.sql')).sort();
  const appliedResult = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.version));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(root, 'migrations', file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateConfig();
  migrate().then(() => closePool()).catch(async (error) => {
    console.error(error);
    await closePool();
    process.exitCode = 1;
  });
}
