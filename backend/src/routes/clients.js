const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const excelService = require('../services/excelService');

// GET /api/clients — Fetch all active clients
router.get('/', authenticate, async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const defaultPath = path.join(__dirname, '../../data/Customer Details - Copy.xlsx');

    // 1. Check if Excel URL is configured in settings
    const settingsRes = await db.query('SELECT excel_url FROM application_settings WHERE id = 1');
    let excelUrl = settingsRes.rows[0]?.excel_url;
    if (excelUrl && excelUrl.trim()) {
      // Strip any wrapping quotes
      excelUrl = excelUrl.trim().replace(/^["']+|["']+$/g, '').trim();
      // Check if local file exists on this PC/drive; fallback if moved
      if (!excelUrl.startsWith('http://') && !excelUrl.startsWith('https://')) {
        if (!fs.existsSync(excelUrl) && fs.existsSync(defaultPath)) {
          excelUrl = defaultPath;
        }
      }
    } else {
      excelUrl = fs.existsSync(defaultPath) ? defaultPath : null;
    }
    if (excelUrl) {
      try {
        const excelClients = await excelService.getExcelClients(excelUrl);
        if (excelClients && excelClients.length > 0) {
          return res.json({ success: true, data: excelClients, source: 'excel' });
        }
      } catch (excelErr) {
        console.warn('[CLIENTS] Error reading Excel sheet database:', excelErr.message);
      }
    }

    // 2. Fetch from local database
    const result = await db.query(
      `SELECT id, name, address, code, contact_person, contact_phone, contact_email, created_at 
       FROM clients WHERE is_active = 1 ORDER BY name ASC`
    );
    return res.json({ success: true, data: result.rows || [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/clients — Add new client (ADMIN ONLY)
router.post('/', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const { id, name, address, code, contactPerson, contactPhone, contactEmail } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Client Name is required.' });
    }

    // Auto-generate client ID if not provided (e.g., C010)
    let clientId = id ? id.trim().toUpperCase() : '';
    if (!clientId) {
      const countRes = await db.query(`SELECT COUNT(*) as cnt FROM clients`);
      const cnt = parseInt(countRes.rows[0]?.cnt || 0) + 1;
      clientId = `C${String(cnt).padStart(3, '0')}`;
    }

    // Check duplicate ID
    const existing = await db.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
    if (existing.rows && existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: `Client ID '${clientId}' already exists.` });
    }

    const clientCode = code ? code.trim().toUpperCase() : clientId;
    const clientName = name.trim().toUpperCase();

    await db.query(
      `INSERT INTO clients (id, name, address, code, contact_person, contact_phone, contact_email, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [
        clientId,
        clientName,
        address ? address.trim() : '',
        clientCode,
        contactPerson ? contactPerson.trim() : '',
        contactPhone ? contactPhone.trim() : '',
        contactEmail ? contactEmail.trim() : '',
      ]
    );

    const newClient = {
      id: clientId,
      name: clientName,
      address: address ? address.trim() : '',
      code: clientCode,
      contact_person: contactPerson ? contactPerson.trim() : '',
      contact_phone: contactPhone ? contactPhone.trim() : '',
      contact_email: contactEmail ? contactEmail.trim() : '',
    };

    res.status(201).json({
      success: true,
      data: newClient,
      message: `Client '${clientName}' registered successfully.`,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/clients/:id — Update existing client (ADMIN ONLY)
router.put('/:id', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, address, code, contactPerson, contactPhone, contactEmail } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Client Name is required.' });
    }

    await db.query(
      `UPDATE clients 
       SET name = $1, address = $2, code = $3, contact_person = $4, contact_phone = $5, contact_email = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [
        name.trim().toUpperCase(),
        address ? address.trim() : '',
        code ? code.trim().toUpperCase() : id,
        contactPerson ? contactPerson.trim() : '',
        contactPhone ? contactPhone.trim() : '',
        contactEmail ? contactEmail.trim() : '',
        id,
      ]
    );

    res.json({ success: true, message: `Client '${id}' updated successfully.` });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clients/:id — Deactivate client (ADMIN ONLY)
router.delete('/:id', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE clients SET is_active = 0 WHERE id = $1`, [id]);
    res.json({ success: true, message: `Client '${id}' deactivated.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
