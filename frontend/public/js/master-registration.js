/**
 * Master Registration Page Logic — Users, Part Specifications, Settings
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;
  const user = Auth.getUser();
  setElement('headerUserName', user.name);
  setElement('headerUserRole', user.role);

  // Tab navigation
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  await switchTab('users');

  document.querySelectorAll('[data-action="logout"]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); Auth.logout(); window.location.href = '/pages/login.html'; });
  });
});

let activeTab = 'users';
let editingUserId = null;
let editingPartId = null;

async function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('[data-tab-content]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.remove('bg-primary', 'text-white');
    btn.classList.add('bg-surface-container-low', 'text-on-surface-variant');
  });
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) { activeBtn.classList.add('bg-primary','text-white'); activeBtn.classList.remove('bg-surface-container-low','text-on-surface-variant'); }

  // Hide all tab contents
  ['users', 'parts', 'settings'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.add('hidden');
  });

  const content = document.getElementById(`tab-${tab}`);
  if (content) content.classList.remove('hidden');

  if (tab === 'users') await loadUsers();
  if (tab === 'parts') await loadPartsMaster();
  if (tab === 'settings') await loadSettings();
}

// ============================================================
// USERS TAB
// ============================================================
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="px-md py-lg text-center text-on-surface-variant">Loading users...</td></tr>';
  try {
    const { data } = await api.getUsers();
    if (!data || !data.length) { tbody.innerHTML = '<tr><td colspan="6" class="px-md py-lg text-center text-on-surface-variant">No users found.</td></tr>'; return; }
    tbody.innerHTML = data.map(u => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="px-md py-md font-body-md font-semibold">${u.name}</td>
        <td class="px-md py-md font-body-md text-on-surface-variant">${u.username}</td>
        <td class="px-md py-md font-body-md text-on-surface-variant">${u.email || '---'}</td>
        <td class="px-md py-md"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${u.role==='Admin'?'bg-primary/10 text-primary':u.role==='Supervisor'?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700'}">${u.role}</span></td>
        <td class="px-md py-md"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${u.is_active?'bg-green-100 text-green-700':'bg-error-container text-error'}">${u.is_active?'Active':'Inactive'}</span></td>
        <td class="px-md py-md flex gap-xs">
          <button onclick="openUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})" class="p-xs hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-primary transition-colors"><span class="material-symbols-outlined text-[18px]">edit</span></button>
          <button onclick="deleteUser(${u.id},'${u.name}')" class="p-xs hover:bg-error-container rounded-lg text-on-surface-variant hover:text-error transition-colors"><span class="material-symbols-outlined text-[18px]">person_remove</span></button>
        </td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-error px-md py-md">${err.message}</td></tr>`;
  }
}

function openUserModal(user = null) {
  editingUserId = user ? user.id : null;
  document.getElementById('userModalTitle').textContent = user ? 'Edit User' : 'Add User';
  document.getElementById('userForm').reset();
  if (user) {
    setField('fuName', user.name); setField('fuUsername', user.username);
    setField('fuEmail', user.email || ''); setField('fuRole', user.role);
    document.getElementById('fuUsername').readOnly = true;
  } else {
    document.getElementById('fuUsername').readOnly = false;
  }
  document.getElementById('userModal').classList.remove('hidden');
  document.getElementById('userModalOverlay').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('userModal').classList.add('hidden');
  document.getElementById('userModalOverlay').classList.add('hidden');
}

async function saveUser(e) {
  e.preventDefault();
  const payload = { name: getField('fuName'), email: getField('fuEmail'), role: getField('fuRole') };
  const password = getField('fuPassword');
  if (password) payload.password = password;
  if (!editingUserId) { payload.username = getField('fuUsername'); }
  try {
    if (editingUserId) await api.updateUser(editingUserId, payload);
    else await api.addUser(payload);
    showToast(editingUserId ? 'User updated.' : 'User created.', 'success');
    closeUserModal();
    await loadUsers();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteUser(id, name) {
  if (!confirm(`Deactivate user "${name}"?`)) return;
  try { await api.deleteUser(id); showToast(`User "${name}" deactivated.`, 'success'); await loadUsers(); }
  catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// PART SPECIFICATION MASTER TAB (TEXT CLIENT INPUT, ALL 9 STICKER FIELDS - ADMIN ONLY)
// ============================================================
async function loadPartsMaster() {
  const tbody = document.getElementById('partsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="px-md py-lg text-center text-on-surface-variant">Loading part specifications...</td></tr>';

  const user = Auth.getUser();
  const isAdmin = user && user.role === 'Admin';

  const adminPartActionsDiv = document.getElementById('adminPartActions');
  if (adminPartActionsDiv) {
    if (isAdmin) {
      adminPartActionsDiv.innerHTML = `
        <button id="addPartBtn" class="bg-primary text-white px-md py-sm rounded-lg flex items-center gap-xs font-label-lg active:scale-95 transition-all shadow-md">
          <span class="material-symbols-outlined">post_add</span> Add Part Specification
        </button>`;
      document.getElementById('addPartBtn')?.addEventListener('click', () => openPartModal());
    } else {
      adminPartActionsDiv.innerHTML = `
        <span class="px-3 py-1.5 bg-surface-container-high text-on-surface-variant rounded-lg text-xs font-bold uppercase flex items-center gap-1" title="Only Admin can add or modify part specifications">
          <span class="material-symbols-outlined text-[16px]">lock</span> Add Part Specification (Admin Only)
        </span>`;
    }
  }

  try {
    const { data } = await api.getAllParts();
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="px-md py-lg text-center text-on-surface-variant">No part specifications registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(p => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="px-sm py-sm font-bold text-on-surface">${p.clientName || p.clientId}</td>
        <td class="px-sm py-sm font-mono font-bold text-primary">${p.partNumber}</td>
        <td class="px-sm py-sm font-semibold max-w-xs truncate">${p.description}</td>
        <td class="px-sm py-sm font-mono">${p.jtNumber || '---'}</td>
        <td class="px-sm py-sm font-mono">${p.vendorCode || '---'}</td>
        <td class="px-sm py-sm font-mono"><span class="px-1.5 py-0.5 rounded bg-surface-container-highest font-bold text-[10px]">${p.revisionLevel || 'NA'}</span></td>
        <td class="px-sm py-sm truncate max-w-[120px]">${p.vendorName || '---'}</td>
        <td class="px-sm py-sm truncate max-w-[120px]">${p.dealer || '---'}</td>
        <td class="px-sm py-sm font-mono">${p.afmCode || '---'}</td>
        <td class="px-sm py-sm whitespace-nowrap">
          ${isAdmin ? `
            <div class="flex gap-xs">
              <button onclick="openPartModal(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Edit Part Specification" class="p-xs hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-primary transition-colors">
                <span class="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button onclick="deletePart('${p.id || p.partNumber}','${p.partNumber}')" title="Delete Part Specification" class="p-xs hover:bg-error-container rounded-lg text-on-surface-variant hover:text-error transition-colors">
                <span class="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          ` : `
            <span class="text-[10px] text-outline italic">Read-only</span>
          `}
        </td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-error px-md py-md">${err.message}</td></tr>`;
  }
}

function openPartModal(part = null) {
  const user = Auth.getUser();
  if (!user || user.role !== 'Admin') {
    showToast('Permission denied: Only Admin users can add or edit part specifications.', 'error');
    return;
  }

  editingPartId = part ? (part.id || part.partNumber) : null;
  document.getElementById('partModalTitle').textContent = part ? 'Edit Part Specification' : 'Add Part Specification';
  document.getElementById('partForm').reset();

  if (part) {
    setField('fpClientInput', part.clientName || part.clientId || '');
    setField('fpPartNumber', part.partNumber || '');
    setField('fpDescription', part.description || '');
    setField('fpJtNumber', part.jtNumber || '');
    setField('fpVendorCode', part.vendorCode || '');
    setField('fpRevisionLevel', part.revisionLevel || '');
    setField('fpVendorName', part.vendorName || '');
    setField('fpDealer', part.dealer || '');
    setField('fpAfmCode', part.afmCode || '');
  }

  document.getElementById('partModal').classList.remove('hidden');
  document.getElementById('partModalOverlay').classList.remove('hidden');
}

function closePartModal() {
  document.getElementById('partModal').classList.add('hidden');
  document.getElementById('partModalOverlay').classList.add('hidden');
}

async function savePart(e) {
  e.preventDefault();
  const user = Auth.getUser();
  if (!user || user.role !== 'Admin') {
    showToast('Permission denied: Only Admin users can add part specifications.', 'error');
    return;
  }

  const clientName = getField('fpClientInput');
  const partNumber = getField('fpPartNumber');
  const description = getField('fpDescription');

  if (!clientName) return showToast('Client Name is required.', 'error');
  if (!partNumber) return showToast('Part Number is required.', 'error');
  if (!description) return showToast('Part Description is required.', 'error');

  const payload = {
    clientName,
    clientId: clientName,
    partNumber,
    description,
    jtNumber: getField('fpJtNumber'),
    vendorCode: getField('fpVendorCode'),
    revisionLevel: getField('fpRevisionLevel'),
    vendorName: getField('fpVendorName'),
    dealer: getField('fpDealer'),
    afmCode: getField('fpAfmCode'),
  };

  try {
    if (editingPartId) {
      await api.updatePart(editingPartId, payload);
      showToast('Part specification updated in database.', 'success');
    } else {
      const res = await api.addPart(payload);
      showToast(res.message || 'Part specification registered in database.', 'success');
    }
    closePartModal();
    await loadPartsMaster();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deletePart(id, partNumber) {
  const user = Auth.getUser();
  if (!user || user.role !== 'Admin') {
    showToast('Permission denied: Only Admin users can delete part specifications.', 'error');
    return;
  }

  if (!confirm(`Are you sure you want to deactivate Part Master "${partNumber}"?`)) return;

  try {
    await api.deletePart(id);
    showToast(`Part Master "${partNumber}" deactivated in database.`, 'success');
    await loadPartsMaster();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// SETTINGS TAB
// ============================================================
async function loadSettings() {
  try {
    const { data } = await api.getSettings();
    if (!data) return;
    setField('sCompanyName', data.company_name || '');
    setField('sExcelUrl', data.excel_url || '');
    setField('sTimezone', data.timezone || 'Asia/Kolkata');
    setField('sDateFormat', data.date_format || 'DD-MMM-YYYY');
  } catch (err) { showToast('Failed to load settings: ' + err.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  // Settings listener
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.updateSettings({
        company_name: getField('sCompanyName'),
        excel_url: getField('sExcelUrl'),
        timezone: getField('sTimezone'),
        date_format: getField('sDateFormat'),
      });
      showToast('Settings saved.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  // User form listeners
  document.getElementById('addUserBtn')?.addEventListener('click', () => openUserModal());
  document.getElementById('userForm')?.addEventListener('submit', saveUser);
  document.getElementById('cancelUserModal')?.addEventListener('click', closeUserModal);
  document.getElementById('userModalOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeUserModal(); });

  // Part form listeners
  document.getElementById('partForm')?.addEventListener('submit', savePart);
  document.getElementById('cancelPartModal')?.addEventListener('click', closePartModal);
  document.getElementById('partModalOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closePartModal(); });
});

// Helper functions
function setElement(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setField(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getField(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function showToast(msg, type='info') {
  const c={info:'bg-primary',error:'bg-error',success:'bg-green-600'};
  const t=document.createElement('div');
  t.className=`fixed top-4 right-4 z-[9999] px-md py-sm rounded-xl text-white font-label-lg shadow-xl ${c[type]}`;
  t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),4000);
}
