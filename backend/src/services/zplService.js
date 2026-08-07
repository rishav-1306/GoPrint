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
 * Format a date for the composite code: DDMMYYYY
 * @param {string|Date} date
 * @returns {string} 8-char date string e.g. "27072026"
 */
const formatDateDDMMYYYY = (date) => {
  if (!date) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    return `${dd}${mm}${yyyy}`;
  }
  if (typeof date === 'string' && date.includes('-')) {
    const parts = date.split('T')[0].split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      return `${String(d).padStart(2, '0')}${String(m).padStart(2, '0')}${y}`;
    }
  }
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
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
 * Build the composite code
 * Composition:
 *   partNumber   → 8 chars  (truncated/padded, uppercase, no spaces)
 *   revisionLevel→ 2 chars
 *   vendorCode   → Full vendor code (uppercase, no spaces)
 *   mfgDate      → 8 chars  (DDMMYYYY)
 *   serialNumber → 6 chars  (zero-padded numeric)
 *   clientName   → 6 chars  (truncated, uppercase, no spaces)
 *
 * @param {Object} params
 * @returns {string} composite code
 */
const build32DigitCode = ({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName }) => {
  const part   = fixLen(partNumber, 8);
  const rev    = fixLen(revisionLevel, 2);
  const vendor = String(vendorCode || '').toUpperCase().replace(/\s+/g, '');
  const date   = formatDateDDMMYYYY(mfgDate);
  const serial = String(serialNumber || '0').replace(/\D/g, '').padStart(6, '0').slice(-6);
  const client = fixLen(clientName, 6);

  return `${part}${rev}${vendor}${date}${serial}${client}`;
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
  labelWidthMm = 100,
  labelHeightMm = 25,
  qrData,
}) => {
  // ---- Dimension Calculations (100mm × 25mm at 203 DPI = 800 × 200 dots) ----
  const WIDTH_MM  = 100;
  const HEIGHT_MM = 25;
  const DPI = 8; // dots per mm at 203 DPI

  const labelWidthDots  = WIDTH_MM  * DPI; // 800 dots
  const labelHeightDots = HEIGHT_MM * DPI; // 200 dots

  // ---- Build 32-digit code ----
  const code32 = build32DigitCode({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName });

  // ---- QR Code data = the 32-digit code ----
  const qrContent = qrData || code32;

  // ---- Layout constants ----
  const MARGIN        = 12;   // outer margin in dots
  const QR_MODULE     = 4;    // QR module size (module = 4 dots -> ~140 dots total size)
  const QR_X          = 640;  // QR left edge (x=640 to 780)
  const TEXT_AREA_W   = QR_X - MARGIN * 2; // 616 dots text width

  // Font sizes (at 203 DPI, 100x25mm label) - scaled to match 80% resolution proportions
  const CODE_FONT_H   = 28;   // font height for composite code
  const CODE_FONT_W   = 18;   // font width for composite code
  const DESC_FONT_H   = 24;   // font height for description line
  const DESC_FONT_W   = 16;   // font width for description line

  // Vertical positions
  const CODE_Y        = 20;   // Y for composite code line
  const DESC_Y        = 82;   // Y for description line
  const JT_Y          = 138;  // Y for JT line

  // JT label formatting
  const formattedJt   = jtNumber ? (jtNumber.toUpperCase().startsWith('JT') ? jtNumber : `JT ${jtNumber}`) : '';
  const JT_TEXT       = formattedJt ? trunc(formattedJt, 30) : '';

  const zpl = [
    // ---- Printer-level SGD commands (must precede ^XA) ----
    // ~SD = Set Darkness (absolute, 0-30). This is the correct command for print density.
    // ^MD inside the label is only an OFFSET and is easily overridden by firmware defaults.
    // Sending ~SD BEFORE ^XA ensures the printer uses the configured darkness level.
    `~SD${Math.max(0, Math.min(30, darkness))}`,

    '^XA',                                  // Start label

    // ---- Printer Setup ----
    `^CI28`,                                // UTF-8 encoding
    `^PR${speed}`,                          // Print speed
    `^PW${labelWidthDots}`,                // Print width in dots (800)
    `^LL${labelHeightDots}`,               // Label length in dots (200)
    `^LH0,0`,                              // Label home (top-left origin)

    // ---- ROW 1: COMPOSITE CODE ----
    `^FO${MARGIN},${CODE_Y}`,
    `^A0N,${CODE_FONT_H},${CODE_FONT_W}`,
    `^FB${TEXT_AREA_W},1,,`,
    `^FD${code32.trim()}^FS`,

    // ---- ROW 2: PART DESCRIPTION ----
    `^FO${MARGIN},${DESC_Y}`,
    `^A0N,${DESC_FONT_H},${DESC_FONT_W}`,
    `^FB${TEXT_AREA_W},1,,`,
    `^FD${trunc(partDescription || '', 38)}^FS`,

    // ---- ROW 3: JT NUMBER ----
    ...(JT_TEXT ? [
      `^FO${MARGIN},${JT_Y}`,
      `^A0N,${DESC_FONT_H},${DESC_FONT_W}`,
      `^FD${JT_TEXT}^FS`,
    ] : []),

    // ---- QR CODE (Native ZPL, right side, encodes 32-digit code) ----
    `^FO${QR_X},15`,
    `^BQN,2,${QR_MODULE},Q`,
    `^FDQA,${qrContent}^FS`,

    // ---- PRINT QUANTITY ----
    `^PQ${quantity},0,1,Y`,

    '^XZ', // End label
  ];

  return zpl.join('\n');
};

/**
 * Generate a test/calibration ZPL label at 100x25mm
 */
const generateTestZPL = ({ darkness = 25, speed = 6, labelWidthMm = 100, labelHeightMm = 25 } = {}) => {
  const DPI = 8; // 203 DPI (8 dots per mm)
  const labelWidthDots  = (labelWidthMm || 100) * DPI; // 800 dots
  const labelHeightDots = (labelHeightMm || 25) * DPI; // 200 dots
  const now = new Date().toLocaleString('en-IN');
  const sampleCode32 = 'A4004113G10NR2507260000007DAIMLER';

  return [
    // ~SD must precede ^XA for correct darkness
    `~SD${Math.max(0, Math.min(30, darkness))}`,
    '^XA',
    `^CI28`,
    `^PR${speed}`,
    `^PW${labelWidthDots}`,
    `^LL${labelHeightDots}`,
    `^LH0,0`,

    // Row 1: Sample 32-digit code
    `^FO12,18`,
    `^A0N,28,18`,
    `^FB616,1,,`,
    `^FD${sampleCode32}^FS`,

    // Row 2: Test status & timestamp
    `^FO12,80`,
    `^A0N,22,15`,
    `^FB616,1,,`,
    `^FDTEST PRINT OK — ${now}^FS`,

    // Row 3: Config info
    `^FO12,136`,
    `^A0N,22,15`,
    `^FD100x25mm | DARK:${darkness} | SPD:${speed}^FS`,

    // QR Code (Right side)
    `^FO640,15`,
    `^BQN,2,4,Q`,
    `^FDQA,${sampleCode32}^FS`,

    `^PQ1,0,1,Y`,
    '^XZ',
  ].join('\n');
};

/**
 * Generate TSPL/TSPL2 label commands for 100x25mm labels
 */
const generateTSPL = ({
  partNumber,
  partDescription,
  clientName,
  vendorCode,
  vendorName,
  revisionLevel,
  serialNumber,
  mfgDate,
  jtNumber,
  hinNumber,
  quantity = 1,
  darkness = 25,
  speed = 6,
  qrData,
}) => {
  const code32 = build32DigitCode({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName });
  const qrContent = qrData || code32;
  const formattedJt = jtNumber ? (jtNumber.toUpperCase().startsWith('JT') ? jtNumber : `JT ${jtNumber}`) : '';
  const jtText = formattedJt ? trunc(formattedJt, 30) : '';

  return [
    `SIZE 100 mm, 25 mm`,
    `GAP 2 mm, 0 mm`,
    `SPEED ${speed}`,
    // TSPL DENSITY is 0-15 (not 0-30). Map the 0-30 scale to 0-15.
    `DENSITY ${Math.round(Math.min(15, Math.max(0, darkness / 2)))}`,
    `DIRECTION 1`,
    `CLS`,
    `TEXT 12,20,"3",0,1,1,"${code32.trim()}"`,
    `TEXT 12,82,"3",0,1,1,"${trunc(partDescription || '', 38)}"`,
    ...(jtText ? [`TEXT 12,138,"3",0,1,1,"${jtText}"`] : []),
    `QRCODE 640,15,H,4,A,0,"${qrContent}"`,
    `PRINT ${quantity},1`,
  ].join('\n');
};

/**
 * Generate test TSPL label
 */
const generateTestTSPL = ({ darkness = 25, speed = 6 } = {}) => {
  const now = new Date().toLocaleString('en-IN');
  const sampleCode32 = 'A4004113G10NR2507260000007DAIMLER';

  return [
    `SIZE 100 mm, 25 mm`,
    `GAP 2 mm, 0 mm`,
    `SPEED ${speed}`,
    `DENSITY ${darkness}`,
    `DIRECTION 1`,
    `CLS`,
    `TEXT 12,20,"3",0,1,1,"${sampleCode32}"`,
    `TEXT 12,82,"2",0,1,1,"TEST PRINT OK — ${now}"`,
    `TEXT 12,136,"2",0,1,1,"100x25mm | DARK:${darkness} | SPD:${speed}"`,
    `QRCODE 640,15,H,4,A,0,"${sampleCode32}"`,
    `PRINT 1,1`,
  ].join('\n');
};

/**
 * Generate EPL II (Eltron / Zebra Desktop) commands for 100x25mm labels
 */
const generateEPL = ({
  partNumber,
  partDescription,
  clientName,
  vendorCode,
  vendorName,
  revisionLevel,
  serialNumber,
  mfgDate,
  jtNumber,
  quantity = 1,
  darkness = 25,
  speed = 6,
  qrData,
}) => {
  const code32 = build32DigitCode({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName });
  const qrContent = qrData || code32;
  const formattedJt = jtNumber ? (jtNumber.toUpperCase().startsWith('JT') ? jtNumber : `JT ${jtNumber}`) : '';
  const jtText = formattedJt ? trunc(formattedJt, 30) : '';

  return [
    `N`,
    `q800`,
    `Q200,24`,
    `S${Math.min(speed, 6)}`,
    `D${Math.min(darkness, 15)}`,
    `A12,18,0,3,1,1,N,"${code32.trim()}"`,
    `A12,82,0,2,1,1,N,"${trunc(partDescription || '', 38)}"`,
    ...(jtText ? [`A12,138,0,2,1,1,N,"${jtText}"`] : []),
    `b640,15,Q,m4,s5,"${qrContent}"`,
    `P${quantity}`,
  ].join('\n');
};

/**
 * Generate test EPL II label
 */
const generateTestEPL = ({ darkness = 10, speed = 4 } = {}) => {
  const now = new Date().toLocaleString('en-IN');
  const sampleCode32 = 'A4004113G10NR2507260000007DAIMLER';

  return [
    `N`,
    `q800`,
    `Q200,24`,
    `S${Math.min(speed, 6)}`,
    `D${Math.min(darkness, 15)}`,
    `A12,18,0,3,1,1,N,"${sampleCode32}"`,
    `A12,82,0,2,1,1,N,"TEST PRINT OK — ${now}"`,
    `A12,136,0,2,1,1,N,"100x25mm | DARK:${darkness} | SPD:${speed}"`,
    `b640,15,Q,m4,s5,"${sampleCode32}"`,
    `P1`,
  ].join('\n');
};

/**
 * Generate Honeywell Fingerprint / Direct Protocol commands
 */
const generateFingerprint = ({
  partNumber,
  partDescription,
  clientName,
  vendorCode,
  vendorName,
  revisionLevel,
  serialNumber,
  mfgDate,
  jtNumber,
  quantity = 1,
  darkness = 25,
  speed = 6,
  labelWidthMm = 100,
  labelHeightMm = 25,
  qrData,
}) => {
  const code32 = build32DigitCode({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName });
  const qrContent = qrData || code32;
  const formattedJt = jtNumber ? (jtNumber.toUpperCase().startsWith('JT') ? jtNumber : `JT ${jtNumber}`) : '';
  const jtText = formattedJt ? trunc(formattedJt, 30) : '';

  return [
    `CLL`,
    `MEDIA SIZE ${labelWidthMm || 100},${labelHeightMm || 25}`,
    `DARKNESS ${Math.max(0, Math.min(100, darkness * 3))}`,
    `SPEED ${speed}`,
    `PRPOS 12,18`,
    `FONT "Swiss 721 BT Bold",12`,
    `PRTXT "${code32.trim()}"`,
    `PRPOS 12,82`,
    `FONT "Swiss 721 BT",10`,
    `PRTXT "${trunc(partDescription || '', 38)}"`,
    ...(jtText ? [`PRPOS 12,138`, `FONT "Swiss 721 BT",10`, `PRTXT "${jtText}"`] : []),
    `PRPOS 640,15`,
    `BARSET "QRCODE",4,1,2,2`,
    `PRBAR "${qrContent}"`,
    `PRINT ${quantity}`,
  ].join('\n');
};

/**
 * Generate test Honeywell Fingerprint / Direct Protocol label
 */
const generateTestFingerprint = ({ darkness = 25, speed = 6, labelWidthMm = 100, labelHeightMm = 25 } = {}) => {
  const now = new Date().toLocaleString('en-IN');
  const sampleCode32 = 'A4004113G10NR2507260000007DAIMLER';

  return [
    `CLL`,
    `MEDIA SIZE ${labelWidthMm || 100},${labelHeightMm || 25}`,
    `DARKNESS ${Math.max(0, Math.min(100, darkness * 3))}`,
    `SPEED ${speed}`,
    `PRPOS 12,18`,
    `FONT "Swiss 721 BT Bold",12`,
    `PRTXT "${sampleCode32}"`,
    `PRPOS 12,82`,
    `FONT "Swiss 721 BT",10`,
    `PRTXT "TEST PRINT OK — ${now}"`,
    `PRPOS 12,136`,
    `FONT "Swiss 721 BT",10`,
    `PRTXT "100x25mm | DIRECT PROTOCOL | DARK:${darkness} | SPD:${speed}"`,
    `PRPOS 640,15`,
    `BARSET "QRCODE",4,1,2,2`,
    `PRBAR "${sampleCode32}"`,
    `PRINT 1`,
  ].join('\n');
};

/**
 * Generate Intermec IPL commands
 */
const generateIPL = ({
  partNumber,
  partDescription,
  clientName,
  vendorCode,
  revisionLevel,
  serialNumber,
  mfgDate,
  jtNumber,
  quantity = 1,
  qrData,
}) => {
  const code32 = build32DigitCode({ partNumber, revisionLevel, vendorCode, mfgDate, serialNumber, clientName });
  const qrContent = qrData || code32;
  const formattedJt = jtNumber ? (jtNumber.toUpperCase().startsWith('JT') ? jtNumber : `JT ${jtNumber}`) : '';
  const jtText = formattedJt ? trunc(formattedJt, 30) : '';

  return [
    `<STX><ESC>C<ETX>`,
    `<STX><ESC>P<ETX>`,
    `<STX>E4;Y25;C1;<ETX>`,
    `<STX>H0;W800;L200;<ETX>`,
    `<STX>B0;X12;Y18;C0;D0;H28;W18;F0;"${code32.trim()}";<ETX>`,
    `<STX>B1;X12;Y80;C0;D0;H22;W15;F0;"${trunc(partDescription || '', 38)}";<ETX>`,
    ...(jtText ? [`<STX>B2;X12;Y138;C0;D0;H22;W15;F0;"${jtText}";<ETX>`] : []),
    `<STX>B3;X640;Y15;C28;D0;H4;W4;F0;"${qrContent}";<ETX>`,
    `<STX>R;<ETX>`,
    `<STX><NUM${quantity}><ETX>`,
  ].join('\n');
};

/**
 * Generate test Intermec IPL label
 */
const generateTestIPL = () => {
  const now = new Date().toLocaleString('en-IN');
  const sampleCode32 = 'A4004113G10NR2507260000007DAIMLER';

  return [
    `<STX><ESC>C<ETX>`,
    `<STX><ESC>P<ETX>`,
    `<STX>E4;Y25;C1;<ETX>`,
    `<STX>H0;W800;L200;<ETX>`,
    `<STX>B0;X12;Y18;C0;D0;H28;W18;F0;"${sampleCode32}";<ETX>`,
    `<STX>B1;X12;Y80;C0;D0;H22;W15;F0;"TEST PRINT OK — ${now}";<ETX>`,
    `<STX>B2;X640;Y15;C28;D0;H4;W4;F0;"${sampleCode32}";<ETX>`,
    `<STX>R;<ETX>`,
    `<STX><NUM1><ETX>`,
  ].join('\n');
};

/**
 * Unified Multi-Printer Language Router
 */
const generateLabelByLanguage = (language = 'DIRECT_PROTOCOL', params = {}) => {
  const lang = (language || 'DIRECT_PROTOCOL').toUpperCase();
  switch (lang) {
    case 'TSPL':
      return generateTSPL(params);
    case 'EPL':
      return generateEPL(params);
    case 'FINGERPRINT':
    case 'DIRECT_PROTOCOL':
    case 'DIRECT PROTOCOL':
    case 'DIRECTPROTOCOL':
    case 'DP':
      return generateFingerprint(params);
    case 'IPL':
      return generateIPL(params);
    case 'ZPL':
      return generateZPL(params);
    default:
      return generateFingerprint(params);
  }
};

/**
 * Unified Test Label Router
 */
const generateTestLabelByLanguage = (language = 'DIRECT_PROTOCOL', params = {}) => {
  const lang = (language || 'DIRECT_PROTOCOL').toUpperCase();
  switch (lang) {
    case 'TSPL':
      return generateTestTSPL(params);
    case 'EPL':
      return generateTestEPL(params);
    case 'FINGERPRINT':
    case 'DIRECT_PROTOCOL':
    case 'DIRECT PROTOCOL':
    case 'DIRECTPROTOCOL':
    case 'DP':
      return generateTestFingerprint(params);
    case 'IPL':
      return generateTestIPL(params);
    case 'ZPL':
      return generateTestZPL(params);
    default:
      return generateTestFingerprint(params);
  }
};

module.exports = {
  generateZPL,
  generateTestZPL,
  generateTSPL,
  generateTestTSPL,
  generateEPL,
  generateTestEPL,
  generateFingerprint,
  generateTestFingerprint,
  generateIPL,
  generateTestIPL,
  generateLabelByLanguage,
  generateTestLabelByLanguage,
  formatDate,
  formatDateDDMMYYYY,
  build32DigitCode,
};
