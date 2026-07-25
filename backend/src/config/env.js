// Copy .env.example to .env before running
require('dotenv').config();

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
];

const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(`[CONFIG ERROR] Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please copy .env.example to .env and fill in the values.');
  process.exit(1);
}

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // Database
  databaseUrl: process.env.DATABASE_URL,

  // JWT
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',

  // External SQL API
  externalApiBaseUrl: process.env.EXTERNAL_API_BASE_URL || 'http://localhost:8080/api',
  // Default to mock data when not explicitly set to false
  useMockExternalApi: process.env.USE_MOCK_EXTERNAL_API !== 'false',

  // Printer
  defaultPrinterIp: process.env.DEFAULT_PRINTER_IP || '192.168.1.104',
  defaultPrinterPort: parseInt(process.env.DEFAULT_PRINTER_PORT) || 9100,
  printerTimeoutMs: parseInt(process.env.PRINTER_TIMEOUT_MS) || 5000,

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),
};
