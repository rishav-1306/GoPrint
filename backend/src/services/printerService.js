const net = require('net');
const config = require('../config/env');

/**
 * Send data to a TCP/IP printer via raw socket connection
 * @param {string} ip - Printer IP address
 * @param {number} port - Printer port (typically 9100 for ZPL)
 * @param {string|Buffer} data - Raw ZPL data to send
 * @param {number} [timeoutMs] - Connection timeout in ms
 * @returns {Promise<void>}
 */
const sendRawData = (ip, port, data, timeoutMs = config.printerTimeoutMs) => {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      try { socket.destroy(); } catch (_) {}
    };

    const settle = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      settle(new Error(`Printer connection timed out after ${timeoutMs}ms. Check IP: ${ip}:${port}`));
    });

    socket.on('error', (err) => {
      settle(new Error(`Printer connection error: ${err.message}`));
    });

    socket.connect(port, ip, () => {
      socket.write(data, 'utf8', (writeErr) => {
        if (writeErr) {
          settle(new Error(`Failed to send data to printer: ${writeErr.message}`));
        } else {
          // Give printer enough time to fully receive and process the ZPL buffer
          // 200ms was too short for some Ethernet/WiFi printers causing empty labels
          setTimeout(() => settle(null), 800);
        }
      });
    });
  });
};

/**
 * Send ZPL data to a USB-connected printer on Windows.
 * Works by writing raw bytes to the Windows printer port (USB00x) or
 * by spawning a print command using the printer's share name.
 *
 * Strategy:
 *   1. If `usb_port` is configured (e.g. "USB001"), write directly to \\.\USB001
 *   2. Otherwise, use Windows `copy /b` to the printer name via net use / print spooler
 *
 * @param {string} printerName  - Windows printer name (as shown in Devices & Printers)
 * @param {string} usbPort      - Optional Windows USB port (e.g. "USB001")
 * @param {string} zplData      - Raw ZPL string
 * @returns {Promise<void>}
 */
const sendUsbPrint = (printerName, usbPort, zplData) => {
  return new Promise((resolve, reject) => {
    const { spawn, exec } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    // Write ZPL to a temp file
    // IMPORTANT: ZPL/TSPL/EPL are ASCII text protocols — must use 'utf8', NOT 'binary'
    // Using 'binary' corrupts the command stream and causes empty stickers
    const tmpFile = path.join(os.tmpdir(), `rsb_label_${Date.now()}.zpl`);
    try {
      fs.writeFileSync(tmpFile, zplData, 'utf8');
    } catch (err) {
      return reject(new Error(`Failed to write ZPL temp file: ${err.message}`));
    }

    const cleanup = () => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    };

    if (usbPort) {
      // Direct port write: copy /b file.zpl \\.\USB001
      // On Windows, the port \\.\USB001 maps to the physical USB port
      const portPath = `\\\\.\\${usbPort}`;
      const cmd = `copy /b "${tmpFile}" "${portPath}"`;
      exec(cmd, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
        cleanup();
        if (err) {
          return reject(new Error(`USB port write failed (${usbPort}): ${err.message}. stderr: ${stderr}`));
        }
        resolve();
      });
    } else if (printerName) {
      // Use Windows print spooler via UNC path: \\localhost\PrinterName
      // NOTE: \\.\PrinterName only works for physical port names (e.g. \\.\USB001),
      // NOT for Windows named printers. Use \\localhost\<name> for spooler.
      const safeName = printerName.replace(/"/g, '');
      const uncPath = `\\\\localhost\\${safeName}`;
      const cmd = `copy /b "${tmpFile}" "${uncPath}"`;
      exec(cmd, { shell: 'cmd.exe' }, (err, stdout, stderr) => {
        cleanup();
        // Fallback: try PowerShell Out-Printer (works for any Windows shared printer)
        if (err) {
          const safeFile = tmpFile.replace(/\\/g, '\\\\');
          const safePrinter = printerName.replace(/'/g, '');
          // Read raw bytes and send via .NET System.Printing or Out-Printer
          const psCmd = [
            `$bytes = [System.IO.File]::ReadAllBytes('${safeFile}');`,
            `$stream = (New-Object -comObject WScript.Shell).Exec('cmd').StdIn;`,
            `$printer = New-Object System.Drawing.Printing.PrintDocument;`,
            `$printer.PrinterSettings.PrinterName = '${safePrinter}';`,
            `Get-Content -Path '${safeFile}' -Encoding UTF8 -Raw | Out-Printer -Name '${safePrinter}'`,
          ].join(' ');
          const ps = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Get-Content -Path '${safeFile}' -Encoding UTF8 -Raw | Out-Printer -Name '${safePrinter}'`,
          ]);
          let psErr = '';
          ps.stderr.on('data', d => { psErr += d.toString(); });
          ps.on('close', (code) => {
            if (code !== 0) {
              return reject(new Error(`USB print failed for printer "${printerName}": ${psErr || 'PowerShell Out-Printer returned non-zero exit code'}`));
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    } else {
      cleanup();
      reject(new Error('USB printer: neither usbPort nor printerName configured.'));
    }
  });
};

/**
 * Test connectivity to a TCP/IP printer (TCP ping)
 * @param {string} ip
 * @param {number} port
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ connected: boolean, latencyMs: number, error?: string }>}
 */
const testConnection = async (ip, port, timeoutMs = 3000) => {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const settle = (connected, error = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve({ connected, latencyMs: Date.now() - start, error });
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => settle(false, `Connection timed out after ${timeoutMs}ms`));
    socket.on('error', (err) => settle(false, err.message));
    socket.connect(port, ip, () => settle(true));
  });
};

/**
 * Send a print job to the printer (TCP/IP or USB)
 * @param {Object} params
 * @param {string} [params.ip]           - Printer IP (for ETHERNET/WIFI)
 * @param {number} [params.port]         - Printer port (for ETHERNET/WIFI)
 * @param {string} [params.connectionType] - 'ETHERNET' | 'WIFI' | 'USB'
 * @param {string} [params.printerName]  - Windows printer name (for USB)
 * @param {string} [params.usbPort]      - Windows USB port, e.g. "USB001" (optional for USB)
 * @param {string} params.zplData        - ZPL label data
 * @returns {Promise<void>}
 */
const sendPrintJob = async ({ ip, port, connectionType = 'ETHERNET', printerName, usbPort, zplData }) => {
  if (connectionType === 'USB') {
    await sendUsbPrint(printerName, usbPort, zplData);
  } else {
    if (!ip || !port) {
      throw new Error('Printer IP and port are required for Ethernet/WiFi printers.');
    }
    await sendRawData(ip, port, zplData);
  }
};

module.exports = { sendPrintJob, testConnection, sendRawData, sendUsbPrint };
