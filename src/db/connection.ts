import mariadb from 'mariadb';
import { config } from '../config';

const pool = mariadb.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: 5,
  connectTimeout: 10000,
});

export async function getConnection() {
  return pool.getConnection();
}

export async function query(sql: string, params?: any[]) {
  const conn = await pool.getConnection();
  try {
    const result = await conn.query(sql, params);
    return result;
  } finally {
    conn.release();
  }
}

export default pool;
