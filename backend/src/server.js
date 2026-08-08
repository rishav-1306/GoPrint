// ============================================================
// GoPrint Sticker Printing & Packing System — Express Server
// ============================================================
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config/env');
const { testConnection } = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Routes
const authRoutes      = require('./routes/auth');
const clientRoutes    = require('./routes/clients');
const partRoutes      = require('./routes/parts');
const printerRoutes   = require('./routes/printers');
const printRoutes     = require('./routes/print');
const logRoutes       = require('./routes/logs');
const reportRoutes    = require('./routes/reports');
const templateRoutes  = require('./routes/templates');
const settingsRoutes  = require('./routes/settings');
const userRoutes      = require('./routes/users');

const app = express();

// ============================================================
// Security & Core Middleware
// ============================================================
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow Tailwind CDN, Google Fonts
  crossOriginEmbedderPolicy: false,
}));

// CORS — allow all origins for intranet/factory deployment.
// Since this server is not exposed to the internet, allowing all origins
// is safe and ensures any company workstation can access the system.
app.use(cors({
  origin: true, // reflect request origin — works for any company IP
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.isDev ? 'dev' : 'combined'));

// ============================================================
// Serve Frontend Static Files
// ============================================================
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// ============================================================
// Health Check
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GoPrint Sticker Printing & Packing System',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// ============================================================
// API Routes
// ============================================================
app.use('/api/auth',      authRoutes);
app.use('/api/clients',   clientRoutes);
app.use('/api/parts',     partRoutes);
app.use('/api/printers',  printerRoutes);
app.use('/api/print',     printRoutes);
app.use('/api/logs',      logRoutes);
app.use('/api/reports',   reportRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/users',     userRoutes);

// ============================================================
// SPA Fallback — serve index.html for all non-API routes
// ============================================================
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  }
});

// ============================================================
// Error Handling (must be last)
// ============================================================
app.use(notFound);
app.use(errorHandler);

// ============================================================
// Start Server
// ============================================================
const start = async () => {
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('[SERVER] Cannot initialize system database.');
    process.exit(1);
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  GoPrint Sticker Printing & Packing System — RUNNING ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`\n  → Local URL:    http://localhost:${config.port}`);
    console.log(`  → Network URL:  http://192.168.166.45:${config.port}`);
    console.log(`  → API Health:   http://localhost:${config.port}/api/health`);
    console.log(`  → Environment:  ${config.nodeEnv}`);
    console.log(`  → Data Engine:  Excel Sheet Database`);
    console.log('\n  Default Credentials:');
    console.log('    Admin    → username: admin      password: Admin@123');
    console.log('    Operator → username: operator   password: Operator@123');
    console.log('\n');
  });
};

start();
