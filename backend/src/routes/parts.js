const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const excelService = require('../services/excelService');

// Helper to get Excel URL from settings
async function getConfiguredExcelUrl() {
  try {
    const settingsRes = await db.query('SELECT excel_url FROM application_settings WHERE id = 1');
    const url = settingsRes.rows[0]?.excel_url;
    return (url && url.trim()) ? url.trim() : null;
  } catch (err) {
    return null;
  }
}

// GET /api/parts — Fetch parts (by clientId/clientName or all)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { clientId, clientName, all } = req.query;
    const targetClient = clientId || clientName;

    // 1. Check Excel Database URL
    const excelUrl = await getConfiguredExcelUrl();
    if (excelUrl) {
      try {
        const excelParts = await excelService.getExcelPartsByClient(excelUrl, targetClient || 'all');
        if (excelParts && excelParts.length > 0) {
          return res.json({ success: true, data: excelParts, source: 'excel' });
        }
      } catch (excelErr) {
        console.warn('[PARTS] Error reading Excel sheet database:', excelErr.message);
      }
    }

    // 2. Local Database
    let sql = `SELECT id, client_id, client_name, part_number, description, jt_number, vendor_code, revision_level, vendor_name, dealer, afm_code, client_address, created_at 
               FROM parts WHERE is_active = 1`;
    const params = [];

    if (targetClient) {
      sql += ` AND (client_id = $1 OR client_name ILIKE $1)`;
      params.push(targetClient);
    }
    sql += ` ORDER BY part_number ASC`;

    const result = await db.query(sql, params);

    if (result.rows && result.rows.length > 0) {
      const mapped = result.rows.map(r => ({
        id: r.id,
        clientId: r.client_id,
        clientName: r.client_name,
        partNumber: r.part_number,
        description: r.description,
        jtNumber: r.jt_number || '',
        vendorCode: r.vendor_code || '',
        revisionLevel: r.revision_level || '',
        vendorName: r.vendor_name || '',
        dealer: r.dealer || '',
        afmCode: r.afm_code || '',
        clientAddress: r.client_address || '',
      }));
      return res.json({ success: true, data: mapped });
    }

    res.json({ success: true, data: [] });
  } catch (err) {
    next(err);
  }
});

// GET /api/parts/:partId — Get single part details for auto-populating sticker fields
router.get('/:partId', authenticate, async (req, res, next) => {
  try {
    const { partId } = req.params;

    // 1. Check Excel Database URL
    const excelUrl = await getConfiguredExcelUrl();
    if (excelUrl) {
      try {
        const excelPart = await excelService.getExcelPartDetails(excelUrl, partId);
        if (excelPart) {
          return res.json({ success: true, data: excelPart, source: 'excel' });
        }
      } catch (excelErr) {
        console.warn('[PARTS] Error fetching part details from Excel sheet:', excelErr.message);
      }
    }

    // 2. Local Database
    const result = await db.query(
      `SELECT id, client_id, client_name, part_number, description, jt_number, vendor_code, revision_level, vendor_name, dealer, afm_code, client_address 
       FROM parts WHERE (id = $1 OR part_number = $1) AND is_active = 1 LIMIT 1`,
      [partId]
    );

    if (result.rows && result.rows.length > 0) {
      const r = result.rows[0];
      return res.json({
        success: true,
        data: {
          id: r.id,
          clientId: r.client_id,
          clientName: r.client_name,
          partNumber: r.part_number,
          description: r.description,
          jtNumber: r.jt_number || '',
          vendorCode: r.vendor_code || '',
          revisionLevel: r.revision_level || '',
          vendorName: r.vendor_name || '',
          dealer: r.dealer || '',
          afmCode: r.afm_code || '',
          clientAddress: r.client_address || '',
        },
      });
    }

    // Fallback if not found
    return res.status(404).json({ success: false, message: 'Part Master specification not found.' });
  } catch (err) {
    next(err);
  }
});

// Helper: Add Part Specification Master
const handleAddPart = async (req, res, next) => {
  try {
    const {
      clientName: rawClientName,
      clientId: rawClientId,
      partNumber,
      description,
      jtNumber,
      vendorCode,
      revisionLevel,
      vendorName,
      dealer,
      afmCode,
    } = req.body;

    const inputClient = rawClientName || rawClientId;
    if (!inputClient || !inputClient.trim()) {
      return res.status(400).json({ success: false, message: 'Client Name is required.' });
    }
    if (!partNumber || !partNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Part Number is required.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Part Description is required.' });
    }

    const trimmedClientName = inputClient.trim().toUpperCase();
    const trimmedPartNo = partNumber.trim().toUpperCase();

    // Check duplicate part number
    const existing = await db.query(`SELECT id FROM parts WHERE part_number = $1 AND is_active = 1`, [trimmedPartNo]);
    if (existing.rows && existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: `Part Number '${trimmedPartNo}' already exists in database.` });
    }

    // Auto-upsert Client record in database if not present
    let clientId = rawClientId ? rawClientId.trim().toUpperCase() : '';
    const clientRes = await db.query(`SELECT id, name FROM clients WHERE name = $1 OR id = $1`, [trimmedClientName]);
    if (clientRes.rows && clientRes.rows.length > 0) {
      clientId = clientRes.rows[0].id;
    } else {
      if (!clientId) {
        const countRes = await db.query(`SELECT COUNT(*) as cnt FROM clients`);
        const cnt = parseInt(countRes.rows[0]?.cnt || 0) + 1;
        clientId = `C${String(cnt).padStart(3, '0')}`;
      }
      await db.query(
        `INSERT INTO clients (id, name, code, is_active) VALUES ($1, $2, $3, 1)`,
        [clientId, trimmedClientName, clientId]
      );
    }

    // Generate Part ID (P001, P002...)
    const countRes = await db.query(`SELECT COUNT(*) as cnt FROM parts`);
    const cnt = parseInt(countRes.rows[0]?.cnt || 0) + 1;
    const partId = `P${String(cnt).padStart(3, '0')}`;

    await db.query(
      `INSERT INTO parts (
        id, client_id, client_name, part_number, description, 
        jt_number, vendor_code, revision_level, vendor_name, dealer, afm_code, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)`,
      [
        partId,
        clientId,
        trimmedClientName,
        trimmedPartNo,
        description.trim().toUpperCase(),
        jtNumber ? jtNumber.trim().toUpperCase() : '',
        vendorCode ? vendorCode.trim() : '',
        revisionLevel ? revisionLevel.trim().toUpperCase() : 'NA',
        vendorName ? vendorName.trim().toUpperCase() : 'RSB TRANSMISSIONS PVT LTD',
        dealer ? dealer.trim().toUpperCase() : trimmedClientName,
        afmCode ? afmCode.trim().toUpperCase() : '',
      ]
    );

    const newPart = {
      id: partId,
      clientId,
      clientName: trimmedClientName,
      partNumber: trimmedPartNo,
      description: description.trim().toUpperCase(),
      jtNumber: jtNumber ? jtNumber.trim().toUpperCase() : '',
      vendorCode: vendorCode ? vendorCode.trim() : '',
      revisionLevel: revisionLevel ? revisionLevel.trim().toUpperCase() : 'NA',
      vendorName: vendorName ? vendorName.trim().toUpperCase() : 'RSB TRANSMISSIONS PVT LTD',
      dealer: dealer ? dealer.trim().toUpperCase() : trimmedClientName,
      afmCode: afmCode ? afmCode.trim().toUpperCase() : '',
    };

    res.status(201).json({
      success: true,
      data: newPart,
      message: `Part Specification '${trimmedPartNo}' registered successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

// Helper: Update Part Specification Master
const handleUpdatePart = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      clientName: rawClientName,
      clientId: rawClientId,
      partNumber,
      description,
      jtNumber,
      vendorCode,
      revisionLevel,
      vendorName,
      dealer,
      afmCode,
    } = req.body;

    const inputClient = rawClientName || rawClientId;
    if (!partNumber || !partNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Part Number is required.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Part Description is required.' });
    }

    const trimmedClientName = inputClient ? inputClient.trim().toUpperCase() : '';
    let clientId = rawClientId ? rawClientId.trim().toUpperCase() : '';

    if (trimmedClientName) {
      const clientRes = await db.query(`SELECT id FROM clients WHERE name = $1 OR id = $1`, [trimmedClientName]);
      if (clientRes.rows && clientRes.rows.length > 0) {
        clientId = clientRes.rows[0].id;
      } else {
        if (!clientId) {
          const countRes = await db.query(`SELECT COUNT(*) as cnt FROM clients`);
          const cnt = parseInt(countRes.rows[0]?.cnt || 0) + 1;
          clientId = `C${String(cnt).padStart(3, '0')}`;
        }
        await db.query(
          `INSERT INTO clients (id, name, code, is_active) VALUES ($1, $2, $3, 1)`,
          [clientId, trimmedClientName, clientId]
        );
      }
    }

    await db.query(
      `UPDATE parts 
       SET client_id = COALESCE(NULLIF($1, ''), client_id),
           client_name = COALESCE(NULLIF($2, ''), client_name),
           part_number = $3,
           description = $4,
           jt_number = $5,
           vendor_code = $6,
           revision_level = $7,
           vendor_name = $8,
           dealer = $9,
           afm_code = $10,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 OR part_number = $11`,
      [
        clientId,
        trimmedClientName,
        partNumber.trim().toUpperCase(),
        description.trim().toUpperCase(),
        jtNumber ? jtNumber.trim().toUpperCase() : '',
        vendorCode ? vendorCode.trim() : '',
        revisionLevel ? revisionLevel.trim().toUpperCase() : 'NA',
        vendorName ? vendorName.trim().toUpperCase() : 'RSB TRANSMISSIONS PVT LTD',
        dealer ? dealer.trim().toUpperCase() : '',
        afmCode ? afmCode.trim().toUpperCase() : '',
        id,
      ]
    );

    res.json({ success: true, message: `Part Master '${partNumber}' updated successfully.` });
  } catch (err) {
    next(err);
  }
};

// Helper: Delete Part Specification Master
const handleDeletePart = async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE parts SET is_active = 0 WHERE id = $1 OR part_number = $1`, [id]);
    res.json({ success: true, message: `Part Master '${id}' deactivated.` });
  } catch (err) {
    next(err);
  }
};

// Register routes (support both root path and explicit action aliases)
router.post('/', authenticate, requireRole('Admin'), handleAddPart);
router.post('/add', authenticate, requireRole('Admin'), handleAddPart);

router.put('/:id', authenticate, requireRole('Admin'), handleUpdatePart);
router.post('/:id/update', authenticate, requireRole('Admin'), handleUpdatePart);

router.delete('/:id', authenticate, requireRole('Admin'), handleDeletePart);
router.post('/:id/delete', authenticate, requireRole('Admin'), handleDeletePart);

module.exports = router;
