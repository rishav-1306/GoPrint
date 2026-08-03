/**
 * migrate.js — No longer needed (app uses embedded SQLite).
 * Database is auto-initialized on server startup via sqlite.js.
 */
console.log('[MIGRATE] Note: This app now uses embedded SQLite database.');
console.log('[MIGRATE] The database is auto-initialized when the server starts.');
console.log('[MIGRATE] No manual migration needed. Just run: npm start');
console.log('[MIGRATE] Default credentials:');
console.log('  Admin    → username: admin      password: Admin@123');
console.log('  Operator → username: operator   password: Operator@123');
