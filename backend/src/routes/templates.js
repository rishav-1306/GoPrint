const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/templates
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM sticker_templates WHERE is_active = TRUE ORDER BY template_name ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// GET /api/templates/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM sticker_templates WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// POST /api/templates
router.post('/', authenticate, requireRole('Admin', 'Supervisor'), async (req, res, next) => {
  try {
    const { template_name, height, width, supports_qr, supports_barcode, zpl_template, description } = req.body;
    if (!template_name) return res.status(400).json({ success: false, message: 'Template name is required.' });
    const result = await db.query(
      `INSERT INTO sticker_templates (template_name, height, width, supports_qr, supports_barcode, zpl_template, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [template_name, height || 150, width || 100, supports_qr !== false, supports_barcode || false, zpl_template || null, description || null]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Template created.' });
  } catch (err) { next(err); }
});

// PUT /api/templates/:id
router.put('/:id', authenticate, requireRole('Admin', 'Supervisor'), async (req, res, next) => {
  try {
    const { template_name, height, width, supports_qr, supports_barcode, zpl_template, description } = req.body;
    const result = await db.query(
      `UPDATE sticker_templates SET
         template_name = COALESCE($1, template_name),
         height = COALESCE($2, height),
         width = COALESCE($3, width),
         supports_qr = COALESCE($4, supports_qr),
         supports_barcode = COALESCE($5, supports_barcode),
         zpl_template = COALESCE($6, zpl_template),
         description = COALESCE($7, description),
         updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [template_name, height, width, supports_qr, supports_barcode, zpl_template, description, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, data: result.rows[0], message: 'Template updated.' });
  } catch (err) { next(err); }
});

// DELETE /api/templates/:id
router.delete('/:id', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const result = await db.query(
      'UPDATE sticker_templates SET is_active = FALSE WHERE id = $1 RETURNING template_name',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, message: `Template "${result.rows[0].template_name}" deleted.` });
  } catch (err) { next(err); }
});

module.exports = router;
