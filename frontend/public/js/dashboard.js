/**
 * Dashboard Page Logic
 */
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  const user = Auth.getUser();

  // Populate user info in header
  const userNameEl = document.getElementById('headerUserName');
  if (userNameEl) userNameEl.textContent = user.name;
  const userRoleEl = document.getElementById('headerUserRole');
  if (userRoleEl) userRoleEl.textContent = user.role;

  // Navigation links
  setupNavigation();

  // Load dashboard data
  await loadSummary('today');
  await loadClientWise();
  await loadPrinterStatus();
  await loadRecentLogs();
  await updateClock();
  setInterval(updateClock, 1000);

  // Period toggle buttons
  document.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-period]').forEach(b => {
        b.classList.remove('bg-primary', 'text-white');
        b.classList.add('bg-white', 'border', 'border-outline-variant', 'text-on-surface-variant');
      });
      btn.classList.add('bg-primary', 'text-white');
      btn.classList.remove('bg-white', 'border', 'border-outline-variant', 'text-on-surface-variant');
      await loadSummary(btn.dataset.period);
    });
  });

  // Quick export
  const exportBtn = document.getElementById('quickExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        showToast('Preparing export...', 'info');
        await api.exportCSV({ dateFrom: new Date().toISOString().split('T')[0] });
      } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
      }
    });
  }

  // Logout
  document.querySelectorAll('[data-action="logout"]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); Auth.logout(); window.location.href = '/pages/login.html'; });
  });
});

async function loadSummary(period = 'today') {
  try {
    const { data } = await api.getReportSummary(period);
    setElement('statTotalPrints', formatNum(data.total_prints || 0));
    setElement('statSuccessful', formatNum(data.successful_prints || 0));
    setElement('statFailed', formatNum(data.failed_prints || 0));
    setElement('statLabels', formatNum(data.total_labels || 0));
    setElement('statActivePrinters', `${data.active_printers || 0} / ${data.total_printers || 0}`);

    // Update bar chart
    if (data.daily_trend && data.daily_trend.length > 0) {
      updateBarChart(data.daily_trend);
    }
  } catch (err) {
    console.error('Failed to load summary:', err);
  }
}

async function loadClientWise() {
  try {
    const { data } = await api.getClientWiseReport();
    const container = document.getElementById('clientWiseContainer');
    if (!container || !data.length) return;

    const total = data.reduce((sum, c) => sum + parseInt(c.label_count || 0), 0);
    container.innerHTML = data.slice(0, 5).map(client => {
      const pct = total > 0 ? ((client.label_count / total) * 100).toFixed(1) : 0;
      return `
        <div class="space-y-sm">
          <div class="flex justify-between items-end mb-1">
            <span class="font-label-lg text-label-lg font-bold text-on-surface">${client.client_name}</span>
            <span class="font-label-md text-label-md text-on-surface-variant">${pct}% (${formatNum(client.label_count)})</span>
          </div>
          <div class="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
            <div class="h-full bg-primary rounded-full transition-all duration-700" style="width: ${pct}%;"></div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load client-wise data:', err);
  }
}

async function loadPrinterStatus() {
  try {
    const { data } = await api.getPrinterWiseReport();
    const container = document.getElementById('printerStatusContainer');
    if (!container) return;
    if (!data.length) { container.innerHTML = '<p class="text-on-surface-variant p-md">No printer data available.</p>'; return; }

    container.innerHTML = data.slice(0, 4).map(p => `
      <div class="p-md flex items-center justify-between hover:bg-surface-container-lowest transition-colors">
        <div class="flex items-center space-x-md">
          <div class="w-10 h-10 rounded-lg ${p.printer_active ? 'bg-primary-fixed' : 'bg-surface-container-high'} flex items-center justify-center">
            <span class="material-symbols-outlined ${p.printer_active ? 'text-primary' : 'text-on-surface-variant'}">print</span>
          </div>
          <div>
            <h5 class="font-label-lg text-label-lg font-bold text-on-surface">${p.printer_name}</h5>
            <p class="font-label-md text-label-md text-on-surface-variant">Jobs: ${p.job_count} | Labels: ${formatNum(p.label_count)}</p>
          </div>
        </div>
        <div class="flex flex-col items-end">
          <span class="px-2 py-0.5 rounded-full ${p.printer_active ? 'bg-green-100 text-green-700' : 'bg-surface-container-high text-on-surface-variant'} text-[10px] font-bold uppercase tracking-wider mb-1">
            ${p.printer_active ? 'Active' : 'Inactive'}
          </span>
          <span class="text-[10px] font-bold text-on-surface-variant">Success: ${p.success_count} / ${p.job_count}</span>
        </div>
      </div>`).join('<div class="border-t border-outline-variant"></div>');
  } catch (err) {
    console.error('Failed to load printer status:', err);
  }
}

async function loadRecentLogs() {
  try {
    const { data } = await api.getLogs({ limit: 10, page: 1 });
    const container = document.getElementById('recentLogsContainer');
    if (!container) return;
    if (!data.length) { container.innerHTML = '<p class="p-md text-on-surface-variant">No recent print jobs.</p>'; return; }

    // Recent activity isn't in the dashboard HTML yet — but we skip if not present
  } catch (err) {
    console.error('Failed to load recent logs:', err);
  }
}

function updateBarChart(trend) {
  const chart = document.getElementById('dynamicBarChart');
  if (!chart) return;
  const max = Math.max(...trend.map(d => parseInt(d.count || 0)), 1);
  const last7 = trend.slice(-7);
  chart.innerHTML = last7.map(d => {
    const pct = Math.round((d.count / max) * 100);
    const dateLabel = new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' });
    return `
      <div class="flex-1 bg-primary/10 rounded-t-lg relative group" style="height: ${Math.max(pct, 5)}%;">
        <span class="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-on-surface-variant opacity-0 group-hover:opacity-100">${d.count}</span>
        <div class="absolute inset-x-0 bottom-0 bg-primary rounded-t-lg" style="height: 90%;"></div>
        <div class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-on-surface-variant uppercase whitespace-nowrap">${dateLabel}</div>
      </div>`;
  }).join('');
}

function updateClock() {
  const el = document.getElementById('currentTime');
  if (el) el.textContent = new Date().toLocaleTimeString('en-IN');
}

function setupNavigation() {
  const navLinks = {
    'nav-dashboard': '/pages/dashboard.html',
    'nav-master': '/pages/master-registration.html',
    'nav-clients': '/pages/master-registration.html',
    'nav-templates': '/pages/sticker-templates.html',
    'nav-printers': '/pages/printer-settings.html',
    'nav-printing': '/pages/printing-station.html',
    'nav-reports': '/pages/reports.html',
    'nav-settings': '/pages/master-registration.html',
  };
  Object.entries(navLinks).forEach(([id, href]) => {
    const el = document.getElementById(id);
    if (el) el.href = href;
  });
}

function setElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatNum(n) {
  return parseInt(n || 0).toLocaleString('en-IN');
}

function showToast(message, type = 'info') {
  const colors = { info: 'bg-primary', error: 'bg-error', success: 'bg-green-600' };
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 z-[9999] px-md py-sm rounded-lg text-white font-label-lg shadow-lg ${colors[type] || colors.info} transition-all`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
