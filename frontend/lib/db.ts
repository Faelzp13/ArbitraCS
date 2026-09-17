import { Pool } from 'pg';

const globalForPg = globalThis as unknown as { pgPool: Pool };

export function getConnection() {
  if (!globalForPg.pgPool) {
    globalForPg.pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return globalForPg.pgPool;
}

export async function query(text: string, params?: any[]) {
  const pool = getConnection();
  return pool.query(text, params);
}