const QRCode = require('qrcode');

/**
 * Generate QR code as a Base64 PNG data URL
 * @param {string} data - Data to encode in QR
 * @returns {Promise<string>} base64 data URL (data:image/png;base64,...)
 */
const generateQRCodeDataURL = async (data) => {
  try {
    const dataURL = await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
      width: 200,
    });
    return dataURL;
  } catch (err) {
    throw new Error(`QR code generation failed: ${err.message}`);
  }
};

/**
 * Generate QR code as raw PNG Buffer
 * @param {string} data - Data to encode
 * @returns {Promise<Buffer>}
 */
const generateQRCodeBuffer = async (data) => {
  try {
    const buffer = await QRCode.toBuffer(data, {
      errorCorrectionLevel: 'M',
      type: 'png',
      margin: 1,
      width: 200,
    });
    return buffer;
  } catch (err) {
    throw new Error(`QR code buffer generation failed: ${err.message}`);
  }
};

/**
 * Generate QR code as Base64 string (without data: prefix)
 * This is used for embedding in ZPL commands
 * @param {string} data - Data to encode
 * @returns {Promise<string>} base64 string
 */
const generateQRCodeBase64 = async (data) => {
  const buffer = await generateQRCodeBuffer(data);
  return buffer.toString('base64');
};

module.exports = { generateQRCodeDataURL, generateQRCodeBuffer, generateQRCodeBase64 };
