const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('../config/env');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATE] Starting database migration...');
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`[MIGRATE] Running: ${file}`);
      await client.query(sql);
      console.log(`[MIGRATE] Done: ${file}`);
    }

    console.log('[MIGRATE] All migrations completed successfully!');
    console.log('[MIGRATE] Default credentials:');
    console.log('  Admin   — username: admin      password: Admin@123');
    console.log('  Operator — username: operator  password: Operator@123');
  } catch (err) {
    console.error('[MIGRATE] Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
