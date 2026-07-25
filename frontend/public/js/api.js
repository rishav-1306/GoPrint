/**
 * RSB System — Centralized API Client
 * Automatically attaches JWT auth header and handles 401 redirects
 */

const API_BASE = '/api';

const Auth = {
  getToken: () => localStorage.getItem('rsb_token'),
  setToken: (token) => localStorage.setItem('rsb_token', token),
  clearToken: () => localStorage.removeItem('rsb_token'),
  logout: () => {
    Auth.clearToken();
    try {
      if (window.api && window.api.logout) {
        window.api.logout().catch(() => {});
      }
    } catch (_) {}
    window.location.href = '/pages/login.html';
  },
  getUser: () => {
    try {
      const token = Auth.getToken();
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      // Check expiry
      if (payload.exp && Date.now() / 1000 > payload.exp) {
        Auth.clearToken();
        return null;
      }
      return payload;
    } catch { return null; }
  },
  isAuthenticated: () => Auth.getUser() !== null,
  requireAuth: () => {
    if (!Auth.isAuthenticated()) {
      window.location.href = '/pages/login.html';
      return false;
    }
    return true;
  },
};

/**
 * Core fetch wrapper
 */
const request = async (method, path, body = null, extraHeaders = {}) => {
  const token = Auth.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...extraHeaders,
  };

  const options = { method, headers };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, options);

  // Handle auth errors
  if (response.status === 401) {
    Auth.clearToken();
    window.location.href = '/pages/login.html';
    throw new Error('Session expired. Redirecting to login...');
  }

  const data = await response.json().catch(() => ({ success: false, message: 'Invalid server response.' }));

  if (!response.ok) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }

  return data;
};

/**
 * Download a file from a URL (for CSV/PDF exports)
 */
const downloadFile = async (path, filename) => {
  const token = Auth.getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Export failed.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'rsb_export';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),
  logout: () => { Auth.clearToken(); request('POST', '/auth/logout').catch(() => {}); },

  // Clients
  getClients: () => request('GET', '/clients'),

  // Parts
  getParts: (clientId) => request('GET', `/parts?clientId=${clientId}`),
  getPartDetails: (partId) => request('GET', `/parts/${partId}`),

  // Printers
  getPrinters: () => request('GET', '/printers'),
  getPrinter: (id) => request('GET', `/printers/${id}`),
  addPrinter: (data) => request('POST', '/printers', data),
  updatePrinter: (id, data) => request('PUT', `/printers/${id}`, data),
  deletePrinter: (id) => request('DELETE', `/printers/${id}`),
  testPrinterConnection: (id) => request('POST', `/printers/${id}/test`),
  testPrint: (id) => request('POST', `/printers/${id}/test-print`),

  // Print
  print: (data) => request('POST', '/print', data),
  getPreviewQR: (data) => request('POST', '/print/preview-qr', data),
  getNextSerial: (params) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined && v !== ''))).toString();
    return request('GET', `/print/next-serial${qs ? '?' + qs : ''}`);
  },

  // Logs
  getLogs: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined && v !== ''))).toString();
    return request('GET', `/logs${qs ? '?' + qs : ''}`);
  },
  getLog: (jobId) => request('GET', `/logs/${jobId}`),

  // Reports
  getReportSummary: (period = 'today') => request('GET', `/reports/summary?period=${period}`),
  getClientWiseReport: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/reports/client-wise${qs ? '?' + qs : ''}`);
  },
  getPrinterWiseReport: () => request('GET', '/reports/printer-wise'),
  getOperatorWiseReport: () => request('GET', '/reports/operator-wise'),
  exportCSV: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return downloadFile(`/reports/export/csv${qs ? '?' + qs : ''}`, `rsb_logs_${new Date().toISOString().split('T')[0]}.csv`);
  },
  exportPDF: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return downloadFile(`/reports/export/pdf${qs ? '?' + qs : ''}`, `rsb_report_${new Date().toISOString().split('T')[0]}.pdf`);
  },

  // Templates
  getTemplates: () => request('GET', '/templates'),
  addTemplate: (data) => request('POST', '/templates', data),
  updateTemplate: (id, data) => request('PUT', `/templates/${id}`, data),
  deleteTemplate: (id) => request('DELETE', `/templates/${id}`),

  // Settings
  getSettings: () => request('GET', '/settings'),
  updateSettings: (data) => request('PUT', '/settings', data),

  // Users
  getUsers: () => request('GET', '/users'),
  addUser: (data) => request('POST', '/users', data),
  updateUser: (id, data) => request('PUT', `/users/${id}`, data),
  deleteUser: (id) => request('DELETE', `/users/${id}`),
};

// Expose globally
window.api = api;
window.Auth = Auth;

// Global listener for logout buttons/links
document.addEventListener('click', (e) => {
  const logoutBtn = e.target.closest('[data-action="logout"]');
  if (logoutBtn) {
    e.preventDefault();
    Auth.logout();
  }
});

