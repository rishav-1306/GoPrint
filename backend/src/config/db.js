const { initSqlite, sqliteQuery } = require('../db/sqlite');

/**
 * Execute a query against the embedded SQLite database
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<{ rows: Array, rowCount?: number }>}
 */
const query = async (text, params = []) => {
  return sqliteQuery(text, params);
};

/**
 * Get a client interface for transactions
 */
const getClient = async () => {
  return {
    query: (text, params) => sqliteQuery(text, params),
    release: () => {},
  };
};

/**
 * Test & initialize SQLite embedded database
 * @returns {Promise<boolean>}
 */
const testConnection = async () => {
  try {
    await initSqlite();
    console.log('[DB] Embedded database (data/rsb_printing.sqlite) initialized successfully.');
    return true;
  } catch (err) {
    console.error('[DB] Embedded database initialization failed:', err.message);
    return false;
  }
};

module.exports = { query, getClient, testConnection };
