const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/settings
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM application_settings WHERE id = 1');
    res.json({ success: true, data: result.rows[0] || {} });
  } catch (err) { next(err); }
});

// PUT /api/settings
router.put('/', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const { company_name, theme_name, default_printer_id, external_api_url, timezone, date_format } = req.body;
    const result = await db.query(
      `INSERT INTO application_settings (id, company_name, theme_name, default_printer_id, external_api_url, timezone, date_format, last_updated)
       VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         theme_name = EXCLUDED.theme_name,
         default_printer_id = EXCLUDED.default_printer_id,
         external_api_url = EXCLUDED.external_api_url,
         timezone = EXCLUDED.timezone,
         date_format = EXCLUDED.date_format,
         last_updated = NOW()
       RETURNING *`,
      [company_name || 'RSB Transmissions', theme_name || 'light', default_printer_id || null,
       external_api_url || null, timezone || 'Asia/Kolkata', date_format || 'DD-MMM-YYYY']
    );
    res.json({ success: true, data: result.rows[0], message: 'Settings saved.' });
  } catch (err) { next(err); }
});

module.exports = router;
