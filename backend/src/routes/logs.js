const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/logs
 * Query params: page, limit, clientName, status, printerId, operatorId, dateFrom, dateTo, search
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const {
      page = 1, limit = 50,
      clientName, status, printerId, operatorId,
      dateFrom, dateTo, search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (clientName) {
      conditions.push(`pl.client_name ILIKE $${paramIdx++}`);
      params.push(`%${clientName}%`);
    }
    if (status) {
      conditions.push(`pl.print_status = $${paramIdx++}`);
      params.push(status.toUpperCase());
    }
    if (printerId) {
      conditions.push(`pl.printer_used = $${paramIdx++}`);
      params.push(parseInt(printerId));
    }
    if (operatorId) {
      conditions.push(`pl.printed_by = $${paramIdx++}`);
      params.push(parseInt(operatorId));
    }
    if (dateFrom) {
      conditions.push(`pl.date_time >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`DATE(pl.date_time) <= $${paramIdx++}`);
      params.push(dateTo);
    }
    if (search) {
      conditions.push(`(pl.job_id LIKE $${paramIdx} OR pl.part_number LIKE $${paramIdx} OR pl.client_name LIKE $${paramIdx} OR pl.serial_number LIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) as count FROM print_logs pl ${whereClause}`;
    const dataQuery = `
      SELECT pl.*, u.name as operator_name
      FROM print_logs pl
      LEFT JOIN users u ON pl.printed_by = u.id
      ${whereClause}
      ORDER BY pl.date_time DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const [countResult, dataResult] = await Promise.all([
      db.query(countQuery, params),
      db.query(dataQuery, [...params, parseInt(limit), offset]),
    ]);

    const total = parseInt(countResult.rows[0]?.count || 0);
    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/logs/:jobId — single log entry
router.get('/:jobId', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pl.*, u.name as operator_name
       FROM print_logs pl
       LEFT JOIN users u ON pl.printed_by = u.id
       WHERE pl.job_id = $1`,
      [req.params.jobId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Log entry not found.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
