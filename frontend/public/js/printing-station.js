/**
 * Printing Station Page Logic
 * Full workflow: Client → Part → Auto-populate → Preview → Print
 * Serial number: auto-generated per client+part+date (sequential)
 * MFG Date: defaults to today (IST)
 */

let selectedClient = null;
let selectedPart = null;
let selectedPrinter = null;
let previewDebounceTimer = null;

// Get today's date in IST as YYYY-MM-DD
function getTodayIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return istNow.toISOString().slice(0, 10);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  const user = Auth.getUser();
  setElement('headerUserName', user.name);
  setElement('headerUserRole', user.role);

  // Auto-set MFG Date to today
  const mfgDateEl = document.getElementById('mfgDate');
  if (mfgDateEl) mfgDateEl.value = getTodayIST();

  // Load initial data
  await Promise.all([loadClients(), loadPrinters(), loadSessionStats()]);

  // Wire up form events
  wireFormEvents();

  // Update clock
  updateClock();
  setInterval(updateClock, 1000);

  // Logout
  document.querySelectorAll('[data-action="logout"]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); Auth.logout(); window.location.href = '/pages/login.html'; });
  });
});

// ============================================================
// DATA LOADING
// ============================================================

async function loadClients() {
  try {
    const { data } = await api.getClients();
    const select = document.getElementById('clientSelect');
    if (!select) return;

    // Clear and populate
    select.innerHTML = '<option value="">-- Select Client --</option>';
    data.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      opt.dataset.name = c.name;
      opt.dataset.address = c.address || '';
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('Failed to load clients: ' + err.message, 'error');
  }
}

async function loadPrinters() {
  try {
    const { data } = await api.getPrinters();
    const select = document.getElementById('printerSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Printer --</option>';
    data.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const connLabel = (p.connection_type || 'ETHERNET').toUpperCase();
      const connDisplay = connLabel === 'USB' ? 'USB' : (p.printer_ip || 'No IP');
      opt.textContent = `${p.printer_name} (${connDisplay})`;
      opt.dataset.darkness = p.darkness;
      opt.dataset.speed = p.speed;
      opt.dataset.ip = p.printer_ip || '';
      opt.dataset.connectionType = p.connection_type || 'ETHERNET';
      opt.dataset.usbPort = p.usb_port || '';
      opt.selected = p.is_default;
      select.appendChild(opt);
    });

    // Auto-select default
    const defaultOpt = select.querySelector('option[selected]');
    if (defaultOpt) {
      selectedPrinter = { id: defaultOpt.value, ...defaultOpt.dataset };
      setElement('printerDarkness', defaultOpt.dataset.darkness || '25');
      setElement('printerSpeed', defaultOpt.dataset.speed || '6');
      const connType = (defaultOpt.dataset.connectionType || 'ETH').toUpperCase();
      setElement('printerIP', connType === 'USB' ? 'USB' : (defaultOpt.dataset.ip || 'Not configured'));
    }
  } catch (err) {
    showToast('Failed to load printers: ' + err.message, 'error');
  }
}

async function loadSessionStats() {
  try {
    const { data } = await api.getReportSummary('today');
    setElement('sessionLabels', formatNum(data.total_labels || 0));
    setElement('sessionErrors', formatNum(data.failed_prints || 0));
    setElement('statPrintsToday', formatNum(data.total_prints || 0));
  } catch (err) {
    console.error('Failed to load session stats:', err);
  }
}

// ============================================================
// FORM EVENTS
// ============================================================

function wireFormEvents() {
  // Client selection
  const clientSelect = document.getElementById('clientSelect');
  if (clientSelect) {
    clientSelect.addEventListener('change', async () => {
      const opt = clientSelect.options[clientSelect.selectedIndex];
      if (!opt.value) { selectedClient = null; clearPartFields(); return; }
      selectedClient = { id: opt.value, name: opt.dataset.name, address: opt.dataset.address };
      await loadParts(opt.value);
      clearPartAutoFields();
      resetSerialDisplay();
      triggerPreviewUpdate();
    });
  }

  // Part selection
  const partSelect = document.getElementById('partSelect');
  if (partSelect) {
    partSelect.addEventListener('change', async () => {
      const partId = partSelect.value;
      if (!partId) { selectedPart = null; clearPartAutoFields(); resetSerialDisplay(); return; }
      await loadPartDetails(partId);
      // Auto-fetch serial number for this client + part + today
      await fetchNextSerial();
      triggerPreviewUpdate();
    });
  }

  // Printer selection
  const printerSelect = document.getElementById('printerSelect');
  if (printerSelect) {
    printerSelect.addEventListener('change', () => {
      const opt = printerSelect.options[printerSelect.selectedIndex];
      if (!opt.value) { selectedPrinter = null; return; }
      selectedPrinter = { id: opt.value, darkness: opt.dataset.darkness, speed: opt.dataset.speed, ip: opt.dataset.ip, connectionType: opt.dataset.connectionType };
      setElement('printerDarkness', opt.dataset.darkness || '25');
      setElement('printerSpeed', opt.dataset.speed || '6');
      const connType = (opt.dataset.connectionType || 'ETH').toUpperCase();
      setElement('printerIP', connType === 'USB' ? 'USB' : (opt.dataset.ip || 'Not configured'));
    });
  }

  // MFG Date change — re-fetch serial (serial is per date)
  const mfgDateEl = document.getElementById('mfgDate');
  if (mfgDateEl) {
    mfgDateEl.addEventListener('change', async () => {
      if (selectedPart && selectedClient) await fetchNextSerial();
      triggerPreviewUpdate();
    });
  }

  // Today button
  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) {
    todayBtn.addEventListener('click', async () => {
      const mfg = document.getElementById('mfgDate');
      if (mfg) {
        mfg.value = getTodayIST();
        if (selectedPart && selectedClient) await fetchNextSerial();
        triggerPreviewUpdate();
      }
    });
  }

  // Refresh serial button
  const refreshSerialBtn = document.getElementById('refreshSerialBtn');
  if (refreshSerialBtn) {
    refreshSerialBtn.addEventListener('click', async () => {
      if (!selectedPart || !selectedClient) {
        showToast('Select a client and part first.', 'info');
        return;
      }
      await fetchNextSerial();
      triggerPreviewUpdate();
    });
  }

  // Quantity — trigger preview on change
  const quantityEl = document.getElementById('quantity');
  if (quantityEl) quantityEl.addEventListener('input', triggerPreviewUpdate);

  // Print button
  const printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', handlePrint);

  // Clear button
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearAllFields);

  // Preview button
  const previewBtn = document.getElementById('previewBtn');
  if (previewBtn) previewBtn.addEventListener('click', triggerPreviewUpdate);
}

async function loadParts(clientId) {
  try {
    const { data } = await api.getParts(clientId);
    const select = document.getElementById('partSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Part Number --</option>';
    data.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.partNumber} — ${p.description}`;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('Failed to load parts: ' + err.message, 'error');
  }
}

async function loadPartDetails(partId) {
  try {
    const { data } = await api.getPartDetails(partId);
    selectedPart = data;

    // Populate read-only auto fields
    setField('revisionLevel', data.revisionLevel || '');
    setField('vendorCode', data.vendorCode || '');
    setField('vendorName', data.vendorName || '');
    setField('partDescription', data.description || '');
    setField('jtNumber', data.jtNumber || '');
    setField('dealer', data.dealer || '');
    setField('afmCode', data.afmCode || '');
    setField('clientAddress', data.clientAddress || '');

    // Update preview label fields
    setElement('previewPartNumber', data.partNumber || '');
    setElement('previewDescription', data.description || '');
    setElement('previewJtNumber', data.jtNumber || '');
    setElement('previewVendorCode', data.vendorCode || '');
  } catch (err) {
    showToast('Failed to load part details: ' + err.message, 'error');
  }
}

// ============================================================
// AUTO SERIAL NUMBER
// ============================================================

/**
 * Fetch the next sequential serial number for the current client + part + date
 * and populate the serial number display + hidden input.
 */
async function fetchNextSerial() {
  if (!selectedClient || !selectedPart) return;

  const mfgDate = getFieldValue('mfgDate') || getTodayIST();
  const icon = document.getElementById('refreshSerialIcon');
  if (icon) icon.textContent = 'sync';
  if (icon) icon.classList.add('animate-spin');

  try {
    const resp = await api.getNextSerial({
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      partNumber: selectedPart.partNumber,
      date: mfgDate,
    });

    const serial = resp.serialNumber; // e.g. "0000007"
    // Update display
    const display = document.getElementById('serialNumberDisplay');
    if (display) display.textContent = serial;
    // Update hidden input
    setField('serialNumber', serial);
    // Update preview
    triggerPreviewUpdate();
  } catch (err) {
    showToast('Could not fetch serial number: ' + err.message, 'error');
  } finally {
    if (icon) icon.classList.remove('animate-spin');
    if (icon) icon.textContent = 'refresh';
  }
}

/**
 * Reset serial number display to placeholder state
 */
function resetSerialDisplay() {
  const display = document.getElementById('serialNumberDisplay');
  if (display) display.textContent = '------';
  setField('serialNumber', '');
}

// ============================================================
// LIVE STICKER PREVIEW
// ============================================================

function triggerPreviewUpdate() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(updateStickerPreview, 400);
}

async function updateStickerPreview() {
  const partNumber    = selectedPart?.partNumber    || '';
  const serialNumber  = getFieldValue('serialNumber') || '';
  const mfgDate       = getFieldValue('mfgDate')       || '';
  const vendorCode    = selectedPart?.vendorCode    || '';
  const description   = selectedPart?.description   || '---';
  const jtNumber      = selectedPart?.jtNumber      || '';
  const clientName    = selectedClient?.name        || '';
  const revisionLevel = selectedPart?.revisionLevel || '';

  // ---- Build composite code (same logic as backend build32DigitCode) ----
  const build32Code = () => {
    const fixLen = (s, n) => {
      const v = String(s || '').toUpperCase().replace(/\s+/g, '');
      return v.substring(0, n).padEnd(n, ' ').substring(0, n);
    };
    const formatDateDDMMYYYY = (dt) => {
      if (!dt) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = String(now.getFullYear());
        return `${dd}${mm}${yyyy}`;
      }
      if (typeof dt === 'string' && dt.includes('-')) {
        const parts = dt.split('T')[0].split('-');
        if (parts.length === 3) {
          const [y, m, d] = parts;
          return `${String(d).padStart(2, '0')}${String(m).padStart(2, '0')}${y}`;
        }
      }
      const d = new Date(dt);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = String(d.getFullYear());
      return `${dd}${mm}${yyyy}`;
    };
    const part   = fixLen(partNumber, 8);
    const rev    = fixLen(revisionLevel, 2);
    const vendor = String(vendorCode || '').toUpperCase().replace(/\s+/g, '');
    const date   = formatDateDDMMYYYY(mfgDate);
    const serial = String(serialNumber || '0').replace(/\D/g, '').padStart(6, '0').slice(-6);
    const client = fixLen(clientName, 6);
    return `${part}${rev}${vendor}${date}${serial}${client}`;
  };

  const code32 = build32Code();

  // Update the code display
  setElement('preview32Code', code32);

  // Update description and JT label
  setElement('previewDescription', description);
  const jtLabel = jtNumber ? `JT ${jtNumber}` : '';
  setElement('previewJtLabel', jtLabel);

  // Generate QR code preview (encodes the 32-digit code)
  if (partNumber) {
    try {
      const resp = await api.getPreviewQR({
        partNumber, serialNumber, mfgDate, vendorCode, revisionLevel, clientName
      });
      const qrImg = document.getElementById('previewQrImage');
      if (qrImg) {
        qrImg.src = resp.dataUrl;
        qrImg.style.display = 'block';
      }
      const qrPlaceholder = document.getElementById('previewQrPlaceholder');
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
      // Update the code32 display with the server-confirmed value
      if (resp.code32) setElement('preview32Code', resp.code32);
    } catch (err) {
      console.error('QR preview failed:', err);
    }
  }
}

// ============================================================
// PRINT
// ============================================================

async function handlePrint() {
  const printBtn = document.getElementById('printBtn');
  const serialNumber = getFieldValue('serialNumber');
  const mfgDate = getFieldValue('mfgDate');
  const quantity = getFieldValue('quantity') || '1';

  // Validation
  if (!selectedClient) return showToast('Please select a client.', 'error');
  if (!selectedPart) return showToast('Please select a part number.', 'error');
  if (!serialNumber) return showToast('Please enter a serial number.', 'error');
  if (!mfgDate) return showToast('Please select a manufacturing date.', 'error');
  if (!selectedPrinter || !getFieldValue('printerSelect')) return showToast('Please select a printer.', 'error');

  // Button state
  printBtn.disabled = true;
  printBtn.innerHTML = `<span class="material-symbols-outlined animate-spin">sync</span> <span class="font-headline-md">Sending to Printer...</span>`;
  printBtn.classList.add('opacity-80');

  try {
    const result = await api.print({
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      partId: selectedPart.id,
      partNumber: selectedPart.partNumber,
      partDescription: selectedPart.description,
      revisionLevel: selectedPart.revisionLevel,
      vendorCode: selectedPart.vendorCode,
      vendorName: selectedPart.vendorName,
      jtNumber: selectedPart.jtNumber,
      afmCode: selectedPart.afmCode,
      dealer: selectedPart.dealer,
      hinNumber: `${selectedPart.partNumber}${serialNumber}`,
      serialNumber,
      mfgDate,
      quantity: parseInt(quantity),
      printerId: parseInt(getFieldValue('printerSelect')),
    });

    // Success state
    printBtn.innerHTML = `<span class="material-symbols-outlined">check_circle</span> <span class="font-headline-md">Print Success!</span>`;
    printBtn.classList.add('bg-green-600');
    printBtn.classList.remove('bg-primary-container');
    showToast(result.message, 'success');

    // Update session stats
    await loadSessionStats();

    setTimeout(() => {
      printBtn.innerHTML = `<span class="material-symbols-outlined">print</span> <span class="font-headline-md">Print Sticker</span>`;
      printBtn.disabled = false;
      printBtn.classList.remove('opacity-80', 'bg-green-600');
      printBtn.classList.add('bg-primary-container');
    }, 3000);
  } catch (err) {
    printBtn.innerHTML = `<span class="material-symbols-outlined">error</span> <span class="font-headline-md">Print Failed</span>`;
    printBtn.classList.add('bg-error');
    printBtn.classList.remove('bg-primary-container');
    showToast('Print failed: ' + err.message, 'error');

    setTimeout(() => {
      printBtn.innerHTML = `<span class="material-symbols-outlined">print</span> <span class="font-headline-md">Print Sticker</span>`;
      printBtn.disabled = false;
      printBtn.classList.remove('opacity-80', 'bg-error');
      printBtn.classList.add('bg-primary-container');
    }, 3000);
  }
}

// ============================================================
// UTILITIES
// ============================================================

function clearAllFields() {
  selectedClient = null;
  selectedPart = null;
  const clientSelect = document.getElementById('clientSelect');
  if (clientSelect) clientSelect.value = '';
  clearPartFields();
  clearManualFields();
  resetSerialDisplay();
  // Reset new preview elements
  setElement('preview32Code', '--------------------------------');
  setElement('previewDescription', '---');
  setElement('previewJtLabel', '');
  // Hide QR image, show placeholder
  const qrImg = document.getElementById('previewQrImage');
  if (qrImg) { qrImg.src = ''; qrImg.style.display = 'none'; }
  const qrPlaceholder = document.getElementById('previewQrPlaceholder');
  if (qrPlaceholder) qrPlaceholder.style.display = '';
}

function clearPartFields() {
  const partSelect = document.getElementById('partSelect');
  if (partSelect) partSelect.innerHTML = '<option value="">-- Select Part Number --</option>';
  clearPartAutoFields();
}

function clearPartAutoFields() {
  ['revisionLevel', 'vendorCode', 'vendorName', 'partDescription', 'jtNumber', 'dealer', 'afmCode', 'clientAddress'].forEach(id => setField(id, ''));
  selectedPart = null;
}

function clearManualFields() {
  setField('quantity', '1');
  resetSerialDisplay();
  // Reset MFG date to today (not blank)
  const mfgDate = document.getElementById('mfgDate');
  if (mfgDate) mfgDate.value = getTodayIST();
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatNum(n) {
  return parseInt(n || 0).toLocaleString('en-IN');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function updateClock() {
  const el = document.getElementById('currentTime');
  if (el) el.textContent = new Date().toLocaleTimeString('en-IN');
}

function showToast(message, type = 'info') {
  const colors = { info: 'bg-primary', error: 'bg-error', success: 'bg-green-600' };
  const existing = document.getElementById('rsb-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'rsb-toast';
  toast.className = `fixed top-4 right-4 z-[9999] px-md py-sm rounded-xl text-white font-label-lg shadow-xl ${colors[type] || colors.info} transition-all duration-300`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}
