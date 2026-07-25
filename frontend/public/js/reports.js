/**
 * Reports Page Logic
 */

let currentFilters = {};

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  const user = Auth.getUser();
  setElement('headerUserName', user.name);
  setElement('headerUserRole', user.role);

  await Promise.all([
    loadSummaryCards(),
    loadPrintLogs(),
    loadClientWise(),
    loadPrinterWise(),
    loadClientFilter(),
  ]);

  wireFilterEvents();

  document.querySelectorAll('[data-action="logout"]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); Auth.logout(); window.location.href = '/pages/login.html'; });
  });
});

async function loadSummaryCards() {
  try {
    const { data } = await api.getReportSummary('today');
    setElement('statTodayPrints', formatNum(data.total_prints || 0));
    setElement('statWeeklyPrints', '...');
    setElement('statActivePrinters', `${data.active_printers || 0} / ${data.total_printers || 0}`);
    setElement('statFailedPrints', formatNum(data.failed_prints || 0));

    // Load weekly separately
    const weekly = await api.getReportSummary('weekly');
    setElement('statWeeklyPrints', formatNum(weekly.data.total_prints || 0));
  } catch (err) {
    console.error('Failed to load summary:', err);
  }
}

async function loadPrintLogs(filters = {}) {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="px-md py-lg text-center text-on-surface-variant">Loading...</td></tr>`;

  try {
    const { data, pagination } = await api.getLogs({ limit: 50, page: 1, ...filters });

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-md py-lg text-center text-on-surface-variant">No records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(log => `
      <tr class="hover:bg-surface-container-low transition-colors group">
        <td class="px-md py-md font-body-md text-on-surface font-semibold">${log.job_id}</td>
        <td class="px-md py-md font-body-md text-on-surface">${log.client_name}</td>
        <td class="px-md py-md font-body-md text-on-surface-variant">${log.part_description || log.part_number}</td>
        <td class="px-md py-md font-body-md text-on-surface">${formatNum(log.quantity)}</td>
        <td class="px-md py-md text-center">
          <span class="px-sm py-xs ${statusClass(log.print_status)} rounded-full font-label-md text-[10px] uppercase font-bold tracking-wider inline-flex items-center gap-xs">
            <span class="w-1.5 h-1.5 ${statusDotClass(log.print_status)} rounded-full"></span> ${log.print_status}
          </span>
        </td>
        <td class="px-md py-md font-body-md text-on-surface-variant text-xs">${formatDateTime(log.date_time)}</td>
      </tr>`).join('');

    // Update pagination info
    setElement('paginationInfo', `Showing ${data.length} of ${pagination.total} records`);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-md py-lg text-center text-error">${err.message}</td></tr>`;
  }
}

async function loadClientWise() {
  try {
    const { data } = await api.getClientWiseReport();
    const container = document.getElementById('clientWiseContainer');
    if (!container) return;
    if (!data.length) { container.innerHTML = '<p class="p-md text-on-surface-variant">No data.</p>'; return; }

    container.innerHTML = data.slice(0, 6).map(c => `
      <div class="flex items-center justify-between group cursor-pointer hover:bg-surface-container-low p-xs rounded-lg transition-colors">
        <div class="flex items-center gap-sm">
          <div class="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary font-bold font-label-md">
            ${(c.client_name || 'X').substring(0,2).toUpperCase()}
          </div>
          <span class="font-body-md text-on-surface">${c.client_name}</span>
        </div>
        <div class="text-right">
          <span class="font-label-lg font-bold block">${formatNum(c.label_count)}</span>
          <span class="font-label-md text-green-600">${c.success_rate || 0}%</span>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error('Failed to load client-wise:', err);
  }
}

async function loadPrinterWise() {
  try {
    const { data } = await api.getPrinterWiseReport();
    const container = document.getElementById('printerWiseContainer');
    if (!container) return;
    if (!data.length) { container.innerHTML = '<p class="p-md text-on-surface-variant">No data.</p>'; return; }

    const max = Math.max(...data.map(p => parseInt(p.label_count || 0)), 1);
    container.innerHTML = data.map(p => {
      const pct = Math.round((p.label_count / max) * 100);
      const isOffline = !p.printer_active;
      return `
        <div class="space-y-xs">
          <div class="flex justify-between font-label-lg">
            <span class="text-on-surface">${p.printer_name}</span>
            <span class="${isOffline ? 'text-secondary font-bold' : 'text-primary'}">${isOffline ? 'OFFLINE' : `${pct}% Load`}</span>
          </div>
          <div class="h-2 w-full bg-surface-container rounded-full overflow-hidden">
            <div class="h-full ${isOffline ? 'bg-outline-variant' : 'bg-primary'}" style="width: ${pct}%;"></div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load printer-wise:', err);
  }
}

async function loadClientFilter() {
  try {
    const { data } = await api.getClientWiseReport();
    const select = document.getElementById('filterClient');
    if (!select) return;
    select.innerHTML = '<option value="">All Clients</option>';
    data.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.client_name;
      opt.textContent = c.client_name;
      select.appendChild(opt);
    });
  } catch (_) {}
}

function wireFilterEvents() {
  const searchInput = document.getElementById('searchInput');
  const filterClient = document.getElementById('filterClient');
  const filterPeriod = document.getElementById('filterPeriod');
  const filterDateFrom = document.getElementById('filterDateFrom');
  const filterDateTo = document.getElementById('filterDateTo');
  const exportCSVBtn = document.getElementById('exportCSVBtn');
  const exportPDFBtn = document.getElementById('exportPDFBtn');

  const applyFilters = () => {
    const filters = {};
    if (searchInput?.value) filters.search = searchInput.value;
    if (filterClient?.value) filters.clientName = filterClient.value;
    if (filterDateFrom?.value) filters.dateFrom = filterDateFrom.value;
    if (filterDateTo?.value) filters.dateTo = filterDateTo.value;
    currentFilters = filters;
    loadPrintLogs(filters);
  };

  // Period quick filter
  if (filterPeriod) {
    filterPeriod.addEventListener('change', () => {
      const now = new Date();
      if (filterPeriod.value === 'Today') {
        filterDateFrom && (filterDateFrom.value = now.toISOString().split('T')[0]);
        filterDateTo && (filterDateTo.value = now.toISOString().split('T')[0]);
      } else if (filterPeriod.value === 'Last 7 Days') {
        const from = new Date(now.setDate(now.getDate() - 7));
        filterDateFrom && (filterDateFrom.value = from.toISOString().split('T')[0]);
        filterDateTo && (filterDateTo.value = new Date().toISOString().split('T')[0]);
      } else if (filterPeriod.value === 'Current Month') {
        filterDateFrom && (filterDateFrom.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]);
        filterDateTo && (filterDateTo.value = new Date().toISOString().split('T')[0]);
      }
      applyFilters();
    });
  }

  let searchTimer;
  if (searchInput) searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 400); });
  if (filterClient) filterClient.addEventListener('change', applyFilters);
  if (filterDateFrom) filterDateFrom.addEventListener('change', applyFilters);
  if (filterDateTo) filterDateTo.addEventListener('change', applyFilters);

  if (exportCSVBtn) {
    exportCSVBtn.addEventListener('click', async () => {
      try { showToast('Preparing CSV export...', 'info'); await api.exportCSV(currentFilters); }
      catch (err) { showToast('Export failed: ' + err.message, 'error'); }
    });
  }

  if (exportPDFBtn) {
    exportPDFBtn.addEventListener('click', async () => {
      try { showToast('Generating PDF...', 'info'); await api.exportPDF(currentFilters); }
      catch (err) { showToast('PDF failed: ' + err.message, 'error'); }
    });
  }
}

// ============================================================
// UTILITIES
// ============================================================

function statusClass(status) {
  const map = { PRINTED: 'bg-green-100 text-green-700', FAILED: 'bg-red-100 text-red-700', PENDING: 'bg-amber-100 text-amber-700', CANCELLED: 'bg-gray-100 text-gray-700' };
  return map[status] || 'bg-gray-100 text-gray-700';
}

function statusDotClass(status) {
  const map = { PRINTED: 'bg-green-500 animate-pulse', FAILED: 'bg-red-500', PENDING: 'bg-amber-500', CANCELLED: 'bg-gray-400' };
  return map[status] || 'bg-gray-400';
}

function formatDateTime(dt) {
  if (!dt) return '---';
  return new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatNum(n) { return parseInt(n || 0).toLocaleString('en-IN'); }

function setElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showToast(message, type = 'info') {
  const colors = { info: 'bg-primary', error: 'bg-error', success: 'bg-green-600' };
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 z-[9999] px-md py-sm rounded-xl text-white font-label-lg shadow-xl ${colors[type]} transition-all`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
