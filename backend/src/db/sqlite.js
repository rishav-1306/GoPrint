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
            excel_url TEXT,
            timezone TEXT DEFAULT 'Asia/Kolkata',
            date_format TEXT DEFAULT 'DD-MMM-YYYY',
            shift_start_time TEXT DEFAULT '08:00:00',
            shift_end_time TEXT DEFAULT '20:00:00',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Migration: Ensure excel_url exists on existing SQLite databases
        db.run(`ALTER TABLE application_settings ADD COLUMN excel_url TEXT`, (err) => {
          // Ignore error if column already exists
        });

        db.run(`
          CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT,
            code TEXT,
            contact_person TEXT,
            contact_phone TEXT,
            contact_email TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS parts (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            client_name TEXT,
            part_number TEXT NOT NULL,
            description TEXT NOT NULL,
            jt_number TEXT,
            vendor_code TEXT,
            revision_level TEXT,
            vendor_name TEXT,
            dealer TEXT,
            afm_code TEXT,
            client_address TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id)
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

        // Seed default clients if clients table is empty
        const clientCount = await allSql(`SELECT COUNT(*) as count FROM clients`);
        if (clientCount && clientCount[0] && clientCount[0].count === 0) {
          const defaultClients = [
            ['C001', 'TATA HITACHI', 'Dharwad, Karnataka, India', 'TH01', 'Logistics Dept', '+91 9876543210', 'contact@tatahitachi.com'],
            ['C002', 'CATERPILLAR INDIA', 'Thiruvallur, Tamil Nadu, India', 'CAT01', 'Supply Chain', '+91 9876543211', 'contact@caterpillar.com'],
            ['C003', 'JCB INDIA LIMITED', 'Ballabgarh, Haryana, India', 'JCB01', 'Plant Manager', '+91 9876543212', 'contact@jcb.com'],
            ['C004', 'KOMATSU INDIA', 'Oragadam, Tamil Nadu, India', 'KOM01', 'Operations', '+91 9876543213', 'contact@komatsu.com'],
            ['C005', 'BEML LIMITED', 'Mysuru, Karnataka, India', 'BEML01', 'Procurement', '+91 9876543214', 'contact@beml.com'],
            ['C006', 'MARUTI SUZUKI', 'Manesar, Haryana, India', 'MS01', 'Quality Lead', '+91 9876543215', 'contact@maruti.com'],
            ['C007', 'HYUNDAI MOTORS INDIA', 'Sriperumbudur, Tamil Nadu, India', 'HYU01', 'Vendor Management', '+91 9876543216', 'contact@hyundai.com'],
            ['C008', 'MAHINDRA & MAHINDRA', 'Nashik, Maharashtra, India', 'MM01', 'Dispatch Control', '+91 9876543217', 'contact@mahindra.com'],
            ['C009', 'ASHOK LEYLAND', 'Chennai, Tamil Nadu, India', 'AL01', 'Packing Desk', '+91 9876543218', 'contact@ashokleyland.com']
          ];
          for (const c of defaultClients) {
            db.run(`INSERT INTO clients (id, name, address, code, contact_person, contact_phone, contact_email) VALUES (?, ?, ?, ?, ?, ?, ?)`, c);
          }
        }

        // Seed default parts if parts table is empty
        const partCount = await allSql(`SELECT COUNT(*) as count FROM parts`);
        if (partCount && partCount[0] && partCount[0].count === 0) {
          const defaultParts = [
            ['P001', 'C001', 'TATA HITACHI', '4004100217-0J23', 'ASSY PROP SHAFT FRONT', 'JT 123 L 413', 'RSB-V66', 'REV-04', 'RSB TRANSMISSIONS PVT LTD', 'TATA HITACHI CONSTRUCTION MACHINERY', 'AFM-2024-001', 'Dharwad, Karnataka 580001'],
            ['P002', 'C001', 'TATA HITACHI', '4004100218-0J23', 'ASSY PROP SHAFT REAR', 'JT 124 L 413', 'RSB-V67', 'REV-02', 'RSB TRANSMISSIONS PVT LTD', 'TATA HITACHI CONSTRUCTION MACHINERY', 'AFM-2024-002', 'Dharwad, Karnataka 580001'],
            ['P003', 'C001', 'TATA HITACHI', '4004100219-0J24', 'BEARING COVER SEAL TYPE B', 'JT 125 L 414', 'RSB-V68', 'REV-01', 'RSB TRANSMISSIONS PVT LTD', 'TATA HITACHI CONSTRUCTION MACHINERY', 'AFM-2024-003', 'Dharwad, Karnataka 580001'],
            ['P004', 'C002', 'CATERPILLAR INDIA', 'CAT-PS-4441-A', 'PROPELLER SHAFT ASSEMBLY CAT 320', 'JT 200 L 500', 'RSB-V70', 'REV-03', 'RSB TRANSMISSIONS PVT LTD', 'CATERPILLAR INDIA PVT LTD', 'AFM-2024-010', 'Thiruvallur, Tamil Nadu 600001'],
            ['P005', 'C003', 'JCB INDIA LIMITED', 'JCB-DRV-3CX-001', 'DRIVE SHAFT FRONT JCB 3CX', 'JT 300 L 600', 'RSB-V80', 'REV-05', 'RSB TRANSMISSIONS PVT LTD', 'JCB INDIA LIMITED', 'AFM-2024-020', 'Ballabgarh, Haryana 121004'],
            ['P006', 'C009', 'ASHOK LEYLAND', 'PD601549', 'S/F R/HSG TUBE ASSY', '590L', '7200868', 'NA', 'RSB TRANSMISSIONS PVT LTD', 'ASHOK LEYLAND', 'AFM-2024-030', 'Chennai, Tamil Nadu, India']
          ];
          for (const p of defaultParts) {
            db.run(`INSERT INTO parts (id, client_id, client_name, part_number, description, jt_number, vendor_code, revision_level, vendor_name, dealer, afm_code, client_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p);
          }
        }

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

  // Replace ILIKE with LIKE (case-insensitive)
  s = s.replace(/\bILIKE\b/gi, 'LIKE');

  // Replace NOW() with DATETIME('now')
  s = s.replace(/\bNOW\(\)/gi, "DATETIME('now')");

  // Replace CURRENT_DATE with DATE('now')
  s = s.replace(/\bCURRENT_DATE\b/gi, "DATE('now')");

  // Replace Postgres date intervals — various formats
  s = s.replace(/DATETIME\('now'\)\s*-\s*INTERVAL\s*'(\d+)\s*days?'/gi, (_, d) => `DATETIME('now', '-${d} days')`);
  s = s.replace(/NOW\(\)\s*-\s*INTERVAL\s*'(\d+)\s*days?'/gi, (_, d) => `DATETIME('now', '-${d} days')`);
  s = s.replace(/DATE_TRUNC\('month',\s*(?:NOW\(\)|DATETIME\('now'\))\)/gi, "DATE('now', 'start of month')");
  s = s.replace(/::date\s*\+\s*interval\s*'1 day'/gi, '');
  s = s.replace(/\s*::\w+/g, ''); // strip any remaining Postgres type casts

  // INTERVAL standalone
  s = s.replace(/INTERVAL\s*'7 days'/gi, "'-7 days'");
  s = s.replace(/INTERVAL\s*'30 days'/gi, "'-30 days'");
  s = s.replace(/INTERVAL\s*'1 day'/gi, "'+1 day'");

  // Replace boolean TRUE/FALSE with 1/0
  s = s.replace(/\bTRUE\b/gi, '1');
  s = s.replace(/\bFALSE\b/gi, '0');

  // Replace RETURNING * (not directly supported in INSERT — strip it and handle in sqliteQuery)
  // Note: sqliteQuery handles this by fetching the last inserted row

  // Replace Postgres WITH TIMEZONE in timestamps
  s = s.replace(/\bTIMESTAMP WITH TIME ZONE\b/gi, 'DATETIME');

  // ON CONFLICT ... DO UPDATE SET — SQLite uses same syntax, no change needed
  // ON CONFLICT (id) DO UPDATE SET — keep as-is

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
