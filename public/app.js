const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
tg.setHeaderColor('#0b0e11');
tg.setBackgroundColor('#0b0e11');

const API_BASE = '/api';
const MAIN_TABS = new Set(['markets', 'wallet', 'profile']);

const NETWORK_OPTIONS = {
  USDT: [
    { network: 'TRC20', label: 'TRC-20' },
    { network: 'ERC20', label: 'ERC-20' },
  ],
  BTC: [{ network: 'BTC', label: 'Bitcoin' }],
};

const TYPE_LABELS = {
  transfer_in: 'Входящий перевод',
  transfer_out: 'Исходящий перевод',
  admin_adjust: 'Корректировка',
  bonus: 'Бонус',
};

const KYC_LABELS = {
  none: { text: 'Не верифицирован', cls: '' },
  pending: { text: 'На проверке', cls: 'pending' },
  approved: { text: 'Верифицирован', cls: 'approved' },
  rejected: { text: 'Отклонено', cls: '' },
};

let profile = null;
let depositAsset = 'USDT';
let depositNetwork = 'TRC20';
let currentThreadId = null;
let kycDocs = {};
let appReady = false;
let quotesTimer = null;
let profileTimer = null;

function apiFetch(path, options = {}) {
  return fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Telegram-Init-Data': tg.initData || '',
      ...(options.headers || {}),
    },
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.error || `Ошибка сервера (${r.status})`;
      throw new Error(msg);
    }
    return data;
  }).catch((e) => {
    if (e.message && !/Failed to fetch|NetworkError/i.test(e.message)) throw e;
    throw new Error('Нет связи с сервером. Проверьте деплой на Railway.');
  });
}

async function apiBlob(path) {
  const r = await fetch(API_BASE + path, {
    headers: { 'X-Telegram-Init-Data': tg.initData || '' },
  });
  if (!r.ok) throw new Error('не удалось загрузить файл');
  return r.blob();
}

function fmtUsdt(n) {
  return (Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function fmtUsdPrice(n) {
  if (n == null) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function fmtChange(n) {
  if (n == null || Number.isNaN(n)) return { text: '—', up: true };
  const up = n >= 0;
  return { text: `${up ? '+' : ''}${n.toFixed(2)}%`, up };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('screen-hidden'));
  const screen = document.getElementById(`screen-${name}`);
  if (!screen) return;
  screen.classList.remove('screen-hidden');

  document.querySelectorAll('.tab').forEach((t) => {
    const tab = MAIN_TABS.has(name) ? name : (
      name === 'deposit' || name === 'transfer' || name === 'history' ? 'wallet' : 'profile'
    );
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  if (name === 'history') loadHistory();
  if (name === 'support') loadSupportThread();
  if (name === 'deposit') renderDepositNetworks();
  if (name === 'transfer' && profile) {
    document.getElementById('transfer-hint').textContent =
      `Доступно: ${fmtUsdt(profile.usdtBalance)} USDT`;
  }
  if (name === 'edit-profile' && profile) fillEditForm();
  if (name === 'kyc') initKycScreen();
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showScreen(tab.dataset.tab));
});

document.getElementById('open-deposit').addEventListener('click', () => showScreen('deposit'));
document.getElementById('open-transfer').addEventListener('click', () => showScreen('transfer'));
document.getElementById('open-history').addEventListener('click', () => showScreen('history'));
document.getElementById('open-support').addEventListener('click', () => showScreen('support'));
document.getElementById('open-edit-profile').addEventListener('click', () => showScreen('edit-profile'));
document.getElementById('open-kyc').addEventListener('click', () => showScreen('kyc'));

document.getElementById('home-go-deposit')?.addEventListener('click', () => showScreen('deposit'));
document.getElementById('home-go-wallet')?.addEventListener('click', () => showScreen('wallet'));
document.getElementById('home-q-deposit')?.addEventListener('click', () => showScreen('deposit'));
document.getElementById('home-q-transfer')?.addEventListener('click', () => showScreen('transfer'));
document.getElementById('home-q-markets')?.addEventListener('click', () => {
  document.getElementById('quotes-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('home-q-profile')?.addEventListener('click', () => showScreen('profile'));
document.getElementById('home-uid-chip')?.addEventListener('click', async () => {
  const uid = profile?.uid;
  if (!uid) return;
  try {
    await navigator.clipboard.writeText(String(uid));
    tg.showAlert('UID скопирован');
  } catch {
    tg.showAlert(String(uid));
  }
});

// ---------- auth ----------
function setAuthTab(which) {
  const isReg = which === 'register';
  document.getElementById('tab-register').classList.toggle('active', isReg);
  document.getElementById('tab-login').classList.toggle('active', !isReg);
  document.getElementById('auth-register').classList.toggle('screen-hidden', !isReg);
  document.getElementById('auth-login').classList.toggle('screen-hidden', isReg);
  document.getElementById('auth-sub-text').textContent = isReg
    ? 'Создайте аккаунт, чтобы открыть кошелёк, рынки и переводы'
    : 'Войдите с email и паролем вашего аккаунта';
  document.getElementById('reg-error').textContent = '';
  document.getElementById('login-error').textContent = '';
}

document.getElementById('tab-register').addEventListener('click', () => setAuthTab('register'));
document.getElementById('tab-login').addEventListener('click', () => setAuthTab('login'));

document.querySelectorAll('.auth-gate a[href^="http"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const url = a.href;
    try {
      if (tg.openLink) tg.openLink(url);
      else window.open(url, '_blank');
    } catch {
      window.open(url, '_blank');
    }
  });
});

function showAuthGate(mode = 'forms') {
  document.body.classList.add('auth-locked');
  document.getElementById('auth-gate').classList.remove('screen-hidden');
  document.getElementById('app-shell').classList.add('screen-hidden');
  if (mode === 'success') {
    document.getElementById('auth-forms').classList.add('screen-hidden');
    document.getElementById('auth-success').classList.remove('screen-hidden');
    document.getElementById('auth-sub-text').textContent = 'Регистрация завершена';
  } else {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    setAuthTab('register');
  }
}

function enterApp(me, { startScreen = 'markets' } = {}) {
  profile = me;
  renderProfile(me);
  document.body.classList.remove('auth-locked');
  document.getElementById('auth-gate').classList.add('screen-hidden');
  document.getElementById('app-shell').classList.remove('screen-hidden');
  showScreen(startScreen);
  if (!appReady) {
    appReady = true;
    loadQuotes();
    loadNews();
    quotesTimer = setInterval(loadQuotes, 60_000);
    profileTimer = setInterval(() => loadProfile().catch(() => {}), 30_000);
  }
}

document.getElementById('auth-enter-app').addEventListener('click', () => {
  if (profile) enterApp(profile);
});

document.getElementById('reg-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('reg-error');
  errorEl.textContent = '';
  const fullName = document.getElementById('reg-fio').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const country = document.getElementById('reg-country').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if (fullName.length < 3) {
    errorEl.textContent = 'Укажите ФИО полностью';
    return;
  }
  if (!email.includes('@')) {
    errorEl.textContent = 'Укажите корректный email';
    return;
  }
  if (phone.length < 8) {
    errorEl.textContent = 'Укажите номер телефона';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'Пароль от 6 символов';
    return;
  }
  if (password !== password2) {
    errorEl.textContent = 'Пароли не совпадают';
    return;
  }

  const btn = document.getElementById('reg-submit');
  btn.disabled = true;
  btn.textContent = 'Создание…';
  try {
    const me = await apiFetch('/users/me/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, email, phone, country, password }),
    });
    profile = me;
    document.getElementById('auth-uid-value').textContent = me.uid || '—';
    showAuthGate('success');
  } catch (e) {
    errorEl.textContent = e.message || 'Не удалось зарегистрироваться';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Зарегистрироваться';
  }
});

document.getElementById('login-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) {
    errorEl.textContent = 'Укажите email и пароль';
    return;
  }
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.textContent = 'Вход…';
  try {
    const me = await apiFetch('/users/me/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    enterApp(me);
  } catch (e) {
    errorEl.textContent = e.message || 'Неверный email или пароль';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
});

['reg-password2', 'reg-password', 'reg-phone', 'reg-email', 'reg-fio'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reg-submit').click();
  });
});
['login-email', 'login-password'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-submit').click();
  });
});

// ---------- profile ----------
function renderAccount(me) {
  const empty = document.getElementById('account-empty');
  const pending = document.getElementById('account-pending');
  const ready = document.getElementById('account-ready');
  [empty, pending, ready].forEach((el) => el.classList.add('screen-hidden'));

  if (me.accountNumber) {
    ready.classList.remove('screen-hidden');
    document.getElementById('account-number').textContent = me.accountNumber;
  } else if (me.accountRequestStatus === 'pending') {
    pending.classList.remove('screen-hidden');
  } else {
    empty.classList.remove('screen-hidden');
  }
}

function renderProfile(me) {
  const name = me.displayName || me.fullName || 'Пользователь';
  const initials = name.slice(0, 2).toUpperCase();
  document.getElementById('avatar').textContent = initials;
  document.getElementById('display-name').textContent = name;
  document.getElementById('profile-uid').textContent = `UID ${me.uid || me.id}`;
  document.getElementById('wallet-balance').textContent = fmtUsdt(me.usdtBalance);
  document.getElementById('header-balance').textContent = fmtUsdt(me.usdtBalance);
  document.getElementById('wallet-fiat').textContent = `≈ $${fmtUsdt(me.usdtBalance)}`;

  const hello = document.getElementById('home-hello-name');
  if (hello) hello.textContent = name;
  const uidChip = document.getElementById('home-uid-chip');
  if (uidChip) uidChip.textContent = `UID ${me.uid || '—'}`;

  document.getElementById('info-display').textContent = me.displayName || '—';
  document.getElementById('info-fullname').textContent = me.fullName || 'не указано';
  document.getElementById('info-email').textContent = me.email || 'не указано';
  document.getElementById('info-phone').textContent = me.phone || 'не указано';
  document.getElementById('info-country').textContent = me.country || 'не указано';
  document.getElementById('info-tg').textContent = me.usernameTg ? `@${me.usernameTg}` : '—';
  document.getElementById('info-account').textContent = me.accountNumber || 'не выдан';

  const badge = document.getElementById('verified-badge');
  const pill = document.getElementById('kyc-pill');
  const kycBtn = document.getElementById('open-kyc');
  const summary = document.getElementById('kyc-summary');
  const meta = KYC_LABELS[me.kycStatus] || KYC_LABELS.none;

  pill.textContent = meta.text;
  pill.className = `kyc-pill ${meta.cls}`;
  if (me.kycStatus === 'rejected' && me.kycRejectReason) {
    summary.textContent = `Отклонено: ${me.kycRejectReason}`;
  } else if (me.kycStatus === 'pending') {
    summary.textContent = 'Заявка на проверке. Обычно это занимает немного времени.';
  } else if (me.kycStatus === 'approved') {
    summary.textContent = 'Документы проверены, профиль подтверждён.';
  } else {
    summary.textContent = 'Пройдите KYC: ФИО, фото документа и селфи.';
  }

  if (me.verified || me.kycStatus === 'approved') {
    badge.classList.remove('badge-hidden');
  } else {
    badge.classList.add('badge-hidden');
  }

  kycBtn.style.display = me.kycStatus === 'approved' ? 'none' : 'block';
  kycBtn.textContent = me.kycStatus === 'pending'
    ? 'Статус заявки'
    : me.kycStatus === 'rejected'
      ? 'Подать снова'
      : 'Пройти верификацию';

  renderAccount(me);
}

async function loadProfile() {
  const me = await apiFetch('/users/me');
  profile = me;
  renderProfile(me);
  return me;
}

document.getElementById('request-account-btn').addEventListener('click', async () => {
  try {
    const res = await apiFetch('/users/me/account-request', { method: 'POST' });
    if (profile) {
      profile.accountNumber = res.accountNumber;
      profile.accountRequestStatus = res.accountRequestStatus;
      renderAccount(profile);
      renderProfile(profile);
    }
    tg.showAlert(res.accountNumber ? 'Номер уже назначен' : 'Заявка отправлена');
  } catch (e) {
    tg.showAlert(e.message);
  }
});

document.getElementById('copy-account-btn').addEventListener('click', async () => {
  const num = document.getElementById('account-number').textContent;
  try {
    await navigator.clipboard.writeText(num);
    tg.showAlert('Номер скопирован');
  } catch {
    tg.showAlert(num);
  }
});

function fillEditForm() {
  document.getElementById('edit-display').value = profile.displayName || '';
  document.getElementById('edit-fullname').value = profile.fullName || '';
  document.getElementById('edit-email').value = profile.email || '';
  document.getElementById('edit-phone').value = profile.phone || '';
  document.getElementById('edit-country').value = profile.country || '';
  document.getElementById('edit-profile-error').textContent = '';
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('edit-profile-error');
  errorEl.textContent = '';
  try {
    const me = await apiFetch('/users/me/profile', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: document.getElementById('edit-display').value,
        fullName: document.getElementById('edit-fullname').value,
        email: document.getElementById('edit-email').value,
        phone: document.getElementById('edit-phone').value,
        country: document.getElementById('edit-country').value,
      }),
    });
    profile = { ...profile, ...me };
    renderProfile(profile);
    tg.showAlert('Профиль сохранён');
    showScreen('profile');
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

// ---------- deposit ----------
function renderDepositNetworks() {
  const box = document.getElementById('deposit-network-seg');
  const list = NETWORK_OPTIONS[depositAsset] || [];
  if (!list.find((n) => n.network === depositNetwork)) {
    depositNetwork = list[0]?.network;
  }
  box.innerHTML = list.map((n) => `
    <button class="seg-btn ${n.network === depositNetwork ? 'active' : ''}" data-network="${n.network}">
      ${escapeHtml(n.label)}
    </button>
  `).join('');
  box.querySelectorAll('[data-network]').forEach((btn) => {
    btn.addEventListener('click', () => {
      depositNetwork = btn.dataset.network;
      renderDepositNetworks();
      loadDepositAddress();
    });
  });
  loadDepositAddress();
}

document.querySelectorAll('#deposit-asset-seg [data-asset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    depositAsset = btn.dataset.asset;
    document.querySelectorAll('#deposit-asset-seg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.asset === depositAsset);
    });
    renderDepositNetworks();
  });
});

async function loadDepositAddress() {
  const box = document.getElementById('deposit-result');
  box.innerHTML = '<div class="empty">Загрузка адреса…</div>';
  try {
    const data = await apiFetch(
      `/users/me/deposit/address?asset=${depositAsset}&network=${depositNetwork}`
    );
    if (!data.assigned) {
      box.innerHTML = `
        <div class="empty">${escapeHtml(data.message || 'Адрес ещё не выдан')}</div>
        <p class="muted" style="margin-top:10px">Администратор назначит персональный адрес в админ-панели.</p>
        <button class="btn-ghost" id="deposit-ask-support">Написать в поддержку</button>`;
      document.getElementById('deposit-ask-support')?.addEventListener('click', () => showScreen('support'));
      return;
    }

    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.address)}`;
    box.innerHTML = `
      <img class="deposit-qr" src="${qr}" alt="QR">
      <div class="deposit-meta">${escapeHtml(data.asset)} · ${escapeHtml(data.network)}</div>
      <div class="deposit-addr mono" id="deposit-addr-text">${escapeHtml(data.address)}</div>
      <button class="btn-primary full" id="copy-deposit-addr">Скопировать адрес</button>
      <p class="muted" style="margin-top:12px">Отправляйте только ${escapeHtml(data.asset)} в сети ${escapeHtml(data.network)}. Зачисление после подтверждения администратором.</p>`;
    document.getElementById('copy-deposit-addr').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.address);
        tg.showAlert('Адрес скопирован');
      } catch {
        tg.showAlert(data.address);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- KYC ----------
function setKycStep(step) {
  [1, 2, 3].forEach((n) => {
    document.getElementById(`kyc-step-${n}`).classList.toggle('screen-hidden', n !== step);
    const el = document.querySelector(`.kyc-step[data-step="${n}"]`);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  document.getElementById('kyc-done').classList.add('screen-hidden');
}

async function initKycScreen() {
  if (profile?.kycStatus === 'pending') {
    document.querySelectorAll('#kyc-step-1, #kyc-step-2, #kyc-step-3').forEach((el) => {
      el.classList.add('screen-hidden');
    });
    document.getElementById('kyc-done').classList.remove('screen-hidden');
    document.querySelector('#kyc-done h2').textContent = 'Заявка на проверке';
    document.querySelector('#kyc-done .muted').textContent =
      'Документы уже отправлены. Ожидайте решения администратора.';
    return;
  }

  document.querySelector('#kyc-done h2').textContent = 'Заявка отправлена';
  document.getElementById('kyc-fullname').value = profile?.fullName || '';
  document.getElementById('kyc-country').value = profile?.country || '';
  setKycStep(1);

  try {
    const kyc = await apiFetch('/users/me/kyc');
    kycDocs = {};
    for (const d of kyc.documents || []) {
      kycDocs[d.type] = true;
      try {
        const blob = await apiBlob(`/users/me/kyc/docs/${d.type}/file`);
        const url = URL.createObjectURL(blob);
        document.getElementById(`preview-${d.type}`).innerHTML =
          `<img src="${url}" alt="">`;
      } catch {
        document.getElementById(`preview-${d.type}`).textContent = 'Загружено';
      }
    }
  } catch {
    /* ignore */
  }
}

document.getElementById('kyc-next-1').addEventListener('click', () => {
  const fio = document.getElementById('kyc-fullname').value.trim();
  const country = document.getElementById('kyc-country').value.trim();
  if (fio.length < 3) return tg.showAlert('Укажите ФИО');
  if (!country) return tg.showAlert('Укажите страну');
  setKycStep(2);
});

document.getElementById('kyc-back-2').addEventListener('click', () => setKycStep(1));
document.getElementById('kyc-next-2').addEventListener('click', () => {
  if (!kycDocs.id_front || !kycDocs.selfie) {
    document.getElementById('kyc-upload-error').textContent =
      'Нужны фото документа и селфи';
    return;
  }
  document.getElementById('kyc-upload-error').textContent = '';
  document.getElementById('kyc-review-fio').textContent =
    document.getElementById('kyc-fullname').value.trim();
  document.getElementById('kyc-review-country').textContent =
    document.getElementById('kyc-country').value.trim();
  setKycStep(3);
});
document.getElementById('kyc-back-3').addEventListener('click', () => setKycStep(2));

document.querySelectorAll('input[data-kyc-type]').forEach((input) => {
  input.addEventListener('change', async () => {
    const type = input.dataset.kycType;
    const file = input.files?.[0];
    if (!file) return;
    const errorEl = document.getElementById('kyc-upload-error');
    errorEl.textContent = '';
    const preview = document.getElementById(`preview-${type}`);
    preview.textContent = 'Загрузка…';

    const fd = new FormData();
    fd.append('file', file);
    try {
      await apiFetch(`/users/me/kyc/docs/${type}`, { method: 'POST', body: fd });
      kycDocs[type] = true;
      const url = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${url}" alt="">`;
    } catch (e) {
      preview.textContent = 'Ошибка';
      errorEl.textContent = e.message;
    }
  });
});

document.getElementById('kyc-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('kyc-submit-error');
  errorEl.textContent = '';
  try {
    await apiFetch('/users/me/kyc/submit', {
      method: 'POST',
      body: JSON.stringify({
        fullName: document.getElementById('kyc-fullname').value.trim(),
        country: document.getElementById('kyc-country').value.trim(),
      }),
    });
    document.querySelectorAll('#kyc-step-1, #kyc-step-2, #kyc-step-3').forEach((el) => {
      el.classList.add('screen-hidden');
    });
    document.getElementById('kyc-done').classList.remove('screen-hidden');
    await loadProfile();
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

// ---------- transfer ----------
document.getElementById('transfer-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('transfer-error');
  errorEl.textContent = '';
  try {
    await apiFetch('/transfers', {
      method: 'POST',
      body: JSON.stringify({
        toAccountNumber: document.getElementById('transfer-account').value.trim(),
        toUsername: document.getElementById('transfer-username').value.trim(),
        amount: document.getElementById('transfer-amount').value,
      }),
    });
    document.getElementById('transfer-account').value = '';
    document.getElementById('transfer-username').value = '';
    document.getElementById('transfer-amount').value = '';
    tg.showAlert('Перевод выполнен');
    await loadProfile();
    showScreen('wallet');
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

// ---------- history ----------
async function loadHistory() {
  try {
    const items = await apiFetch('/users/me/history');
    const list = document.getElementById('history-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">Пока нет операций</div>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const isPositive = item.amount > 0;
      const sign = isPositive ? '+' : '';
      const date = new Date(item.createdAt).toLocaleString('ru-RU');
      const label = TYPE_LABELS[item.type] || item.type;
      return `
        <div class="history-item">
          <div>
            <div>${escapeHtml(label)}</div>
            <div class="history-meta">${date}${item.meta ? ' · ' + escapeHtml(item.meta) : ''}</div>
          </div>
          <div class="mono ${isPositive ? 'history-amount-pos' : 'history-amount-neg'}">
            ${sign}${fmtUsdt(item.amount)}
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('history-list').innerHTML =
      `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- support ----------
async function loadSupportThread() {
  try {
    const thread = await apiFetch('/support/thread');
    currentThreadId = thread.id;
    const container = document.getElementById('chat-messages');
    container.innerHTML = thread.messages.map((m) => `
      <div class="msg ${m.sender === 'user' ? 'msg-user' : 'msg-admin'}">${escapeHtml(m.text)}</div>
    `).join('');
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    document.getElementById('chat-messages').innerHTML =
      `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

async function sendSupportMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !currentThreadId) return;
  input.value = '';
  try {
    await apiFetch(`/support/thread/${currentThreadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    loadSupportThread();
  } catch (e) {
    tg.showAlert(e.message);
  }
}

document.getElementById('chat-send').addEventListener('click', sendSupportMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendSupportMessage();
});

// ---------- markets ----------
async function loadQuotes() {
  try {
    const r = await fetch('/api/market/quotes');
    const quotes = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(quotes)) throw new Error(quotes?.error || 'bad');
    document.getElementById('ticker-strip').innerHTML = quotes.slice(0, 6).map((q, i) => {
      const chg = fmtChange(q.change24h);
      return `
        <div class="ticker-chip" style="animation-delay:${i * 40}ms">
          <div class="sym">${escapeHtml(q.symbol)}/USDT</div>
          <div class="px mono">${fmtUsdPrice(q.price)}</div>
          <div class="chg ${chg.up ? 'chg-up' : 'chg-down'}">${chg.text}</div>
        </div>`;
    }).join('');

    document.getElementById('quotes-list').innerHTML = quotes.map((q, i) => {
      const chg = fmtChange(q.change24h);
      const img = q.image
        ? `<img src="${escapeHtml(q.image)}" alt="" loading="lazy">`
        : `<div class="quote-ico">${escapeHtml(q.symbol.slice(0, 2))}</div>`;
      return `
        <div class="quote-row" style="animation-delay:${i * 35}ms">
          ${img}
          <div>
            <div class="quote-name">${escapeHtml(q.symbol)}<span style="color:var(--text-3);font-weight:500"> / USDT</span></div>
            <div class="quote-full">${escapeHtml(q.name)}</div>
          </div>
          <div class="quote-right">
            <div class="quote-price mono">$${fmtUsdPrice(q.price)}</div>
            <span class="chg-pill ${chg.up ? 'up' : 'down'}">${chg.text}</span>
          </div>
        </div>`;
    }).join('');

    document.getElementById('quotes-updated').textContent =
      `обн. ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    document.getElementById('ticker-strip').innerHTML = '';
    document.getElementById('quotes-list').innerHTML =
      '<div class="empty">Не удалось загрузить котировки</div>';
  }
}

async function loadNews() {
  try {
    const r = await fetch('/api/market/news');
    const news = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(news)) throw new Error(news?.error || 'bad');
    const list = document.getElementById('news-list');
    if (!news.length) {
      list.innerHTML = '<div class="empty">Новостей пока нет</div>';
      return;
    }
    list.innerHTML = news.map((n) => {
      const date = n.publishedAt
        ? new Date(n.publishedAt).toLocaleString('ru-RU', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })
        : '';
      const img = n.image
        ? `<img src="${escapeHtml(n.image)}" alt="" loading="lazy">`
        : `<div style="width:64px;height:48px;border-radius:6px;background:var(--panel-2)"></div>`;
      return `
        <a class="news-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener">
          ${img}
          <div>
            <div class="news-title">${escapeHtml(n.title)}</div>
            <div class="news-meta">${escapeHtml(n.source || '')}${date ? ' · ' + date : ''}</div>
          </div>
        </a>`;
    }).join('');
  } catch {
    document.getElementById('news-list').innerHTML =
      '<div class="empty">Не удалось загрузить новости</div>';
  }
}

async function boot() {
  showAuthGate('forms');
  try {
    const me = await apiFetch('/users/me');
    if (me.registered) {
      enterApp(me);
      return;
    }
    // префилл из Telegram
    const tgUser = tg.initDataUnsafe?.user;
    if (tgUser?.first_name && !document.getElementById('reg-fio').value) {
      const parts = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
      if (parts) document.getElementById('reg-fio').value = parts;
    }
    showAuthGate('forms');
  } catch (e) {
    console.error(e);
    document.getElementById('reg-error').textContent =
      e.message || 'Не удалось связаться с сервером';
    try { tg.showAlert(e.message || 'Не удалось загрузить профиль'); } catch (_) {}
  }
}

boot();
