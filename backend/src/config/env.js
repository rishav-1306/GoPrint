// Environment variables configuration
require('dotenv').config();
const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT) || 2026,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'goprint_default_jwt_secret_key_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',

  // Printer
  defaultPrinterIp: process.env.DEFAULT_PRINTER_IP || '192.168.1.104',
  defaultPrinterPort: parseInt(process.env.DEFAULT_PRINTER_PORT) || 9100,
  printerTimeoutMs: parseInt(process.env.PRINTER_TIMEOUT_MS) || 5000,

  // Excel Database — default local file path
  defaultExcelPath: process.env.EXCEL_PATH || path.join(__dirname, '../../data/Customer Details - Copy.xlsx'),

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:2026,http://127.0.0.1:2026,http://192.168.166.45:2026,http://192.168.166.45').split(',').map(s => s.trim()),
};
