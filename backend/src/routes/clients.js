const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const externalApi = require('../services/externalApiService');

// GET /api/clients
router.get('/', authenticate, async (req, res, next) => {
  try {
    const clients = await externalApi.getClients();
    res.json({ success: true, data: clients });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
