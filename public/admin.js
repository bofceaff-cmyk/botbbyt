const STORAGE_KEY = 'byx_admin_secret';

let secret = localStorage.getItem(STORAGE_KEY) || '';
let currentThreadId = null;
let currentKycUserId = null;
let editingUserId = null;

const NETWORK_BY_ASSET = {
  USDT: ['TRC20', 'ERC20'],
  BTC: ['BTC'],
};

function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

async function adminFetch(path, options = {}) {
  let res;
  try {
    const isForm = options.body instanceof FormData;
    res = await fetch('/api/admin' + path, {
      ...options,
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        'X-Admin-Secret': secret,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('Нет связи с сервером Railway');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка сервера (${res.status})`);
  return data;
}

function fileUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `/api/admin${path}${sep}secret=${encodeURIComponent(secret)}`;
}

function showApp(ok) {
  $('login-view').classList.toggle('screen-hidden', ok);
  $('app-view').classList.toggle('screen-hidden', !ok);
}

async function tryLogin(value) {
  secret = value.trim();
  $('login-error').textContent = '';
  try {
    await adminFetch('/users?q=');
    localStorage.setItem(STORAGE_KEY, secret);
    showApp(true);
    loadUsers();
    loadAccountRequests();
    loadKycQueue();
    loadThreads();
  } catch (e) {
    secret = '';
    localStorage.removeItem(STORAGE_KEY);
    showApp(false);
    $('login-error').textContent = e.message || 'Неверный секрет';
  }
}

$('login-btn').addEventListener('click', () => tryLogin($('secret-input').value));
$('secret-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryLogin($('secret-input').value);
});
$('logout-btn').addEventListener('click', () => {
  secret = '';
  localStorage.removeItem(STORAGE_KEY);
  showApp(false);
});

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.add('screen-hidden'));
    $(`view-${btn.dataset.view}`).classList.remove('screen-hidden');
    if (btn.dataset.view === 'support') startAdminSupportPoll();
    else stopAdminSupportPoll();
  });
});

function statusChip(status) {
  const map = { pending: 'ожидает', assigned: 'назначен', none: 'нет' };
  return `<span class="chip ${escapeHtml(status)}">${map[status] || status}</span>`;
}

function kycChip(status) {
  const map = {
    none: 'нет', pending: 'проверка', approved: 'ok', rejected: 'отклонён',
  };
  return `<span class="chip ${status === 'approved' ? 'assigned' : status === 'pending' ? 'pending' : 'none'}">${map[status] || status}</span>`;
}

async function loadUsers() {
  const q = $('users-search').value.trim();
  const users = await adminFetch('/users?q=' + encodeURIComponent(q));
  const tbody = $('users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Никого не найдено</td></tr>';
    return;
  }
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td class="mono">${u.id}<div class="muted">UID ${escapeHtml(u.uid || '—')}</div></td>
      <td>
        <div>${escapeHtml(u.displayName || '—')} ${u.registered ? '' : '<span class="muted">(не рег.)</span>'}</div>
        <div class="muted">${escapeHtml(u.fullName || '')}</div>
        <div class="muted">${escapeHtml(u.email || '')}</div>
      </td>
      <td>@${escapeHtml(u.usernameTg || '—')}<div class="muted">${escapeHtml(u.phone || '')}</div></td>
      <td class="mono">${escapeHtml(u.accountNumber || '—')}</td>
      <td>${kycChip(u.kycStatus)}</td>
      <td class="mono">${Number(u.usdtBalance).toFixed(2)}</td>
      <td><button class="btn-link" data-edit="${u.id}">Открыть</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEdit(Number(btn.dataset.edit)));
  });
}

let searchTimer = null;
$('users-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers().catch(console.error), 250);
});

async function loadAccountRequests() {
  const users = await adminFetch('/users?pendingAccounts=1');
  const tbody = $('accounts-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Нет активных заявок</td></tr>';
    return;
  }
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td class="mono">${u.id}</td>
      <td>${escapeHtml(u.displayName || '—')}</td>
      <td>@${escapeHtml(u.usernameTg || '—')}</td>
      <td>${statusChip(u.accountRequestStatus)}</td>
      <td>
        <div class="inline-assign">
          <input class="mono" data-acc-input="${u.id}" placeholder="номер счёта">
          <button class="btn-primary" data-acc-save="${u.id}">Сохранить</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-acc-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.accSave;
      const input = tbody.querySelector(`[data-acc-input="${id}"]`);
      const accountNumber = input.value.trim();
      if (!accountNumber) return alert('Укажите номер счёта');
      try {
        await adminFetch(`/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ accountNumber }),
        });
        await loadAccountRequests();
        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

$('refresh-accounts').addEventListener('click', () => loadAccountRequests().catch(console.error));

function syncNetworkOptions() {
  const asset = $('addr-asset').value;
  const nets = NETWORK_BY_ASSET[asset] || [];
  $('addr-network').innerHTML = nets.map((n) => `<option value="${n}">${n}</option>`).join('');
}
$('addr-asset').addEventListener('change', syncNetworkOptions);

async function openEdit(id) {
  editingUserId = id;
  const user = await adminFetch(`/users/${id}`);
  $('edit-title-id').textContent = `#${user.id}`;
  $('edit-id').value = user.id;
  $('edit-account').value = user.accountNumber || '';
  $('edit-balance').value = Number(user.usdtBalance);
  $('edit-verified').checked = user.kycStatus === 'approved' || user.verified;
  $('edit-error').textContent = '';
  $('addr-value').value = '';
  syncNetworkOptions();
  renderAddrList(user.depositAddresses || []);
  $('edit-modal').classList.remove('screen-hidden');
}

function renderAddrList(list) {
  const box = $('addr-list');
  if (!list.length) {
    box.innerHTML = '<div class="muted">Адресов пока нет</div>';
    return;
  }
  box.innerHTML = list.map((a) => `
    <div class="addr-item">
      <div class="meta">${escapeHtml(a.asset)} · ${escapeHtml(a.network)}</div>
      <div class="mono">${escapeHtml(a.address)}</div>
      <button class="btn-link" data-del-addr="${a.id}">Удалить</button>
    </div>
  `).join('');
  box.querySelectorAll('[data-del-addr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await adminFetch(`/users/${editingUserId}/deposit-addresses/${btn.dataset.delAddr}`, {
        method: 'DELETE',
      });
      openEdit(editingUserId);
    });
  });
}

$('addr-save').addEventListener('click', async () => {
  try {
    await adminFetch(`/users/${editingUserId}/deposit-addresses`, {
      method: 'PUT',
      body: JSON.stringify({
        asset: $('addr-asset').value,
        network: $('addr-network').value,
        address: $('addr-value').value.trim(),
      }),
    });
    $('addr-value').value = '';
    await openEdit(editingUserId);
  } catch (e) {
    $('edit-error').textContent = e.message;
  }
});

$('edit-cancel').addEventListener('click', () => $('edit-modal').classList.add('screen-hidden'));
$('edit-save').addEventListener('click', async () => {
  const id = $('edit-id').value;
  $('edit-error').textContent = '';
  try {
    const verified = $('edit-verified').checked;
    await adminFetch(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        accountNumber: $('edit-account').value.trim(),
        usdtBalance: Number($('edit-balance').value),
        kycStatus: verified ? 'approved' : undefined,
        verified,
      }),
    });
    $('edit-modal').classList.add('screen-hidden');
    await loadUsers();
    await loadAccountRequests();
    await loadKycQueue();
  } catch (e) {
    $('edit-error').textContent = e.message;
  }
});

async function loadKycQueue() {
  const users = await adminFetch('/users?kycPending=1');
  const box = $('kyc-list');
  if (!users.length) {
    box.innerHTML = '<div class="muted">Нет заявок на проверке</div>';
    return;
  }
  box.innerHTML = users.map((u) => `
    <div class="kyc-card">
      <h3>${escapeHtml(u.fullName || u.displayName || '—')}</h3>
      <div class="muted mono">UID ${escapeHtml(u.uid || '—')} · #${u.id}</div>
      <div class="muted">${escapeHtml(u.email || 'нет email')} · ${escapeHtml(u.phone || 'нет телефона')}</div>
      <div class="muted">ID ${u.id} · @${escapeHtml(u.usernameTg || '—')}</div>
      <div class="muted">${escapeHtml(u.country || '')}</div>
      <div style="margin-top:10px">
        <button class="btn-primary" data-kyc-open="${u.id}">Открыть</button>
      </div>
    </div>
  `).join('');
  box.querySelectorAll('[data-kyc-open]').forEach((btn) => {
    btn.addEventListener('click', () => openKyc(Number(btn.dataset.kycOpen)));
  });
}

$('refresh-kyc').addEventListener('click', () => loadKycQueue().catch(console.error));

async function openKyc(id) {
  currentKycUserId = id;
  const user = await adminFetch(`/users/${id}`);
  $('kyc-modal-meta').textContent =
    `${user.fullName || '—'} · ${user.country || '—'} · @${user.usernameTg || '—'} · ID ${user.id}`;
  $('kyc-reject-reason').value = '';

  const labels = { id_front: 'Документ (лицевая)', id_back: 'Документ (оборот)', selfie: 'Селфи' };
  $('kyc-modal-docs').innerHTML = (user.kycDocuments || []).map((d) => `
    <div class="kyc-doc">
      <img src="${fileUrl(`/users/${id}/kyc/docs/${d.type}/file`)}" alt="">
      <div class="cap">${labels[d.type] || d.type}</div>
    </div>
  `).join('') || '<div class="muted">Документы не загружены</div>';

  $('kyc-modal').classList.remove('screen-hidden');
}

$('kyc-modal-close').addEventListener('click', () => $('kyc-modal').classList.add('screen-hidden'));

$('kyc-approve-btn').addEventListener('click', async () => {
  await adminFetch(`/users/${currentKycUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ kycStatus: 'approved' }),
  });
  $('kyc-modal').classList.add('screen-hidden');
  await loadKycQueue();
  await loadUsers();
});

$('kyc-reject-btn').addEventListener('click', async () => {
  const reason = $('kyc-reject-reason').value.trim() || 'Отклонено';
  await adminFetch(`/users/${currentKycUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ kycStatus: 'rejected', kycRejectReason: reason }),
  });
  $('kyc-modal').classList.add('screen-hidden');
  await loadKycQueue();
  await loadUsers();
});

let adminSupportPoll = null;
let adminThreadSig = '';

function stopAdminSupportPoll() {
  if (adminSupportPoll) {
    clearInterval(adminSupportPoll);
    adminSupportPoll = null;
  }
}

function startAdminSupportPoll() {
  stopAdminSupportPoll();
  adminSupportPoll = setInterval(() => {
    const onSupport = !$('view-support').classList.contains('screen-hidden');
    if (!onSupport || !secret) return;
    loadThreads({ silent: true }).catch(() => {});
    if (currentThreadId) openThread(currentThreadId, { silent: true }).catch(() => {});
  }, 2500);
}

function renderAdminMsg(m) {
  const text = m.text && m.text !== '📎 Вложение' ? `<div>${escapeHtml(m.text)}</div>` : '';
  let file = '';
  if (m.hasFile && m.fileUrl) {
    const url = fileUrl(m.fileUrl.replace(/^\/api\/admin/, ''));
    if ((m.mimeType || '').startsWith('image/')) {
      file = `<a href="${url}" target="_blank" rel="noopener"><img class="msg-img" src="${url}" alt=""></a>`;
    } else {
      file = `<a class="msg-file" href="${url}" target="_blank" rel="noopener">📄 ${escapeHtml(m.originalName || 'файл')}</a>`;
    }
  }
  return `<div class="msg ${m.sender}">${text}${file}</div>`;
}

function updateSupportNavDot(threads) {
  const unread = (threads || []).filter((t) => t.unread).length;
  const dot = $('support-nav-dot');
  if (!dot) return;
  dot.classList.toggle('screen-hidden', unread === 0);
  dot.textContent = unread > 9 ? '9+' : String(unread || '');
}

async function loadThreads({ silent = false } = {}) {
  const threads = await adminFetch('/support/threads');
  updateSupportNavDot(threads);
  const list = $('threads-list');
  if (!threads.length) {
    list.innerHTML = '<div class="muted">Открытых тикетов нет</div>';
    return threads;
  }
  list.innerHTML = threads.map((t) => {
    const preview = t.lastMessage?.hasFile && (!t.lastMessage.text || t.lastMessage.text === '📎 Вложение')
      ? '📎 Вложение'
      : (t.lastMessage?.text || 'нет сообщений');
    return `
    <button class="thread-item ${t.id === currentThreadId ? 'active' : ''} ${t.unread ? 'unread' : ''}" data-thread="${t.id}">
      <div class="t-id">
        ${t.unread ? '<span class="unread-dot"></span>' : ''}
        #${t.id} · ${escapeHtml(t.user.displayName || t.user.usernameTg || t.user.id)}
      </div>
      <div class="t-preview">${escapeHtml(preview)}</div>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-thread]').forEach((btn) => {
    btn.addEventListener('click', () => openThread(Number(btn.dataset.thread)));
  });
  return threads;
}

$('refresh-threads').addEventListener('click', () => loadThreads().catch(console.error));

async function openThread(id, { silent = false } = {}) {
  currentThreadId = id;
  const thread = await adminFetch(`/support/threads/${id}`);
  const sig = thread.messages.map((m) => m.id).join(',');
  if (silent && sig === adminThreadSig) {
    loadThreads({ silent: true }).catch(() => {});
    return;
  }
  adminThreadSig = sig;

  $('thread-empty').classList.add('screen-hidden');
  $('thread-panel').classList.remove('screen-hidden');
  $('thread-title').textContent = `Тикет #${thread.id}`;
  $('thread-user').textContent =
    `${thread.user.displayName || '—'} · @${thread.user.usernameTg || '—'} · id ${thread.user.id}` +
    (thread.user.accountNumber ? ` · счёт ${thread.user.accountNumber}` : '');

  const box = $('thread-messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = thread.messages.map(renderAdminMsg).join('');
  if (!silent || nearBottom) box.scrollTop = box.scrollHeight;
  loadThreads({ silent: true }).catch(() => {});
}

$('reply-file').addEventListener('change', () => {
  const f = $('reply-file').files?.[0];
  $('reply-file-name').textContent = f ? f.name : '';
});

$('reply-btn').addEventListener('click', async () => {
  if (!currentThreadId) return;
  const text = $('reply-text').value.trim();
  const file = $('reply-file').files?.[0];
  if (!text && !file) return;
  try {
    const fd = new FormData();
    if (text) fd.append('text', text);
    if (file) fd.append('file', file);
    await adminFetch(`/support/threads/${currentThreadId}/reply`, {
      method: 'POST',
      body: fd,
    });
    $('reply-text').value = '';
    $('reply-file').value = '';
    $('reply-file-name').textContent = '';
    adminThreadSig = '';
    await openThread(currentThreadId);
  } catch (e) {
    alert(e.message);
  }
});

$('close-thread-btn').addEventListener('click', async () => {
  if (!currentThreadId) return;
  if (!confirm('Закрыть тикет?')) return;
  await adminFetch(`/support/threads/${currentThreadId}/close`, { method: 'POST' });
  currentThreadId = null;
  adminThreadSig = '';
  $('thread-panel').classList.add('screen-hidden');
  $('thread-empty').classList.remove('screen-hidden');
  await loadThreads();
});

// красная точка в меню — даже вне вкладки поддержки
setInterval(() => {
  if (!secret) return;
  loadThreads({ silent: true }).catch(() => {});
}, 8000);

if (secret) tryLogin(secret);
else showApp(false);
