const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'rsb_printing.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper to run sqlite query as Promise
const runSql = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const allSql = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

/**
 * Initialize SQLite tables and seed data
 */
const initSqlite = async () => {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        db.run('PRAGMA foreign_keys = ON;');

        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'Operator',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS printer_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            printer_name TEXT NOT NULL,
            printer_model TEXT,
            printer_ip TEXT,
            printer_port INTEGER DEFAULT 9100,
            connection_type TEXT DEFAULT 'ETHERNET',
            usb_port TEXT,
            print_language TEXT DEFAULT 'ZPL',
            darkness INTEGER DEFAULT 25,
            speed INTEGER DEFAULT 6,
            label_width INTEGER DEFAULT 100,
            label_height INTEGER DEFAULT 150,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        // Add usb_port column if upgrading from older schema
        db.run(`ALTER TABLE printer_settings ADD COLUMN usb_port TEXT`, () => {});

        db.run(`
          CREATE TABLE IF NOT EXISTS sticker_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_name TEXT UNIQUE NOT NULL,
            height INTEGER NOT NULL DEFAULT 150,
            width INTEGER NOT NULL DEFAULT 100,
            supports_qr INTEGER DEFAULT 1,
            supports_barcode INTEGER DEFAULT 0,
            zpl_template TEXT,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS print_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT UNIQUE NOT NULL,
            client_id TEXT,
            client_name TEXT NOT NULL,
            part_number TEXT NOT NULL,
            part_description TEXT,
            serial_number TEXT,
            hin_number TEXT,
            revision_level TEXT,
            vendor_code TEXT,
            vendor_name TEXT,
            jt_number TEXT,
            afm_code TEXT,
            dealer TEXT,
            mfg_date TEXT,
            quantity INTEGER NOT NULL DEFAULT 1,
            printed_by INTEGER REFERENCES users(id),
            printed_by_name TEXT,
            printer_used INTEGER REFERENCES printer_settings(id),
            printer_name TEXT,
            template_id INTEGER REFERENCES sticker_templates(id),
            print_status TEXT NOT NULL DEFAULT 'PENDING',
            error_message TEXT,
            date_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS application_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            company_name TEXT DEFAULT 'RSB Transmissions',
            theme_name TEXT DEFAULT 'light',
            default_printer_id INTEGER REFERENCES printer_settings(id),
            external_api_url TEXT,
            timezone TEXT DEFAULT 'Asia/Kolkata',
            date_format TEXT DEFAULT 'DD-MMM-YYYY',
            shift_start_time TEXT DEFAULT '08:00:00',
            shift_end_time TEXT DEFAULT '20:00:00',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Seed default admin user (Admin@123)
        const adminHash = '$2a$10$SR3Fp4GI4GhYfZc5IXNGK.MrVmufLNdXyoYmVaSAm4DEGdJ0f6UtS';
        const operatorHash = '$2a$10$wUet.pr0vfeqV53Gg66Da.ornjxocw8mr74iCGXx2ZpVuAiHrzpJC';

        db.run(`INSERT OR IGNORE INTO users (id, name, email, username, password, role) VALUES (1, 'System Administrator', 'admin@rsb.com', 'admin', ?, 'Admin')`, [adminHash]);
        db.run(`INSERT OR IGNORE INTO users (id, name, email, username, password, role) VALUES (2, 'Default Operator', 'operator@rsb.com', 'operator', ?, 'Operator')`, [operatorHash]);

        // Seed default templates
        db.run(`INSERT OR IGNORE INTO sticker_templates (id, template_name, height, width, supports_qr, supports_barcode, description) VALUES (1, 'Standard_OEM_v2.1', 150, 100, 1, 0, 'Standard OEM label for automotive parts with QR code')`);

        // Seed application settings
        db.run(`INSERT OR IGNORE INTO application_settings (id, company_name) VALUES (1, 'RSB Transmissions')`);

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
};

/**
 * SQL dialect converter from Postgres to SQLite
 */
const convertPostgresToSqlite = (sql) => {
  let s = sql;

  // Replace Postgres $1, $2 with ? or keep $1 ($1 works in sqlite3 if params is an array or object, but ? is safest)
  // sqlite3 supports $1, $2 natively when params are passed as an array or object in sqlite3!
  // Replace ILIKE with LIKE
  s = s.replace(/\bILIKE\b/gi, 'LIKE');

  // Replace NOW() with CURRENT_TIMESTAMP or DATETIME('now')
  s = s.replace(/\bNOW\(\)/gi, "DATETIME('now')");

  // Replace CURRENT_DATE with DATE('now')
  s = s.replace(/\bCURRENT_DATE\b/gi, "DATE('now')");

  // Replace Postgres date intervals
  s = s.replace(/NOW\(\)\s*-\s*INTERVAL\s*'7 days'/gi, "DATETIME('now', '-7 days')");
  s = s.replace(/NOW\(\)\s*-\s*INTERVAL\s*'30 days'/gi, "DATETIME('now', '-30 days')");
  s = s.replace(/DATE_TRUNC\('month',\s*NOW\(\)\)/gi, "DATE('now', 'start of month')");
  s = s.replace(/::date\s*\+\s*interval\s*'1 day'/gi, "");

  // Replace boolean TRUE/FALSE with 1/0
  s = s.replace(/=\s*TRUE\b/gi, '= 1');
  s = s.replace(/=\s*FALSE\b/gi, '= 0');
  s = s.replace(/\bis_active\s*=\s*TRUE\b/gi, 'is_active = 1');
  s = s.replace(/\bis_active\s*=\s*FALSE\b/gi, 'is_active = 0');
  s = s.replace(/\bis_default\s*=\s*TRUE\b/gi, 'is_default = 1');
  s = s.replace(/\bis_default\s*=\s*FALSE\b/gi, 'is_default = 0');

  return s;
};

/**
 * Execute query against SQLite database (returns Postgres-style { rows: [...] })
 */
const sqliteQuery = async (text, params = []) => {
  const convertedSql = convertPostgresToSqlite(text);

  // Check if query is SELECT or returns rows
  const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(convertedSql);
  const isReturning = /RETURNING/i.test(convertedSql);

  if (isSelect || isReturning) {
    const rows = await allSql(convertedSql, params);
    // Convert integer booleans back to JS booleans for consistency with pg driver
    const mapped = rows.map(r => {
      const copy = { ...r };
      if (typeof copy.is_active === 'number') copy.is_active = Boolean(copy.is_active);
      if (typeof copy.is_default === 'number') copy.is_default = Boolean(copy.is_default);
      if (typeof copy.supports_qr === 'number') copy.supports_qr = Boolean(copy.supports_qr);
      if (typeof copy.supports_barcode === 'number') copy.supports_barcode = Boolean(copy.supports_barcode);
      return copy;
    });
    return { rows: mapped };
  } else {
    const result = await runSql(convertedSql, params);
    return { rows: [], rowCount: result.changes };
  }
};

module.exports = { db, initSqlite, sqliteQuery };
