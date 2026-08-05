/**
 * Printer Settings Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;
  const user = Auth.getUser();
  setElement('headerUserName', user.name);
  setElement('headerUserRole', user.role);

  await loadPrinters();

  document.getElementById('addPrinterBtn')?.addEventListener('click', () => openModal());
  document.getElementById('printerForm')?.addEventListener('submit', savePrinter);
  document.getElementById('cancelModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('modalOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  document.querySelectorAll('[data-action="logout"]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); Auth.logout(); window.location.href = '/pages/login.html'; });
  });
});

let editingPrinterId = null;

async function loadPrinters() {
  const container = document.getElementById('printersGrid');
  if (!container) return;
  container.innerHTML = '<div class="col-span-full text-on-surface-variant text-center py-lg">Loading printers...</div>';
  try {
    const { data } = await api.getPrinters();
    if (!data.length) {
      container.innerHTML = `<div class="col-span-full text-center py-xl">
        <span class="material-symbols-outlined text-[64px] text-on-surface-variant/30">print</span>
        <p class="text-on-surface-variant mt-sm">No printers configured yet.</p>
        <button onclick="openModal()" class="mt-md bg-primary text-white px-md py-sm rounded-lg font-label-lg">Add First Printer</button>
      </div>`;
      return;
    }
    container.innerHTML = data.map(p => printerCard(p)).join('');
  } catch (err) {
    container.innerHTML = `<div class="col-span-full text-error text-center py-lg">${err.message}</div>`;
  }
}

function togglePrinterConnFields() {
  const connType = (document.getElementById('fpConnection')?.value || 'ETHERNET').toUpperCase();
  const ipGroup = document.getElementById('fpIpGroup');
  const portGroup = document.getElementById('fpPortGroup');
  const usbGroup = document.getElementById('fpUsbPortGroup');

  if (connType === 'USB') {
    if (ipGroup) ipGroup.classList.add('hidden');
    if (portGroup) portGroup.classList.add('hidden');
    if (usbGroup) usbGroup.classList.remove('hidden');
  } else {
    if (ipGroup) ipGroup.classList.remove('hidden');
    if (portGroup) portGroup.classList.remove('hidden');
    if (usbGroup) usbGroup.classList.add('hidden');
  }
}
window.togglePrinterConnFields = togglePrinterConnFields;

function printerCard(p) {
  const isUsb = (p.connection_type || '').toUpperCase() === 'USB';
  const connDisplay = isUsb ? 'USB (Direct)' : (p.connection_type || 'ETHERNET');
  const endpointDisplay = isUsb ? (p.usb_port || 'Windows Default Spooler') : `${p.printer_ip || 'Not configured'}:${p.printer_port || 9100}`;

  return `
  <div class="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden hover:border-primary transition-all" id="printer-card-${p.id}">
    <div class="bg-surface-container-low px-md py-sm flex items-center justify-between border-b border-outline-variant">
      <div class="flex items-center gap-sm">
        <span class="w-2.5 h-2.5 rounded-full ${p.is_active ? 'bg-green-500 animate-pulse' : 'bg-outline'}"></span>
        <h4 class="font-title-lg text-primary font-bold">${p.printer_name}</h4>
        ${p.is_default ? '<span class="px-2 py-0.5 bg-primary text-white text-[10px] font-bold uppercase rounded-full ml-sm">Default</span>' : ''}
      </div>
      <div class="flex gap-xs">
        <button onclick="testConnection(${p.id})" class="p-xs hover:bg-surface-container rounded-lg transition-colors text-on-surface-variant hover:text-primary" title="Test Connection">
          <span class="material-symbols-outlined text-[18px]">sensors</span>
        </button>
        <button onclick="testPrint(${p.id})" class="p-xs hover:bg-surface-container rounded-lg transition-colors text-on-surface-variant hover:text-primary" title="Test Print">
          <span class="material-symbols-outlined text-[18px]">print</span>
        </button>
        <button onclick="openModal(${JSON.stringify(p).replace(/"/g,'&quot;')})" class="p-xs hover:bg-surface-container rounded-lg transition-colors text-on-surface-variant hover:text-primary" title="Edit">
          <span class="material-symbols-outlined text-[18px]">edit</span>
        </button>
        <button onclick="deletePrinter(${p.id}, '${p.printer_name}')" class="p-xs hover:bg-error-container rounded-lg transition-colors text-on-surface-variant hover:text-error" title="Delete">
          <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    </div>
    <div class="p-md grid grid-cols-2 gap-sm text-sm">
      <div><p class="text-on-surface-variant text-xs uppercase font-bold">Model</p><p class="font-semibold">${p.printer_model || '---'}</p></div>
      <div><p class="text-on-surface-variant text-xs uppercase font-bold">${isUsb ? 'Port / Target' : 'IP Address'}</p><p class="font-semibold font-mono">${endpointDisplay}</p></div>
      <div><p class="text-on-surface-variant text-xs uppercase font-bold">Connection</p><p class="font-semibold">${connDisplay}</p></div>
      <div><p class="text-on-surface-variant text-xs uppercase font-bold">Print Language</p><p class="font-semibold">${p.print_language || 'ZPL'}</p></div>
      <div><p class="text-on-surface-variant text-xs uppercase font-bold">Darkness</p><p class="font-semibold">${p.darkness}</p></div>
      <div><p class="text-on-surface-variant text-xs uppercase font-bold">Speed</p><p class="font-semibold">${p.speed}</p></div>
    </div>
    <div class="px-md pb-md" id="test-result-${p.id}"></div>
  </div>`;
}

async function testConnection(id) {
  const resultEl = document.getElementById(`test-result-${id}`);
  if (resultEl) resultEl.innerHTML = '<p class="text-xs text-on-surface-variant animate-pulse">Testing connection...</p>';
  try {
    const { success, message } = await api.testPrinterConnection(id);
    if (resultEl) resultEl.innerHTML = `<p class="text-xs font-bold ${success ? 'text-green-600' : 'text-error'}">${success ? '✓' : '✗'} ${message}</p>`;
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<p class="text-xs text-error font-bold">✗ ${err.message}</p>`;
  }
}

async function testPrint(id) {
  showToast('Sending test label...', 'info');
  try {
    const { message } = await api.testPrint(id);
    showToast(message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deletePrinter(id, name) {
  if (!confirm(`Delete printer "${name}"? This action cannot be undone.`)) return;
  try {
    await api.deletePrinter(id);
    showToast(`Printer "${name}" deleted.`, 'success');
    await loadPrinters();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openModal(printer = null) {
  editingPrinterId = printer ? printer.id : null;
  const modal = document.getElementById('printerModal');
  const title = document.getElementById('modalTitle');
  if (!modal) return;
  title.textContent = printer ? 'Edit Printer' : 'Add Printer';

  // Reset form
  document.getElementById('printerForm').reset();

  if (printer) {
    setField('fpName', printer.printer_name || '');
    setField('fpModel', printer.printer_model || '');
    setField('fpIp', printer.printer_ip || '');
    setField('fpPort', printer.printer_port || 9100);
    setField('fpConnection', printer.connection_type || 'ETHERNET');
    setField('fpUsbPort', printer.usb_port || '');
    setField('fpLanguage', printer.print_language || 'ZPL');
    setField('fpDarkness', printer.darkness || 25);
    setField('fpSpeed', printer.speed || 6);
    setField('fpWidth', printer.label_width || 100);
    setField('fpHeight', printer.label_height || 25);
    document.getElementById('fpDefault').checked = printer.is_default || false;
  }

  togglePrinterConnFields();

  modal.classList.remove('hidden');
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('printerModal')?.classList.add('hidden');
  document.getElementById('modalOverlay')?.classList.add('hidden');
  editingPrinterId = null;
}

async function savePrinter(e) {
  e.preventDefault();
  const payload = {
    printer_name: getField('fpName'),
    printer_model: getField('fpModel'),
    printer_ip: getField('fpIp'),
    printer_port: parseInt(getField('fpPort')) || 9100,
    connection_type: getField('fpConnection'),
    usb_port: getField('fpUsbPort'),
    print_language: getField('fpLanguage'),
    darkness: parseInt(getField('fpDarkness')) || 25,
    speed: parseInt(getField('fpSpeed')) || 6,
    label_width: parseInt(getField('fpWidth')) || 100,
    label_height: parseInt(getField('fpHeight')) || 25,
    is_default: document.getElementById('fpDefault')?.checked || false,
  };
  try {
    if (editingPrinterId) {
      await api.updatePrinter(editingPrinterId, payload);
      showToast('Printer updated.', 'success');
    } else {
      await api.addPrinter(payload);
      showToast('Printer added.', 'success');
    }
    closeModal();
    await loadPrinters();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function setElement(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setField(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getField(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function showToast(msg, type='info') {
  const c={info:'bg-primary',error:'bg-error',success:'bg-green-600'};
  const t=document.createElement('div');
  t.className=`fixed top-4 right-4 z-[9999] px-md py-sm rounded-xl text-white font-label-lg shadow-xl ${c[type]} transition-all`;
  t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),4000);
}

