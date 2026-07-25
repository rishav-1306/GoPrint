const config = require('../config/env');

/**
 * Global error handler middleware
 * Must be registered LAST in Express app
 */
const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isDev = config.isDev;

  console.error(`[ERROR] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (isDev && err.stack) {
    console.error(err.stack);
  }

  res.status(status).json({
    success: false,
    message: err.message || 'An internal server error occurred.',
    ...(isDev && { stack: err.stack }),
  });
};

/**
 * 404 Not Found handler
 */
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

module.exports = { errorHandler, notFound };
