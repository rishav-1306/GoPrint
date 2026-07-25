-- ============================================================
-- RSB Sticker Printing & Packing System
-- PostgreSQL Schema — Initial Migration
-- Run: psql -U postgres -d rsb_printing -f 001_initial_schema.sql
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255) UNIQUE,
    username    VARCHAR(100) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    role        VARCHAR(50) NOT NULL DEFAULT 'Operator' CHECK (role IN ('Admin', 'Supervisor', 'Operator')),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- PRINTER SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS printer_settings (
    id              SERIAL PRIMARY KEY,
    printer_name    VARCHAR(255) NOT NULL,
    printer_model   VARCHAR(255),
    printer_ip      VARCHAR(50),
    printer_port    INTEGER DEFAULT 9100,
    connection_type VARCHAR(50) DEFAULT 'ETHERNET' CHECK (connection_type IN ('ETHERNET', 'WIFI', 'USB')),
    print_language  VARCHAR(20) DEFAULT 'ZPL' CHECK (print_language IN ('ZPL', 'EPL', 'IPL', 'FINGERPRINT')),
    darkness        INTEGER DEFAULT 25 CHECK (darkness BETWEEN 0 AND 30),
    speed           INTEGER DEFAULT 6 CHECK (speed BETWEEN 1 AND 14),
    label_width     INTEGER DEFAULT 100,
    label_height    INTEGER DEFAULT 150,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- STICKER TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS sticker_templates (
    id              SERIAL PRIMARY KEY,
    template_name   VARCHAR(255) NOT NULL UNIQUE,
    height          INTEGER NOT NULL DEFAULT 150,
    width           INTEGER NOT NULL DEFAULT 100,
    supports_qr     BOOLEAN DEFAULT TRUE,
    supports_barcode BOOLEAN DEFAULT FALSE,
    zpl_template    TEXT,
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- PRINT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS print_logs (
    id              SERIAL PRIMARY KEY,
    job_id          VARCHAR(50) UNIQUE NOT NULL,
    client_id       VARCHAR(100),
    client_name     VARCHAR(255) NOT NULL,
    part_number     VARCHAR(255) NOT NULL,
    part_description VARCHAR(500),
    serial_number   VARCHAR(255),
    hin_number      VARCHAR(500),
    revision_level  VARCHAR(50),
    vendor_code     VARCHAR(100),
    vendor_name     VARCHAR(255),
    jt_number       VARCHAR(100),
    afm_code        VARCHAR(100),
    dealer          VARCHAR(255),
    mfg_date        DATE,
    quantity        INTEGER NOT NULL DEFAULT 1,
    printed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    printed_by_name VARCHAR(255),
    printer_used    INTEGER REFERENCES printer_settings(id) ON DELETE SET NULL,
    printer_name    VARCHAR(255),
    template_id     INTEGER REFERENCES sticker_templates(id) ON DELETE SET NULL,
    print_status    VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (print_status IN ('PENDING', 'PRINTED', 'FAILED', 'CANCELLED')),
    error_message   TEXT,
    date_time       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- APPLICATION SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS application_settings (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    company_name        VARCHAR(255) DEFAULT 'RSB Transmissions',
    theme_name          VARCHAR(50) DEFAULT 'light',
    default_printer_id  INTEGER REFERENCES printer_settings(id) ON DELETE SET NULL,
    external_api_url    VARCHAR(500),
    timezone            VARCHAR(100) DEFAULT 'Asia/Kolkata',
    date_format         VARCHAR(50) DEFAULT 'DD-MMM-YYYY',
    shift_start_time    TIME DEFAULT '08:00:00',
    shift_end_time      TIME DEFAULT '20:00:00',
    last_updated        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_print_logs_date ON print_logs(date_time DESC);
CREATE INDEX IF NOT EXISTS idx_print_logs_client ON print_logs(client_name);
CREATE INDEX IF NOT EXISTS idx_print_logs_status ON print_logs(print_status);
CREATE INDEX IF NOT EXISTS idx_print_logs_printed_by ON print_logs(printed_by);
CREATE INDEX IF NOT EXISTS idx_print_logs_printer ON print_logs(printer_used);
CREATE INDEX IF NOT EXISTS idx_print_logs_job_id ON print_logs(job_id);

-- ============================================================
-- DEFAULT DATA
-- ============================================================

-- Default admin user (password: Admin@123)
-- Password hash generated with bcrypt rounds=10
INSERT INTO users (name, email, username, password, role)
VALUES (
    'System Administrator',
    'admin@rsb.com',
    'admin',
    '$2a$10$SR3Fp4GI4GhYfZc5IXNGK.MrVmufLNdXyoYmVaSAm4DEGdJ0f6UtS',
    'Admin'
) ON CONFLICT (username) DO NOTHING;

-- Default operator (password: Operator@123)
-- Hash for 'Operator@123' with bcrypt rounds=10
INSERT INTO users (name, email, username, password, role)
VALUES (
    'Default Operator',
    'operator@rsb.com',
    'operator',
    '$2a$10$wUet.pr0vfeqV53Gg66Da.ornjxocw8mr74iCGXx2ZpVuAiHrzpJC',
    'Operator'
) ON CONFLICT (username) DO NOTHING;

-- Default sticker templates
INSERT INTO sticker_templates (template_name, height, width, supports_qr, supports_barcode, description)
VALUES
    ('Standard_OEM_v2.1', 150, 100, TRUE, FALSE, 'Standard OEM label for automotive parts with QR code'),
    ('Compact_Label_v1', 75, 50, TRUE, FALSE, 'Compact label for small parts'),
    ('Barcode_Label_v1', 100, 75, FALSE, TRUE, 'Label with barcode only')
ON CONFLICT (template_name) DO NOTHING;

-- Default application settings
INSERT INTO application_settings (id, company_name)
VALUES (1, 'RSB Transmissions')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_printer_settings_updated_at
    BEFORE UPDATE ON printer_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_sticker_templates_updated_at
    BEFORE UPDATE ON sticker_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
