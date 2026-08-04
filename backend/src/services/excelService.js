const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// In-memory cache to prevent spamming reads
let excelCache = {
  url: null,
  timestamp: 0,
  clients: null,
  parts: null,
  stickerConfig: null,
};
const CACHE_TTL_MS = 15000; // 15 seconds cache

// ============================================================
// PATH & URL HELPERS
// ============================================================

/**
 * Cleans the stored excel_url / file path:
 *  - Strips wrapping double-quotes (common DB storage issue)
 *  - Trims whitespace
 *  - Normalizes Google Sheets URLs
 */
function cleanExcelPath(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();

  // Strip wrapping double-quotes (escaped or literal)
  url = url.replace(/^["']+|["']+$/g, '');
  url = url.trim();

  return url;
}

/**
 * Normalizes Google Sheets URLs to standard XLSX export links.
 */
function normalizeExcelUrl(rawUrl) {
  const url = cleanExcelPath(rawUrl);
  if (!url) return '';

  // Handle Google Sheets URL transform: convert /edit... to /export?format=xlsx
  if (url.includes('docs.google.com/spreadsheets/d/')) {
    const matches = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (matches && matches[1]) {
      const sheetId = matches[1];
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
 * Dynamic column header alias matcher — case/space/underscore insensitive
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

// ============================================================
// WORKBOOK READING
// ============================================================

/**
 * Read workbook buffer from URL or local file path
 */
async function readWorkbookBuffer(rawUrl) {
  const normalizedUrl = normalizeExcelUrl(rawUrl);
  if (!normalizedUrl) return null;

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
    let filePath = normalizedUrl.replace(/^file:\/\/\/?/, '');
    filePath = path.resolve(filePath);
    if (!fs.existsSync(filePath)) {
      // Dynamic fallback: check local backend/data folder regardless of PC or Drive letter
      const projectDefaultPath = path.join(__dirname, '../../data/Customer Details - Copy.xlsx');
      if (fs.existsSync(projectDefaultPath)) {
        console.log(`[EXCEL] Configured path not found on this system ('${filePath}'). Using project relative path: '${projectDefaultPath}'`);
        filePath = projectDefaultPath;
      } else {
        throw new Error(`Excel file not found at path: ${filePath}`);
      }
    }
    buffer = fs.readFileSync(filePath);
  }

  return XLSX.read(buffer, { type: 'buffer' });
}

/**
 * Read a specific sheet by name (case-insensitive match)
 * Returns array of row objects, or empty array if sheet not found
 */
function readSheet(workbook, sheetNameTarget) {
  if (!workbook || !workbook.SheetNames) return [];

  // Case-insensitive sheet name match
  const target = sheetNameTarget.toLowerCase().trim();
  const matchedName = workbook.SheetNames.find(
    n => n.toLowerCase().trim() === target
  );

  if (!matchedName) return [];

  const sheet = workbook.Sheets[matchedName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// ============================================================
// PARSE EACH SHEET
// ============================================================

/**
 * Parse "OEM" sheet → Client master data
 * Columns: Customer ID, Customer name, Address, City, State, PIN, Email, Barcode size, Mobile No
 *
 * Note: Some rows are continuation rows (e.g. multi-line address) with empty Customer name.
 *       We merge those into the previous client's address.
 */
function parseOEMSheet(rows) {
  const clients = [];
  let lastClient = null;

  for (const row of rows) {
    const customerName = getColumnValue(row, ['customer name', 'customername', 'client name', 'clientname', 'customer']);
    const customerId = getColumnValue(row, ['customer id', 'customerid', 'client id', 'clientid']);
    const address = getColumnValue(row, ['address']);
    const city = getColumnValue(row, ['city']);
    const state = getColumnValue(row, ['state']);
    const pin = getColumnValue(row, ['pin', 'pincode', 'zip']);
    const email = getColumnValue(row, ['email', 'e-mail']);
    const mobile = getColumnValue(row, ['mobile no', 'mobileno', 'mobile', 'phone']);
    const barcodeSize = getColumnValue(row, ['barcode size', 'barcodesize']);
    const status = getColumnValue(row, ['__EMPTY_1', 'status', 'enable']);

    if (customerName) {
      // Build full address
      const fullAddress = [address, city, state, pin].filter(Boolean).join(', ');

      const client = {
        id: customerId || `OEM_${customerName.toUpperCase().replace(/\W+/g, '_')}`,
        name: customerName.toUpperCase(),
        customerId: customerId,
        address: fullAddress,
        city: city,
        state: state,
        pin: pin,
        email: email,
        mobile: mobile,
        barcodeSize: barcodeSize,
        code: customerId || customerName.toUpperCase().replace(/\W+/g, '_'),
        isEnabled: status ? status.toLowerCase().includes('enable') : true,
      };
      clients.push(client);
      lastClient = client;
    } else if (lastClient && address) {
      // Continuation row — append address
      const extraAddress = [address, city, state, pin].filter(Boolean).join(', ');
      if (extraAddress) {
        lastClient.address = lastClient.address
          ? `${lastClient.address}, ${extraAddress}`
          : extraAddress;
      }
    }
  }

  return clients;
}

/**
 * Parse "OEM Part No" sheet → Part number master (2,256 rows)
 * Columns: SL NO, Partno, Description, Type, JT, Length, Rev No, Customer
 */
function parseOEMPartNoSheet(rows, clientsMap) {
  const parts = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];

    const partNumber = getColumnValue(row, ['partno', 'part no', 'part number', 'partnumber', 'part_no', 'part_number', 'item code']);
    const description = getColumnValue(row, ['description', 'part description', 'partdescription', 'desc']);
    const type = getColumnValue(row, ['type']);
    const jtNumber = getColumnValue(row, ['jt', 'jt number', 'jtnumber', 'jt no', 'jt_number']);
    const length = getColumnValue(row, ['length']);
    const revisionLevel = getColumnValue(row, ['rev no', 'revno', 'revision level', 'rev level', 'revision', 'rev_no', 'rev']);
    const customerRef = getColumnValue(row, ['customer', 'client', 'client name', 'customer name']);
    const slNo = getColumnValue(row, ['sl no', 'slno', 'sr no', 'srno', 'serial', 's.no']);

    // Skip rows with no part number
    if (!partNumber) continue;

    // Cross-reference customer abbreviation to full client data
    // customerRef from "OEM Part No" sheet is abbreviation like "TML", "VECV"
    // Try to find matching client from OEM sheet
    const clientData = findClientByRef(customerRef, clientsMap);

    const fullDescription = type && type !== '-'
      ? `${description} ${type}`.trim()
      : description;

    const jtDisplay = jtNumber && jtNumber !== '.'
      ? (length ? `JT ${jtNumber} L ${length}`.trim() : `JT ${jtNumber}`)
      : '';

    parts.push({
      id: `EXCEL_P_${idx + 1}_${partNumber}`,
      clientId: clientData ? clientData.id : `OEM_${(customerRef || 'GENERAL').toUpperCase().replace(/\W+/g, '_')}`,
      clientName: clientData ? clientData.name : (customerRef || 'GENERAL CLIENT').toUpperCase(),
      partNumber: String(partNumber).toUpperCase(),
      description: fullDescription.toUpperCase() || 'PARTS SPECIFICATION',
      jtNumber: jtDisplay,
      vendorCode: clientData ? (clientData.customerId || '') : '',
      revisionLevel: revisionLevel || 'NA',
      vendorName: 'RSB TRANSMISSIONS PVT LTD',
      dealer: clientData ? clientData.name : (customerRef || '').toUpperCase(),
      afmCode: '',
      clientAddress: clientData ? clientData.address : '',
      type: type || '',
      length: length || '',
      slNo: slNo,
    });
  }

  return parts;
}

/**
 * Parse "Sheet1" → Sticker/QR format configuration per customer
 * Columns: Customer (header row: "Sticker Format - QR"), Part NO, Rev, Vendor Code, Date, SlNO, Vendor Name
 *
 * First row after header is the config template.
 */
function parseStickerConfigSheet(rows) {
  const configs = {};

  for (const row of rows) {
    const customer = getColumnValue(row, ['sticker format - qr', 'stickerformatqr', 'customer']);
    if (!customer) continue;

    // Skip if it looks like the header row itself
    if (customer.toLowerCase() === 'customer') continue;

    const partNoDigits = getColumnValue(row, ['__EMPTY', 'part no', 'partno']);
    const revDigits = getColumnValue(row, ['__EMPTY_1', 'rev']);
    const vendorCode = getColumnValue(row, ['__EMPTY_2', 'vendor code', 'vendorcode']);
    const dateFormat = getColumnValue(row, ['__EMPTY_3', 'date']);
    const slNoFormat = getColumnValue(row, ['__EMPTY_4', 'slno', 'sl no']);
    const vendorName = getColumnValue(row, ['__EMPTY_5', 'vendor name', 'vendorname']);

    configs[customer.toUpperCase()] = {
      customer: customer.toUpperCase(),
      partNoDigits: partNoDigits,
      revDigits: revDigits,
      vendorCode: vendorCode,
      dateFormat: dateFormat,
      slNoFormat: slNoFormat,
      vendorName: vendorName,
    };
  }

  return configs;
}

// ============================================================
// CLIENT MATCHING
// ============================================================

/**
 * Find a client from the OEM clients map using the abbreviation from "OEM Part No" sheet.
 * Tries: exact match on name, contains match, abbreviation match.
 */
function findClientByRef(customerRef, clientsMap) {
  if (!customerRef || !clientsMap || clientsMap.length === 0) return null;

  const ref = customerRef.toUpperCase().trim();

  // 1. Exact name match
  let found = clientsMap.find(c => c.name === ref);
  if (found) return found;

  // 2. Name contains the reference or reference contains the name
  found = clientsMap.find(c => c.name.includes(ref) || ref.includes(c.name));
  if (found) return found;

  // 3. Abbreviation/partial match — check if any word in the client name starts with the ref
  //    e.g., "TML" → "TATA MOTORS LIMITED", "VECV" → "VE COMMERCIAL VEHICLES"
  found = clientsMap.find(c => {
    const words = c.name.split(/\s+/);
    // Check if abbreviation matches first letters of words
    if (words.length >= ref.length) {
      const abbrev = words.map(w => w.charAt(0)).join('');
      if (abbrev === ref) return true;
    }
    // Check if any word starts with the reference
    return words.some(w => w.startsWith(ref));
  });
  if (found) return found;

  return null;
}

// ============================================================
// MAIN DATA LOADING FUNCTIONS
// ============================================================

/**
 * Fetch and parse all 3 Excel sheets into structured data.
 * Caches results for CACHE_TTL_MS.
 */
async function fetchAllExcelData(rawUrl) {
  const normalizedUrl = normalizeExcelUrl(rawUrl);
  if (!normalizedUrl) return { clients: [], parts: [], stickerConfig: {} };

  // Return cached data if valid and fresh
  const now = Date.now();
  if (
    excelCache.url === normalizedUrl &&
    (now - excelCache.timestamp) < CACHE_TTL_MS &&
    excelCache.clients &&
    excelCache.parts
  ) {
    return {
      clients: excelCache.clients,
      parts: excelCache.parts,
      stickerConfig: excelCache.stickerConfig,
    };
  }

  console.log('[EXCEL] Reading workbook from:', normalizedUrl);
  const workbook = await readWorkbookBuffer(normalizedUrl);
  if (!workbook) return { clients: [], parts: [], stickerConfig: {} };

  console.log('[EXCEL] Available sheets:', workbook.SheetNames.join(', '));

  // 1. Parse OEM sheet → Clients
  const oemRows = readSheet(workbook, 'OEM');
  const clients = parseOEMSheet(oemRows);
  console.log(`[EXCEL] Parsed ${clients.length} clients from "OEM" sheet`);

  // 2. Parse "Sheet1" → Sticker config
  const configRows = readSheet(workbook, 'Sheet1');
  const stickerConfig = parseStickerConfigSheet(configRows);
  console.log(`[EXCEL] Parsed ${Object.keys(stickerConfig).length} sticker configs from "Sheet1"`);

  // 3. Parse "OEM Part No" → Parts (cross-referenced with clients)
  const partRows = readSheet(workbook, 'OEM Part No');
  const parts = parseOEMPartNoSheet(partRows, clients);
  console.log(`[EXCEL] Parsed ${parts.length} parts from "OEM Part No" sheet`);

  // Cache
  excelCache = {
    url: normalizedUrl,
    timestamp: now,
    clients,
    parts,
    stickerConfig,
  };

  return { clients, parts, stickerConfig };
}

/**
 * Backward-compatible: Fetch Excel rows (returns parts array)
 */
async function fetchExcelRows(rawUrl) {
  const { parts } = await fetchAllExcelData(rawUrl);
  return parts;
}

/**
 * Get unique clients list from Excel "OEM" sheet
 */
async function getExcelClients(excelUrl) {
  const { clients } = await fetchAllExcelData(excelUrl);
  
  // Return clients formatted for the dropdown
  return clients
    .filter(c => c.isEnabled !== false)
    .map(c => ({
      id: c.id,
      name: c.name,
      address: c.address || '',
      code: c.code || c.id,
      contact_person: '',
      contact_phone: c.mobile || '',
      contact_email: c.email || '',
    }));
}

/**
 * Get parts by client ID or Name from Excel
 */
async function getExcelPartsByClient(excelUrl, clientKey) {
  const { parts } = await fetchAllExcelData(excelUrl);
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
  const { parts } = await fetchAllExcelData(excelUrl);
  if (!partIdOrNumber) return null;

  const target = String(partIdOrNumber).trim().toUpperCase();
  return parts.find(p =>
    p.id.toUpperCase() === target ||
    p.partNumber.toUpperCase() === target
  ) || null;
}

/**
 * Get sticker config for a customer (from Sheet1)
 */
async function getStickerConfig(excelUrl, customerRef) {
  const { stickerConfig } = await fetchAllExcelData(excelUrl);
  if (!customerRef) return stickerConfig['ALL'] || null;

  const ref = customerRef.toUpperCase().trim();
  return stickerConfig[ref] || stickerConfig['ALL'] || null;
}

module.exports = {
  fetchExcelRows,
  fetchAllExcelData,
  getExcelClients,
  getExcelPartsByClient,
  getExcelPartDetails,
  getStickerConfig,
  normalizeExcelUrl,
  cleanExcelPath,
};
