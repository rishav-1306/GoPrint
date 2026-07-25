const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const externalApi = require('../services/externalApiService');

// GET /api/parts?clientId=C001
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { clientId } = req.query;
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId query parameter is required.' });
    }
    const parts = await externalApi.getPartsByClient(clientId);
    res.json({ success: true, data: parts });
  } catch (err) {
    next(err);
  }
});

// GET /api/parts/:partId — full part details (auto-populate fields)
router.get('/:partId', authenticate, async (req, res, next) => {
  try {
    const part = await externalApi.getPartDetails(req.params.partId);
    if (!part) {
      return res.status(404).json({ success: false, message: 'Part not found.' });
    }
    res.json({ success: true, data: part });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
