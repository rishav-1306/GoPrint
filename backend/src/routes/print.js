const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { generateZPL, build32DigitCode } = require('../services/zplService');
const { sendPrintJob } = require('../services/printerService');
const { generateQRCodeDataURL } = require('../services/qrService');

/**
 * Generate a unique Job ID
 */
const generateJobId = () => {
  const now = new Date();
  const datePart = now.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `JOB-${datePart}-${rand}`;
};

/**
 * GET /api/print/next-serial
 * Returns the next auto-generated serial number for a given client + partNumber + date.
 * Serial format: 7-digit zero-padded sequential count (0000001, 0000002, ...)
 * Counts successful print logs for that client+partNumber on the given date (local date).
 *
 * Query params: clientId (or clientName), partNumber, date (YYYY-MM-DD, defaults to today IST)
 */
router.get('/next-serial', authenticate, async (req, res, next) => {
  try {
    const { clientId, clientName, partNumber, date } = req.query;

    if (!partNumber) {
      return res.status(400).json({ success: false, message: 'partNumber is required.' });
    }

    // Use provided date or today in IST (Asia/Kolkata = UTC+5:30)
    let targetDate = date;
    if (!targetDate) {
      const now = new Date();
      // IST offset: +5:30
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istNow = new Date(now.getTime() + istOffset);
      targetDate = istNow.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    // Count how many stickers have been printed today for this client+part
    // (count all print_logs for the day regardless of status to keep serial unique)
    let countResult;
    if (clientId) {
      countResult = await db.query(
        `SELECT COUNT(*) as cnt FROM print_logs
         WHERE client_id = $1
           AND part_number = $2
           AND DATE(date_time) = $3`,
        [clientId, partNumber, targetDate]
      );
    } else if (clientName) {
      countResult = await db.query(
        `SELECT COUNT(*) as cnt FROM print_logs
         WHERE client_name = $1
           AND part_number = $2
           AND DATE(date_time) = $3`,
        [clientName, partNumber, targetDate]
      );
    } else {
      return res.status(400).json({ success: false, message: 'clientId or clientName is required.' });
    }

    const count = parseInt(countResult.rows[0]?.cnt || countResult.rows[0]?.count || 0);
    const nextSerial = count + 1;
    // Zero-pad to 6 digits
    const serialNumber = String(nextSerial).padStart(6, '0');

    return res.json({
      success: true,
      serialNumber,
      nextSerial,
      date: targetDate,
      partNumber,
      note: `Serial #${nextSerial} for ${partNumber} on ${targetDate}`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/print
 * Main print endpoint — validates, generates ZPL, sends to printer, logs result
 */
router.post('/', authenticate, async (req, res, next) => {
  const jobId = generateJobId();

  const {
    clientId, clientName,
    partId, partNumber, partDescription,
    revisionLevel, vendorCode, vendorName,
    jtNumber, afmCode, dealer,
    serialNumber, mfgDate, quantity,
    hinNumber,
    printerId,
  } = req.body;

  // --- Validation ---
  const errors = [];
  if (!clientName) errors.push('Client name is required.');
  if (!partNumber) errors.push('Part number is required.');
  if (!serialNumber) errors.push('Serial number is required.');
  if (!mfgDate) errors.push('Manufacturing date is required.');
  if (!quantity || quantity < 1) errors.push('Quantity must be at least 1.');
  if (!printerId) errors.push('Printer must be selected.');

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: errors.join(' '), errors });
  }

  // Fetch printer details
  let printer;
  try {
    const printerResult = await db.query(
      'SELECT * FROM printer_settings WHERE id = $1 AND is_active = TRUE',
      [printerId]
    );
    if (printerResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Selected printer not found or is inactive.' });
    }
    printer = printerResult.rows[0];
  } catch (err) {
    return next(err);
  }

  const isUsb = (printer.connection_type || '').toUpperCase() === 'USB';

  // For network printers, IP is required. USB printers skip this check.
  if (!isUsb && !printer.printer_ip) {
    return res.status(400).json({
      success: false,
      message: `Printer "${printer.printer_name}" does not have an IP address configured. Please set the IP in Printer Settings.`,
    });
  }

  // --- Build 32-digit composite code ---
  const code32 = build32DigitCode({
    partNumber,
    revisionLevel: revisionLevel || '',
    vendorCode: vendorCode || '',
    mfgDate,
    serialNumber,
    clientName,
  });

  // --- Generate ZPL ---
  let zplData;
  try {
    zplData = generateZPL({
      partNumber,
      partDescription: partDescription || '',
      clientName,
      vendorCode: vendorCode || '',
      vendorName: vendorName || '',
      revisionLevel: revisionLevel || '',
      serialNumber,
      mfgDate,
      jtNumber: jtNumber || '',
      afmCode: afmCode || '',
      dealer: dealer || '',
      hinNumber: code32,          // 32-digit composite code used as HIN
      quantity: parseInt(quantity),
      darkness: printer.darkness || 25,
      speed: printer.speed || 6,
      labelWidthMm: 1000,         // Fixed: 1000mm
      labelHeightMm: 250,         // Fixed: 250mm
      qrData: code32,             // QR encodes the 32-digit code
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Label generation failed: ${err.message}` });
  }

  // --- Send to Printer ---
  let printStatus = 'PENDING';
  let errorMessage = null;

  try {
    await sendPrintJob({
      connectionType: printer.connection_type || 'ETHERNET',
      ip: printer.printer_ip,
      port: printer.printer_port || 9100,
      printerName: printer.printer_name,   // Used for USB
      usbPort: printer.usb_port || null,   // e.g. "USB001"
      zplData,
    });
    printStatus = 'PRINTED';
  } catch (err) {
    printStatus = 'FAILED';
    errorMessage = err.message;
    console.error(`[PRINT] Job ${jobId} failed:`, err.message);
  }

  // --- Save Log ---
  try {
    await db.query(
      `INSERT INTO print_logs
        (job_id, client_id, client_name, part_number, part_description,
         serial_number, hin_number, revision_level, vendor_code, vendor_name,
         jt_number, afm_code, dealer, mfg_date, quantity,
         printed_by, printed_by_name, printer_used, printer_name,
         print_status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        jobId, clientId || null, clientName, partNumber, partDescription || null,
        serialNumber, code32, revisionLevel || null, vendorCode || null, vendorName || null,
        jtNumber || null, afmCode || null, dealer || null, mfgDate || null, parseInt(quantity),
        req.user.id, req.user.name, printerId, printer.printer_name,
        printStatus, errorMessage,
      ]
    );
  } catch (logErr) {
    console.error('[PRINT] Failed to save print log:', logErr.message);
  }

  if (printStatus === 'PRINTED') {
    return res.json({
      success: true,
      jobId,
      message: `${quantity} label(s) sent to ${printer.printer_name} successfully.`,
      printStatus,
      code32,
      serialNumber,
    });
  } else {
    return res.status(503).json({
      success: false,
      jobId,
      message: `Print job failed: ${errorMessage}`,
      printStatus,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/print/preview-qr
 * Generate a QR code data URL for the live sticker preview
 */
router.post('/preview-qr', authenticate, async (req, res, next) => {
  try {
    const { partNumber, serialNumber, mfgDate, vendorCode, revisionLevel, clientName } = req.body;
    // Build the same 32-digit code that will be printed
    const code32 = build32DigitCode({
      partNumber: partNumber || '',
      revisionLevel: revisionLevel || '',
      vendorCode: vendorCode || '',
      mfgDate: mfgDate || '',
      serialNumber: serialNumber || '',
      clientName: clientName || '',
    });
    const dataUrl = await generateQRCodeDataURL(code32);
    res.json({ success: true, dataUrl, code32 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
