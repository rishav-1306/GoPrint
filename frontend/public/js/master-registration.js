/**
 * Master Registration Page Logic — Users, Settings
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

async function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('[data-tab-content]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.remove('bg-primary', 'text-white');
    btn.classList.add('bg-surface-container-low', 'text-on-surface-variant');
  });
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) { activeBtn.classList.add('bg-primary','text-white'); activeBtn.classList.remove('bg-surface-container-low','text-on-surface-variant'); }
  const content = document.getElementById(`tab-${tab}`);
  if (content) content.classList.remove('hidden');

  if (tab === 'users') await loadUsers();
  if (tab === 'settings') await loadSettings();
}

// ============================================================
// USERS TAB
// ============================================================
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="px-md py-lg text-center text-on-surface-variant">Loading...</td></tr>';
  try {
    const { data } = await api.getUsers();
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" class="px-md py-lg text-center text-on-surface-variant">No users found.</td></tr>'; return; }
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
// SETTINGS TAB
// ============================================================
async function loadSettings() {
  try {
    const { data } = await api.getSettings();
    if (!data) return;
    setField('sCompanyName', data.company_name || '');
    setField('sExternalApi', data.external_api_url || '');
    setField('sTimezone', data.timezone || 'Asia/Kolkata');
    setField('sDateFormat', data.date_format || 'DD-MMM-YYYY');
  } catch (err) { showToast('Failed to load settings: ' + err.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.updateSettings({
        company_name: getField('sCompanyName'),
        external_api_url: getField('sExternalApi'),
        timezone: getField('sTimezone'),
        date_format: getField('sDateFormat'),
      });
      showToast('Settings saved.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('addUserBtn')?.addEventListener('click', () => openUserModal());
  document.getElementById('userForm')?.addEventListener('submit', saveUser);
  document.getElementById('cancelUserModal')?.addEventListener('click', closeUserModal);
  document.getElementById('userModalOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeUserModal(); });
});

function setElement(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setField(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getField(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function showToast(msg, type='info') {
  const c={info:'bg-primary',error:'bg-error',success:'bg-green-600'};
  const t=document.createElement('div');
  t.className=`fixed top-4 right-4 z-[9999] px-md py-sm rounded-xl text-white font-label-lg shadow-xl ${c[type]}`;
  t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),4000);
}
