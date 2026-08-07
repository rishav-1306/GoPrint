const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { testConnection } = require('../services/printerService');
const { sendPrintJob } = require('../services/printerService');
const { generateTestLabelByLanguage } = require('../services/zplService');

// GET /api/printers
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM printer_settings WHERE is_active = TRUE ORDER BY is_default DESC, printer_name ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/printers/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM printer_settings WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Printer not found.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/printers — add printer (Admin/Supervisor only)
router.post('/', authenticate, requireRole('Admin', 'Supervisor'), async (req, res, next) => {
  try {
    const { printer_name, printer_model, printer_ip, printer_port, connection_type, usb_port,
            print_language, darkness, speed, label_width, label_height, is_default } = req.body;

    if (!printer_name) {
      return res.status(400).json({ success: false, message: 'Printer name is required.' });
    }

    const connType = (connection_type || 'ETHERNET').toUpperCase();

    // If setting as default, clear all others first
    if (is_default) {
      await db.query('UPDATE printer_settings SET is_default = FALSE');
    }

    const result = await db.query(
      `INSERT INTO printer_settings
        (printer_name, printer_model, printer_ip, printer_port, connection_type, usb_port,
         print_language, darkness, speed, label_width, label_height, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [printer_name, printer_model || null, printer_ip || null,
       printer_port || 9100, connType, usb_port || null,
       print_language || 'DIRECT_PROTOCOL', darkness || 25, speed || 6,
       label_width || 100, label_height || 25, is_default || false]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Printer added successfully.' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/printers/:id — update printer
router.put('/:id', authenticate, requireRole('Admin', 'Supervisor'), async (req, res, next) => {
  try {
    const { printer_name, printer_model, printer_ip, printer_port, connection_type, usb_port,
            print_language, darkness, speed, label_width, label_height, is_default } = req.body;

    if (is_default) {
      await db.query('UPDATE printer_settings SET is_default = FALSE WHERE id != $1', [req.params.id]);
    }

    const result = await db.query(
      `UPDATE printer_settings SET
        printer_name = COALESCE($1, printer_name),
        printer_model = COALESCE($2, printer_model),
        printer_ip = COALESCE($3, printer_ip),
        printer_port = COALESCE($4, printer_port),
        connection_type = COALESCE($5, connection_type),
        usb_port = COALESCE($6, usb_port),
        print_language = COALESCE($7, print_language),
        darkness = COALESCE($8, darkness),
        speed = COALESCE($9, speed),
        label_width = COALESCE($10, label_width),
        label_height = COALESCE($11, label_height),
        is_default = COALESCE($12, is_default),
        updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [printer_name, printer_model, printer_ip, printer_port,
       connection_type, usb_port, print_language, darkness, speed,
       label_width, label_height, is_default, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Printer not found.' });
    res.json({ success: true, data: result.rows[0], message: 'Printer updated.' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/printers/:id — soft delete
router.delete('/:id', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const result = await db.query(
      'UPDATE printer_settings SET is_active = FALSE WHERE id = $1 RETURNING id, printer_name',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Printer not found.' });
    res.json({ success: true, message: `Printer "${result.rows[0].printer_name}" deleted.` });
  } catch (err) {
    next(err);
  }
});

// POST /api/printers/:id/test — test connectivity
router.post('/:id/test', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT printer_ip, printer_port, printer_name, connection_type FROM printer_settings WHERE id = $1 AND is_active = TRUE',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Printer not found.' });

    const { printer_ip, printer_port, printer_name, connection_type } = result.rows[0];
    const connType = (connection_type || 'ETHERNET').toUpperCase();

    // USB printers: no IP ping needed — report as connected
    if (connType === 'USB') {
      return res.json({
        success: true,
        message: `USB printer "${printer_name}" is configured. Ensure it is plugged in and ready.`,
        latencyMs: 0,
        connectionType: 'USB',
      });
    }

    if (!printer_ip) {
      return res.status(400).json({ success: false, message: 'Printer IP not configured.' });
    }

    const { connected, latencyMs, error } = await testConnection(printer_ip, printer_port || 9100);
    res.json({
      success: connected,
      message: connected
        ? `Connected to ${printer_name} (${printer_ip}:${printer_port}) in ${latencyMs}ms`
        : `Cannot reach ${printer_name} at ${printer_ip}:${printer_port}. ${error}`,
      latencyMs,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/printers/:id/test-print — send a test label
router.post('/:id/test-print', authenticate, requireRole('Admin', 'Supervisor'), async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM printer_settings WHERE id = $1 AND is_active = TRUE',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Printer not found.' });

    const printer = result.rows[0];
    const connType = (printer.connection_type || 'ETHERNET').toUpperCase();

    if (connType !== 'USB' && !printer.printer_ip) {
      return res.status(400).json({ success: false, message: 'Printer IP not configured.' });
    }

    const printData = generateTestLabelByLanguage(printer.print_language, {
      darkness: printer.darkness,
      speed: printer.speed,
      labelWidthMm: 100,
      labelHeightMm: 25,
    });

    await sendPrintJob({
      connectionType: connType,
      ip: printer.printer_ip,
      port: printer.printer_port || 9100,
      printerName: printer.printer_name,
      usbPort: printer.usb_port || null,
      zplData: printData,
    });
    res.json({ success: true, message: `Test label sent to ${printer.printer_name}.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
