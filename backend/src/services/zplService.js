/**
 * ZPL II Label Generation Service
 * Compatible with: Honeywell PM-43, Zebra ZT411, Zebra ZT230
 *
 * Sticker Dimensions: 1000mm (width) x 250mm (length/height)
 *
 * Label Layout (matches physical sticker template):
 * ┌──────────────────────────────────────────────────────────────┬─────────┐
 * │  A4004113G10NR2507260000007DAIMLER  (32-digit code, bold)   │  [QR]  │
 * ├──────────────────────────────────────────────────────────────┤  CODE  │
 * │  COUPLING FLANGE ASSY -       JT 123                        │  (3    │
 * │                                                              │  eyes) │
 * └──────────────────────────────────────────────────────────────┴─────────┘
 *
 * 32-DIGIT CODE COMPOSITION:
 *   partNumber(8) + revisionLevel(2) + vendorCode(3) + mfgDate(6,YYMMDD)
 *   + serialNumber(7,zero-padded) + clientName(6,uppercase-truncated) = 32 chars
 *
 * ZPL Reference:
 *  ^XA = start label
 *  ^XZ = end label
 *  ^FO = field origin (x, y)
 *  ^A  = font selection
 *  ^FD = field data
 *  ^FS = field separator
 *  ^FB = field block (word-wrap)
 *  ^BQN= QR code (native ZPL QR)
 *  ^PQ = print quantity
 *  ^LL = label length
 *  ^PW = print width (dots)
 *  ^LH = label home (origin offset)
 */

/**
 * Format a date for the 32-digit code: YYMMDD
 * @param {string|Date} date
 * @returns {string} 6-char date string e.g. "250726"
 */
const formatDateYYMMDD = (date) => {
  if (!date) {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};

/**
 * Format date as DD-MMM-YYYY for display
 */
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

/**
 * Truncate/pad string to exact length (uppercase, right-padded with spaces)
 */
const fixLen = (str, len) => {
  const s = String(str || '').toUpperCase().replace(/\s+/g, '');
  return s.substring(0, len).padEnd(len, ' ').substring(0, len);
};

/**
 * Truncate string to max length
 */
const trunc = (str, max) => str ? String(str).substring(0, max) : '';

/**
 * Build the 32-character composite code
 * Composition (total = 32 chars):
 *   partNumber   → 8 chars  (truncated/padded, uppercase, no spaces)
 *   revisionLevel→ 2 chars
 *   vendorCode   → 3 chars
 *   mfgDate      → 6 chars  (YYMMDD)
 *   serialNumber → 7 chars  (zero-padded numeric)
 *   clientName   → 6 chars  (truncated, uppercase, no spaces)
 *
 * @param {Object} params
 * @returns {string} 32-character code
 */
const build32DigitCode = ({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName }) => {
  const part   = fixLen(partNumber,    8);   // 8
  const rev    = fixLen(revisionLevel, 2);   // 2
  const vendor = fixLen(vendorCode,    3);   // 3
  const date   = formatDateYYMMDD(mfgDate);  // 6
  const serial = String(serialNumber || '0').replace(/\D/g, '').padStart(7, '0').slice(-7); // 7
  const client = fixLen(clientName,    6);   // 6

  const code = `${part}${rev}${vendor}${date}${serial}${client}`;
  // Ensure exactly 32 chars
  return code.substring(0, 32).padEnd(32, ' ');
};

/**
 * Generate ZPL II for the RSB OEM sticker label
 *
 * Sticker size: 1000mm × 250mm (landscape)
 * At 203 DPI (8 dots/mm):
 *   Width  = 1000 × 8 = 8000 dots
 *   Height = 250  × 8 = 2000 dots
 *
 * Layout:
 *   Row 1 (top ~40% of height): 32-digit code in large bold font
 *   Row 2 (bottom ~40% of height): Part Description  |  JT [jtNumber]
 *   QR Code: right side, spans both rows, encodes the 32-digit code
 *
 * @param {Object} params
 * @returns {string} ZPL II string
 */
const generateZPL = ({
  partNumber,
  partDescription,
  clientName,
  vendorCode,
  vendorName,
  revisionLevel,
  serialNumber,
  mfgDate,
  jtNumber,
  afmCode,
  dealer,
  hinNumber,
  quantity = 1,
  darkness = 25,
  speed = 6,
  labelWidthMm = 1000,
  labelHeightMm = 250,
  qrData,
}) => {
  // ---- Dimension Calculations ----
  // Force to specified dimensions regardless of passed values
  const WIDTH_MM  = 1000;
  const HEIGHT_MM = 250;
  const DPI = 8; // dots per mm at 203 DPI

  const labelWidthDots  = WIDTH_MM  * DPI; // 8000 dots
  const labelHeightDots = HEIGHT_MM * DPI; // 2000 dots

  // ---- Build 32-digit code ----
  const code32 = build32DigitCode({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName });

  // ---- QR Code data = the 32-digit code ----
  const qrContent = qrData || code32;

  // ---- Layout constants ----
  const MARGIN        = 40;   // outer margin in dots
  const QR_SIZE       = 1800; // QR code zone height/width (nearly full height, right side)
  const QR_MODULE     = 10;   // QR module size — makes it large and scannable
  const QR_X         = labelWidthDots - QR_SIZE - MARGIN; // QR left edge
  const TEXT_AREA_W   = QR_X - MARGIN * 2;               // text area width

  // Font sizes — large bold monospace-style for the 32-char code
  // ^A0 = built-in scalable font (closest to monospace)
  const CODE_FONT_H   = 200; // font height for 32-digit code (large)
  const CODE_FONT_W   = 190;
  const DESC_FONT_H   = 160; // font height for description line
  const DESC_FONT_W   = 150;

  // Vertical positions
  const CODE_Y        = 100;  // Y for 32-digit code line
  const DESC_Y        = 900;  // Y for description/JT line (roughly bottom half)

  // JT label separator — space between description and JT
  const JT_TEXT       = jtNumber ? `JT ${trunc(jtNumber, 20)}` : '';

  const zpl = [
    '^XA',                                  // Start label

    // ---- Printer Setup ----
    `^CI28`,                                // UTF-8 encoding
    `^MD${darkness}`,                       // Darkness
    `^PR${speed}`,                          // Print speed
    `^PW${labelWidthDots}`,                // Print width in dots
    `^LL${labelHeightDots}`,               // Label length in dots
    `^LH0,0`,                              // Label home (top-left origin)

    // ---- ROW 1: 32-DIGIT CODE (large, bold) ----
    // Prints the entire 32-char code on a single line in bold
    `^FO${MARGIN},${CODE_Y}`,
    `^A0N,${CODE_FONT_H},${CODE_FONT_W}`,
    `^FB${TEXT_AREA_W},1,,`,
    `^FD${code32.trim()}^FS`,

    // ---- HORIZONTAL DIVIDER ----
    `^FO${MARGIN},${Math.round((CODE_Y + CODE_FONT_H + 50 + DESC_Y) / 2)}`,
    `^GB${TEXT_AREA_W},4,4^FS`,

    // ---- ROW 2: PART DESCRIPTION ----
    `^FO${MARGIN},${DESC_Y}`,
    `^A0N,${DESC_FONT_H},${DESC_FONT_W}`,
    `^FB${Math.round(TEXT_AREA_W * 0.65)},1,,`,
    `^FD${trunc(partDescription || '', 35)}^FS`,

    // ---- ROW 2: JT NUMBER (right of description, separated by dashes/spaces) ----
    ...(JT_TEXT ? [
      `^FO${MARGIN + Math.round(TEXT_AREA_W * 0.66)},${DESC_Y}`,
      `^A0N,${DESC_FONT_H},${DESC_FONT_W}`,
      `^FD${JT_TEXT}^FS`,
    ] : []),

    // ---- QR CODE (Native ZPL, right side, encodes 32-digit code) ----
    // ^BQN = QR code native
    // param 2 = model (2 = Model 2, standard QR with 3 finder patterns/"eyes")
    // param 3 = magnification factor (module size)
    `^FO${QR_X},${MARGIN}`,
    `^BQN,2,${QR_MODULE}`,
    `^FDQA,${qrContent}^FS`,

    // ---- PRINT QUANTITY ----
    `^PQ${quantity},0,1,Y`,

    '^XZ', // End label
  ];

  return zpl.join('\n');
};

/**
 * Generate a test/calibration ZPL label at 1000x250mm
 */
const generateTestZPL = ({ darkness = 25, speed = 6, labelWidthMm = 1000, labelHeightMm = 250 } = {}) => {
  const DPI = 8;
  const labelWidthDots  = 1000 * DPI; // Always 1000mm
  const labelHeightDots = 250  * DPI; // Always 250mm
  const now = new Date().toLocaleString('en-IN');

  return [
    '^XA',
    `^MD${darkness}`,
    `^PR${speed}`,
    `^PW${labelWidthDots}`,
    `^LL${labelHeightDots}`,
    `^FO40,40^GB${labelWidthDots-80},${labelHeightDots-80},4^FS`,
    `^FO80,100^A0N,160,150^FDRSB TRANSMISSIONS PVT. LTD.^FS`,
    `^FO80,320^A0N,120,110^FDTEST PRINT — CONNECTION OK^FS`,
    `^FO80,500^A0N,100,90^FD${now}^FS`,
    `^FO80,660^A0N,100,90^FDDARKNESS: ${darkness} | SPEED: ${speed} | 1000x250mm^FS`,
    `^PQ1,0,1,Y`,
    '^XZ',
  ].join('\n');
};

module.exports = { generateZPL, generateTestZPL, formatDate, formatDateYYMMDD, build32DigitCode };
