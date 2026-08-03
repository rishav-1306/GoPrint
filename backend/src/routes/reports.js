const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');

// ============================================================
// GET /api/reports/summary
// ============================================================
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const { period = 'today' } = req.query;
    let dateFilter;
    if (period === 'today') {
      dateFilter = `DATE(date_time) = DATE('now')`;
    } else if (period === 'weekly') {
      dateFilter = `date_time >= DATETIME('now', '-7 days')`;
    } else if (period === 'monthly') {
      dateFilter = `date_time >= DATE('now', 'start of month')`;
    } else {
      dateFilter = `DATE(date_time) = DATE('now')`;
    }

    // SQLite-compatible summary using CASE WHEN instead of FILTER (WHERE ...)
    const [summaryResult, statusResult, dailyResult] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) as total_prints,
          SUM(CASE WHEN print_status = 'PRINTED' THEN 1 ELSE 0 END) as successful_prints,
          SUM(CASE WHEN print_status = 'FAILED' THEN 1 ELSE 0 END) as failed_prints,
          SUM(CASE WHEN print_status = 'PENDING' THEN 1 ELSE 0 END) as pending_prints,
          COALESCE(SUM(CASE WHEN print_status = 'PRINTED' THEN quantity ELSE 0 END), 0) as total_labels
        FROM print_logs
        WHERE ${dateFilter}
      `),
      db.query(`
        SELECT
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_printers,
          COUNT(*) as total_printers
        FROM printer_settings
      `),
      db.query(`
        SELECT
          DATE(date_time) as date,
          COUNT(*) as count,
          SUM(quantity) as labels
        FROM print_logs
        WHERE date_time >= DATETIME('now', '-30 days')
        GROUP BY DATE(date_time)
        ORDER BY date ASC
      `),
    ]);

    res.json({
      success: true,
      data: {
        ...summaryResult.rows[0],
        ...statusResult.rows[0],
        daily_trend: dailyResult.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/reports/client-wise
// ============================================================
router.get('/client-wise', authenticate, async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let conditions = [];
    const params = [];
    let p = 1;

    if (dateFrom) { conditions.push(`date_time >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { conditions.push(`DATE(date_time) <= $${p++}`); params.push(dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT
        client_name,
        COUNT(*) as job_count,
        SUM(quantity) as label_count,
        SUM(CASE WHEN print_status = 'PRINTED' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN print_status = 'FAILED' THEN 1 ELSE 0 END) as fail_count,
        ROUND(SUM(CASE WHEN print_status = 'PRINTED' THEN 1.0 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) as success_rate
      FROM print_logs
      ${where}
      GROUP BY client_name
      ORDER BY label_count DESC
    `, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/reports/printer-wise
// ============================================================
router.get('/printer-wise', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        pl.printer_name,
        COUNT(*) as job_count,
        SUM(pl.quantity) as label_count,
        SUM(CASE WHEN pl.print_status = 'PRINTED' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN pl.print_status = 'FAILED' THEN 1 ELSE 0 END) as fail_count,
        ps.is_active as printer_active
      FROM print_logs pl
      LEFT JOIN printer_settings ps ON pl.printer_used = ps.id
      GROUP BY pl.printer_name, ps.is_active
      ORDER BY label_count DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/reports/operator-wise
// ============================================================
router.get('/operator-wise', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        pl.printed_by_name as operator_name,
        u.role,
        COUNT(*) as job_count,
        SUM(pl.quantity) as label_count,
        SUM(CASE WHEN pl.print_status = 'PRINTED' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN pl.print_status = 'FAILED' THEN 1 ELSE 0 END) as fail_count
      FROM print_logs pl
      LEFT JOIN users u ON pl.printed_by = u.id
      GROUP BY pl.printed_by_name, u.role
      ORDER BY label_count DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/reports/export/csv
// ============================================================
router.get('/export/csv', authenticate, async (req, res, next) => {
  try {
    const { dateFrom, dateTo, clientName, status } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;

    if (dateFrom) { conditions.push(`pl.date_time >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { conditions.push(`DATE(pl.date_time) <= $${p++}`); params.push(dateTo); }
    if (clientName) { conditions.push(`pl.client_name LIKE $${p++}`); params.push(`%${clientName}%`); }
    if (status) { conditions.push(`pl.print_status = $${p++}`); params.push(status.toUpperCase()); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT
        pl.job_id as "Job ID",
        pl.client_name as "Client",
        pl.part_number as "Part Number",
        pl.part_description as "Description",
        pl.serial_number as "Serial No",
        pl.revision_level as "Revision",
        pl.vendor_code as "Vendor Code",
        pl.jt_number as "JT Number",
        pl.mfg_date as "Mfg Date",
        pl.quantity as "Quantity",
        pl.printed_by_name as "Operator",
        pl.printer_name as "Printer",
        pl.print_status as "Status",
        pl.error_message as "Error",
        pl.date_time as "Date & Time"
      FROM print_logs pl
      ${where}
      ORDER BY pl.date_time DESC
    `, params);

    const parser = new Parser();
    const csv = parser.parse(result.rows);
    const filename = `rsb_print_logs_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/reports/export/pdf
// ============================================================
router.get('/export/pdf', authenticate, async (req, res, next) => {
  try {
    const { dateFrom, dateTo, clientName, status } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;

    if (dateFrom) { conditions.push(`pl.date_time >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { conditions.push(`DATE(pl.date_time) <= $${p++}`); params.push(dateTo); }
    if (clientName) { conditions.push(`pl.client_name LIKE $${p++}`); params.push(`%${clientName}%`); }
    if (status) { conditions.push(`pl.print_status = $${p++}`); params.push(status.toUpperCase()); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [logsResult, summaryResult] = await Promise.all([
      db.query(`
        SELECT job_id, client_name, part_number, serial_number, quantity,
               printed_by_name, printer_name, print_status, date_time, error_message
        FROM print_logs pl ${where}
        ORDER BY date_time DESC LIMIT 500
      `, params),
      db.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN print_status = 'PRINTED' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN print_status = 'FAILED' THEN 1 ELSE 0 END) as failed
        FROM print_logs pl ${where}
      `, params),
    ]);

    const summary = summaryResult.rows[0];
    const logs = logsResult.rows;
    const filename = `rsb_report_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('RSB TRANSMISSIONS PVT. LTD.', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Sticker Printing Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString('en-IN')}   |   Total Records: ${summary.total}   |   Printed: ${summary.success}   |   Failed: ${summary.failed}`, { align: 'center' });
    doc.moveDown(1);

    // Table header
    const cols = { jobId: 80, client: 120, partNumber: 120, serial: 100, qty: 40, operator: 100, printer: 100, status: 60, dateTime: 110 };
    const startX = 40;
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(8);
    doc.rect(startX, y, 750, 16).fill('#142a7d');
    doc.fillColor('white');
    let x = startX + 4;
    for (const [key, width] of Object.entries(cols)) {
      const label = { jobId:'Job ID', client:'Client', partNumber:'Part No', serial:'Serial', qty:'Qty', operator:'Operator', printer:'Printer', status:'Status', dateTime:'Date & Time' }[key];
      doc.text(label, x, y + 4, { width, ellipsis: true });
      x += width;
    }
    doc.fillColor('black').font('Helvetica').fontSize(7);
    y += 16;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (y > 520) {
        doc.addPage({ layout: 'landscape' });
        y = 40;
      }
      const bg = i % 2 === 0 ? '#f5f3f3' : 'white';
      doc.rect(startX, y, 750, 14).fill(bg);
      doc.fillColor(log.print_status === 'FAILED' ? '#ba1a1a' : '#1b1c1c');

      x = startX + 4;
      const row = {
        jobId: log.job_id || '',
        client: log.client_name || '',
        partNumber: log.part_number || '',
        serial: log.serial_number || '',
        qty: String(log.quantity || ''),
        operator: log.printed_by_name || '',
        printer: log.printer_name || '',
        status: log.print_status || '',
        dateTime: log.date_time ? new Date(log.date_time).toLocaleString('en-IN') : '',
      };

      for (const [key, width] of Object.entries(cols)) {
        doc.text(row[key], x, y + 3, { width: width - 4, ellipsis: true });
        x += width;
      }
      doc.fillColor('black');
      y += 14;
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
