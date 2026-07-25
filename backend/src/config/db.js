const { Pool } = require('pg');
const config = require('./env');
const { initSqlite, sqliteQuery } = require('../db/sqlite');

let isUsingSqlite = false;

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  if (!isUsingSqlite) {
    console.error('[DB] Unexpected error on idle PostgreSQL client:', err.message);
  }
});

/**
 * Execute a query with optional parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<{ rows: Array, rowCount?: number }>}
 */
const query = async (text, params = []) => {
  if (isUsingSqlite) {
    return sqliteQuery(text, params);
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    // If PostgreSQL fails during runtime, try fallback
    if (err.code === 'ECONNREFUSED' || err.code === '28P01' || err.code === '3D000') {
      if (!isUsingSqlite) {
        console.warn('[DB] Switching to embedded SQLite fallback due to PostgreSQL error:', err.message);
        isUsingSqlite = true;
        await initSqlite();
      }
      return sqliteQuery(text, params);
    }
    throw err;
  }
};

/**
 * Get a client for transactions
 */
const getClient = async () => {
  if (isUsingSqlite) {
    return {
      query: (text, params) => sqliteQuery(text, params),
      release: () => {},
    };
  }
  return pool.connect();
};

/**
 * Test database connection and initialize fallback if Postgres is down
 * @returns {Promise<boolean>}
 */
const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW() as now');
    console.log(`[DB] Connected to PostgreSQL at: ${res.rows[0].now}`);
    isUsingSqlite = false;
    return true;
  } catch (err) {
    console.warn(`[DB] PostgreSQL connection failed (${err.message}).`);
    console.log('[DB] Activating embedded SQLite database fallback (data/rsb_printing.sqlite)...');
    try {
      isUsingSqlite = true;
      await initSqlite();
      console.log('[DB] Embedded SQLite database initialized successfully.');
      return true;
    } catch (sqliteErr) {
      console.error('[DB] SQLite initialization failed:', sqliteErr.message);
      return false;
    }
  }
};

module.exports = { query, getClient, pool, testConnection };
