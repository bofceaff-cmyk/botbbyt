const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
tg.setHeaderColor('#0b0e11');
tg.setBackgroundColor('#0b0e11');

function syncAppViewport() {
  const h = Math.round(tg.viewportStableHeight || tg.viewportHeight || window.innerHeight);
  const shell = document.getElementById('app-shell');
  if (shell && h > 0) shell.style.height = `${h}px`;
}
syncAppViewport();
if (typeof tg.onEvent === 'function') tg.onEvent('viewportChanged', syncAppViewport);
window.addEventListener('resize', syncAppViewport);

const API_BASE = '/api';
const MAIN_TABS = new Set(['markets', 'tickers', 'trade', 'tradfi', 'wallet']);

const NETWORK_OPTIONS = {
  USDT: [
    { network: 'TRC20', label: 'TRC-20' },
    { network: 'ERC20', label: 'ERC-20' },
  ],
  BTC: [{ network: 'BTC', label: 'Bitcoin' }],
};

const TYPE_LABELS = {
  transfer_in: 'Перевод USDT',
  transfer_out: 'Перевод USDT',
  admin_adjust: 'Корректировка USDT',
  bonus: 'Внести USDT',
  deposit: 'Внести USDT',
  withdraw_admin: 'Вывод средств USDT',
  withdraw_onchain: 'Вывод средств USDT',
  withdraw_card: 'Вывод средств USDT',
  convert: 'Конвертация USDT',
  earn: 'Earn USDT',
};

const TYPE_KIND = {
  transfer_in: 'Перевод',
  transfer_out: 'Перевод',
  admin_adjust: 'Корректировка',
  bonus: 'Внести',
  deposit: 'Внести',
  withdraw_admin: 'Вывести',
  withdraw_onchain: 'Вывести',
  withdraw_card: 'Вывести',
  convert: 'Конвертация',
  earn: 'Earn',
};

function historyAsset(item) {
  return String(item.asset || 'USDT').toUpperCase();
}

function historyTitle(item) {
  const a = historyAsset(item);
  if (item.type === 'admin_adjust') {
    return item.amount >= 0 ? `Внести ${a}` : `Вывод средств ${a}`;
  }
  if (item.type === 'convert') return `Конвертация ${a}`;
  if (item.type === 'deposit' || item.type === 'bonus') return `Внести ${a}`;
  if (String(item.type || '').startsWith('withdraw')) return `Вывод средств ${a}`;
  if (item.type === 'transfer_in' || item.type === 'transfer_out') return `Перевод ${a}`;
  if (item.type === 'earn') return `Earn ${a}`;
  return TYPE_LABELS[item.type] || item.type;
}

function historyKind(item) {
  if (item.type === 'admin_adjust') {
    return item.amount >= 0 ? 'Внести' : 'Вывести';
  }
  return TYPE_KIND[item.type] || item.type;
}

function historyBucket(item) {
  const t = String(item.type || '');
  if (t === 'transfer_in' || t === 'transfer_out') return 'transfer';
  if (t.startsWith('withdraw') || (t === 'admin_adjust' && item.amount < 0)) return 'withdraw';
  if (t === 'deposit' || t === 'bonus' || (t === 'admin_adjust' && item.amount > 0)) return 'deposit';
  return 'other';
}

function historyStatusText(item) {
  const bucket = historyBucket(item);
  if (bucket === 'withdraw') return 'Вывод завершён';
  return 'Успешно';
}

function fmtHistAmt(n) {
  const x = Math.abs(Number(n) || 0);
  if (x === 0) return '0';
  if (Number.isInteger(x) || Math.abs(x - Math.round(x)) < 1e-8) {
    return Math.round(x).toLocaleString('en-US');
  }
  return x.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function fmtHistoryDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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
let newsTimer = null;
let profileTimer = null;
let quotesEs = null;
let quotesWs = null;
let pendingTotpToken = '';
let pendingReset = { email: '', totpEnabled: false, contact: '', resetToken: '' };
let screenStack = ['markets'];

const SESSION_KEY = 'byx_session';
const COPY = {
  transfersDisabled: 'Переводы для вашего аккаунта временно недоступны. Обратитесь в службу поддержки.',
  conversionsDisabled: 'Конвертация для вашего аккаунта временно недоступна. Обратитесь в службу поддержки.',
};

function getSessionToken() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; }
}
function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private mode */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientError(msg, status) {
  if (status === 401 || status === 403) return false;
  if (status === 502 || status === 503 || status === 504) return true;
  return /502|503|504|Failed to fetch|NetworkError|Нет связи|Application failed/i.test(String(msg || ''));
}

function forceLogoutToAuth(message) {
  setSessionToken('');
  profile = null;
  appReady = false;
  if (quotesTimer) clearInterval(quotesTimer);
  if (newsTimer) clearInterval(newsTimer);
  if (profileTimer) clearInterval(profileTimer);
  quotesTimer = newsTimer = profileTimer = null;
  stopQuotesLive();
  stopSupportPoll();
  document.getElementById('ban-overlay')?.classList.add('screen-hidden');
  showAuthGate('forms');
  setAuthTab('login');
  const el = document.getElementById('login-error');
  if (el && message) el.textContent = message;
}

function showBanOverlay(reason) {
  const box = document.getElementById('ban-overlay');
  const text = document.getElementById('ban-reason');
  if (text) text.textContent = reason || COPY.transfersDisabled;
  box?.classList.remove('screen-hidden');
}

async function apiFetch(path, options = {}, { retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        'X-Telegram-Init-Data': tg.initData || '',
        ...(options.headers || {}),
      };
      const tok = getSessionToken();
      if (tok) headers['X-Session-Token'] = tok;
      const r = await fetch(API_BASE + path, { ...options, headers });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data.error || `Ошибка сервера (${r.status})`;
        if (r.status === 401 && (data.code === 'session_revoked' || /сессия/i.test(msg))) {
          forceLogoutToAuth(msg);
          throw new Error(msg);
        }
        if (r.status === 403 && data.code === 'banned') {
          showBanOverlay(data.banReason || msg);
          throw new Error(msg);
        }
        if (isTransientError(msg, r.status) && attempt < retries) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        const err = new Error(msg);
        err.code = data.code;
        err.status = r.status;
        throw err;
      }
      if (data && data.sessionToken) setSessionToken(data.sessionToken);
      return data;
    } catch (e) {
      lastErr = e;
      if (e.code === 'session_revoked' || e.status === 401) throw e;
      if (isTransientError(e.message, e.status) && attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      if (e.message && !/Failed to fetch|NetworkError/i.test(e.message)) throw e;
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw new Error('Нет связи с сервером. Проверьте деплой на Railway.');
    }
  }
  throw lastErr || new Error('Нет связи с сервером');
}

async function wakeServer() {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (r.ok || r.status < 500) return true;
    } catch (_) { /* cold start */ }
    await sleep(800);
  }
  return false;
}

async function apiBlob(path) {
  const headers = { 'X-Telegram-Init-Data': tg.initData || '' };
  const tok = getSessionToken();
  if (tok) headers['X-Session-Token'] = tok;
  const r = await fetch(API_BASE + path, { headers });
  if (!r.ok) throw new Error('не удалось загрузить файл');
  return r.blob();
}

function fmtUsdt(n, maxDigits = 6) {
  return (Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDigits,
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

function parseQty(raw) {
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!s || s === '.') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function bindAmountInputs() {
  document.querySelectorAll('input[data-amount]').forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('input', () => {
      const cur = el.value;
      let next = cur.replace(/[^\d.,]/g, '');
      const dot = next.indexOf('.');
      const comma = next.indexOf(',');
      let sep = -1;
      if (dot >= 0 && comma >= 0) sep = Math.min(dot, comma);
      else sep = Math.max(dot, comma);
      if (sep >= 0) {
        const mark = next[sep];
        next = next.slice(0, sep + 1) + next.slice(sep + 1).replace(/[.,]/g, '');
        if (mark === ',') next = `${next.slice(0, sep)}.${next.slice(sep + 1)}`;
      }
      if (next !== cur) {
        const pos = el.selectionStart;
        el.value = next;
        try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    });
  });
}

function blurAnyKeyboard() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) {
    a.blur();
  }
  document.body.classList.remove('kb-open');
  document.documentElement.style.setProperty('--kb', '0px');
}

function blurChatKeyboard() {
  blurAnyKeyboard();
}

function updateKeyboardInset() {
  const vv = window.visualViewport;
  const base = tg.viewportStableHeight || window.innerHeight;
  let kb = 0;
  if (vv) kb = Math.max(0, base - vv.height - (vv.offsetTop || 0));
  document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  const focused = document.activeElement
    && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  document.body.classList.toggle('kb-open', Boolean(focused && kb > 40));
  const supportOpen = !document.getElementById('screen-support')?.classList.contains('screen-hidden');
  if (supportOpen) {
    const box = document.getElementById('chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }
  if (focused && kb > 40) {
    try { document.activeElement.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
  }
  syncAppViewport();
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateKeyboardInset);
  window.visualViewport.addEventListener('scroll', updateKeyboardInset);
}
document.addEventListener('focusin', updateKeyboardInset);
document.addEventListener('focusout', () => setTimeout(updateKeyboardInset, 80));
document.addEventListener('pointerdown', (e) => {
  const a = document.activeElement;
  if (!a || (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA')) return;
  if (e.target.closest('input, textarea, select, button, label')) return;
  blurAnyKeyboard();
}, true);
bindAmountInputs();

const I18N = {
  ru: {
    'tab.home': 'Главная', 'tab.markets': 'Рынки', 'tab.trade': 'Торговать', 'tab.assets': 'Активы',
    'trade.convert': 'Конвертация', 'trade.spot': 'Спот', 'trade.futures': 'Фьючерсы', 'trade.options': 'Опцион',
    'uc.title': 'Центр пользователя', 'uc.data': 'Мои данные', 'uc.security': 'Безопасность',
    'uc.params': 'Параметры', 'uc.general': 'Общее',
    tz: 'Ориентировочный часовой пояс', lang: 'Язык', fiat: 'Курс', theme: 'Настройки темы',
    langRu: 'Русский', langEn: 'English', themeDark: 'Ночной режим', themeLight: 'Дневной режим',
  },
  en: {
    'tab.home': 'Home', 'tab.markets': 'Markets', 'tab.trade': 'Trade', 'tab.assets': 'Assets',
    'trade.convert': 'Convert', 'trade.spot': 'Spot', 'trade.futures': 'Futures', 'trade.options': 'Options',
    'uc.title': 'User Center', 'uc.data': 'My data', 'uc.security': 'Security',
    'uc.params': 'Preferences', 'uc.general': 'General',
    tz: 'Estimated time zone', lang: 'Language', fiat: 'Currency', theme: 'Theme',
    langRu: 'Русский', langEn: 'English', themeDark: 'Dark mode', themeLight: 'Light mode',
  },
};
const TZ_LIST = [
  { id: 'UTC-8', off: -8 }, { id: 'UTC-5', off: -5 }, { id: 'UTC+0', off: 0 },
  { id: 'UTC+1', off: 1 }, { id: 'UTC+2', off: 2 }, { id: 'UTC+3', off: 3 },
  { id: 'UTC+4', off: 4 }, { id: 'UTC+8', off: 8 },
];
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('byx_prefs') || '{}'); } catch { return {}; }
}
const prefs = Object.assign({
  lang: 'ru',
  fiat: 'USD',
  theme: 'dark',
  tz: 'UTC+3',
  notifDeposit: true,
  notifSecurity: true,
  notifTrade: true,
  notifNews: true,
  notifTg: true,
}, loadPrefs());
let fxRates = { USD: 1, EUR: 0.92, RUB: 92 };
window.pendingOtpauth = '';

function t(key) {
  return (I18N[prefs.lang] && I18N[prefs.lang][key]) || I18N.ru[key] || key;
}
function savePrefs() {
  localStorage.setItem('byx_prefs', JSON.stringify(prefs));
}
function fmtMoneyFiat(usd) {
  const rate = Number(fxRates[prefs.fiat]) || 1;
  return `${fmtUsdt(Number(usd) * rate)} ${prefs.fiat}`;
}
function applyPrefs() {
  document.documentElement.lang = prefs.lang === 'en' ? 'en' : 'ru';
  document.documentElement.setAttribute('data-theme', prefs.theme === 'light' ? 'light' : 'dark');
  try {
    tg.setHeaderColor(prefs.theme === 'light' ? '#f4f5f7' : '#0b0e11');
    tg.setBackgroundColor(prefs.theme === 'light' ? '#f4f5f7' : '#0b0e11');
  } catch { /* ignore */ }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  const langVal = document.getElementById('uc-lang-val');
  if (langVal) langVal.textContent = prefs.lang === 'en' ? t('langEn') : t('langRu');
  const fiatVal = document.getElementById('uc-fiat-val');
  if (fiatVal) fiatVal.textContent = prefs.fiat;
  const themeVal = document.getElementById('uc-theme-val');
  if (themeVal) themeVal.textContent = prefs.theme === 'light' ? t('themeLight') : t('themeDark');
  const tzVal = document.getElementById('uc-tz-val');
  if (tzVal) tzVal.textContent = prefs.tz;
  ['deposit', 'security', 'trade', 'news', 'tg'].forEach((k) => {
    const key = `notif${k[0].toUpperCase()}${k.slice(1)}`;
    document.getElementById(`notif-${k}`)?.classList.toggle('on', prefs[key] !== false);
  });
  const ccy = document.getElementById('assets-ccy-label');
  if (ccy) ccy.innerHTML = `${prefs.fiat} <span class="assets-ccy-caret">▾</span>`;
  if (typeof applyBalanceVisibility === 'function') {
    try { applyBalanceVisibility(); } catch { /* CONVERT_ASSETS may not exist yet */ }
  }
}
function cyclePref(key, list) {
  const i = Math.max(0, list.indexOf(prefs[key]));
  prefs[key] = list[(i + 1) % list.length];
  savePrefs();
  applyPrefs();
}
async function copyText(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
async function loadFx() {
  try {
    const r = await fetch('/api/market/fx');
    const d = await r.json();
    if (d && d.USD) fxRates = d;
    applyPrefs();
  } catch { /* keep fallback */ }
}

function syncTelegramBack() {
  if (!tg.BackButton) return;
  if (screenStack.length > 1) tg.BackButton.show();
  else tg.BackButton.hide();
}

function goBack(fallback) {
  blurChatKeyboard();
  if (screenStack.length > 1) {
    screenStack.pop();
    showScreen(screenStack[screenStack.length - 1], { fromStack: true });
    return;
  }
  showScreen(fallback || 'markets', { fromStack: true });
}

function showScreen(name, opts = {}) {
  const fromStack = Boolean(opts.fromStack);
  const prev = screenStack[screenStack.length - 1];
  if (!fromStack) {
    if (MAIN_TABS.has(name)) {
      screenStack = [name];
    } else if (prev !== name) {
      const idx = screenStack.lastIndexOf(name);
      if (idx >= 0) screenStack = screenStack.slice(0, idx + 1);
      else screenStack.push(name);
    }
  }

  if (prev === 'support' && name !== 'support') blurChatKeyboard();

  document.querySelectorAll('.screen').forEach((el) => el.classList.add('screen-hidden'));
  blurAnyKeyboard();
  const screen = document.getElementById(`screen-${name}`);
  if (!screen) return;
  screen.classList.remove('screen-hidden');
  document.getElementById('app-shell')?.scrollTo(0, 0);
  syncTelegramBack();

  const profileBack = document.querySelector('#screen-profile > .back-btn');
  if (profileBack) profileBack.classList.toggle('screen-hidden', name === 'profile' && screenStack.length <= 1);

  document.querySelectorAll('.tab').forEach((t) => {
    const walletScreens = new Set([
      'deposit', 'transfer', 'history', 'tx-detail', 'withdraw', 'convert', 'earn', 'card', 'notif',
    ]);
    const tab = MAIN_TABS.has(name) ? name : (
      name === 'chart' ? 'trade' : (
        walletScreens.has(name) ? 'wallet' : (
        name === 'profile' || name === 'support' || name === 'kyc' || name === 'edit-profile' || name === 'notif' ? 'wallet' : 'markets'
        )
      )
    );
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelector('.topbar')?.classList.toggle('screen-hidden', name === 'trade' || name === 'tradfi');
  document.getElementById('app-shell')?.classList.toggle('trade-on', name === 'trade');
  document.getElementById('app-shell')?.classList.toggle('profile-on', name === 'profile');

  if (name === 'history') loadHistory();
  if (name === 'support') {
    loadSupportThread();
    startSupportPoll();
    updateKeyboardInset();
  } else {
    stopSupportPoll();
  }
  if (name === 'deposit') renderDepositNetworks();
  if (name === 'markets') loadNews();
  if (name === 'chart') startChartLive();
  else if (name === 'trade') {
    startChartLive();
    loadTradeChart();
  } else stopChartLive();
  if (name === 'tickers') renderTickersList(lastQuotes);
  if (name === 'transfer' && profile) {
    document.getElementById('transfer-hint').textContent =
      `Доступно: ${fmtUsdt(profile.usdtBalance)} USDT`;
    const terr = document.getElementById('transfer-error');
    if (terr && profile.transfersDisabled) {
      terr.textContent = profile.transferLockReason || profile.copy?.transfersDisabled || COPY.transfersDisabled;
    }
  }
  if (name === 'edit-profile' && profile) fillEditForm();
  if (name === 'kyc') initKycScreen();
  if (name === 'card') renderCardScreen();
  if (name === 'withdraw') prepareWithdrawScreen();
  if (name === 'convert') {
    prepareConvertScreen();
    const cerr = document.getElementById('convert-error');
    if (cerr && profile?.conversionsDisabled) {
      cerr.textContent = profile.convertLockReason || profile.copy?.conversionsDisabled || COPY.conversionsDisabled;
    }
  }
  if (name === 'earn') prepareEarnScreen();
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => goBack(btn.dataset.back));
});
if (typeof tg.onEvent === 'function' && tg.BackButton) {
  tg.BackButton.onClick(() => goBack());
}
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showScreen(tab.dataset.tab));
});

document.getElementById('open-deposit').addEventListener('click', () => showScreen('deposit'));
document.getElementById('open-transfer').addEventListener('click', () => showScreen('transfer'));
document.getElementById('open-history').addEventListener('click', () => showScreen('history'));
document.getElementById('wallet-pnl')?.addEventListener('click', () => showScreen('history'));

document.querySelectorAll('#hist-tabs [data-hist-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    histTab = btn.getAttribute('data-hist-tab') || 'all';
    document.querySelectorAll('#hist-tabs [data-hist-tab]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderHistory();
  });
});
document.getElementById('hist-asset-btn')?.addEventListener('click', () => {
  const assets = ['', ...[...new Set(historyCache.map(historyAsset))].sort()];
  const i = assets.indexOf(histAssetFilter);
  histAssetFilter = assets[(i + 1) % assets.length] || '';
  const el = document.getElementById('hist-asset-btn');
  if (el) el.textContent = (histAssetFilter || 'Все активы') + ' ▾';
  renderHistory();
});
document.getElementById('hist-status-btn')?.addEventListener('click', () => {});
document.getElementById('hist-date-btn')?.addEventListener('click', () => {
  histDateFilter = histDateFilter === 'all' ? '7d' : histDateFilter === '7d' ? '30d' : 'all';
  const labels = { all: 'Дата', '7d': '7 дней', '30d': '30 дней' };
  const el = document.getElementById('hist-date-btn');
  if (el) el.textContent = `${labels[histDateFilter]} ▾`;
  renderHistory();
});
document.getElementById('hist-deposit-help')?.addEventListener('click', () => showScreen('support'));
document.getElementById('history-list')?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-hid]');
  if (row) openTxDetail(row.getAttribute('data-hid'));
});
document.getElementById('txd-explorer')?.addEventListener('click', () => {
  const url = document.getElementById('txd-explorer')?.dataset.url;
  if (url) window.open(url, '_blank', 'noopener');
});
document.getElementById('txd-rows')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const which = btn.getAttribute('data-copy');
  const el = document.getElementById(which === 'hash' ? 'txd-hash' : 'txd-addr');
  const text = el?.textContent?.trim();
  if (!text || text === '—') return;
  const ok = await copyText(text);
  if (ok) tg.showAlert('Скопировано');
});
document.getElementById('wallet-go-profile')?.addEventListener('click', () => showScreen('profile'));
document.getElementById('open-withdraw')?.addEventListener('click', () => showScreen('withdraw'));
document.getElementById('open-convert')?.addEventListener('click', () => {
  showScreen('trade');
  setTradeProduct('convert');
});
document.getElementById('open-earn')?.addEventListener('click', () => showScreen('earn'));
document.getElementById('open-earn-promo')?.addEventListener('click', () => showScreen('earn'));
document.getElementById('wallet-card-banner')?.addEventListener('click', () => showScreen('card'));

document.querySelectorAll('.assets-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.assets-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.assetsTab;
    document.getElementById('assets-tab-asset')?.classList.toggle('screen-hidden', tab !== 'asset');
    document.getElementById('assets-tab-account')?.classList.toggle('screen-hidden', tab !== 'account');
  });
});

let balanceHidden = localStorage.getItem('byx_hide_bal') === '1';
let lastWalletBalance = 0;
let lastEarnBalance = 0;
let lastBtcPrice = 77420;
let lastQuotes = [];
let assetChange24h = { USDT: 0 };
let convertOptions = null;
let earnProducts = [];
let selectedEarnProduct = null;

function maskBal(text) {
  return balanceHidden ? '******' : text;
}

function applyBalanceVisibility() {
  const open = document.getElementById('eye-open');
  const closed = document.getElementById('eye-closed');
  open?.classList.toggle('screen-hidden', balanceHidden);
  closed?.classList.toggle('screen-hidden', !balanceHidden);
  renderWalletAmounts(lastWalletBalance, lastEarnBalance);
}

function renderWalletAmounts(available, earn) {
  lastWalletBalance = Number(available) || 0;
  lastEarnBalance = Number(earn) || 0;
  const bals = typeof getBalancesMap === 'function' ? getBalancesMap() : { USDT: lastWalletBalance };
  bals.USDT = lastWalletBalance;

  let cryptoUsd = 0;
  let assets = [{ id: 'USDT' }];
  try { if (CONVERT_ASSETS) assets = CONVERT_ASSETS; } catch { /* not ready */ }
  const prices = typeof assetPrices !== 'undefined' ? assetPrices : { USDT: 1 };
  for (const a of assets) {
    if (a.id === 'USDT') continue;
    const amt = Number(bals[a.id]) || 0;
    const px = Number(prices[a.id]) || 0;
    cryptoUsd += amt * px;
  }
  const total = lastWalletBalance + lastEarnBalance + cryptoUsd;
  const usdTotal = fmtUsdt(total);
  try {
    const alphaBal = document.getElementById('alpha-bal');
    if (alphaBal) alphaBal.textContent = maskBal('0.00 USD');
    document.querySelectorAll('.alpha-eye-open').forEach((el) => el.classList.toggle('screen-hidden', balanceHidden));
    document.querySelectorAll('.alpha-eye-closed').forEach((el) => el.classList.toggle('screen-hidden', !balanceHidden));
  } catch { /* alpha pane may be absent */ }
  const usdAvail = fmtUsdt(lastWalletBalance + cryptoUsd);
  const usdEarn = fmtUsdt(lastEarnBalance);
  const btc = lastBtcPrice > 0 ? (total / lastBtcPrice) : 0;
  const btcStr = btc.toFixed(8);
  const idleBase = lastWalletBalance + lastEarnBalance + cryptoUsd;
  const idlePct = idleBase > 0
    ? Math.max(0, Math.min(100, Math.round(((lastWalletBalance + cryptoUsd) / idleBase) * 100)))
    : 100;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('wallet-balance', maskBal(usdTotal));
  set('wallet-available', maskBal(fmtMoneyFiat(lastWalletBalance + cryptoUsd)));
  set('wallet-in-use', maskBal(fmtMoneyFiat(lastEarnBalance)));
  set('wallet-btc', balanceHidden ? '≈ **** BTC' : `≈ ${btcStr} BTC`);

  const list = document.getElementById('assets-coin-list');
  let assetRows = null;
  try { assetRows = CONVERT_ASSETS; } catch { assetRows = null; }
  if (list && assetRows) {
    const rows = assetRows.map((a) => {
      const amt = Number(bals[a.id]) || 0;
      if (a.id !== 'USDT' && amt <= 0) return '';
      const px = a.id === 'USDT' ? 1 : (Number(prices[a.id]) || 0);
      const fiat = amt * px;
      const amtStr = typeof fmtAssetAmt === 'function' ? fmtAssetAmt(a.id, amt) : fmtUsdt(amt, 4);
      const ch = a.id === 'USDT' ? 0 : (Number(assetChange24h[a.id]) || 0);
      const prevFiat = ch <= -99.999 ? fiat : fiat / (1 + ch / 100);
      const dFiat = fiat - prevFiat;
      const chgUp = dFiat >= 0;
      const chgTxt = a.id === 'USDT'
        ? '0.00 (0.00%)'
        : `${chgUp ? '+' : ''}${fmtUsdt(dFiat, 2)} (${chgUp ? '+' : ''}${ch.toFixed(2)}%)`;
      return `
          <button type="button" class="assets-coin-row" data-asset-open="${a.id}">
            <div class="assets-coin-left">
              <img class="assets-coin-logo" src="${coinSrc(a.id)}" alt="${a.id}" width="36" height="36">
              <div>
                <div class="assets-coin-sym">${a.id}</div>
                <div class="assets-coin-chg ${chgUp ? 'chg-up' : 'chg-down'}">${maskBal(chgTxt)}</div>
              </div>
            </div>
            <div class="assets-coin-right">
              <div class="mono assets-coin-amt">${maskBal(amtStr)}</div>
              <div class="muted assets-coin-fiat">${maskBal(fmtMoneyFiat(fiat))}</div>
            </div>
          </button>`;
    }).join('');
    list.innerHTML = rows || '';
    list.querySelectorAll('[data-asset-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.assetOpen;
        if (id === 'USDT') {
          convertFromAsset = 'USDT';
          convertToAsset = 'BTC';
        } else {
          convertFromAsset = 'USDT';
          convertToAsset = id;
        }
        showScreen('convert');
      });
    });
  }

  const earnAmt = document.getElementById('wallet-earn-amt');
  const earnFiat = document.getElementById('wallet-earn-fiat');
  const earnRow = document.getElementById('assets-earn-row');
  if (earnRow) earnRow.classList.toggle('screen-hidden', lastEarnBalance <= 0);
  if (earnAmt) earnAmt.textContent = maskBal(fmtUsdt(lastEarnBalance, 4));
  if (earnFiat) earnFiat.textContent = maskBal(`${usdEarn} USD`);

  const promo = document.querySelector('#open-earn-promo .assets-promo-text');
  if (promo) {
    if (idleBase <= 0) {
      promo.textContent = '100% ваших активов не работают. Начните зарабатывать.';
    } else if (idlePct <= 0) {
      promo.textContent = 'Ваши активы работают. Отлично!';
    } else if (idlePct >= 100) {
      promo.textContent = '100% ваших активов не работают. Начните зарабатывать.';
    } else {
      promo.textContent = `${idlePct}% ваших активов не работают. Начните зарабатывать.`;
    }
  }

  let pnlUsd = 0;
  for (const a of assets) {
    if (a.id === 'USDT') continue;
    const amt = Number(bals[a.id]) || 0;
    const px = Number(prices[a.id]) || 0;
    const now = amt * px;
    const ch = Number(assetChange24h[a.id]) || 0;
    const prev = ch <= -99.999 ? now : now / (1 + ch / 100);
    pnlUsd += now - prev;
  }
  const pnlPctBase = total - pnlUsd;
  const pnlPct = pnlPctBase > 1e-9 ? (pnlUsd / pnlPctBase) * 100 : 0;
  const pnlUp = pnlUsd >= 0;
  const pnl = document.querySelector('#wallet-pnl .pnl-val');
  if (pnl) {
    pnl.textContent = balanceHidden
      ? '****'
      : `${pnlUp ? '+' : ''}${fmtUsdt(pnlUsd, 2)} USD (${pnlUp ? '+' : ''}${pnlPct.toFixed(2)}%)`;
    pnl.classList.toggle('chg-up', pnlUp);
    pnl.classList.toggle('chg-down', !pnlUp);
  }
  const sparkLine = document.querySelector('.spark-line');
  const sparkFill = document.querySelector('#sparkGrad stop');
  if (sparkLine) sparkLine.setAttribute('stroke', pnlUp ? '#0ecb81' : '#f6465d');
  if (sparkFill) sparkFill.setAttribute('stop-color', pnlUp ? '#0ecb81' : '#f6465d');
}

function formatCardMask(num) {
  if (!num) return 'Подать заявку';
  const digits = String(num).replace(/\D/g, '');
  const tail = digits.slice(-4) || '----';
  return `**** **** **** ${tail}`;
}

function renderCardBanner(me) {
  const mask = document.getElementById('wallet-card-mask');
  const label = document.getElementById('wallet-card-label');
  if (!mask) return;
  if (me.cardNumber) {
    mask.textContent = formatCardMask(me.cardNumber);
    if (label) label.innerHTML = 'Моя карта <span>›</span>';
  } else if (me.cardRequestStatus === 'pending') {
    mask.textContent = 'На рассмотрении';
    if (label) label.innerHTML = 'Моя карта <span>›</span>';
  } else {
    mask.textContent = 'Подать заявку';
    if (label) label.innerHTML = 'Моя карта <span>›</span>';
  }
}

function renderCardScreen() {
  const me = profile || {};
  const none = document.getElementById('card-panel-none');
  const pending = document.getElementById('card-panel-pending');
  const ready = document.getElementById('card-panel-ready');
  [none, pending, ready].forEach((el) => el?.classList.add('screen-hidden'));
  if (me.cardNumber) {
    ready?.classList.remove('screen-hidden');
    const digits = String(me.cardNumber).replace(/\D/g, '');
    const pretty = digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    document.getElementById('card-number-display').textContent = pretty;
  } else if (me.cardRequestStatus === 'pending') {
    pending?.classList.remove('screen-hidden');
  } else {
    none?.classList.remove('screen-hidden');
  }
}

document.getElementById('toggle-balance-eye')?.addEventListener('click', () => {
  balanceHidden = !balanceHidden;
  localStorage.setItem('byx_hide_bal', balanceHidden ? '1' : '0');
  applyBalanceVisibility();
});

document.getElementById('card-request-btn')?.addEventListener('click', async () => {
  try {
    const res = await apiFetch('/finance/card-request', { method: 'POST', body: JSON.stringify({}) });
    if (profile) {
      profile.cardNumber = res.cardNumber;
      profile.cardRequestStatus = res.cardRequestStatus;
    }
    renderCardBanner(profile || res);
    renderCardScreen();
    tg.showAlert(res.cardNumber
      ? 'Карта уже оформлена'
      : 'Заявка отправлена на рассмотрение. После решения вы получите уведомление.');
  } catch (e) {
    tg.showAlert(e.message);
  }
});

document.getElementById('copy-card-btn')?.addEventListener('click', async () => {
  const num = profile?.cardNumber;
  if (!num) return;
  try {
    await navigator.clipboard.writeText(String(num));
    tg.showAlert('Номер скопирован');
  } catch {
    tg.showAlert(String(num));
  }
});

function prepareWithdrawScreen() {
  const bal = profile ? fmtUsdt(profile.usdtBalance) : '0.00';
  document.getElementById('withdraw-hint-onchain').textContent = `Доступно: ${bal} USDT`;
  document.getElementById('withdraw-hint-card').textContent = `Доступно: ${bal} USDT`;
  const info = document.getElementById('withdraw-card-info');
  if (profile?.cardNumber) {
    info.textContent = `Вывод на карту ${formatCardMask(profile.cardNumber)}`;
  } else if (profile?.cardRequestStatus === 'pending') {
    info.textContent = 'Карта на рассмотрении. Дождитесь выдачи или оформите заявку в «Моя карта».';
  } else {
    info.textContent = 'Сначала оформите карту: Активы → Моя карта.';
  }
}

document.querySelectorAll('#withdraw-method-seg [data-wd-method]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#withdraw-method-seg .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const method = btn.dataset.wdMethod;
    document.getElementById('withdraw-onchain-panel').classList.toggle('screen-hidden', method !== 'onchain');
    document.getElementById('withdraw-card-panel').classList.toggle('screen-hidden', method !== 'card');
  });
});

async function submitWithdraw(method) {
  const amountEl = method === 'onchain'
    ? document.getElementById('withdraw-amount-onchain')
    : document.getElementById('withdraw-amount-card');
  const errEl = method === 'onchain'
    ? document.getElementById('withdraw-error-onchain')
    : document.getElementById('withdraw-error-card');
  errEl.textContent = '';
  const body = {
    method,
    amount: parseQty(amountEl.value),
  };
  if (method === 'onchain') {
    body.network = document.getElementById('withdraw-network').value;
    body.address = document.getElementById('withdraw-address').value.trim();
  }
  try {
    await apiFetch('/finance/withdraw', { method: 'POST', body: JSON.stringify(body) });
    amountEl.value = '';
    if (method === 'onchain') document.getElementById('withdraw-address').value = '';
    tg.showAlert('Заявка принята. Средства будут выведены после проверки и одобрения системой.');
    showScreen('wallet');
  } catch (e) {
    errEl.textContent = e.message;
  }
}

document.getElementById('withdraw-submit-onchain')?.addEventListener('click', () => submitWithdraw('onchain'));
document.getElementById('withdraw-submit-card')?.addEventListener('click', () => submitWithdraw('card'));

const CONVERT_ASSETS = [
  { id: 'USDT', name: 'Tether', icon: '/img/usdt.svg?v=2' },
  { id: 'BTC', name: 'Bitcoin', icon: '/img/btc.svg?v=1' },
  { id: 'ETH', name: 'Ethereum', icon: '/img/eth.svg?v=1' },
  { id: 'BNB', name: 'BNB', icon: '/img/bnb.svg?v=1' },
  { id: 'SOL', name: 'Solana', icon: '/img/sol.svg?v=1' },
  { id: 'XRP', name: 'XRP', icon: '/img/xrp.svg?v=1' },
  { id: 'DOGE', name: 'Dogecoin', icon: '/img/doge.svg?v=1' },
  { id: 'ADA', name: 'Cardano', icon: '/img/ada.svg?v=1' },
  { id: 'TON', name: 'Toncoin', icon: '/img/ton.svg?v=1' },
  { id: 'AVAX', name: 'Avalanche', icon: '/img/avax.svg?v=1' },
  { id: 'LINK', name: 'Chainlink', icon: '/img/link.svg?v=1' },
  { id: 'TRX', name: 'TRON', icon: '/img/trx.svg?v=1' },
];

let convertFromAsset = 'USDT';
let convertToAsset = 'BTC';
let convertPickSide = 'to';
let assetPrices = { USDT: 1 };

function convertAssetMeta(id) {
  return CONVERT_ASSETS.find((a) => a.id === id) || CONVERT_ASSETS[0];
}

const ICO_CHEV = '<svg class="ico-chev" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M7.41 9.84 12 14.42l4.59-4.58L18 11.25l-6 6-6-6z"/></svg>';
const ICO_SWAP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 8h11.5M15.5 5.5 18.5 8 15.5 10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 16H5.5M8.5 13.5 5.5 16 8.5 18.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function coinTicker(symbol) {
  let s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT') && s !== 'USDT') s = s.slice(0, -4);
  return s || 'USDT';
}

function coinSrc(symbol) {
  return `/api/market/icon/${coinTicker(symbol)}`;
}

function coinLogoHtml(symbol, size = 32, image) {
  const id = coinTicker(symbol);
  const q = image ? `?img=${encodeURIComponent(image)}` : '';
  const src = `/api/market/icon/${encodeURIComponent(id)}${q}`;
  const fb = `/api/market/icon/${encodeURIComponent(id)}`;
  return `<img class="coin-logo quote-logo" src="${src}" alt="${id}" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${fb}';}else{this.onerror=null;}">`;
}

function farmPairHtml(f, size = 32) {
  const a = coinLogoHtml(f.aId || f.a || 'SPCX', Math.round(size * 0.72), f.logoA);
  const b = coinLogoHtml('USDC', Math.round(size * 0.72));
  return `<span class="alpha-pair-ico" style="width:${size}px;height:${size}px">${a}${b}</span>`;
}

function coinIconHtml(a, size = 22) {
  return coinLogoHtml(a.id || a, size);
}

function getBalancesMap() {
  const b = { ...(profile?.balances || {}) };
  if (b.USDT == null) b.USDT = Number(profile?.usdtBalance) || 0;
  for (const a of CONVERT_ASSETS) {
    if (b[a.id] == null) b[a.id] = 0;
  }
  return b;
}

function fmtAssetAmt(asset, n) {
  const x = Number(n) || 0;
  if (asset === 'USDT') return fmtUsdt(x, 4);
  if (asset === 'BTC') return x.toFixed(8).replace(/\.?0+$/, '') || '0';
  return x.toFixed(6).replace(/\.?0+$/, '') || '0';
}

function quoteIconFor(id, fallback) {
  return coinSrc(id) || fallback;
}

function setConvertFromAsset(id) {
  if (id === convertToAsset || id === cvTo) {
    convertToAsset = convertFromAsset;
    cvTo = convertFromAsset;
  }
  convertFromAsset = id;
  cvFrom = id;
  const meta = convertAssetMeta(id);
  const fromVal = document.getElementById('convert-from-asset');
  if (fromVal) fromVal.value = id;
  const fromLab = document.getElementById('convert-from-label');
  if (fromLab) fromLab.textContent = id;
  const ico = document.getElementById('convert-from-icon');
  if (ico) { ico.src = quoteIconFor(id, meta.icon); ico.alt = id; }
  const hint = document.getElementById('convert-hint');
  if (hint) hint.textContent = fmtAssetAmt(id, getBalancesMap()[id] || 0);
  setConvertToAsset(convertToAsset, false);
  updateConvertEstimate();
  if (typeof refreshConvertPane === 'function') refreshConvertPane();
}

function setConvertToAsset(id, closeSheet = true) {
  if (id === convertFromAsset || id === cvFrom) {
    const alt = CONVERT_ASSETS.find((a) => a.id !== id);
    id = alt ? alt.id : id;
  }
  convertToAsset = id;
  cvTo = id;
  const meta = convertAssetMeta(id);
  const hid = document.getElementById('convert-asset');
  if (hid) hid.value = id;
  const lab = document.getElementById('convert-to-label');
  if (lab) lab.textContent = id;
  const ico = document.getElementById('convert-to-icon');
  if (ico) { ico.src = quoteIconFor(id, meta.icon); ico.alt = id; }
  if (closeSheet) document.getElementById('convert-asset-sheet')?.classList.add('screen-hidden');
  updateConvertEstimate();
  if (typeof refreshConvertPane === 'function') refreshConvertPane();
}

function openConvertAssetSheet(side) {
  convertPickSide = side;
  const current = side === 'from' ? (cvFrom || convertFromAsset) : (cvTo || convertToAsset);
  const title = document.getElementById('convert-sheet-title');
  if (title) title.textContent = side === 'from' ? 'Списать с' : 'Получить';
  const list = document.getElementById('convert-asset-list');
  if (!list) return;
  const bals = getBalancesMap();
  list.innerHTML = CONVERT_ASSETS.map((a) => `
    <button type="button" class="sheet-item ${a.id === current ? 'active' : ''}" data-pick="${a.id}">
      ${coinIconHtml(a, 28)}
      <span style="flex:1">
        <div class="sheet-item-title">${a.id}</div>
        <div class="muted" style="font-size:12px">${escapeHtml(a.name)}</div>
      </span>
      <span class="mono muted" style="font-size:12px">${fmtAssetAmt(a.id, bals[a.id] || 0)}</span>
    </button>
  `).join('');
  list.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (convertPickSide === 'from') setConvertFromAsset(btn.dataset.pick);
      else setConvertToAsset(btn.dataset.pick);
      document.getElementById('convert-asset-sheet')?.classList.add('screen-hidden');
    });
  });
  document.getElementById('convert-asset-sheet')?.classList.remove('screen-hidden');
}

function openConvertAssetSheet(side) {
  convertPickSide = side;
  const current = side === 'from' ? convertFromAsset : convertToAsset;
  document.getElementById('convert-sheet-title').textContent =
    side === 'from' ? 'Списать с' : 'Получить';
  const list = document.getElementById('convert-asset-list');
  const bals = getBalancesMap();
  list.innerHTML = CONVERT_ASSETS.map((a) => `
    <button type="button" class="sheet-item ${a.id === current ? 'active' : ''}" data-pick="${a.id}">
      ${coinIconHtml(a, 28)}
      <span style="flex:1">
        <div class="sheet-item-title">${a.id}</div>
        <div class="muted" style="font-size:12px">${escapeHtml(a.name)}</div>
      </span>
      <span class="mono muted" style="font-size:12px">${fmtAssetAmt(a.id, bals[a.id] || 0)}</span>
    </button>
  `).join('');
  list.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (convertPickSide === 'from') setConvertFromAsset(btn.dataset.pick);
      else setConvertToAsset(btn.dataset.pick);
      document.getElementById('convert-asset-sheet')?.classList.add('screen-hidden');
    });
  });
  document.getElementById('convert-asset-sheet').classList.remove('screen-hidden');
}

function prepareConvertScreen() {
  setConvertFromAsset(convertFromAsset || 'USDT');
  setConvertToAsset(convertToAsset || 'BTC', false);
  updateConvertEstimate();
}

async function loadAssetPrices() {
  try {
    const r = await fetch('/api/market/quotes');
    const quotes = await r.json().catch(() => []);
    applyMarketQuotes(quotes);
  } catch { /* keep previous */ }
  if (!assetPrices.BTC) assetPrices.BTC = lastBtcPrice || 95000;
}

function applyMarketQuotes(quotes) {
  if (!Array.isArray(quotes)) return;
  lastQuotes = quotes;
  assetPrices = { ...(assetPrices || {}), USDT: 1 };
  assetChange24h = { USDT: 0 };
  for (const q of quotes) {
    const sym = String(q.symbol || '').toUpperCase();
    const px = Number(q.price);
    if (Number.isFinite(px) && px > 0) assetPrices[sym] = px;
    const ch = Number(q.change24h);
    if (Number.isFinite(ch)) assetChange24h[sym] = ch;
  }
  if (assetPrices.BTC) lastBtcPrice = assetPrices.BTC;
  if (profile) applyBalanceVisibility();
}

function estimateConvertOut(amount, from, to) {
  const fromPx = assetPrices[from] || 0;
  const toPx = assetPrices[to] || 0;
  if (!fromPx || !toPx) return null;
  return (amount * fromPx) / toPx;
}

async function updateConvertEstimate() {
  const el = document.getElementById('convert-estimate');
  const out = document.getElementById('convert-out');
  if (!el) return;
  const amount = parseQty(document.getElementById('convert-amount')?.value);
  const from = convertFromAsset || 'USDT';
  const to = convertToAsset || 'BTC';
  if (!Number.isFinite(amount) || amount <= 0) {
    el.textContent = 'Ориентировочный курс появится после ввода суммы';
    if (out) out.textContent = '—';
    return;
  }
  if (!assetPrices[from] || !assetPrices[to]) await loadAssetPrices();
  const got = estimateConvertOut(amount, from, to);
  if (got == null) {
    el.textContent = 'Курс временно недоступен';
    if (out) out.textContent = '—';
    return;
  }
  const text = fmtAssetAmt(to, got);
  el.textContent = `≈ ${fmtAssetAmt(from, amount)} ${from} → ${text} ${to}`;
  if (out) out.textContent = text;
}

document.getElementById('convert-from-pick')?.addEventListener('click', () => openConvertAssetSheet('from'));
document.getElementById('convert-to-pick')?.addEventListener('click', () => openConvertAssetSheet('to'));
document.getElementById('convert-sheet-close')?.addEventListener('click', () => {
  document.getElementById('convert-asset-sheet')?.classList.add('screen-hidden');
});
document.getElementById('convert-amount')?.addEventListener('input', updateConvertEstimate);
document.getElementById('convert-max')?.addEventListener('click', () => {
  const bals = getBalancesMap();
  const from = convertFromAsset || 'USDT';
  document.getElementById('convert-amount').value = String(Number(bals[from]) || 0);
  updateConvertEstimate();
});
document.getElementById('convert-bal-link')?.addEventListener('click', () => {
  document.getElementById('convert-max')?.click();
});
document.getElementById('convert-swap')?.addEventListener('click', () => {
  const a = convertFromAsset;
  const b = convertToAsset;
  convertFromAsset = b;
  convertToAsset = a;
  setConvertFromAsset(convertFromAsset);
});

document.getElementById('convert-submit')?.addEventListener('click', async () => {
  const err = document.getElementById('convert-error');
  err.textContent = '';
  if (profile?.conversionsDisabled) {
    err.textContent = profile.convertLockReason || profile.copy?.conversionsDisabled || COPY.conversionsDisabled;
    return;
  }
  try {
    const res = await apiFetch('/finance/convert', {
      method: 'POST',
      body: JSON.stringify({
        amount: parseQty(document.getElementById('convert-amount').value),
        fromAsset: document.getElementById('convert-from-asset').value,
        toAsset: document.getElementById('convert-asset').value,
      }),
    });
    if (res.balances) profile.balances = res.balances;
    if (res.usdtBalance != null) profile.usdtBalance = res.usdtBalance;
    lastWalletBalance = Number(res.usdtBalance ?? profile.usdtBalance) || 0;
    applyBalanceVisibility();
    document.getElementById('convert-amount').value = '';
    tg.showAlert('Готово. Средства зачислены на баланс — можете конвертировать обратно.');
    showScreen('wallet');
  } catch (e) {
    err.textContent = e.message;
  }
});

async function prepareEarnScreen() {
  const bal = profile ? fmtUsdt(profile.usdtBalance) : '0.00';
  document.getElementById('earn-hint').textContent = `Доступно: ${bal} USDT`;
  document.getElementById('earn-form')?.classList.add('screen-hidden');
  selectedEarnProduct = null;
  try {
    earnProducts = await apiFetch('/finance/earn/products');
  } catch {
    earnProducts = [];
  }
  const box = document.getElementById('earn-products');
  box.innerHTML = earnProducts.map((p) => `
    <button type="button" class="earn-card" data-earn="${escapeHtml(p.id)}">
      <div class="earn-card-top">
        <span class="earn-card-title">${escapeHtml(p.title)}</span>
        <span class="earn-card-apy">${escapeHtml(p.apy)} APY</span>
      </div>
      <div class="earn-card-desc">${escapeHtml(p.desc)}</div>
    </button>
  `).join('') || '<div class="muted">Продукты временно недоступны</div>';

  box.querySelectorAll('[data-earn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      box.querySelectorAll('.earn-card').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      selectedEarnProduct = earnProducts.find((p) => p.id === btn.dataset.earn);
      const form = document.getElementById('earn-form');
      form.classList.remove('screen-hidden');
      document.getElementById('earn-form-title').textContent =
        selectedEarnProduct ? `${selectedEarnProduct.title} · ${selectedEarnProduct.apy}` : 'Подписка';
    });
  });
}

document.getElementById('earn-submit')?.addEventListener('click', async () => {
  const err = document.getElementById('earn-error');
  err.textContent = '';
  if (!selectedEarnProduct) {
    err.textContent = 'выберите продукт';
    return;
  }
  try {
    const res = await apiFetch('/finance/earn', {
      method: 'POST',
      body: JSON.stringify({
        productId: selectedEarnProduct.id,
        amount: parseQty(document.getElementById('earn-amount').value),
      }),
    });
    document.getElementById('earn-amount').value = '';
    if (profile) {
      if (res.usdtBalance != null) profile.usdtBalance = res.usdtBalance;
      if (res.earnBalance != null) profile.earnBalance = res.earnBalance;
    }
    lastWalletBalance = Number(res.usdtBalance ?? profile?.usdtBalance) || 0;
    lastEarnBalance = Number(res.earnBalance ?? profile?.earnBalance) || 0;
    applyBalanceVisibility();
    tg.showAlert('Средства направлены в Earn. Статус заявки — на проверке.');
    showScreen('wallet');
  } catch (e) {
    err.textContent = e.message;
  }
});

document.getElementById('open-support').addEventListener('click', () => showScreen('support'));
document.getElementById('open-notif')?.addEventListener('click', () => showScreen('notif'));
document.querySelectorAll('[data-notif]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.notif;
    const key = `notif${k[0].toUpperCase()}${k.slice(1)}`;
    prefs[key] = prefs[key] === false;
    savePrefs();
    applyPrefs();
  });
});
document.getElementById('open-edit-profile').addEventListener('click', () => showScreen('edit-profile'));
document.getElementById('open-kyc').addEventListener('click', () => showScreen('kyc'));
document.getElementById('uc-nick-row')?.addEventListener('click', () => {
  fillEditForm();
  showScreen('edit-profile');
});
document.getElementById('uc-phone-row')?.addEventListener('click', () => {
  fillEditForm();
  showScreen('edit-profile');
});
document.getElementById('open-withdraw-from-profile')?.addEventListener('click', () => showScreen('withdraw'));
document.getElementById('uc-copy-uid')?.addEventListener('click', async () => {
  const uid = profile?.uid || document.getElementById('profile-uid')?.textContent;
  if (!uid) return;
  try { await navigator.clipboard.writeText(String(uid)); tg.showAlert('UID скопирован'); }
  catch { tg.showAlert(String(uid)); }
});
document.getElementById('uc-personal-toggle')?.addEventListener('click', () => {
  window.__ucShowPersonal = !window.__ucShowPersonal;
  document.getElementById('uc-personal')?.classList.toggle('screen-hidden', !window.__ucShowPersonal);
  document.getElementById('uc-eye-ico').textContent = window.__ucShowPersonal ? '🙈' : '👁';
  if (profile) renderProfile(profile);
});
document.querySelectorAll('#uc-tabs .uc-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#uc-tabs .uc-tab').forEach((b) => b.classList.toggle('active', b === btn));
    const id = btn.dataset.uc;
    ['data', 'security', 'params', 'general'].forEach((p) => {
      document.getElementById(`uc-pane-${p}`)?.classList.toggle('screen-hidden', p !== id);
    });
  });
});
document.getElementById('uc-email-row')?.addEventListener('click', () => {
  document.getElementById('uc-email-verify')?.classList.toggle('screen-hidden');
});
document.getElementById('uc-pwd-row')?.addEventListener('click', () => {
  document.getElementById('uc-pwd-form')?.classList.toggle('screen-hidden');
  document.getElementById('uc-pwd-totp-wrap')?.classList.toggle('screen-hidden', !profile?.totpEnabled);
});
document.getElementById('uc-email-send')?.addEventListener('click', async () => {
  const err = document.getElementById('uc-email-error');
  err.textContent = '';
  try {
    await apiFetch('/users/me/email/send', { method: 'POST' });
    tg.showAlert('Код отправлен на почту');
  } catch (e) { err.textContent = e.message; }
});
document.getElementById('uc-email-confirm')?.addEventListener('click', async () => {
  const err = document.getElementById('uc-email-error');
  err.textContent = '';
  try {
    const me = await apiFetch('/users/me/email/confirm', {
      method: 'POST',
      body: JSON.stringify({ code: document.getElementById('uc-email-code').value.trim() }),
    });
    profile = { ...profile, ...me };
    renderProfile(profile);
    tg.showAlert('Почта подтверждена');
  } catch (e) { err.textContent = e.message; }
});
document.getElementById('uc-pwd-save')?.addEventListener('click', async () => {
  const err = document.getElementById('uc-pwd-error');
  err.textContent = '';
  const next = document.getElementById('uc-pwd-new').value;
  if (next !== document.getElementById('uc-pwd-new2').value) {
    err.textContent = 'Пароли не совпадают';
    return;
  }
  try {
    await apiFetch('/users/me/password', {
      method: 'POST',
      body: JSON.stringify({
        current: document.getElementById('uc-pwd-cur').value,
        next,
        totpCode: document.getElementById('uc-pwd-totp')?.value.trim() || '',
      }),
    });
    document.getElementById('uc-pwd-form').classList.add('screen-hidden');
    tg.showAlert('Пароль изменён. Выводы ограничены на 24 часа.');
  } catch (e) { err.textContent = e.message; }
});
async function saveAntiPhish() {
  const code = window.prompt('Код защиты от фишинга (4–16 символов)', profile?.antiPhishCode || '');
  if (code == null) return;
  try {
    const me = await apiFetch('/users/me/antiphish', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    profile = { ...profile, ...me };
    renderProfile(profile);
    tg.showAlert('Код сохранён');
  } catch (e) { tg.showAlert(e.message); }
}
document.getElementById('uc-antiphish-btn')?.addEventListener('click', saveAntiPhish);
document.getElementById('uc-antiphish-row')?.addEventListener('click', saveAntiPhish);
document.getElementById('uc-lang-btn')?.addEventListener('click', () => {
  cyclePref('lang', ['ru', 'en']);
});
document.getElementById('uc-lang-row')?.addEventListener('click', () => {
  cyclePref('lang', ['ru', 'en']);
});
document.getElementById('uc-fiat-row')?.addEventListener('click', () => {
  cyclePref('fiat', ['USD', 'EUR', 'RUB']);
});
document.getElementById('assets-ccy-label')?.addEventListener('click', () => {
  cyclePref('fiat', ['USD', 'EUR', 'RUB']);
});
document.getElementById('uc-theme-row')?.addEventListener('click', () => {
  cyclePref('theme', ['dark', 'light']);
});
document.getElementById('uc-tz-row')?.addEventListener('click', () => {
  cyclePref('tz', TZ_LIST.map((z) => z.id));
});
document.getElementById('uc-totp-toggle')?.addEventListener('click', () => {
  if (profile?.totpEnabled) {
    document.getElementById('totp-off-wrap')?.classList.remove('screen-hidden');
    document.getElementById('totp-disable-code')?.focus();
  } else {
    document.getElementById('totp-start-btn')?.click();
  }
});

let pendingAvatarId = '00';
function openAvatarPicker() {
  pendingAvatarId = String(profile?.avatarId || '00').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const grid = document.getElementById('avatar-grid');
  const name = profile?.displayName || 'U';
  const initials = String(name).replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '').slice(0, 2).toUpperCase() || 'U';
  const cells = [`<button type="button" data-av="00" class="${pendingAvatarId === '00' ? 'active' : ''}"><span class="uc-initials">${initials}</span></button>`];
  for (let i = 1; i <= 8; i++) {
    const id = String(i).padStart(2, '0');
    cells.push(`<button type="button" data-av="${id}" class="${id === pendingAvatarId ? 'active' : ''}"><img src="${avatarUrl(id)}" alt=""></button>`);
  }
  grid.innerHTML = cells.join('');
  grid.querySelectorAll('[data-av]').forEach((b) => {
    b.addEventListener('click', () => {
      pendingAvatarId = b.dataset.av;
      grid.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      document.getElementById('avatar-picker-preview').src = avatarUrl(pendingAvatarId);
    });
  });
  document.getElementById('avatar-picker-preview').src = avatarUrl(pendingAvatarId);
  document.getElementById('avatar-picker').classList.remove('screen-hidden');
}
document.getElementById('open-avatar-picker')?.addEventListener('click', openAvatarPicker);
document.getElementById('open-avatar-picker-row')?.addEventListener('click', openAvatarPicker);
document.getElementById('avatar-picker-close')?.addEventListener('click', () => {
  document.getElementById('avatar-picker').classList.add('screen-hidden');
});
document.getElementById('avatar-picker-save')?.addEventListener('click', async () => {
  try {
    const me = await apiFetch('/users/me/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatarId: pendingAvatarId }),
    });
    profile = { ...profile, ...me };
    renderProfile(profile);
    document.getElementById('avatar-picker').classList.add('screen-hidden');
  } catch (e) { tg.showAlert(e.message); }
});

document.getElementById('home-go-deposit')?.addEventListener('click', () => showScreen('deposit'));
document.getElementById('home-go-wallet')?.addEventListener('click', () => showScreen('wallet'));
document.getElementById('home-q-deposit')?.addEventListener('click', () => showScreen('deposit'));
document.getElementById('home-q-transfer')?.addEventListener('click', () => showScreen('transfer'));
document.getElementById('home-q-markets')?.addEventListener('click', () => showScreen('tickers'));
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
let regContactKind = 'email'; // email | phone
let regContactValue = '';

function parseContact(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (v.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: 'Некорректный email' };
    return { kind: 'email', value: v.toLowerCase() };
  }
  const digits = v.replace(/[^\d+]/g, '');
  const onlyDigits = digits.replace(/\D/g, '');
  if (onlyDigits.length < 8) return { error: 'Укажите номер телефона или email' };
  return { kind: 'phone', value: digits.startsWith('+') ? digits : `+${onlyDigits}` };
}

function geo() {
  return window.GEO || null;
}

function setCountryFields(prefix, country) {
  if (!country) return;
  const btn = document.getElementById(`${prefix}-country-btn`);
  const nameEl = document.getElementById(`${prefix}-country`);
  const isoEl = document.getElementById(`${prefix}-country-iso`);
  const dialEl = document.getElementById(`${prefix}-phone-dial`);
  const natEl = document.getElementById(`${prefix}-phone-national`);
  if (btn) btn.textContent = geo()?.label(country) || country.name;
  if (nameEl) nameEl.value = country.name;
  if (isoEl) isoEl.value = country.iso;
  if (dialEl) dialEl.textContent = `+${country.dial}`;
  if (natEl) {
    natEl.maxLength = country.nsn[1];
    natEl.placeholder = '0'.repeat(country.nsn[0]);
  }
}

function currentCountry(prefix) {
  const g = geo();
  if (!g) return null;
  const iso = document.getElementById(`${prefix}-country-iso`)?.value;
  return g.byIso(iso) || g.byName(document.getElementById(`${prefix}-country`)?.value) || g.byIso('RU');
}

function readPhoneE164(prefix) {
  const g = geo();
  const c = currentCountry(prefix);
  const national = document.getElementById(`${prefix}-phone-national`)?.value || '';
  if (!g || !c) return { error: 'выберите страну' };
  return g.validateNational(c.iso, national);
}

function fillPhoneFromE164(prefix, phone, countryName) {
  const g = geo();
  if (!g) return;
  let c = g.byName(countryName) || g.byIso('RU');
  const parsed = g.parseE164(phone);
  if (parsed) c = parsed.country;
  setCountryFields(prefix, c);
  const nat = document.getElementById(`${prefix}-phone-national`);
  if (nat) nat.value = parsed ? parsed.national : g.digitsOnly(phone);
}

function renderCountrySheet(filter) {
  const g = geo();
  const list = document.getElementById('country-sheet-list');
  if (!g || !list) return;
  const q = String(filter || '').trim().toLowerCase();
  const rows = g.COUNTRIES.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q) || (`+${c.dial}`).includes(q)
  );
  list.innerHTML = rows.map((c) => `
    <button type="button" class="sheet-item" data-iso="${c.iso}">
      <span class="sheet-item-flag">${g.flag(c.iso)}</span>
      <span class="sheet-item-title">${escapeHtml(c.name)}</span>
      <span class="sheet-item-meta">+${c.dial}</span>
    </button>
  `).join('');
  list.querySelectorAll('[data-iso]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = g.byIso(btn.dataset.iso);
      if (c && window.__countryPickPrefix) setCountryFields(window.__countryPickPrefix, c);
      document.getElementById('country-sheet')?.classList.add('screen-hidden');
    });
  });
}

function openCountrySheet(prefix) {
  window.__countryPickPrefix = prefix;
  const search = document.getElementById('country-sheet-search');
  if (search) search.value = '';
  renderCountrySheet('');
  document.getElementById('country-sheet')?.classList.remove('screen-hidden');
  setTimeout(() => search?.focus(), 50);
}

function bindPhoneNational(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    el.value = String(el.value || '').replace(/\D/g, '');
  });
}

function setRegStep(step) {
  document.getElementById('reg-step-1').classList.toggle('screen-hidden', step !== 1);
  document.getElementById('reg-step-2').classList.toggle('screen-hidden', step !== 2);
  document.getElementById('reg-title').textContent =
    step === 1 ? 'Зарегистрироваться' : 'Данные аккаунта';
  document.getElementById('reg-error-1').textContent = '';
  document.getElementById('reg-error').textContent = '';
}

function hideAuthSubScreens() {
  document.getElementById('auth-2fa')?.classList.add('screen-hidden');
  document.getElementById('auth-forgot')?.classList.add('screen-hidden');
  document.getElementById('auth-seccheck')?.classList.add('screen-hidden');
  document.getElementById('auth-reset')?.classList.add('screen-hidden');
}

function setAuthLight(on) {
  document.getElementById('auth-main-tabs')?.classList.toggle('screen-hidden', Boolean(on));
}

function setAuthTab(which) {
  const isReg = which === 'register';
  document.getElementById('tab-register').classList.toggle('active', isReg);
  document.getElementById('tab-login').classList.toggle('active', !isReg);
  document.getElementById('auth-register').classList.toggle('screen-hidden', !isReg);
  document.getElementById('auth-login').classList.toggle('screen-hidden', isReg);
  hideAuthSubScreens();
  document.getElementById('reg-error').textContent = '';
  document.getElementById('reg-error-1').textContent = '';
  document.getElementById('login-error').textContent = '';
  if (isReg) setRegStep(1);
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

function showAuthLoading(on) {
  document.getElementById('auth-loading').classList.toggle('screen-hidden', !on);
  document.getElementById('auth-forms').classList.toggle('screen-hidden', on);
  document.getElementById('auth-success').classList.add('screen-hidden');
}

function showAuthGate(mode = 'forms') {
  document.body.classList.add('auth-locked');
  document.getElementById('auth-gate').classList.remove('screen-hidden');
  document.getElementById('app-shell').classList.add('screen-hidden');
  document.getElementById('auth-loading').classList.add('screen-hidden');
  hideAuthSubScreens();
  const light = mode === 'forgot' || mode === 'seccheck' || mode === 'reset';
  setAuthLight(light);
  if (mode === 'success') {
    document.getElementById('auth-forms').classList.add('screen-hidden');
    document.getElementById('auth-success').classList.remove('screen-hidden');
  } else if (mode === 'loading') {
    showAuthLoading(true);
  } else if (mode === '2fa') {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    document.getElementById('auth-register').classList.add('screen-hidden');
    document.getElementById('auth-login').classList.add('screen-hidden');
    document.getElementById('auth-2fa')?.classList.remove('screen-hidden');
  } else if (mode === 'forgot') {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    document.getElementById('auth-register').classList.add('screen-hidden');
    document.getElementById('auth-login').classList.add('screen-hidden');
    document.getElementById('auth-forgot')?.classList.remove('screen-hidden');
  } else if (mode === 'seccheck') {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    document.getElementById('auth-register').classList.add('screen-hidden');
    document.getElementById('auth-login').classList.add('screen-hidden');
    document.getElementById('auth-seccheck')?.classList.remove('screen-hidden');
  } else if (mode === 'reset') {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    document.getElementById('auth-register').classList.add('screen-hidden');
    document.getElementById('auth-login').classList.add('screen-hidden');
    document.getElementById('auth-reset')?.classList.remove('screen-hidden');
  } else {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    setAuthTab('login');
    setRegStep(1);
  }
}

function enterApp(me, { startScreen = 'markets' } = {}) {
  if (me?.sessionToken) setSessionToken(me.sessionToken);
  profile = me;
  renderProfile(me);
  applyPrefs();
  loadFx();
  document.body.classList.remove('auth-locked');
  document.getElementById('auth-gate').classList.add('screen-hidden');
  document.getElementById('app-shell').classList.remove('screen-hidden');
  showScreen(startScreen);
  if (!appReady) {
    appReady = true;
    loadQuotes().finally(() => { if (appReady) startQuotesLive(); });
    loadNews();
    newsTimer = setInterval(loadNews, 90 * 1000);
    profileTimer = setInterval(() => loadProfile().catch(() => {}), 12_000);
  }
}

document.getElementById('auth-enter-app').addEventListener('click', () => {
  if (profile) enterApp(profile);
});

document.getElementById('reg-next').addEventListener('click', () => {
  const errorEl = document.getElementById('reg-error-1');
  errorEl.textContent = '';
  if (!document.getElementById('reg-agree').checked) {
    errorEl.textContent = 'Примите условия обслуживания';
    return;
  }
  const parsed = parseContact(document.getElementById('reg-contact').value);
  if (!parsed || parsed.error) {
    errorEl.textContent = parsed?.error || 'Укажите email или телефон';
    return;
  }
  regContactKind = parsed.kind;
  regContactValue = parsed.value;

  const wrap = document.getElementById('reg-extra-wrap');
  const extraLabel = document.getElementById('reg-extra-label');
  const phoneRow = document.getElementById('reg-phone-row');
  const extraEmail = document.getElementById('reg-extra-email');
  wrap.classList.remove('screen-hidden');

  if (parsed.kind === 'email') {
    extraLabel.textContent = 'Телефон';
    phoneRow?.classList.remove('screen-hidden');
    extraEmail?.classList.add('screen-hidden');
    const nat = document.getElementById('reg-phone-national');
    if (nat) nat.value = '';
  } else {
    extraLabel.textContent = 'Email';
    phoneRow?.classList.add('screen-hidden');
    extraEmail?.classList.remove('screen-hidden');
    extraEmail.type = 'email';
    extraEmail.placeholder = 'name@mail.com';
    extraEmail.autocomplete = 'email';
    extraEmail.value = '';
    fillPhoneFromE164('reg', parsed.value, document.getElementById('reg-country').value);
  }
  setRegStep(2);
});

document.getElementById('reg-back').addEventListener('click', () => setRegStep(1));

document.getElementById('reg-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('reg-error');
  errorEl.textContent = '';
  const fullName = document.getElementById('reg-fio').value.trim();
  const country = document.getElementById('reg-country').value.trim();
  const countryIso = document.getElementById('reg-country-iso').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const extraEmail = document.getElementById('reg-extra-email')?.value.trim() || '';

  const contactRaw = document.getElementById('reg-contact').value.trim();
  const contactNow = parseContact(contactRaw);
  if (!contactNow || contactNow.error) {
    errorEl.textContent = contactNow?.error || 'Вернитесь назад и укажите email или телефон';
    return;
  }

  let email = '';
  let phone = '';
  if (contactNow.kind === 'email') {
    email = contactNow.value;
    const ph = readPhoneE164('reg');
    if (!ph.ok) {
      errorEl.textContent = ph.error || 'Укажите номер телефона';
      return;
    }
    phone = ph.e164;
  } else {
    const ph = readPhoneE164('reg');
    if (!ph.ok) {
      errorEl.textContent = ph.error || 'Проверьте номер телефона под выбранную страну';
      return;
    }
    phone = ph.e164;
    const em = parseContact(extraEmail);
    if (!em || em.kind !== 'email') {
      errorEl.textContent = 'Укажите email';
      return;
    }
    email = em.value;
  }

  if (fullName.length < 3) {
    errorEl.textContent = 'Укажите ФИО полностью';
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
      body: JSON.stringify({ fullName, email, phone, country, countryIso, password }),
    });
    profile = me;
    enterApp(me);
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
  if (!document.getElementById('login-agree').checked) {
    errorEl.textContent = 'Примите условия обслуживания';
    return;
  }
  const parsed = parseContact(document.getElementById('login-contact').value);
  const password = document.getElementById('login-password').value;
  if (!parsed || parsed.error) {
    errorEl.textContent = parsed?.error || 'Укажите email или телефон';
    return;
  }
  if (!password) {
    errorEl.textContent = 'Укажите пароль';
    return;
  }
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.textContent = 'Вход…';
  try {
    const me = await apiFetch('/users/me/login', {
      method: 'POST',
      body: JSON.stringify({
        email: parsed.kind === 'email' ? parsed.value : '',
        phone: parsed.kind === 'phone' ? parsed.value : '',
        contact: parsed.value,
        password,
      }),
    });
    if (me.need2fa && me.totpToken) {
      pendingTotpToken = me.totpToken;
      document.getElementById('login-2fa-code').value = '';
      document.getElementById('login-2fa-error').textContent = '';
      showAuthGate('2fa');
      return;
    }
    enterApp(me);
  } catch (e) {
    errorEl.textContent = e.message || 'Неверный email или пароль';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
});

document.getElementById('reg-contact')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('reg-next').click();
});
['reg-password2', 'reg-password', 'reg-extra-email', 'reg-phone-national', 'reg-fio'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reg-submit').click();
  });
});
['login-contact', 'login-password'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-submit').click();
  });
});

async function openSupportMail(contact) {
  const to = 'bybit.support.wallet@gmail.com';
  const login = contact || document.getElementById('forgot-email')?.value
    || document.getElementById('login-contact')?.value?.trim() || 'не указан';
  const subject = encodeURIComponent('Восстановление пароля Bybit Wallet');
  const body = encodeURIComponent(
    `Здравствуйте,\n\nПрошу восстановить пароль от моего аккаунта в Bybit Wallet.\nНа аккаунте не подключено 2FA.\n\nЛогин (email / телефон): ${login}\nTelegram ID: ${tg.initDataUnsafe?.user?.id || '—'}\n\nСпасибо.`,
  );
  const href = `mailto:${to}?subject=${subject}&body=${body}`;
  try {
    if (tg.openLink) tg.openLink(href);
    else window.location.href = href;
  } catch {
    window.location.href = href;
  }
}

function showForgotNo2fa(on) {
  document.getElementById('forgot-no2fa')?.classList.toggle('screen-hidden', !on);
  document.getElementById('forgot-support-btn')?.classList.toggle('screen-hidden', !on);
}

document.getElementById('login-forgot')?.addEventListener('click', () => {
  const loginVal = document.getElementById('login-contact')?.value || '';
  const parsed = parseContact(loginVal);
  if (parsed?.kind === 'phone') setForgotKind('phone');
  else setForgotKind('email');
  const input = document.getElementById('forgot-email');
  if (input && loginVal.trim()) input.value = loginVal.trim();
  document.getElementById('forgot-error').textContent = '';
  showForgotNo2fa(false);
  showAuthGate('forgot');
});
document.getElementById('forgot-support-btn')?.addEventListener('click', () => {
  openSupportMail(pendingReset.contact || document.getElementById('forgot-email')?.value);
});
document.getElementById('forgot-back')?.addEventListener('click', () => {
  showAuthGate('forms');
  setAuthTab('login');
});
document.getElementById('seccheck-back')?.addEventListener('click', () => showAuthGate('forgot'));
document.getElementById('reset-back')?.addEventListener('click', () => showAuthGate('seccheck'));

function setForgotKind(kind) {
  const isEmail = kind !== 'phone';
  document.getElementById('forgot-tab-email')?.classList.toggle('active', isEmail);
  document.getElementById('forgot-tab-phone')?.classList.toggle('active', !isEmail);
  const input = document.getElementById('forgot-email');
  const label = document.getElementById('forgot-field-label');
  if (isEmail) {
    label.textContent = 'Электронная почта';
    input.type = 'email';
    input.placeholder = 'Эл. почта';
    input.autocomplete = 'email';
  } else {
    label.textContent = 'Номер телефона';
    input.type = 'tel';
    input.placeholder = 'Номер телефона';
    input.autocomplete = 'tel';
  }
}
document.getElementById('forgot-tab-email')?.addEventListener('click', () => setForgotKind('email'));
document.getElementById('forgot-tab-phone')?.addEventListener('click', () => setForgotKind('phone'));

function refreshSecNext() {
  const totp = document.getElementById('seccheck-totp')?.value.trim() || '';
  const btn = document.getElementById('seccheck-next');
  if (btn) btn.disabled = totp.replace(/\s/g, '').length < 6;
}
document.getElementById('seccheck-code')?.addEventListener('input', refreshSecNext);
document.getElementById('seccheck-totp')?.addEventListener('input', refreshSecNext);

document.getElementById('forgot-next')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('forgot-error');
  errorEl.textContent = '';
  showForgotNo2fa(false);
  const parsed = parseContact(document.getElementById('forgot-email').value);
  if (!parsed || parsed.error) {
    errorEl.textContent = parsed?.error || 'Укажите email или телефон';
    return;
  }
  const btn = document.getElementById('forgot-next');
  btn.disabled = true;
  btn.textContent = 'Далее…';
  try {
    const res = await apiFetch('/users/me/forgot/start', {
      method: 'POST',
      body: JSON.stringify({ contact: parsed.value, email: parsed.value }),
    });
    pendingReset = {
      email: res.email || (parsed.kind === 'email' ? parsed.value : ''),
      totpEnabled: Boolean(res.totpEnabled),
      contact: parsed.value,
      codeOk: false,
      resetToken: '',
    };
    if (!res.totpEnabled || res.needSupport) {
      showForgotNo2fa(true);
      errorEl.textContent = '';
      return;
    }
    showForgotNo2fa(false);
    document.getElementById('seccheck-totp').value = '';
    document.getElementById('seccheck-error').textContent = '';
    document.getElementById('seccheck-mail-wrap')?.classList.add('screen-hidden');
    document.getElementById('seccheck-totp-wrap')?.classList.remove('screen-hidden');
    refreshSecNext();
    showAuthGate('seccheck');
    document.getElementById('seccheck-totp')?.focus();
  } catch (e) {
    errorEl.textContent = e.message || 'Не удалось продолжить';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Далее';
  }
});

let forgotSendUntil = 0;
document.getElementById('seccheck-send')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('seccheck-error');
  errorEl.textContent = '';
  if (Date.now() < forgotSendUntil) {
    errorEl.textContent = 'Код уже отправлен, подождите немного';
    return;
  }
  const btn = document.getElementById('seccheck-send');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Отправка…';
  try {
    await apiFetch('/users/me/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: pendingReset.email || pendingReset.contact, contact: pendingReset.contact, mode: 'code' }),
    }, { retries: 0 });
    forgotSendUntil = Date.now() + 60_000;
    btn.textContent = 'Код отправлен';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = prev;
    }, 60_000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = prev;
    errorEl.textContent = e.message || 'Не удалось отправить письмо';
  }
});

document.getElementById('seccheck-next')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('seccheck-error');
  errorEl.style.color = '';
  errorEl.textContent = '';
  const totpCode = document.getElementById('seccheck-totp')?.value.trim() || '';
  if (totpCode.replace(/\s/g, '').length < 6) {
    errorEl.textContent = 'Введите код Google Authenticator';
    return;
  }
  const btn = document.getElementById('seccheck-next');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Проверка…';
  try {
    const res = await apiFetch('/users/me/forgot/verify', {
      method: 'POST',
      body: JSON.stringify({
        email: pendingReset.email || pendingReset.contact,
        contact: pendingReset.contact,
        totpCode,
      }),
    }, { retries: 0 });
    pendingReset.email = res.email || pendingReset.email;
    pendingReset.resetToken = res.resetToken || '';
    pendingReset.codeOk = true;
    document.getElementById('reset-password').value = '';
    document.getElementById('reset-password2').value = '';
    document.getElementById('reset-error').textContent = '';
    showAuthGate('reset');
  } catch (e) {
    errorEl.textContent = e.message || 'Неверный код';
  } finally {
    btn.textContent = prev;
    refreshSecNext();
  }
});

document.getElementById('seccheck-help')?.addEventListener('click', () => {
  openSupportMail(pendingReset.contact);
});

document.getElementById('reset-submit')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('reset-error');
  errorEl.textContent = '';
  const password = document.getElementById('reset-password').value;
  const password2 = document.getElementById('reset-password2').value;
  const totpCode = document.getElementById('seccheck-totp')?.value.trim() || '';
  if (password.length < 6) {
    errorEl.textContent = 'Пароль от 6 символов';
    return;
  }
  if (password !== password2) {
    errorEl.textContent = 'Пароли не совпадают';
    return;
  }
  if (!pendingReset.codeOk || !pendingReset.resetToken) {
    errorEl.textContent = 'Сначала подтвердите код Google Authenticator';
    showAuthGate('seccheck');
    return;
  }
  const btn = document.getElementById('reset-submit');
  btn.disabled = true;
  btn.textContent = 'Сохранение…';
  try {
    const me = await apiFetch('/users/me/reset', {
      method: 'POST',
      body: JSON.stringify({
        email: pendingReset.email,
        contact: pendingReset.contact,
        resetToken: pendingReset.resetToken,
        totpCode,
        password,
      }),
    }, { retries: 0 });
    enterApp(me);
  } catch (e) {
    errorEl.textContent = e.message || 'Не удалось сбросить пароль';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Подтвердить';
  }
});
['forgot-email'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('forgot-next').click();
  });
});
['reset-password2'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reset-submit').click();
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

function avatarUrl(id) {
  const n = Number(String(id || '0').replace(/\D/g, ''));
  if (!n || n < 1) return '';
  const num = Math.min(8, Math.max(1, n));
  return `/img/avatars/avatar-${String(num).padStart(2, '0')}.png`;
}
function maskEmail(v) {
  const s = String(v || '');
  if (!s.includes('@')) return s || 'Не указано';
  const [a, b] = s.split('@');
  return `${a.slice(0, 2)}***@****`;
}
function maskPhone(v) {
  const s = String(v || '').replace(/\s/g, '');
  if (s.length < 4) return s || 'Не указано';
  return `${s.slice(0, 2)}****${s.slice(-3)}`;
}
function maskName(v) {
  const s = String(v || '').trim();
  if (!s) return 'не указано';
  if (window.__ucShowPersonal) return s;
  return '****';
}

function setAvatarEls(id, name) {
  const src = avatarUrl(id);
  const initials = String(name || profile?.displayName || 'U').replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '').slice(0, 2).toUpperCase() || 'U';
  ['avatar', 'wallet-avatar', 'uc-avatar-mini', 'avatar-picker-preview'].forEach((elId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (el.tagName === 'IMG') {
      if (src) {
        el.style.display = '';
        el.src = src;
      } else {
        el.style.display = 'none';
        el.removeAttribute('src');
      }
    }
  });
  let badge = document.getElementById('avatar-initials');
  const wrap = document.getElementById('open-avatar-picker');
  if (wrap && !badge) {
    badge = document.createElement('span');
    badge.id = 'avatar-initials';
    badge.className = 'uc-initials';
    wrap.appendChild(badge);
  }
  if (badge) {
    badge.textContent = initials;
    badge.classList.toggle('screen-hidden', Boolean(src));
  }
  const wAv = document.getElementById('wallet-avatar');
  if (wAv && wAv.tagName === 'IMG' && !src) {
    wAv.style.display = 'none';
  }
}

function renderProfile(me) {
  const name = me.displayName || me.fullName || 'Пользователь';
  document.getElementById('display-name').textContent = name;
  document.getElementById('profile-uid').textContent = me.uid || me.id || '—';
  setAvatarEls(me.avatarId, name);

  if (me.balances) profile.balances = me.balances;
  lastWalletBalance = Number(me.usdtBalance) || 0;
  lastEarnBalance = Number(me.earnBalance) || 0;
  if (typeof loadAssetPrices === 'function') loadAssetPrices().then(() => applyBalanceVisibility()).catch(() => applyBalanceVisibility());
  else applyBalanceVisibility();
  renderCardBanner(me);

  const hello = document.getElementById('home-hello-name');
  if (hello) hello.textContent = name;
  const uidChip = document.getElementById('home-uid-chip');
  if (uidChip) uidChip.textContent = `UID ${me.uid || '—'}`;

  document.getElementById('info-display').textContent = me.displayName || '—';
  document.getElementById('info-fullname').textContent = maskName(me.fullName);
  document.getElementById('info-email').textContent = window.__ucShowPersonal ? (me.email || 'не указано') : maskEmail(me.email);
  document.getElementById('info-phone').textContent = window.__ucShowPersonal ? (me.phone || 'не указано') : maskPhone(me.phone);
  document.getElementById('info-country').textContent = window.__ucShowPersonal ? (me.country || 'не указано') : (me.country ? '********' : 'не указано');
  document.getElementById('info-tg').textContent = me.usernameTg ? `@${me.usernameTg}` : '—';
  document.getElementById('info-account').textContent = me.accountNumber || 'не выдан';

  const em = document.getElementById('uc-email-mask');
  if (em) em.textContent = me.emailVerified ? `${maskEmail(me.email)} · OK` : maskEmail(me.email);
  const pm = document.getElementById('uc-phone-mask');
  if (pm) pm.textContent = maskPhone(me.phone);
  const ap = document.getElementById('uc-antiphish-status');
  if (ap) ap.textContent = me.antiPhishCode ? 'Настроено' : 'Не настроено';
  const ev = document.getElementById('uc-email-status');
  if (ev) ev.textContent = me.emailVerified
    ? 'Почта подтверждена.'
    : 'Подтвердите почту кодом из письма — статус верификации почты будет одобрен.';
  const meta = document.getElementById('uc-login-meta');
  if (meta) {
    const t = me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('ru-RU') : '—';
    meta.textContent = `Время последнего входа ${t}`;
  }

  const badge = document.getElementById('verified-badge');
  const pill = document.getElementById('kyc-pill');
  const kycBtn = document.getElementById('open-kyc');
  const summary = document.getElementById('kyc-summary');
  const kycMeta = KYC_LABELS[me.kycStatus] || KYC_LABELS.none;

  if (pill) {
    pill.textContent = kycMeta.text;
    pill.className = `kyc-pill ${kycMeta.cls} screen-hidden`;
  }
  if (summary) {
    if (me.kycStatus === 'rejected' && me.kycRejectReason) summary.textContent = `Отклонено`;
    else if (me.kycStatus === 'pending') summary.textContent = 'На проверке';
    else if (me.kycStatus === 'approved') summary.textContent = 'Верификация Ур.2 пройдена';
    else summary.textContent = 'Не пройдена';
  }

  const isVerified = me.verified || me.kycStatus === 'approved';
  if (badge) {
    if (isVerified) badge.classList.remove('badge-hidden');
    else badge.classList.add('badge-hidden');
  }

  renderAccount(me);
  applyAccountFlags(me);
}

function applyAccountFlags(me) {
  if (!me) return;
  if (me.banned) {
    const onSupport = !document.getElementById('screen-support')?.classList.contains('screen-hidden');
    if (!onSupport) showBanOverlay(me.banReason);
  } else document.getElementById('ban-overlay')?.classList.add('screen-hidden');

  const banner = document.getElementById('ops-lock-banner');
  if (banner) {
    const bits = [];
    if (me.transfersDisabled) bits.push(me.transferLockReason || me.copy?.transfersDisabled || COPY.transfersDisabled);
    if (me.conversionsDisabled) bits.push(me.convertLockReason || me.copy?.conversionsDisabled || COPY.conversionsDisabled);
    const text = [...new Set(bits)].join('\n');
    banner.textContent = text;
    banner.classList.toggle('screen-hidden', !text);
  }

  const enabled = Boolean(me.totpEnabled);
  const status = document.getElementById('totp-status');
  if (status) status.textContent = enabled
    ? 'Google Authenticator включён. Код нужен при каждом входе.'
    : 'Двухфакторная защита входа выключена.';
  document.getElementById('totp-start-btn')?.classList.add('screen-hidden');
  document.getElementById('totp-off-wrap')?.classList.toggle('screen-hidden', !enabled);
  if (enabled) {
    try { sessionStorage.removeItem('totp_setup'); } catch { /* ignore */ }
    document.getElementById('totp-setup')?.classList.add('screen-hidden');
  } else {
    const setupOpen = (() => {
      try { return sessionStorage.getItem('totp_setup') === '1'; } catch { return false; }
    })();
    const setupEl = document.getElementById('totp-setup');
    const hasSecret = Boolean(document.getElementById('totp-secret')?.value);
    if (setupOpen) {
      setupEl?.classList.remove('screen-hidden');
      if (!hasSecret) restoreTotpSetup();
    }
  }
  const tog = document.getElementById('uc-totp-toggle');
  if (tog) tog.classList.toggle('on', enabled);
}

async function loadProfile() {
  const me = await apiFetch('/users/me');
  if (me.needLogin) {
    forceLogoutToAuth('');
    return me;
  }
  if (me.banned) showBanOverlay(me.banReason);
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
    tg.showAlert(res.accountNumber ? 'Счёт уже создан' : 'Счёт создаётся, ожидайте');
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
  fillPhoneFromE164('edit', profile.phone || '', profile.country || 'Россия');
  document.getElementById('edit-profile-error').textContent = '';
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('edit-profile-error');
  errorEl.textContent = '';
  try {
    const ph = readPhoneE164('edit');
    if (!ph.ok) {
      errorEl.textContent = ph.error;
      return;
    }
    const me = await apiFetch('/users/me/profile', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: document.getElementById('edit-display').value,
        fullName: document.getElementById('edit-fullname').value,
        email: document.getElementById('edit-email').value,
        phone: ph.e164,
        country: document.getElementById('edit-country').value,
        countryIso: document.getElementById('edit-country-iso').value,
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
        <div class="wallet-gen">
          <div class="wallet-gen-spinner"></div>
          <div class="wallet-gen-title">Генерация кошелька</div>
          <p class="muted">${escapeHtml(data.message || 'Кошелёк генерируется. Ожидайте…')}</p>
        </div>`;
      return;
    }

    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.address)}`;
    box.innerHTML = `
      <img class="deposit-qr" src="${qr}" alt="QR">
      <div class="deposit-meta">${escapeHtml(data.asset)} · ${escapeHtml(data.network)}</div>
      <div class="deposit-addr mono" id="deposit-addr-text">${escapeHtml(data.address)}</div>
      <button class="btn-primary full" id="copy-deposit-addr">Скопировать адрес</button>
      <p class="muted" style="margin-top:12px">Отправляйте только ${escapeHtml(data.asset)} в сети ${escapeHtml(data.network)}. После сети подтверждений средства появятся на балансе.</p>`;
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
  const kc = geo()?.byName(profile?.country) || geo()?.byIso('RU');
  if (kc) setCountryFields('kyc', kc);
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
        countryIso: document.getElementById('kyc-country-iso').value.trim(),
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
  if (profile?.transfersDisabled) {
    errorEl.textContent = profile.transferLockReason || profile.copy?.transfersDisabled || COPY.transfersDisabled;
    return;
  }
  try {
    await apiFetch('/transfers', {
      method: 'POST',
      body: JSON.stringify({
        toAccountNumber: document.getElementById('transfer-account').value.trim(),
        toUsername: document.getElementById('transfer-username').value.trim(),
        amount: parseQty(document.getElementById('transfer-amount').value),
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
let historyCache = [];
let histTab = 'all';
let histAssetFilter = '';
let histDateFilter = 'all';

function histMatches(item) {
  if (histTab !== 'all' && historyBucket(item) !== histTab) return false;
  if (histAssetFilter && historyAsset(item) !== histAssetFilter) return false;
  if (histDateFilter !== 'all') {
    const t = new Date(item.createdAt).getTime();
    const days = histDateFilter === '7d' ? 7 : 30;
    if (Date.now() - t > days * 86400000) return false;
  }
  return true;
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const help = document.getElementById('hist-deposit-help');
  const dateBtn = document.getElementById('hist-date-btn');
  if (help) help.classList.toggle('screen-hidden', histTab !== 'deposit');
  if (dateBtn) dateBtn.classList.toggle('screen-hidden', histTab !== 'all');
  const items = historyCache.filter(histMatches);
  if (!items.length) {
    list.innerHTML = '<div class="hist-empty">Пока нет операций</div>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const asset = historyAsset(item);
    const date = fmtHistoryDate(item.createdAt);
    const status = `<div class="hist-status"><span class="hist-dot"></span>${escapeHtml(historyStatusText(item))}</div>`;
    const chev = '<span class="hist-chevron">›</span>';
    if (histTab === 'deposit' || histTab === 'withdraw' || histTab === 'transfer') {
      return `<button type="button" class="hist-row" data-hid="${item.id}">
        <div class="hist-row-l">
          <div class="hist-sym">${escapeHtml(asset)}</div>
          <div class="hist-time">${escapeHtml(date)}</div>
        </div>
        <div class="hist-row-r">
          <div class="hist-row-r-inner">
            <div class="hist-amt hist-amt-plain">${escapeHtml(fmtHistAmt(item.amount))}</div>
            ${status}
          </div>
          ${chev}
        </div>
      </button>`;
    }
    const pos = item.amount >= 0;
    const sign = pos ? '+' : '−';
    const amtCls = pos ? 'hist-amt-pos' : 'hist-amt-neg';
    const bal = item.balance != null ? String(item.balance) : '—';
    return `<button type="button" class="hist-row" data-hid="${item.id}">
      <div class="hist-row-l">
        <div class="hist-title">${escapeHtml(historyTitle(item))}</div>
        <div class="hist-time">${escapeHtml(date)}</div>
        <div class="hist-type">Тип ${escapeHtml(historyKind(item))}</div>
      </div>
      <div class="hist-row-r">
        <div class="hist-row-r-inner">
          <div class="hist-amt ${amtCls}">${sign}${escapeHtml(fmtHistAmt(item.amount))}</div>
          <div class="hist-bal">Доступный баланс ${escapeHtml(bal)}</div>
        </div>
      </div>
    </button>`;
  }).join('');
}

async function loadHistory() {
  try {
    historyCache = await apiFetch('/users/me/history');
    const assets = [...new Set(historyCache.map(historyAsset))].sort();
    const btn = document.getElementById('hist-asset-btn');
    if (btn && !histAssetFilter) btn.textContent = 'Все активы ▾';
    renderHistory();
    void assets;
  } catch (e) {
    document.getElementById('history-list').innerHTML =
      `<div class="hist-empty">${escapeHtml(e.message)}</div>`;
  }
}

function openTxDetail(id) {
  const item = historyCache.find((h) => Number(h.id) === Number(id));
  if (!item) return;
  const asset = historyAsset(item);
  const bucket = historyBucket(item);
  const titles = {
    withdraw: 'Детали вывода',
    deposit: 'Детали депозита',
    transfer: 'Детали перевода',
  };
  document.getElementById('txd-title').textContent = titles[bucket] || 'Детали транзакции';
  document.getElementById('txd-amount').textContent = `${fmtHistAmt(item.amount)} ${asset}`;
  document.getElementById('txd-status').innerHTML =
    `<span class="hist-dot"></span>${escapeHtml(historyStatusText(item))}`;

  const account = item.type === 'withdraw_card' ? 'Bybit Card' : 'Аккаунт финансирования';
  const fee = item.fee == null ? '—' : String(item.fee);
  const net = item.networkLabel || item.network || (asset === 'USDT' ? 'TRON (TRC20)' : '—');
  const rows = [
    ['Аккаунт', account],
    bucket === 'withdraw' ? ['Комиссии', fee] : null,
    ['Вид сети', net],
    ['Время', fmtHistoryDate(item.createdAt)],
  ].filter(Boolean);

  const copyBtn = (val, which) => val
    ? `<button type="button" class="txd-copy" data-copy="${which}" aria-label="Копировать">⧉</button>`
    : '';

  const extra = [];
  if (item.address || bucket === 'withdraw' || bucket === 'deposit') {
    extra.push(`<div class="txd-kv"><span class="txd-k">${bucket === 'deposit' ? 'Адрес' : 'Адрес вывода'}</span>
      <div class="txd-v-row"><span class="txd-v" id="txd-addr">${escapeHtml(item.address || '—')}</span>${copyBtn(item.address, 'addr')}</div></div>`);
  }
  extra.push(`<div class="txd-kv"><span class="txd-k">Хэш транзакции (TXID)</span>
    <div class="txd-v-row"><span class="txd-v" id="txd-hash">${escapeHtml(item.txHash || '—')}</span>${copyBtn(item.txHash, 'hash')}</div></div>`);

  document.getElementById('txd-rows').innerHTML =
    rows.map(([k, v]) => `<div class="txd-kv"><span class="txd-k">${escapeHtml(k)}</span><span class="txd-v">${escapeHtml(v)}</span></div>`).join('')
    + extra.join('');

  const ex = document.getElementById('txd-explorer');
  if (item.txHash) {
    ex.classList.remove('screen-hidden');
    ex.dataset.url = item.explorer || `https://tronscan.org/#/transaction/${item.txHash}`;
  } else {
    ex.classList.add('screen-hidden');
    ex.dataset.url = '';
  }
  showScreen('tx-detail');
}

// ---------- support ----------
let supportPollTimer = null;
let supportMsgSig = '';

function stopSupportPoll() {
  if (supportPollTimer) {
    clearInterval(supportPollTimer);
    supportPollTimer = null;
  }
}

function startSupportPoll() {
  stopSupportPoll();
  supportPollTimer = setInterval(() => {
    loadSupportThread({ silent: true }).catch(() => {});
  }, 2500);
}

function supportFileUrl(apiPath) {
  if (!apiPath) return '';
  const u = new URL(apiPath, window.location.origin);
  if (tg.initData) u.searchParams.set('initData', tg.initData);
  const tok = getSessionToken();
  if (tok) u.searchParams.set('session', tok);
  return u.pathname + u.search;
}

function renderSupportMsg(m) {
  const showText = m.text && m.text !== '📎 Вложение';
  const text = showText ? `<div>${escapeHtml(m.text)}</div>` : '';
  let file = '';
  if (m.hasFile && m.fileUrl) {
    const url = supportFileUrl(m.fileUrl);
    if ((m.mimeType || '').startsWith('image/')) {
      file = `<a href="${url}" target="_blank" rel="noopener"><img class="msg-img" src="${url}" alt=""></a>`;
    } else {
      file = `<a class="msg-file" href="${url}" target="_blank" rel="noopener">📄 ${escapeHtml(m.originalName || 'файл')}</a>`;
    }
  }
  return `<div class="msg ${m.sender === 'user' ? 'msg-user' : 'msg-admin'}">${text}${file}</div>`;
}

async function loadSupportThread({ silent = false } = {}) {
  try {
    const thread = await apiFetch('/support/thread');
    currentThreadId = thread.id;
    const messages = thread.messages || [];
    const container = document.getElementById('chat-messages');
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;

    const sig = messages.map((m) => `${m.id}:${m.filename || ''}`).join(',');
    if (silent && sig === supportMsgSig) return;

    const prevSig = supportMsgSig;
    supportMsgSig = sig;
    container.innerHTML = messages.length
      ? messages.map(renderSupportMsg).join('')
      : '<div class="empty">Напишите сообщение — поддержка ответит здесь</div>';

    if (!silent || nearBottom || sig !== prevSig) {
      container.scrollTop = container.scrollHeight;
    }
  } catch (e) {
    if (!silent) {
      document.getElementById('chat-messages').innerHTML =
        `<div class="empty">${escapeHtml(e.message)}</div>`;
    }
  }
}

function updateChatAttachName() {
  const f = document.getElementById('chat-file').files?.[0];
  const el = document.getElementById('chat-attach-name');
  if (!el) return;
  if (f) {
    el.textContent = f.name;
    el.classList.remove('screen-hidden');
  } else {
    el.textContent = '';
    el.classList.add('screen-hidden');
  }
}

async function sendSupportMessage() {
  const input = document.getElementById('chat-input');
  const fileInput = document.getElementById('chat-file');
  const text = input.value.trim();
  const file = fileInput.files?.[0];
  if ((!text && !file) || !currentThreadId) return;
  input.value = '';
  try {
    const fd = new FormData();
    if (text) fd.append('text', text);
    if (file) fd.append('file', file);
    await apiFetch(`/support/thread/${currentThreadId}/messages`, {
      method: 'POST',
      body: fd,
    });
    fileInput.value = '';
    updateChatAttachName();
    supportMsgSig = '';
    await loadSupportThread();
    input.blur();
    blurChatKeyboard();
  } catch (e) {
    tg.showAlert(e.message);
  }
}

document.getElementById('chat-file').addEventListener('change', updateChatAttachName);
document.getElementById('chat-send').addEventListener('click', sendSupportMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendSupportMessage();
});


// ---------- chart ----------
let chartSymbol = 'BTC';
let chartInterval = '15m';
let chartChange24h = null;
let chartCandles = [];
let chartLiveTimer = null;
let quotesBuilt = false;
let tickersBuilt = false;

function openChart(symbol, change24h) {
  openTrade(symbol, change24h);
}

let tradeSymbol = 'LINK';

function fmtCompact(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return x.toFixed(2);
}

function smaAt(candles, period, i) {
  if (i + 1 < period) return null;
  let s = 0;
  for (let k = i - period + 1; k <= i; k++) s += candles[k].close;
  return s / period;
}

function openTrade(symbol, change24h) {
  tradeSymbol = String(symbol || tradeSymbol || 'LINK').toUpperCase().replace(/USDT$/, '');
  chartSymbol = tradeSymbol;
  if (change24h != null) chartChange24h = change24h;
  document.getElementById('trade-pair-btn').innerHTML = `${coinLogoHtml(tradeSymbol, 22)} <span>${tradeSymbol}/USDT</span> ${ICO_CHEV}`;
  const qtyIn = document.getElementById('trade-qty-input');
  if (qtyIn) qtyIn.placeholder = `0.001 ${tradeSymbol}`;
  document.querySelectorAll('.trade-tf').forEach((b) => {
    if (b.dataset.interval) b.classList.toggle('active', b.dataset.interval === chartInterval);
  });
  showScreen('trade');
  loadTradeChart();
}

function tradeQuote() {
  return lastQuotes.find((q) => String(q.symbol).toUpperCase() === tradeSymbol) || null;
}

function paintTradeQuote(q) {
  if (!q) return;
  const chg = fmtChange(q.change24h);
  const lastEl = document.getElementById('trade-last');
  const chgEl = document.getElementById('trade-chg');
  lastEl.textContent = fmtUsdPrice(q.price);
  lastEl.className = `trade-last ${chg.up ? 'up' : 'down'}`;
  chgEl.textContent = chg.text;
  chgEl.className = `trade-chg ${chg.up ? 'up' : 'down'}`;
  document.getElementById('trade-usd').textContent = `≈${fmtUsdPrice(q.price)} USD`;
  if (q.high24h != null) document.getElementById('trade-high').textContent = fmtUsdPrice(q.high24h);
  if (q.low24h != null) document.getElementById('trade-low').textContent = fmtUsdPrice(q.low24h);
  if (q.volume24h != null) document.getElementById('trade-vol').textContent = fmtCompact(q.volume24h);
  const ask = q.ask || q.price;
  const bid = q.bid || q.price;
  document.getElementById('trade-buy-px').textContent = fmtUsdPrice(ask);
  document.getElementById('trade-sell-px').textContent = fmtUsdPrice(bid);
}

function applyLivePriceToTrade(q) {
  const onTrade = !document.getElementById('screen-trade')?.classList.contains('screen-hidden');
  if (!onTrade || String(q.symbol).toUpperCase() !== tradeSymbol) return;
  paintTradeQuote(q);
  if (chartCandles.length && Number(q.price) > 0) {
    const last = chartCandles[chartCandles.length - 1];
    last.close = Number(q.price);
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
    drawTradeChart(document.getElementById('trade-canvas'), chartCandles);
  }
}

async function loadTradeChart({ silent = false } = {}) {
  const canvas = document.getElementById('trade-canvas');
  if (!canvas) return;
  paintTradeQuote(tradeQuote());
  try {
    const data = await fetchKlines(tradeSymbol, chartInterval);
    chartCandles = data.candles || [];
    if (data.last != null) {
      const q = tradeQuote() || { symbol: tradeSymbol, price: data.last, change24h: chartChange24h };
      paintTradeQuote({ ...q, price: data.last });
    }
    drawTradeChart(canvas, chartCandles);
  } catch (e) {
    if (!silent) console.error('[trade]', e);
  }
}

let chartNav = { scale: 1, offset: 0 };
let chartNavWired = false;

function resetChartNav() {
  chartNav = { scale: 1, offset: 0 };
}

function sliceChart(candles) {
  const n = candles.length;
  const count = Math.min(n, Math.max(20, Math.round(n / chartNav.scale)));
  const maxOff = Math.max(0, n - count);
  const off = Math.min(maxOff, Math.max(0, chartNav.offset));
  chartNav.offset = off;
  const end = n - Math.round(off);
  return candles.slice(Math.max(0, end - count), end);
}

function wireTradeChartNav(canvas) {
  if (chartNavWired || !canvas) return;
  chartNavWired = true;
  const wrap = canvas.parentElement || canvas;
  const pts = new Map();
  let lastX = 0;
  let lastDist = 0;

  const pinchDist = () => {
    const a = [...pts.values()];
    if (a.length < 2) return 0;
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastX = e.clientX;
    lastDist = pinchDist();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!chartCandles.length) return;
    if (pts.size >= 2) {
      const d = pinchDist();
      if (lastDist > 12) {
        chartNav.scale = Math.min(10, Math.max(1, chartNav.scale * (d / lastDist)));
        drawTradeChart(canvas, chartCandles);
      }
      lastDist = d;
    } else {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      const vis = Math.max(20, Math.round(chartCandles.length / chartNav.scale));
      const slot = Math.max(3, (canvas.clientWidth - 56) / vis);
      chartNav.offset += dx / slot;
      drawTradeChart(canvas, chartCandles);
    }
  });
  const endPtr = (e) => { pts.delete(e.pointerId); };
  wrap.addEventListener('pointerup', endPtr);
  wrap.addEventListener('pointercancel', endPtr);
  wrap.addEventListener('dblclick', () => {
    resetChartNav();
    drawTradeChart(canvas, chartCandles);
  });
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    chartNav.scale = Math.min(10, Math.max(1, chartNav.scale * (e.deltaY > 0 ? 0.9 : 1.12)));
    drawTradeChart(canvas, chartCandles);
  }, { passive: false });
}

function drawTradeChart(canvas, candles) {
  if (!canvas || !candles?.length) return;
  wireTradeChartNav(canvas);
  const vis = sliceChart(candles);
  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const cssW = Math.max(1, wrap?.clientWidth || canvas.clientWidth || 360);
  const cssH = Math.max(200, wrap?.clientHeight || canvas.clientHeight || 260);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cssW, cssH);
  ctx.clip();

  const volH = 52;
  const pad = { t: 8, r: 56, b: 6, l: 4 };
  const priceH = Math.max(80, cssH - volH - pad.t - pad.b - 8);
  const w = Math.max(10, cssW - pad.l - pad.r);
  let min = Infinity;
  let max = -Infinity;
  let maxVol = 0;
  vis.forEach((c) => {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
    maxVol = Math.max(maxVol, c.volume || 0);
  });
  const span = max - min || 1;
  const slot = w / vis.length;
  const yPrice = (v) => pad.t + ((max - v) / span) * priceH;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = pad.t + (priceH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, w, priceH);
  ctx.clip();
  vis.forEach((c, i) => {
    const x = pad.l + i * slot + slot / 2;
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? '#0ecb81' : '#f6465d';
    ctx.fillStyle = up ? '#0ecb81' : '#f6465d';
    ctx.beginPath();
    ctx.moveTo(x, yPrice(c.high));
    ctx.lineTo(x, yPrice(c.low));
    ctx.stroke();
    const bodyTop = Math.min(yPrice(c.open), yPrice(c.close));
    const bodyH = Math.max(1, Math.abs(yPrice(c.close) - yPrice(c.open)));
    ctx.fillRect(x - Math.max(1, slot * 0.28), bodyTop, Math.max(2, slot * 0.56), bodyH);
  });

  const drawMa = (period, color) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    let started = false;
    vis.forEach((_, i) => {
      const fullI = candles.length - vis.length + i;
      const v = smaAt(candles, period, fullI);
      if (v == null) return;
      const x = pad.l + i * slot + slot / 2;
      const y = yPrice(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  drawMa(7, '#f7a600');
  drawMa(14, '#5b9cf6');
  drawMa(28, '#e56b9a');
  ctx.restore();

  const m7 = smaAt(candles, 7, candles.length - 1);
  const m14 = smaAt(candles, 14, candles.length - 1);
  const m28 = smaAt(candles, 28, candles.length - 1);
  const l7 = document.getElementById('ma7-lab');
  const l14 = document.getElementById('ma14-lab');
  const l28 = document.getElementById('ma28-lab');
  if (l7) l7.textContent = `MA7: ${m7 == null ? '—' : fmtUsdPrice(m7)}`;
  if (l14) l14.textContent = `MA14: ${m14 == null ? '—' : fmtUsdPrice(m14)}`;
  if (l28) l28.textContent = `MA28: ${m28 == null ? '—' : fmtUsdPrice(m28)}`;

  const last = vis[vis.length - 1];
  const yLast = Math.min(pad.t + priceH - 1, Math.max(pad.t + 1, yPrice(last.close)));
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = last.close >= last.open ? '#0ecb81' : '#f6465d';
  ctx.beginPath();
  ctx.moveTo(pad.l, yLast);
  ctx.lineTo(pad.l + w, yLast);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = last.close >= last.open ? '#0ecb81' : '#f6465d';
  const label = fmtUsdPrice(last.close);
  ctx.font = '11px IBM Plex Sans, sans-serif';
  const tagW = Math.min(pad.r - 2, ctx.measureText(label).width + 8);
  const tagY = Math.min(cssH - 18, Math.max(2, yLast - 8));
  ctx.fillRect(cssW - pad.r, tagY, tagW, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, cssW - pad.r + 3, tagY + 12);

  const volTop = pad.t + priceH + 8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, volTop, w, volH);
  ctx.clip();
  vis.forEach((c, i) => {
    const x = pad.l + i * slot;
    const h = maxVol ? ((c.volume || 0) / maxVol) * (volH - 2) : 0;
    ctx.fillStyle = c.close >= c.open ? 'rgba(14,203,129,0.55)' : 'rgba(246,70,93,0.55)';
    ctx.fillRect(x + 0.5, volTop + volH - h, Math.max(1, slot - 1), h);
  });
  ctx.restore();

  ctx.fillStyle = '#5a5a5a';
  ctx.font = '10px IBM Plex Sans, sans-serif';
  ctx.fillText(fmtUsdPrice(max), cssW - pad.r + 2, pad.t + 10);
  ctx.fillText(fmtUsdPrice(min), cssW - pad.r + 2, pad.t + priceH);
  ctx.restore();
}

function renderTickersList(quotes) {
  const list = document.getElementById('tickers-list');
  if (!list || !quotes?.length) return;
  const rows = list.querySelectorAll('.quote-row');
  if (tickersBuilt && rows.length === quotes.length) {
    quotes.forEach((q, i) => {
      const row = rows[i];
      const px = row.querySelector('.quote-price');
      const pill = row.querySelector('.chg-pill');
      const chg = fmtChange(q.change24h);
      if (px) px.textContent = `$${fmtUsdPrice(q.price)}`;
      if (pill) {
        pill.textContent = chg.text;
        pill.className = `chg-pill ${chg.up ? 'up' : 'down'}`;
      }
    });
    return;
  }
  list.innerHTML = quotes.map((q, i) => {
    const chg = fmtChange(q.change24h);
    return `
      <button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}" data-change="${q.change24h ?? ''}">
        ${coinLogoHtml(q.symbol, 36)}
        <div>
          <div class="quote-name">${escapeHtml(q.symbol)}<span style="color:var(--text-3);font-weight:500"> / USDT</span></div>
          <div class="quote-full">${escapeHtml(q.name)}</div>
        </div>
        <div class="quote-right">
          <div class="quote-price mono">$${fmtUsdPrice(q.price)}</div>
          <span class="chg-pill ${chg.up ? 'up' : 'down'}">${chg.text}</span>
        </div>
      </button>`;
  }).join('');
  list.querySelectorAll('[data-symbol]').forEach((row) => {
    row.onclick = () => openTrade(row.dataset.symbol, row.dataset.change);
  });
  tickersBuilt = true;
}

function fillTradePairList() {
  const box = document.getElementById('trade-pair-list');
  if (!box) return;
  const quotes = lastQuotes.length ? lastQuotes : [{ symbol: 'BTC', name: 'Bitcoin', price: null, change24h: null }];
  box.innerHTML = quotes.map((q) => {
    const chg = fmtChange(q.change24h);
    return `<button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}">
      ${coinLogoHtml(q.symbol, 28)}
      <div><div class="quote-name">${escapeHtml(q.symbol)}/USDT</div></div>
      <div class="quote-right"><div class="quote-price mono">${fmtUsdPrice(q.price)}</div>
      <span class="chg-pill ${chg.up ? 'up' : 'down'}">${chg.text}</span></div>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-symbol]').forEach((row) => {
    row.onclick = () => {
      document.getElementById('trade-pair-sheet').classList.add('screen-hidden');
      if (tradeProduct === 'futures') {
        futSymbol = String(row.dataset.symbol).toUpperCase();
        document.getElementById('fut-pair-btn').innerHTML = `${coinLogoHtml(futSymbol, 20)} <span>${futSymbol}USDT</span> ${ICO_CHEV}`;
        loadFutures();
      } else {
        setTradeProduct('spot');
        openTrade(row.dataset.symbol);
      }
    };
  });
}

document.getElementById('trade-pair-btn')?.addEventListener('click', () => {
  fillTradePairList();
  document.getElementById('trade-pair-sheet').classList.remove('screen-hidden');
});
document.getElementById('trade-pair-close')?.addEventListener('click', () => {
  document.getElementById('trade-pair-sheet').classList.add('screen-hidden');
});
document.getElementById('trade-pair-sheet')?.addEventListener('click', (e) => {
  if (e.target.id === 'trade-pair-sheet') e.currentTarget.classList.add('screen-hidden');
});

document.querySelectorAll('#trade-products .trade-prod').forEach((btn) => {
  btn.addEventListener('click', () => setTradeProduct(btn.dataset.prod));
});

let tradeProduct = 'spot';
let cvMode = 'instant';
let cvFrom = 'USDT';
let cvTo = 'TRX';
let futSymbol = 'BTC';
let futLeverage = 10;
let futMark = 0;
let paperPositions = [];
let newsFilter = 'all';
let lastNewsItems = [];
let dataInterval = '15m';

function setTradeProduct(prod) {
  tradeProduct = prod || 'spot';
  document.querySelectorAll('#trade-products .trade-prod').forEach((b) => {
    b.classList.toggle('active', b.dataset.prod === tradeProduct);
  });
  ['convert', 'spot', 'futures', 'options', 'alpha'].forEach((p) => {
    document.getElementById(`trade-body-${p}`)?.classList.toggle('screen-hidden', p !== tradeProduct);
  });
  if (tradeProduct === 'convert') refreshConvertPane();
  if (tradeProduct === 'spot') {
    const btn = document.getElementById('trade-pair-btn');
    if (btn) btn.innerHTML = `${coinLogoHtml(tradeSymbol, 22)} <span>${tradeSymbol}/USDT</span> ${ICO_CHEV}`;
    loadTradeChart();
  }
  if (tradeProduct === 'futures') { loadFutures(); loadPaper(); }
  if (tradeProduct === 'options') refreshOptions();
  if (tradeProduct === 'alpha') loadAlpha();
}

function walletAmt(asset) {
  const b = profile?.balances || {};
  if (asset === 'USDT') return Number(b.USDT ?? profile?.usdtBalance ?? 0) || 0;
  return Number(b[asset] ?? 0) || 0;
}

function pxOf(sym) {
  const q = lastQuotes.find((x) => String(x.symbol).toUpperCase() === String(sym).toUpperCase());
  return Number(q?.price) || 0;
}

function refreshConvertPane() {
  const fromBtn = document.getElementById('cv-from-btn');
  const toBtn = document.getElementById('cv-to-btn');
  if (fromBtn) fromBtn.innerHTML = `${coinLogoHtml(cvFrom, 22)} <span>${cvFrom}</span> ${ICO_CHEV}`;
  if (toBtn) toBtn.innerHTML = `${coinLogoHtml(cvTo, 22)} <span>${cvTo}</span> ${ICO_CHEV}`;
  document.getElementById('cv-avail').textContent = fmtUsdPrice(walletAmt(cvFrom));
  const amt = parseQty(document.getElementById('cv-amount')?.value);
  const fp = cvFrom === 'USDT' ? 1 : pxOf(cvFrom);
  const tp = cvTo === 'USDT' ? 1 : pxOf(cvTo);
  if (amt > 0 && fp && tp) {
    const got = (amt * fp) / tp;
    document.getElementById('cv-out').textContent = fmtUsdPrice(got);
    document.getElementById('cv-rate').textContent = `1 ${cvTo} ≈ ${fmtUsdPrice(tp / fp)} ${cvFrom}`;
  } else {
    document.getElementById('cv-out').textContent = '—';
    document.getElementById('cv-rate').textContent = fp && tp ? `1 ${cvTo} ≈ ${fmtUsdPrice(tp / fp)} ${cvFrom}` : '—';
  }
  const lim = document.getElementById('cv-limit-price');
  if (lim && !lim.value && tp && fp) lim.value = String((tp / (cvFrom === 'USDT' ? 1 : fp)).toFixed(6));
  renderLimitOrders();
}

async function doConvert(amount, fromAsset, toAsset, silent) {
  const res = await apiFetch('/finance/convert', {
    method: 'POST',
    body: JSON.stringify({ amount, fromAsset, toAsset }),
  });
  if (res.balances) profile.balances = res.balances;
  if (res.usdtBalance != null) profile.usdtBalance = res.usdtBalance;
  applyBalanceVisibility();
  if (!silent) tg.showAlert(`Готово: ${fromAsset} → ${toAsset}`);
  return res;
}

function limitOrders() {
  try { return JSON.parse(localStorage.getItem('byx_limits') || '[]'); } catch { return []; }
}
function saveLimitOrders(rows) {
  localStorage.setItem('byx_limits', JSON.stringify(rows));
}
function renderLimitOrders() {
  const rows = limitOrders().filter((o) => o.status === 'open');
  const el = document.getElementById('cv-orders-list');
  if (!el) return;
  if (!rows.length) { el.textContent = 'Нет активных ордеров'; el.className = 'muted'; return; }
  el.className = '';
  el.innerHTML = rows.map((o) => `<div class="pos-row">${o.amount} ${o.from} → ${o.to} @ ${o.price}</div>`).join('');
}
async function tryLimitOrders() {
  const rows = limitOrders();
  let changed = false;
  for (const o of rows) {
    if (o.status !== 'open') continue;
    const fp = o.from === 'USDT' ? 1 : pxOf(o.from);
    const tp = o.to === 'USDT' ? 1 : pxOf(o.to);
    if (!fp || !tp) continue;
    const px = tp / fp;
    if (px <= Number(o.price)) {
      try {
        await doConvert(o.amount, o.from, o.to, true);
        o.status = 'filled';
        changed = true;
      } catch { /* keep open */ }
    }
  }
  if (changed) {
    saveLimitOrders(rows);
    renderLimitOrders();
  }
}

document.querySelectorAll('.cv-mode').forEach((b) => {
  b.addEventListener('click', () => {
    cvMode = b.dataset.cv;
    document.querySelectorAll('.cv-mode').forEach((x) => x.classList.toggle('active', x === b));
    document.getElementById('cv-limit-box').classList.toggle('screen-hidden', cvMode !== 'limit');
    document.getElementById('cv-go').textContent = cvMode === 'limit' ? 'Разместить ордер' : 'Запрос';
  });
});
document.getElementById('cv-amount')?.addEventListener('input', refreshConvertPane);
document.getElementById('cv-max')?.addEventListener('click', () => {
  document.getElementById('cv-amount').value = String(walletAmt(cvFrom));
  refreshConvertPane();
});
{
  const el = document.getElementById('cv-swap');
  if (el) el.innerHTML = ICO_SWAP;
  const el2 = document.getElementById('convert-swap');
  if (el2) el2.innerHTML = ICO_SWAP;
}
document.getElementById('cv-swap')?.addEventListener('click', () => {
  const a = cvFrom; cvFrom = cvTo; cvTo = a;
  refreshConvertPane();
});
document.getElementById('cv-from-btn')?.addEventListener('click', () => {
  convertPickSide = 'from';
  openConvertAssetSheet('from');
});
document.getElementById('cv-to-btn')?.addEventListener('click', () => {
  convertPickSide = 'to';
  openConvertAssetSheet('to');
});
document.querySelectorAll('#cv-limit-box [data-pct]').forEach((b) => {
  b.addEventListener('click', () => {
    const p = Number(b.dataset.pct) / 100;
    const fp = cvFrom === 'USDT' ? 1 : pxOf(cvFrom);
    const tp = cvTo === 'USDT' ? 1 : pxOf(cvTo);
    if (!fp || !tp) return;
    document.getElementById('cv-limit-price').value = String(((tp / fp) * (1 + p)).toFixed(6));
  });
});
document.getElementById('cv-mkt')?.addEventListener('click', () => {
  const fp = cvFrom === 'USDT' ? 1 : pxOf(cvFrom);
  const tp = cvTo === 'USDT' ? 1 : pxOf(cvTo);
  if (fp && tp) document.getElementById('cv-limit-price').value = String((tp / fp).toFixed(6));
});
document.getElementById('cv-go')?.addEventListener('click', async () => {
  const err = document.getElementById('cv-error');
  err.textContent = '';
  const amount = parseQty(document.getElementById('cv-amount').value);
  if (!amount || amount <= 0) { err.textContent = 'укажите сумму'; return; }
  try {
    if (cvMode === 'limit') {
      const price = parseQty(document.getElementById('cv-limit-price').value);
      if (!price) { err.textContent = 'укажите цену'; return; }
      const rows = limitOrders();
      rows.push({ from: cvFrom, to: cvTo, amount, price, status: 'open', at: Date.now() });
      saveLimitOrders(rows);
      renderLimitOrders();
      tg.showAlert('Лимитный ордер размещён. Исполнится при достижении цены.');
    } else {
      await doConvert(amount, cvFrom, cvTo);
      refreshConvertPane();
    }
  } catch (e) {
    err.textContent = e.message;
  }
});

async function execSpot(side) {
  const err = document.getElementById('trade-error');
  if (err) err.textContent = '';
  const qty = parseQty(document.getElementById('trade-qty-input')?.value);
  const q = tradeQuote();
  const px = Number(q?.ask || q?.price);
  if (!qty || qty <= 0) {
    if (err) err.textContent = 'укажите количество, например 0.5';
    return;
  }
  if (!px) { if (err) err.textContent = 'нет цены'; return; }
  try {
    if (side === 'buy') await doConvert(qty * px, 'USDT', tradeSymbol);
    else await doConvert(qty, tradeSymbol, 'USDT');
    loadProfile().catch(() => {});
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

document.querySelectorAll('#trade-subtabs .trade-sub').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#trade-subtabs .trade-sub').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const sub = btn.dataset.sub;
    document.getElementById('trade-pane-chart').classList.toggle('screen-hidden', sub !== 'chart');
    document.getElementById('trade-pane-overview').classList.toggle('screen-hidden', sub !== 'overview');
    document.getElementById('trade-pane-data').classList.toggle('screen-hidden', sub !== 'data');
    document.getElementById('trade-pane-news').classList.toggle('screen-hidden', sub !== 'news');
    if (sub === 'overview') loadOverview();
    if (sub === 'data') loadFlow();
    if (sub === 'news') renderTradeNews();
    if (sub === 'chart') setTimeout(() => loadTradeChart({ silent: true }), 50);
  });
});

document.querySelectorAll('.trade-tf[data-interval]').forEach((btn) => {
  btn.addEventListener('click', () => {
    chartInterval = btn.dataset.interval;
    document.querySelectorAll('.trade-tf[data-interval]').forEach((b) => b.classList.toggle('active', b === btn));
    resetChartNav();
    loadTradeChart();
  });
});

document.getElementById('trade-buy')?.addEventListener('click', () => execSpot('buy'));
document.getElementById('trade-sell')?.addEventListener('click', () => execSpot('sell'));
document.getElementById('tradfi-go-trade')?.addEventListener('click', () => {
  setTradeProduct('spot');
  openTrade(tradeSymbol);
});
document.getElementById('trade-depth')?.addEventListener('click', () => setTradeProduct('futures'));

async function loadOverview() {
  const about = document.getElementById('ov-about');
  const metrics = document.getElementById('ov-metrics');
  try {
    const r = await fetch(`/api/market/coin?symbol=${encodeURIComponent(tradeSymbol)}`);
    const d = await r.json();
    about.textContent = d.description || 'Нет описания';
    const n = (x) => x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
    metrics.innerHTML = `
      <div><span>Рын. капитализация</span><b>$${n(d.marketCap)}</b></div>
      <div><span>FDV</span><b>$${n(d.fdv)}</b></div>
      <div><span>В обороте</span><b>${n(d.circulating)}</b></div>
      <div><span>Общая эмиссия</span><b>${n(d.total)}</b></div>
      <div><span>Макс. эмиссия</span><b>${n(d.max)}</b></div>`;
    const linksEl = document.getElementById('ov-links');
    if (linksEl) linksEl.innerHTML = '';
  } catch {
    about.textContent = 'Не удалось загрузить обзор';
  }
}

async function loadFlow() {
  const box = document.getElementById('data-flow');
  try {
    const data = await fetchKlines(tradeSymbol, dataInterval);
    const cs = data.candles || [];
    const slice = cs.slice(-40);
    let inn = 0; let out = 0;
    slice.forEach((c) => {
      if (c.close >= c.open) inn += c.volume || 0;
      else out += c.volume || 0;
    });
    const tot = inn + out || 1;
    box.innerHTML = `
      <div>Приток <b style="color:#0ecb81">${fmtCompact(inn)} ${tradeSymbol}</b></div>
      <div class="flow-bar"><i style="width:${(inn / tot) * 100}%;background:#0ecb81"></i></div>
      <div>Отток <b style="color:#f6465d">${fmtCompact(out)} ${tradeSymbol}</b></div>
      <div class="flow-bar"><i style="width:${(out / tot) * 100}%;background:#f6465d"></i></div>
      <div class="muted">Чистый поток ${fmtCompact(inn - out)} · интервал ${dataInterval}</div>`;
  } catch {
    box.textContent = 'Нет данных потока';
  }
}
document.querySelectorAll('#data-tf button').forEach((b) => {
  b.addEventListener('click', () => {
    dataInterval = b.dataset.df;
    document.querySelectorAll('#data-tf button').forEach((x) => x.classList.toggle('active', x === b));
    loadFlow();
  });
});

function renderTradeNews() {
  const mini = document.getElementById('trade-news-mini');
  if (!mini) return;
  const items = lastNewsItems.filter((n) => {
    const t = `${n.title || ''} ${n.body || ''}`.toLowerCase();
    if (newsFilter === 'token') return t.includes(tradeSymbol.toLowerCase()) || t.includes((tradeQuote()?.name || '').toLowerCase());
    if (newsFilter === 'macro') return /fed|ставк|инфляц|macro|bank|цб|доллар/i.test(t);
    return true;
  });
  mini.innerHTML = (items.length ? items : lastNewsItems).slice(0, 12).map((n) => {
    const date = n.publishedAt ? new Date(n.publishedAt).toISOString().slice(0, 16).replace('T', ' ') : '';
    const bull = /bull|рост|etf|buy/i.test(n.title || '');
    const bear = /bear|пад|crash|sell/i.test(n.title || '');
    const tag = bull ? 'Бычьи' : bear ? 'Медвежий тренд' : 'Нейтральный';
    return `<div class="news-item" style="display:block;padding:10px 0;border-bottom:1px solid #1a1a1a">
      <div class="news-meta">${date} UTC · ${escapeHtml(n.source || '')} · ${tag}</div>
      <div class="news-title">${escapeHtml(n.title || '')}</div></div>`;
  }).join('') || '<div class="muted">Нет новостей</div>';
}
document.querySelectorAll('.news-pills button').forEach((b) => {
  b.addEventListener('click', () => {
    newsFilter = b.dataset.nf;
    document.querySelectorAll('.news-pills button').forEach((x) => x.classList.toggle('active', x === b));
    renderTradeNews();
  });
});

async function loadFutures() {
  try {
    const r = await fetch(`/api/market/futures?symbol=${futSymbol}USDT`);
    const d = await r.json();
    futMark = Number(d.mark || d.price) || 0;
    const chg = fmtChange(d.change24h);
    const el = document.getElementById('fut-chg');
    el.textContent = chg.text;
    el.className = `trade-chg ${chg.up ? 'up' : 'down'}`;
    document.getElementById('fut-mark').textContent = fmtUsdPrice(futMark);
    document.getElementById('fut-mark').style.color = chg.up ? '#0ecb81' : '#f6465d';
    document.getElementById('fut-index').textContent = `Index ${fmtUsdPrice(d.index)}`;
    const left = d.nextFunding ? Math.max(0, d.nextFunding - Date.now()) : 0;
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    document.getElementById('fut-fund').textContent =
      `Funding ${Number(d.funding || 0).toFixed(4)}% / ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (!document.getElementById('fut-price').value) document.getElementById('fut-price').value = String(futMark);
    document.getElementById('fut-avail').textContent = `Доступно ${fmtUsdPrice(walletAmt('USDT'))} USDT`;
    updateFutCost();
  } catch { /* ignore */ }
  try {
    const r = await fetch(`/api/market/depth?symbol=${futSymbol}USDT&market=futures`);
    const d = await r.json();
    const asks = (d.asks || []).slice(0, 8).reverse();
    const bids = (d.bids || []).slice(0, 8);
    document.getElementById('fut-asks').innerHTML = asks.map((a) =>
      `<div class="ask"><span>${fmtUsdPrice(a.price)}</span><span>${Number(a.qty).toFixed(4)}</span></div>`).join('');
    document.getElementById('fut-bids').innerHTML = bids.map((a) =>
      `<div class="bid"><span>${fmtUsdPrice(a.price)}</span><span>${Number(a.qty).toFixed(4)}</span></div>`).join('');
  } catch { /* ignore */ }
  renderPaper();
}

function updateFutCost() {
  const qty = parseQty(document.getElementById('fut-qty')?.value) || 0;
  const px = parseQty(document.getElementById('fut-price')?.value) || futMark;
  const cost = qty && px ? (qty * px) / futLeverage : 0;
  document.getElementById('fut-cost').textContent = `Стоимость ${fmtUsdPrice(cost)} USDT · ${futLeverage}x`;
}
document.getElementById('fut-qty')?.addEventListener('input', updateFutCost);
document.getElementById('fut-price')?.addEventListener('input', updateFutCost);
document.getElementById('fut-lev')?.addEventListener('click', () => {
  futLeverage = futLeverage >= 50 ? 5 : futLeverage * 2;
  document.getElementById('fut-lev').textContent = `${futLeverage}x`;
  updateFutCost();
});
document.querySelectorAll('#fut-pct button').forEach((b) => {
  b.addEventListener('click', () => {
    const pct = Number(b.dataset.fp) / 100;
    const px = parseQty(document.getElementById('fut-price').value) || futMark;
    if (!px) return;
    const margin = walletAmt('USDT') * pct;
    document.getElementById('fut-qty').value = String(((margin * futLeverage) / px).toFixed(6));
    updateFutCost();
  });
});
document.getElementById('fut-pair-btn')?.addEventListener('click', () => {
  fillTradePairList();
  document.getElementById('trade-pair-sheet').classList.remove('screen-hidden');
});

async function loadPaper() {
  try {
    paperPositions = await apiFetch('/finance/paper');
  } catch { paperPositions = []; }
  renderPaper();
}
function renderPaper() {
  const box = document.getElementById('fut-pos-list');
  if (!box) return;
  const rows = (paperPositions || []).filter((p) => p.market !== 'option');
  if (!rows.length) { box.innerHTML = '<div class="muted">Нет позиций</div>'; return; }
  box.innerHTML = rows.map((p) => {
    const mark = p.symbol === futSymbol ? futMark : pxOf(p.symbol);
    const dir = p.side === 'short' ? -1 : 1;
    const pnl = mark ? (mark - p.entry) * p.qty * dir : 0;
    return `<div class="pos-row">
      <div>${p.side.toUpperCase()} ${p.symbol} ${p.leverage}x<br><span class="muted">${p.qty} @ ${fmtUsdPrice(p.entry)}</span></div>
      <div style="color:${pnl >= 0 ? '#0ecb81' : '#f6465d'}">${pnl >= 0 ? '+' : ''}${fmtUsdPrice(pnl)}
        <button type="button" class="fut-chip" data-close="${p.id}">Закрыть</button></div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => closePaper(Number(b.dataset.close));
  });
}
async function openPaper(side) {
  const err = document.getElementById('fut-error');
  err.textContent = '';
  const qty = parseQty(document.getElementById('fut-qty').value);
  const entry = parseQty(document.getElementById('fut-price').value) || futMark;
  try {
    const res = await apiFetch('/finance/paper/open', {
      method: 'POST',
      body: JSON.stringify({ market: 'futures', symbol: futSymbol, side, qty, leverage: futLeverage, entry }),
    });
    if (res.balances) profile.balances = res.balances;
    if (res.usdtBalance != null) profile.usdtBalance = res.usdtBalance;
    paperPositions = res.positions || [];
    applyBalanceVisibility();
    renderPaper();
    document.getElementById('fut-avail').textContent = `Доступно ${fmtUsdPrice(walletAmt('USDT'))} USDT`;
  } catch (e) {
    err.textContent = e.message;
  }
}
async function closePaper(id, mark) {
  const pos = (paperPositions || []).find((p) => p.id === id);
  const px = mark || (pos?.symbol === futSymbol ? futMark : pxOf(pos?.symbol || futSymbol));
  try {
    const res = await apiFetch('/finance/paper/close', {
      method: 'POST',
      body: JSON.stringify({ id, mark: px }),
    });
    if (res.balances) profile.balances = res.balances;
    if (res.usdtBalance != null) profile.usdtBalance = res.usdtBalance;
    paperPositions = res.positions || [];
    applyBalanceVisibility();
    renderPaper();
    refreshOptions();
    tg.showAlert(`Закрыто. PnL ${fmtUsdPrice(res.pnl)}`);
  } catch (e) {
    tg.showAlert(e.message);
  }
}
document.getElementById('fut-long')?.addEventListener('click', () => openPaper('long'));
document.getElementById('fut-short')?.addEventListener('click', () => openPaper('short'));

function refreshOptions() {
  const px = pxOf('BTC') || futMark;
  document.getElementById('opt-px').textContent = fmtUsdPrice(px);
  document.getElementById('opt-bal').textContent = `Доступный баланс ${fmtUsdPrice(walletAmt('USDT'))} USDT`;
  const sl = document.getElementById('opt-slider');
  const target = px * (0.9 + (Number(sl.value) / 100) * 0.25);
  document.getElementById('opt-target').textContent = fmtUsdPrice(target);
  const levels = [0.07, 0.08, 0.055, 0.045].map((k) => px * (1 + k));
  document.getElementById('opt-scenarios').innerHTML = levels.map((lv) => `
    <div class="opt-sc">
      <div>Цена BTC выше ${fmtUsdPrice(lv)}</div>
      <button type="button" data-opt="${lv}">Подписаться</button>
    </div>`).join('');
  document.querySelectorAll('#opt-scenarios [data-opt]').forEach((b) => {
    b.onclick = () => subscribeOption(Number(b.dataset.opt));
  });
}
document.getElementById('opt-slider')?.addEventListener('input', refreshOptions);
async function subscribeOption(target) {
  const err = document.getElementById('opt-error');
  err.textContent = '';
  const invest = parseQty(document.getElementById('opt-invest').value);
  const entry = pxOf('BTC');
  if (!invest) { err.textContent = 'укажите сумму'; return; }
  try {
    const res = await apiFetch('/finance/paper/open', {
      method: 'POST',
      body: JSON.stringify({
        market: 'option', symbol: 'BTC', side: 'up', qty: invest, leverage: 1, entry, target,
      }),
    });
    if (res.balances) profile.balances = res.balances;
    if (res.usdtBalance != null) profile.usdtBalance = res.usdtBalance;
    paperPositions = res.positions || [];
    applyBalanceVisibility();
    tg.showAlert('Опцион оформлен. Прибыль начислится при закрытии, если цель достигнута.');
    refreshOptions();
  } catch (e) {
    err.textContent = e.message;
  }
}

const alphaState = {
  pane: 'market',
  chip: 'new',
  q: '',
  data: { sniping: [], farms: [], market: [] },
};

async function loadAlpha() {
  try {
    applyBalanceVisibility();
  } catch { /* ignore */ }
  const pnl = document.getElementById('alpha-pnl');
  if (pnl) pnl.innerHTML = `P&amp;L за сегодня <span>--</span> <span class="alpha-chev">›</span>`;
  try {
    const r = await fetch('/api/market/alpha');
    const data = await r.json();
    if (Array.isArray(data)) {
      alphaState.data = { sniping: data.slice(0, 2), farms: [], market: data };
    } else if (data && Array.isArray(data.market)) {
      alphaState.data = data;
    } else {
      alphaState.data = { sniping: [], farms: [], market: [] };
    }
    renderAlpha();
  } catch {
    alphaState.data = { sniping: [], farms: [], market: [] };
    document.getElementById('alpha-list').innerHTML = '<div class="hist-empty">Не удалось загрузить Alpha</div>';
  }
}

function alphaFavs() {
  try { return JSON.parse(localStorage.getItem('alphaFavs') || '[]'); } catch { return []; }
}
function setAlphaFav(sym, on) {
  const s = String(sym).toUpperCase();
  const cur = new Set(alphaFavs());
  if (on) cur.add(s); else cur.delete(s);
  localStorage.setItem('alphaFavs', JSON.stringify([...cur]));
}

function alphaSpark(up) {
  const d = up
    ? 'M1 16C8 14 14 8 22 9C30 10 36 4 49 5'
    : 'M1 5C10 7 16 13 24 11C32 9 38 18 49 17';
  const c = up ? '#0ecb81' : '#f6465d';
  return `<svg class="alpha-spark" viewBox="0 0 50 22" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}

function renderAlpha() {
  const data = alphaState.data || {};
  const sniping = Array.isArray(data.sniping) ? data.sniping : [];
  const farms = Array.isArray(data.farms) ? data.farms : [];
  const market = Array.isArray(data.market) ? data.market : [];
  const fav = new Set(alphaFavs());

  document.getElementById('alpha-new').innerHTML = sniping.slice(0, 2).map((a) => {
    const chg = fmtChange(a.change24h);
    const foot = a.created
      ? `Создан:${escapeHtml(a.created)}`
      : `${fmtCompact(a.marketCap)} рыночная капитал<br>Объем, 24H: ${fmtCompact(a.volume24h)}`;
    return `<button type="button" class="alpha-card" data-alpha-sym="${escapeHtml(a.symbol)}">
      <div class="alpha-card-tag">${escapeHtml(a.tag || 'Новые')}</div>
      <div class="alpha-card-name">${coinLogoHtml(a.symbol, 22, a.image)} ${escapeHtml(a.symbol)}
        ${a.popular ? '<span class="alpha-pop">Популярно</span>' : ''}</div>
      <div class="alpha-card-px">${fmtUsdPrice(a.price)} <span class="${chg.up ? 'chg-up' : 'chg-down'}">${chg.text}</span></div>
      ${alphaSpark(chg.up)}
      <div class="alpha-card-foot">${foot}</div>
    </button>`;
  }).join('') || '<div class="hist-empty">Нет новинок</div>';

  document.getElementById('alpha-farms').innerHTML = farms.slice(0, 2).map((f) => `
    <button type="button" class="alpha-card" data-alpha-farm="${escapeHtml(f.pair)}">
      <div class="alpha-card-tag">${escapeHtml(f.tag || 'Farm')}</div>
      <div class="alpha-farm-pair">
        ${farmPairHtml(f, 32)}
        ${escapeHtml(f.pair)}
        ${f.popular ? '<span class="alpha-pop">Популярно</span>' : ''}
      </div>
      <div class="alpha-farm-metrics">${Number(f.apr).toFixed(2)}% APR <span>${fmtCompact(f.tvl)} TVL</span></div>
    </button>`).join('');

  const q = alphaState.q.trim().toUpperCase();
  let rows = market.slice();
  if (alphaState.pane === 'farm') {
    document.getElementById('alpha-list').innerHTML = farms.map((f) => `
      <button type="button" class="alpha-row" data-alpha-farm="${escapeHtml(f.pair)}">
        <div class="alpha-row-l">
          ${farmPairHtml(f, 36)}
          <div><div class="hist-sym">${escapeHtml(f.pair)}</div>
            <div class="alpha-row-meta">${escapeHtml(f.tag)} · ${fmtCompact(f.tvl)} TVL</div></div>
        </div>
        <div class="alpha-row-r"><div class="alpha-row-px">${Number(f.apr).toFixed(2)}% APR</div></div>
      </button>`).join('');
    document.getElementById('alpha-empty').classList.add('screen-hidden');
    document.getElementById('alpha-cols')?.classList.add('screen-hidden');
    document.getElementById('alpha-chips')?.classList.add('screen-hidden');
    return;
  }
  if (alphaState.pane === 'balance') {
    document.getElementById('alpha-list').innerHTML = '';
    document.getElementById('alpha-empty').classList.remove('screen-hidden');
    document.getElementById('alpha-empty').textContent = 'Нет Alpha-активов на балансе';
    document.getElementById('alpha-cols')?.classList.add('screen-hidden');
    document.getElementById('alpha-chips')?.classList.add('screen-hidden');
    return;
  }
  document.getElementById('alpha-empty').classList.add('screen-hidden');
  document.getElementById('alpha-cols')?.classList.remove('screen-hidden');
  document.getElementById('alpha-chips')?.classList.remove('screen-hidden');

  if (alphaState.chip === 'fav') rows = rows.filter((a) => fav.has(String(a.symbol).toUpperCase()));
  else if (alphaState.chip === 'hot') rows = rows.filter((a) => a.chip === 'hot');
  else if (alphaState.chip === 'stocks') rows = [];
  if (q) rows = rows.filter((a) => String(a.symbol).toUpperCase().includes(q) || String(a.name || '').toUpperCase().includes(q));

  if (alphaState.chip === 'stocks') {
    document.getElementById('alpha-list').innerHTML = farms.filter((f) => /stock|rwa|nvda|tsla|spcx/i.test(`${f.tag} ${f.pair}`)).map((f) => `
      <button type="button" class="alpha-row" data-alpha-farm="${escapeHtml(f.pair)}">
        <div class="alpha-row-l">
          ${farmPairHtml(f, 36)}
          <div><div class="hist-sym">${escapeHtml(f.pair)}</div>
            <div class="alpha-row-meta">${fmtCompact(f.tvl)} TVL</div></div>
        </div>
        <div class="alpha-row-r"><div class="alpha-chg up">${Number(f.apr).toFixed(2)}%</div></div>
      </button>`).join('') || '';
    document.getElementById('alpha-empty').classList.toggle('screen-hidden', Boolean(document.getElementById('alpha-list').innerHTML));
    document.getElementById('alpha-empty').textContent = 'Нет Stocks';
    return;
  }

  if (!rows.length) {
    document.getElementById('alpha-list').innerHTML = '';
    document.getElementById('alpha-empty').classList.remove('screen-hidden');
    document.getElementById('alpha-empty').textContent = 'Нет монет';
    return;
  }
  document.getElementById('alpha-list').innerHTML = rows.map((a) => {
    const chg = fmtChange(a.change24h);
    const on = fav.has(String(a.symbol).toUpperCase());
    return `<button type="button" class="alpha-row" data-alpha-sym="${escapeHtml(a.symbol)}" data-alpha-chg="${a.change24h ?? ''}">
      <div class="alpha-row-l">
        <span class="alpha-star ${on ? 'on' : ''}" data-alpha-fav="${escapeHtml(a.symbol)}">${on ? '★' : '☆'}</span>
        ${coinLogoHtml(a.symbol, 28, a.image)}
        <div>
          <div class="hist-sym">${escapeHtml(a.symbol)}</div>
          <div class="alpha-row-meta">${fmtCompact(a.volume24h)} | ${fmtCompact(a.marketCap)}</div>
        </div>
      </div>
      <div class="alpha-row-r">
        <div class="alpha-row-px">${fmtUsdPrice(a.price)}</div>
        <div class="alpha-chg ${chg.up ? 'up' : 'down'}">${chg.text}</div>
      </div>
    </button>`;
  }).join('');
}

document.getElementById('alpha-eye')?.addEventListener('click', () => {
  balanceHidden = !balanceHidden;
  applyBalanceVisibility();
});
document.getElementById('alpha-pnl')?.addEventListener('click', () => showScreen('history'));
document.querySelectorAll('#alpha-chips [data-alpha-chip]').forEach((btn) => {
  btn.addEventListener('click', () => {
    alphaState.chip = btn.getAttribute('data-alpha-chip') || 'new';
    document.querySelectorAll('#alpha-chips [data-alpha-chip]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderAlpha();
  });
});
document.querySelectorAll('[data-alpha-pane]').forEach((btn) => {
  btn.addEventListener('click', () => {
    alphaState.pane = btn.getAttribute('data-alpha-pane') || 'market';
    document.querySelectorAll('[data-alpha-pane]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    renderAlpha();
  });
});
document.getElementById('alpha-search-btn')?.addEventListener('click', () => {
  document.getElementById('alpha-search')?.classList.toggle('screen-hidden');
});
document.getElementById('alpha-search')?.addEventListener('input', (e) => {
  alphaState.q = e.target.value || '';
  renderAlpha();
});
document.getElementById('alpha-sort-btn')?.addEventListener('click', () => {
  const order = ['new', 'hot', 'fav', 'stocks'];
  const i = order.indexOf(alphaState.chip);
  alphaState.chip = order[(i + 1) % order.length];
  document.querySelectorAll('#alpha-chips [data-alpha-chip]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-alpha-chip') === alphaState.chip);
  });
  renderAlpha();
});
document.getElementById('trade-body-alpha')?.addEventListener('click', (e) => {
  const favBtn = e.target.closest('[data-alpha-fav]');
  if (favBtn) {
    e.preventDefault();
    e.stopPropagation();
    const sym = favBtn.getAttribute('data-alpha-fav');
    setAlphaFav(sym, !alphaFavs().includes(String(sym).toUpperCase()));
    renderAlpha();
    return;
  }
  const farm = e.target.closest('[data-alpha-farm]');
  if (farm) {
    showScreen('earn');
    return;
  }
  const row = e.target.closest('[data-alpha-sym]');
  if (row) {
    const chg = Number(row.getAttribute('data-alpha-chg'));
    setTradeProduct('spot');
    openTrade(row.getAttribute('data-alpha-sym'), Number.isFinite(chg) ? chg : undefined);
  }
});

document.querySelectorAll('.tab').forEach((tab) => {
  if (tab.dataset.tab === 'trade') {
    tab.addEventListener('click', () => openTrade(tradeSymbol));
  }
});

document.getElementById('chart-buy')?.addEventListener('click', () => {
  const id = String(chartSymbol || 'BTC').toUpperCase();
  convertFromAsset = 'USDT';
  convertToAsset = CONVERT_ASSETS.some((a) => a.id === id) ? id : 'BTC';
  showScreen('convert');
});

async function fetchKlines(symbol, interval) {
  const pair = `${String(symbol).toUpperCase().replace(/USDT$/, '')}USDT`;
  // 1) напрямую Binance (без Telegram auth)
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=120`
    );
    if (r.ok) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length) {
        const candles = raw.map((k) => ({
          time: k[0], open: Number(k[1]), high: Number(k[2]),
          low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
        }));
        return {
          symbol: pair.replace('USDT', ''),
          pair,
          candles,
          last: candles[candles.length - 1].close,
        };
      }
    }
  } catch (_) { /* fallback below */ }

  // 2) наш API
  const r2 = await fetch(
    `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}`,
    { headers: { 'X-Telegram-Init-Data': tg.initData || '' } }
  );
  const data = await r2.json().catch(() => ({}));
  if (!r2.ok || !data.candles?.length) {
    throw new Error(data.error || 'Не удалось загрузить график');
  }
  return data;
}

async function loadChart({ silent = false } = {}) {
  const canvas = document.getElementById('chart-canvas');
  const empty = document.getElementById('chart-empty');
  if (!silent) {
    empty.classList.remove('screen-hidden');
    empty.textContent = 'Загрузка графика…';
  }
  document.getElementById('chart-title').textContent = `${chartSymbol} / USDT`;
  try {
    const data = await fetchKlines(chartSymbol, chartInterval);
    empty.classList.add('screen-hidden');
    chartCandles = data.candles || [];
    document.getElementById('chart-price').textContent = `$${fmtUsdPrice(data.last)}`;
    document.getElementById('chart-pair').textContent = data.pair || `${chartSymbol}USDT`;
    const chg = fmtChange(chartChange24h == null || chartChange24h === '' ? null : Number(chartChange24h));
    const chgEl = document.getElementById('chart-change');
    chgEl.textContent = chg.text;
    chgEl.className = chg.up ? 'chg-up' : 'chg-down';
    drawCandles(canvas, chartCandles);
  } catch (e) {
    if (!silent) {
      empty.classList.remove('screen-hidden');
      empty.textContent = 'Не удалось загрузить график. Попробуйте позже.';
    }
    console.error('[chart]', e);
  }
}

function startChartLive() {
  stopChartLive();
  chartLiveTimer = setInterval(() => {
    const onTrade = !document.getElementById('screen-trade')?.classList.contains('screen-hidden');
    const onChart = !document.getElementById('screen-chart')?.classList.contains('screen-hidden');
    if (onTrade) loadTradeChart({ silent: true });
    if (onTrade && tradeProduct === 'futures') loadFutures();
    else if (onChart) loadChart({ silent: true });
  }, 12_000);
}
function stopChartLive() {
  if (chartLiveTimer) {
    clearInterval(chartLiveTimer);
    chartLiveTimer = null;
  }
}

function applyLivePriceToChart(symbol, price, change24h) {
  const onChart = !document.getElementById('screen-chart')?.classList.contains('screen-hidden');
  if (!onChart || !chartCandles.length) return;
  if (String(symbol).toUpperCase() !== String(chartSymbol).toUpperCase()) return;
  const last = chartCandles[chartCandles.length - 1];
  const px = Number(price);
  if (!Number.isFinite(px) || px <= 0) return;
  last.close = px;
  last.high = Math.max(last.high, px);
  last.low = Math.min(last.low, px);
  const priceEl = document.getElementById('chart-price');
  if (priceEl) priceEl.textContent = `$${fmtUsdPrice(px)}`;
  if (change24h != null) {
    chartChange24h = change24h;
    const chg = fmtChange(Number(change24h));
    const chgEl = document.getElementById('chart-change');
    if (chgEl) {
      chgEl.textContent = chg.text;
      chgEl.className = chg.up ? 'chg-up' : 'chg-down';
    }
  }
  drawCandles(document.getElementById('chart-canvas'), chartCandles);
}

function drawCandles(canvas, candles) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = 220;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { t: 12, r: 12, b: 20, l: 12 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;
  let min = Infinity;
  let max = -Infinity;
  candles.forEach((c) => {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
  });
  const span = max - min || 1;
  const slot = w / candles.length;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = pad.t + (h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
  }

  candles.forEach((c, i) => {
    const x = pad.l + i * slot + slot / 2;
    const yHigh = pad.t + ((max - c.high) / span) * h;
    const yLow = pad.t + ((max - c.low) / span) * h;
    const yOpen = pad.t + ((max - c.open) / span) * h;
    const yClose = pad.t + ((max - c.close) / span) * h;
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? '#0ecb81' : '#f6465d';
    ctx.fillStyle = up ? '#0ecb81' : '#f6465d';
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - Math.max(1, slot * 0.3), bodyTop, Math.max(2, slot * 0.6), bodyH);
  });

  const last = candles[candles.length - 1];
  if (last) {
    const y = pad.t + ((max - last.close) / span) * h;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(247,166,0,0.7)';
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f7a600';
    ctx.beginPath();
    ctx.arc(pad.l + w, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

document.querySelectorAll('#chart-intervals [data-interval]').forEach((btn) => {
  btn.addEventListener('click', () => {
    chartInterval = btn.dataset.interval;
    document.querySelectorAll('#chart-intervals .seg-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    loadChart();
  });
});

// ---------- markets ----------
function flashEl(el, up) {
  if (!el) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(up ? 'flash-up' : 'flash-down');
}

function ingestQuotes(quotes) {
  if (!Array.isArray(quotes) || !quotes.length) return;
  applyMarketQuotes(quotes);
  const btcQ = quotes.find((q) => String(q.symbol).toUpperCase() === 'BTC');
  if (btcQ?.price) lastBtcPrice = Number(btcQ.price) || lastBtcPrice;
  renderQuotesUi(quotes);
  renderTickersList(quotes);
  tryLimitOrders().catch(() => {});
  quotes.forEach((q) => applyLivePriceToChart(q.symbol, q.price, q.change24h));
  quotes.forEach((q) => applyLivePriceToTrade(q));
  const onConvert = !document.getElementById('screen-convert')?.classList.contains('screen-hidden');
  if (onConvert) updateConvertEstimate();
}

function bindQuoteClicks(quotes) {
  document.querySelectorAll('#quotes-list [data-symbol]').forEach((row) => {
    row.onclick = () => openChart(row.dataset.symbol, row.dataset.change);
  });
  document.querySelectorAll('#ticker-strip .ticker-chip').forEach((chip, idx) => {
    const q = quotes[idx];
    if (!q) return;
    chip.style.cursor = 'pointer';
    chip.onclick = () => openChart(q.symbol, q.change24h);
  });
}

function renderQuotesUi(quotes) {
  const list = document.getElementById('quotes-list');
  const strip = document.getElementById('ticker-strip');
  if (!list || !strip) return;
  const rows = list.querySelectorAll('.quote-row');
  if (quotesBuilt && rows.length === quotes.length) {
    quotes.forEach((q, i) => {
      const row = rows[i];
      row.dataset.change = q.change24h ?? '';
      const px = row.querySelector('.quote-price');
      const pill = row.querySelector('.chg-pill');
      const next = `$${fmtUsdPrice(q.price)}`;
      const prev = Number(px?.dataset.px);
      if (px && px.textContent !== next) {
        if (Number.isFinite(prev) && Number(q.price) !== prev) flashEl(px, Number(q.price) >= prev);
        px.textContent = next;
        px.dataset.px = String(q.price);
      }
      const chg = fmtChange(q.change24h);
      if (pill) {
        pill.textContent = chg.text;
        pill.className = `chg-pill ${chg.up ? 'up' : 'down'}`;
      }
      const chip = strip.children[i];
      if (chip && i < 6) {
        const cpx = chip.querySelector('.px');
        const cchg = chip.querySelector('.chg');
        if (cpx) cpx.textContent = fmtUsdPrice(q.price);
        if (cchg) {
          cchg.textContent = chg.text;
          cchg.className = `chg ${chg.up ? 'chg-up' : 'chg-down'}`;
        }
      }
    });
    bindQuoteClicks(quotes);
    return;
  }

  strip.innerHTML = quotes.slice(0, 6).map((q, i) => {
    const chg = fmtChange(q.change24h);
    return `
      <div class="ticker-chip" style="animation-delay:${i * 40}ms">
        <div class="sym">${escapeHtml(q.symbol)}/USDT</div>
        <div class="px mono">${fmtUsdPrice(q.price)}</div>
        <div class="chg ${chg.up ? 'chg-up' : 'chg-down'}">${chg.text}</div>
      </div>`;
  }).join('');

  list.innerHTML = quotes.map((q, i) => {
    const chg = fmtChange(q.change24h);
    return `
      <button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}" data-change="${q.change24h ?? ''}">
        ${coinLogoHtml(q.symbol, 36)}
        <div>
          <div class="quote-name">${escapeHtml(q.symbol)}<span style="color:var(--text-3);font-weight:500"> / USDT</span></div>
          <div class="quote-full">${escapeHtml(q.name)}</div>
        </div>
        <div class="quote-right">
          <div class="quote-price mono" data-px="${q.price ?? ''}">$${fmtUsdPrice(q.price)}</div>
          <span class="chg-pill ${chg.up ? 'up' : 'down'}">${chg.text}</span>
        </div>
      </button>`;
  }).join('');
  quotesBuilt = true;
  bindQuoteClicks(quotes);
}

async function loadQuotes() {
  try {
    const r = await fetch('/api/market/quotes', { cache: 'no-store' });
    const quotes = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(quotes)) throw new Error(quotes?.error || 'bad');
    ingestQuotes(quotes);
  } catch {
    if (!quotesBuilt) {
      document.getElementById('ticker-strip').innerHTML = '';
      document.getElementById('quotes-list').innerHTML =
        '<div class="empty">Не удалось загрузить котировки</div>';
    }
  }
}

function stopQuotesLive() {
  if (quotesEs) {
    try { quotesEs.close(); } catch { /* ignore */ }
    quotesEs = null;
  }
  if (quotesWs) {
    try { quotesWs.close(); } catch { /* ignore */ }
    quotesWs = null;
  }
  if (quotesTimer) {
    clearInterval(quotesTimer);
    quotesTimer = null;
  }
}

function startQuotesSse() {
  try {
    quotesEs = new EventSource('/api/market/stream');
    quotesEs.onmessage = (ev) => {
      try {
        const quotes = JSON.parse(ev.data);
        if (Array.isArray(quotes)) ingestQuotes(quotes);
      } catch { /* ignore */ }
    };
    quotesEs.onerror = () => {
      if (quotesEs) {
        quotesEs.close();
        quotesEs = null;
      }
      if (!quotesTimer) quotesTimer = setInterval(loadQuotes, 5000);
    };
  } catch {
    quotesTimer = setInterval(loadQuotes, 5000);
  }
}

function startQuotesLive() {
  stopQuotesLive();
  const streams = (lastQuotes.length ? lastQuotes : [
    { symbol: 'BTC' }, { symbol: 'ETH' }, { symbol: 'BNB' }, { symbol: 'SOL' },
    { symbol: 'XRP' }, { symbol: 'DOGE' }, { symbol: 'ADA' }, { symbol: 'TON' },
    { symbol: 'AVAX' }, { symbol: 'LINK' }, { symbol: 'TRX' },
  ]).map((q) => `${String(q.symbol).toLowerCase()}usdt@miniTicker`).join('/');
  try {
    quotesWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    quotesWs.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg.data || msg;
        if (!d?.s || !lastQuotes.length) return;
        const symbol = String(d.s).replace(/USDT$/i, '').toUpperCase();
        const price = Number(d.c);
        const open = Number(d.o);
        const change24h = open ? ((price - open) / open) * 100 : null;
        const next = lastQuotes.map((q) => (
          String(q.symbol).toUpperCase() === symbol
            ? { ...q, price, change24h: change24h == null ? q.change24h : change24h }
            : q
        ));
        ingestQuotes(next);
      } catch { /* ignore */ }
    };
    quotesWs.onerror = () => {
      try { quotesWs.close(); } catch { /* ignore */ }
      quotesWs = null;
      startQuotesSse();
    };
    quotesWs.onclose = () => {
      if (appReady && !quotesEs && !quotesTimer) startQuotesSse();
    };
  } catch {
    startQuotesSse();
  }
}

async function loadNews() {
  const list = document.getElementById('news-list');
  if (!list) return;
  const hadItems = Boolean(list.querySelector('.news-item'));
  try {
    const r = await fetch('/api/market/news?t=' + Date.now(), { cache: 'no-store' });
    const news = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(news)) throw new Error(news?.error || 'bad');
    if (!news.length) {
      if (!hadItems) list.innerHTML = '<div class="empty">Новостей пока нет</div>';
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
    lastNewsItems = news;
    const tick = document.getElementById('trade-ticker-text');
    if (tick && news[0]?.title) tick.textContent = news[0].title;
    list.querySelectorAll('a.news-item').forEach((a) => {
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
    renderTradeNews();
  } catch {
    if (!hadItems) {
      list.innerHTML = '<div class="empty">Не удалось загрузить новости</div>';
    }
  }
}

async function boot() {
  showAuthGate('loading');
  await wakeServer();
  try {
    const me = await apiFetch('/users/me', {}, { retries: 5 });
    if (me.needLogin) {
      showAuthGate('forms');
      setAuthTab('login');
      if (me.banned) showBanOverlay(me.banReason);
      return;
    }
    if (me.registered) {
      enterApp(me);
      return;
    }
    const tgUser = tg.initDataUnsafe?.user;
    if (tgUser?.first_name) {
      const parts = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
      if (parts) document.getElementById('reg-fio').value = parts;
    }
    showAuthGate('forms');
  } catch (e) {
    console.error(e);
    showAuthGate('forms');
    const el = document.getElementById('reg-error-1');
    if (el) el.textContent = 'Сервер просыпается, попробуйте ещё раз через пару секунд';
  }
}

document.getElementById('login-2fa-back')?.addEventListener('click', () => {
  pendingTotpToken = '';
  showAuthGate('forms');
  setAuthTab('login');
});
document.getElementById('login-2fa-submit')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('login-2fa-error');
  errorEl.textContent = '';
  const code = document.getElementById('login-2fa-code').value.trim();
  if (!code) {
    errorEl.textContent = 'Введите код';
    return;
  }
  try {
    const me = await apiFetch('/users/me/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ totpToken: pendingTotpToken, code }),
    });
    pendingTotpToken = '';
    enterApp(me);
  } catch (e) {
    errorEl.textContent = e.message;
  }
});
document.getElementById('login-2fa-code')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-2fa-submit')?.click();
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  try { await apiFetch('/users/me/logout', { method: 'POST' }, { retries: 1 }); } catch { /* anyway */ }
  forceLogoutToAuth('');
});

document.getElementById('ban-support')?.addEventListener('click', () => {
  document.getElementById('ban-overlay')?.classList.add('screen-hidden');
  if (profile && !document.getElementById('app-shell').classList.contains('screen-hidden')) {
    showScreen('support');
  } else {
    showAuthGate('forms');
    setAuthTab('login');
    tg.showAlert('Войдите, затем откройте поддержку — или напишите в бота.');
  }
});

function fillTotpSetup(res, { keepCode = false } = {}) {
  try { sessionStorage.setItem('totp_setup', '1'); } catch { /* ignore */ }
  document.getElementById('totp-setup')?.classList.remove('screen-hidden');
  const qr = document.getElementById('totp-qr');
  if (qr && res.qrSvg) qr.innerHTML = res.qrSvg;
  const secretEl = document.getElementById('totp-secret');
  if (secretEl) {
    secretEl.value = res.secret || '';
    secretEl.onclick = () => { secretEl.select(); secretEl.setSelectionRange(0, 999); };
  }
  window.pendingOtpauth = res.otpauth || '';
  if (!keepCode) {
    const codeEl = document.getElementById('totp-enable-code');
    if (codeEl) codeEl.value = '';
  }
}

let totpRestoreBusy = false;
async function restoreTotpSetup() {
  if (totpRestoreBusy || profile?.totpEnabled) return;
  totpRestoreBusy = true;
  try {
    const res = await apiFetch('/users/me/2fa/setup', { method: 'POST', body: JSON.stringify({}) });
    fillTotpSetup(res, { keepCode: true });
  } catch { /* ignore */ }
  totpRestoreBusy = false;
}

document.getElementById('totp-start-btn')?.addEventListener('click', async () => {
  const err = document.getElementById('totp-error');
  if (err) err.textContent = '';
  try {
    const res = await apiFetch('/users/me/2fa/setup', { method: 'POST', body: JSON.stringify({}) });
    fillTotpSetup(res);
  } catch (e) {
    if (err) err.textContent = e.message;
    else tg.showAlert(e.message);
  }
});
document.getElementById('totp-copy-secret')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const secret = document.getElementById('totp-secret')?.value || '';
  const ok = await copyText(secret);
  const btn = e.currentTarget;
  const prev = btn?.textContent;
  if (btn) btn.textContent = ok ? 'Скопировано' : 'Не вышло';
  setTimeout(() => { if (btn && prev) btn.textContent = prev; }, 1600);
  if (!ok && secret) tg.showAlert(secret);
});
document.getElementById('totp-copy-otpauth')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const uri = window.pendingOtpauth || '';
  const ok = await copyText(uri);
  const btn = e.currentTarget;
  const prev = btn?.textContent;
  if (btn) btn.textContent = ok ? 'Скопировано' : 'Не вышло';
  setTimeout(() => { if (btn && prev) btn.textContent = prev; }, 1600);
  if (!ok && uri) tg.showAlert(uri);
});
document.getElementById('totp-enable-btn')?.addEventListener('click', async () => {
  const err = document.getElementById('totp-error');
  err.textContent = '';
  try {
    const res = await apiFetch('/users/me/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code: document.getElementById('totp-enable-code').value.trim() }),
    });
    document.getElementById('totp-setup')?.classList.add('screen-hidden');
    const box = document.getElementById('totp-backups');
    box.classList.remove('screen-hidden');
    document.getElementById('totp-backup-list').textContent = (res.backupCodes || []).join('\n');
    if (profile) profile.totpEnabled = true;
    try { sessionStorage.removeItem('totp_setup'); } catch { /* ignore */ }
    applyAccountFlags(profile);
    tg.showAlert('2FA включена. Сохраните резервные коды.');
  } catch (e) {
    err.textContent = e.message;
  }
});
document.getElementById('totp-disable-btn')?.addEventListener('click', async () => {
  try {
    await apiFetch('/users/me/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code: document.getElementById('totp-disable-code').value.trim() }),
    });
    if (profile) profile.totpEnabled = false;
    document.getElementById('totp-backups')?.classList.add('screen-hidden');
    document.getElementById('totp-disable-code').value = '';
    applyAccountFlags(profile);
    tg.showAlert('2FA отключена');
  } catch (e) {
    tg.showAlert(e.message);
  }
});

document.getElementById('chat-input')?.addEventListener('focus', () => {
  setTimeout(updateKeyboardInset, 50);
});
document.getElementById('chat-input')?.addEventListener('blur', () => {
  setTimeout(() => {
    if (document.activeElement?.id !== 'chat-input') blurChatKeyboard();
  }, 80);
});

try { applyPrefs(); } catch { /* ignore */ }
(function initGeoUi() {
  const ru = geo()?.byIso('RU');
  if (ru) {
    setCountryFields('reg', ru);
    setCountryFields('edit', ru);
    setCountryFields('kyc', ru);
  }
  ['reg', 'edit', 'kyc'].forEach((prefix) => {
    document.getElementById(`${prefix}-country-btn`)?.addEventListener('click', () => openCountrySheet(prefix));
  });
  bindPhoneNational('reg-phone-national');
  bindPhoneNational('edit-phone-national');
  document.getElementById('country-sheet-close')?.addEventListener('click', () => {
    document.getElementById('country-sheet')?.classList.add('screen-hidden');
  });
  document.getElementById('country-sheet-search')?.addEventListener('input', (e) => {
    renderCountrySheet(e.target.value);
  });
})();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  let open = false;
  try { open = sessionStorage.getItem('totp_setup') === '1'; } catch { /* ignore */ }
  if (open && !profile?.totpEnabled) {
    document.getElementById('totp-setup')?.classList.remove('screen-hidden');
    if (!document.getElementById('totp-secret')?.value) restoreTotpSetup();
  }
  if (appReady) loadNews();
});
boot();
