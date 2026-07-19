import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;
let pool;

export function setPool(nextPool) {
  pool = nextPool;
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: Number(process.env.DATABASE_POOL_MAX || 12),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
    pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error', error));
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

export async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

export async function tx(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
