const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// In-memory cache to prevent spamming web requests
let excelCache = {
  url: null,
  timestamp: 0,
  data: null,
};
const CACHE_TTL_MS = 15000; // 15 seconds cache

/**
 * Normalizes Google Sheets URLs to standard XLSX export links.
 */
function normalizeExcelUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();

  // Handle Google Sheets URL transform: convert /edit... to /export?format=xlsx
  if (url.includes('docs.google.com/spreadsheets/d/')) {
    const matches = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (matches && matches[1]) {
      const sheetId = matches[1];
      // Check if specific gid is in original URL
      const gidMatch = url.match(/gid=([0-9]+)/);
      const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
      return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx${gidParam}`;
    }
  }

  return url;
}

/**
 * Normalizes cell value to string
 */
function cleanVal(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * Dynamic column header alias matcher
 */
function getColumnValue(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = alias.toLowerCase().replace(/[\s_:-]+/g, '');
    const foundKey = keys.find(k => k.toLowerCase().replace(/[\s_:-]+/g, '') === target);
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
      return cleanVal(row[foundKey]);
    }
  }
  return '';
}

/**
 * Fetch and parse Excel or CSV buffer into structured rows
 */
async function fetchExcelRows(rawUrl) {
  const normalizedUrl = normalizeExcelUrl(rawUrl);
  if (!normalizedUrl) return [];

  // Return cached data if valid and fresh
  const now = Date.now();
  if (excelCache.url === normalizedUrl && (now - excelCache.timestamp) < CACHE_TTL_MS && excelCache.data) {
    return excelCache.data;
  }

  let buffer;

  if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
    const response = await axios.get(normalizedUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GoPrint-Dashboard/1.0',
      },
    });
    buffer = Buffer.from(response.data);
  } else {
    // Treat as local file path
    const filePath = path.resolve(normalizedUrl.replace(/^file:\/\/\/?/, ''));
    if (!fs.existsSync(filePath)) {
      throw new Error(`Excel file not found at path: ${filePath}`);
    }
    buffer = fs.readFileSync(filePath);
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rawJsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  // Map each row to normalized fields
  const parsedParts = rawJsonRows.map((row, idx) => {
    const clientName = getColumnValue(row, ['client name', 'client', 'customer name', 'customer', 'client_name', 'clientname']);
    const partNumber = getColumnValue(row, ['part number', 'part no', 'part_number', 'part_no', 'partno', 'item code', 'material', 'part']);
    const description = getColumnValue(row, ['part description', 'description', 'part_description', 'item description', 'desc']);
    const jtNumber = getColumnValue(row, ['jt number', 'jt no', 'jt_number', 'jt_no', 'jt', 'jtnumber']);
    const vendorCode = getColumnValue(row, ['vendor code', 'vendor_code', 'vendorcode', 'supplier code']);
    const revisionLevel = getColumnValue(row, ['revision level', 'rev level', 'revision_level', 'rev_level', 'revision', 'rev']);
    const vendorName = getColumnValue(row, ['vendor name', 'vendor_name', 'vendorname', 'supplier name']);
    const dealer = getColumnValue(row, ['dealer', 'dealer name', 'dealer_name']);
    const afmCode = getColumnValue(row, ['afm code', 'afm_code', 'afmcode', 'afm']);
    const clientAddress = getColumnValue(row, ['client address', 'address', 'client_address', 'customer address']);

    const clientId = clientName ? `EXCEL_C_${clientName.toUpperCase().replace(/\W+/g, '_')}` : 'EXCEL_C_DEFAULT';

    return {
      id: `EXCEL_P_${idx + 1}_${partNumber || 'PART'}`,
      clientId,
      clientName: clientName || 'GENERAL CLIENT',
      partNumber: partNumber || `PART_${idx + 1}`,
      description: description || 'PARTS SPECIFICATION',
      jtNumber: jtNumber || '',
      vendorCode: vendorCode || '',
      revisionLevel: revisionLevel || 'NA',
      vendorName: vendorName || 'RSB TRANSMISSIONS PVT LTD',
      dealer: dealer || clientName || '',
      afmCode: afmCode || '',
      clientAddress: clientAddress || '',
    };
  }).filter(p => p.partNumber || p.clientName);

  // Cache results
  excelCache = {
    url: normalizedUrl,
    timestamp: now,
    data: parsedParts,
  };

  return parsedParts;
}

/**
 * Get unique clients list from Excel
 */
async function getExcelClients(excelUrl) {
  const parts = await fetchExcelRows(excelUrl);
  const clientMap = new Map();

  parts.forEach(p => {
    if (!clientMap.has(p.clientId)) {
      clientMap.set(p.clientId, {
        id: p.clientId,
        name: p.clientName,
        address: p.clientAddress || '',
        code: p.clientId,
      });
    }
  });

  return Array.from(clientMap.values());
}

/**
 * Get parts by client ID or Name from Excel
 */
async function getExcelPartsByClient(excelUrl, clientKey) {
  const parts = await fetchExcelRows(excelUrl);
  if (!clientKey || clientKey === 'all') return parts;

  const keyUpper = String(clientKey).trim().toUpperCase();
  return parts.filter(p =>
    p.clientId.toUpperCase() === keyUpper ||
    p.clientName.toUpperCase() === keyUpper ||
    p.clientId.toUpperCase().includes(keyUpper) ||
    p.clientName.toUpperCase().includes(keyUpper)
  );
}

/**
 * Get specific part details by ID or Part Number from Excel
 */
async function getExcelPartDetails(excelUrl, partIdOrNumber) {
  const parts = await fetchExcelRows(excelUrl);
  if (!partIdOrNumber) return null;

  const target = String(partIdOrNumber).trim().toUpperCase();
  return parts.find(p =>
    p.id.toUpperCase() === target ||
    p.partNumber.toUpperCase() === target
  ) || null;
}

module.exports = {
  fetchExcelRows,
  getExcelClients,
  getExcelPartsByClient,
  getExcelPartDetails,
  normalizeExcelUrl,
};
