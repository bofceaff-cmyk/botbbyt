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

function historyTitle(item) {
  if (item.type === 'admin_adjust') {
    return item.amount >= 0 ? 'Внести USDT' : 'Вывод средств USDT';
  }
  return TYPE_LABELS[item.type] || item.type;
}

function historyKind(item) {
  if (item.type === 'admin_adjust') {
    return item.amount >= 0 ? 'Внести' : 'Вывести';
  }
  return TYPE_KIND[item.type] || item.type;
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
let pendingReset = { email: '', totpEnabled: false, contact: '' };
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

function blurChatKeyboard() {
  const input = document.getElementById('chat-input');
  if (input) input.blur();
  document.body.classList.remove('kb-open');
  document.documentElement.style.setProperty('--kb', '0px');
}

function updateKeyboardInset() {
  const vv = window.visualViewport;
  const base = tg.viewportStableHeight || window.innerHeight;
  let kb = 0;
  if (vv) kb = Math.max(0, base - vv.height - (vv.offsetTop || 0));
  document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  const supportOpen = !document.getElementById('screen-support')?.classList.contains('screen-hidden');
  document.body.classList.toggle('kb-open', supportOpen && kb > 64);
  if (supportOpen) {
    const box = document.getElementById('chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }
  syncAppViewport();
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateKeyboardInset);
  window.visualViewport.addEventListener('scroll', updateKeyboardInset);
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
  const screen = document.getElementById(`screen-${name}`);
  if (!screen) return;
  screen.classList.remove('screen-hidden');
  document.getElementById('app-shell')?.scrollTo(0, 0);
  syncTelegramBack();

  const profileBack = document.querySelector('#screen-profile > .back-btn');
  if (profileBack) profileBack.classList.toggle('screen-hidden', name === 'profile' && screenStack.length <= 1);

  document.querySelectorAll('.tab').forEach((t) => {
    const walletScreens = new Set([
      'deposit', 'transfer', 'history', 'withdraw', 'convert', 'earn', 'card',
    ]);
    const tab = MAIN_TABS.has(name) ? name : (
      name === 'chart' ? 'trade' : (
        walletScreens.has(name) ? 'wallet' : (
          name === 'profile' || name === 'support' || name === 'kyc' || name === 'edit-profile' ? 'wallet' : 'markets'
        )
      )
    );
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelector('.topbar')?.classList.toggle('screen-hidden', name === 'trade' || name === 'tradfi');

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
document.getElementById('wallet-go-profile')?.addEventListener('click', () => showScreen('profile'));
document.getElementById('open-withdraw')?.addEventListener('click', () => showScreen('withdraw'));
document.getElementById('open-convert')?.addEventListener('click', () => showScreen('convert'));
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
  const assets = typeof CONVERT_ASSETS !== 'undefined' ? CONVERT_ASSETS : [{ id: 'USDT' }];
  const prices = typeof assetPrices !== 'undefined' ? assetPrices : { USDT: 1 };
  for (const a of assets) {
    if (a.id === 'USDT') continue;
    const amt = Number(bals[a.id]) || 0;
    const px = Number(prices[a.id]) || 0;
    cryptoUsd += amt * px;
  }
  const total = lastWalletBalance + lastEarnBalance + cryptoUsd;
  const usdTotal = fmtUsdt(total);
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
  set('wallet-available', maskBal(`${usdAvail} USD`));
  set('wallet-in-use', maskBal(`${usdEarn} USD`));
  set('wallet-btc', balanceHidden ? '≈ **** BTC' : `≈ ${btcStr} BTC`);

  const list = document.getElementById('assets-coin-list');
  if (list && typeof CONVERT_ASSETS !== 'undefined') {
    const rows = CONVERT_ASSETS.map((a) => {
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
              <img class="assets-coin-logo" src="${a.icon}" alt="${a.id}" width="36" height="36">
              <div>
                <div class="assets-coin-sym">${a.id}</div>
                <div class="assets-coin-chg ${chgUp ? 'chg-up' : 'chg-down'}">${maskBal(chgTxt)}</div>
              </div>
            </div>
            <div class="assets-coin-right">
              <div class="mono assets-coin-amt">${maskBal(amtStr)}</div>
              <div class="muted assets-coin-fiat">${maskBal(`${fmtUsdt(fiat)} USD`)}</div>
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
    amount: amountEl.value,
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

function coinIconHtml(a, size = 22) {
  const q = lastQuotes.find((x) => String(x.symbol).toUpperCase() === a.id);
  const src = (q && q.image) ? q.image : a.icon;
  return `<img class="coin-logo" src="${src}" alt="" width="${size}" height="${size}" onerror="this.style.display='none'">`;
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
  const q = lastQuotes.find((x) => String(x.symbol).toUpperCase() === id);
  return (q && q.image) || fallback;
}

function setConvertFromAsset(id) {
  if (id === convertToAsset) convertToAsset = convertFromAsset;
  convertFromAsset = id;
  const meta = convertAssetMeta(id);
  document.getElementById('convert-from-asset').value = id;
  document.getElementById('convert-from-label').textContent = id;
  const ico = document.getElementById('convert-from-icon');
  if (ico) { ico.src = quoteIconFor(id, meta.icon); ico.alt = id; }
  const bal = getBalancesMap()[id] || 0;
  document.getElementById('convert-hint').textContent = fmtAssetAmt(id, bal);
  setConvertToAsset(convertToAsset, false);
  updateConvertEstimate();
}

function setConvertToAsset(id, closeSheet = true) {
  if (id === convertFromAsset) {
    const alt = CONVERT_ASSETS.find((a) => a.id !== id);
    id = alt ? alt.id : id;
  }
  convertToAsset = id;
  const meta = convertAssetMeta(id);
  document.getElementById('convert-asset').value = id;
  document.getElementById('convert-to-label').textContent = id;
  const ico = document.getElementById('convert-to-icon');
  if (ico) { ico.src = quoteIconFor(id, meta.icon); ico.alt = id; }
  if (closeSheet) document.getElementById('convert-asset-sheet')?.classList.add('screen-hidden');
  updateConvertEstimate();
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
  const amount = Number(document.getElementById('convert-amount')?.value);
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
        amount: document.getElementById('convert-amount').value,
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
        amount: document.getElementById('earn-amount').value,
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
document.getElementById('open-edit-profile').addEventListener('click', () => showScreen('edit-profile'));
document.getElementById('open-kyc').addEventListener('click', () => showScreen('kyc'));

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
  document.getElementById('auth-sheet')?.classList.toggle('light', Boolean(on));
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
  document.body.classList.remove('auth-locked');
  document.getElementById('auth-gate').classList.add('screen-hidden');
  document.getElementById('app-shell').classList.remove('screen-hidden');
  showScreen(startScreen);
  if (!appReady) {
    appReady = true;
    loadQuotes().finally(() => { if (appReady) startQuotesLive(); });
    loadNews();
    newsTimer = setInterval(loadNews, 7 * 60 * 1000);
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
  const extraInput = document.getElementById('reg-extra');
  wrap.classList.remove('screen-hidden');

  // Шаг 1: почта → на шаге 2 нужен телефон. Шаг 1: телефон → на шаге 2 нужен email.
  if (parsed.kind === 'email') {
    extraLabel.textContent = 'Телефон';
    extraInput.type = 'tel';
    extraInput.placeholder = '+7 900 000-00-00';
    extraInput.autocomplete = 'tel';
    extraInput.inputMode = 'tel';
  } else {
    extraLabel.textContent = 'Email';
    extraInput.type = 'email';
    extraInput.placeholder = 'name@mail.com';
    extraInput.autocomplete = 'email';
    extraInput.inputMode = 'email';
  }
  extraInput.value = '';
  setRegStep(2);
});

document.getElementById('reg-back').addEventListener('click', () => setRegStep(1));

document.getElementById('reg-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('reg-error');
  errorEl.textContent = '';
  const fullName = document.getElementById('reg-fio').value.trim();
  const country = document.getElementById('reg-country').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const extra = document.getElementById('reg-extra').value.trim();

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
    const ph = parseContact(extra);
    if (!ph || ph.kind !== 'phone') {
      errorEl.textContent = 'Укажите номер телефона';
      return;
    }
    phone = ph.value;
  } else {
    phone = contactNow.value;
    const em = parseContact(extra);
    if (!em || em.kind !== 'email') {
      errorEl.textContent = 'Укажите корректный email';
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
['reg-password2', 'reg-password', 'reg-extra', 'reg-fio'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reg-submit').click();
  });
});
['login-contact', 'login-password'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-submit').click();
  });
});

document.getElementById('login-forgot')?.addEventListener('click', () => {
  const parsed = parseContact(document.getElementById('login-contact').value);
  setForgotKind(parsed?.kind === 'phone' ? 'phone' : 'email');
  document.getElementById('forgot-email').value = parsed?.value || '';
  document.getElementById('forgot-error').textContent = '';
  showAuthGate('forgot');
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
  const code = document.getElementById('seccheck-code')?.value.trim() || '';
  const totpWrap = document.getElementById('seccheck-totp-wrap');
  const needTotp = totpWrap && !totpWrap.classList.contains('screen-hidden');
  const totp = document.getElementById('seccheck-totp')?.value.trim() || '';
  const btn = document.getElementById('seccheck-next');
  if (btn) btn.disabled = !(code.length >= 4 && (!needTotp || totp.length >= 4));
}
document.getElementById('seccheck-code')?.addEventListener('input', refreshSecNext);
document.getElementById('seccheck-totp')?.addEventListener('input', refreshSecNext);

document.getElementById('forgot-next')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('forgot-error');
  errorEl.textContent = '';
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
    };
    document.getElementById('seccheck-masked').textContent = res.maskedEmail || '****@****';
    document.getElementById('seccheck-code').value = '';
    document.getElementById('seccheck-totp').value = '';
    document.getElementById('seccheck-error').textContent = '';
    document.getElementById('seccheck-totp-wrap').classList.toggle('screen-hidden', !pendingReset.totpEnabled);
    refreshSecNext();
    showAuthGate('seccheck');
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
    });
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

document.getElementById('seccheck-next')?.addEventListener('click', () => {
  const errorEl = document.getElementById('seccheck-error');
  errorEl.textContent = '';
  const code = document.getElementById('seccheck-code').value.trim();
  if (code.length < 4) {
    errorEl.textContent = 'Введите код из письма';
    return;
  }
  if (pendingReset.totpEnabled && !document.getElementById('seccheck-totp').value.trim()) {
    errorEl.textContent = 'Введите код Google Authenticator';
    return;
  }
  document.getElementById('reset-password').value = '';
  document.getElementById('reset-password2').value = '';
  document.getElementById('reset-error').textContent = '';
  showAuthGate('reset');
});

document.getElementById('seccheck-help')?.addEventListener('click', () => {
  tg.showAlert('Откройте чат поддержки в приложении после входа или напишите в бота.');
});

document.getElementById('reset-submit')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('reset-error');
  errorEl.textContent = '';
  const password = document.getElementById('reset-password').value;
  const password2 = document.getElementById('reset-password2').value;
  const code = document.getElementById('seccheck-code').value.trim();
  const totpCode = document.getElementById('seccheck-totp')?.value.trim() || '';
  if (password.length < 6) {
    errorEl.textContent = 'Пароль от 6 символов';
    return;
  }
  if (password !== password2) {
    errorEl.textContent = 'Пароли не совпадают';
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
        code,
        totpCode,
        password,
      }),
    });
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

function renderProfile(me) {
  const name = me.displayName || me.fullName || 'Пользователь';
  const initials = name.slice(0, 2).toUpperCase();
  document.getElementById('avatar').textContent = initials;
  document.getElementById('display-name').textContent = name;
  document.getElementById('profile-uid').textContent = `UID ${me.uid || me.id}`;
  const wAvatar = document.getElementById('wallet-avatar');
  if (wAvatar) wAvatar.textContent = initials;

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

  const isVerified = me.verified || me.kycStatus === 'approved';
  if (isVerified) {
    badge.classList.remove('badge-hidden');
    pill.classList.add('screen-hidden'); // не дублируем «Верифицирован»
  } else {
    badge.classList.add('badge-hidden');
    pill.classList.remove('screen-hidden');
  }

  kycBtn.style.display = me.kycStatus === 'approved' ? 'none' : 'block';
  kycBtn.textContent = me.kycStatus === 'pending'
    ? 'Статус заявки'
    : me.kycStatus === 'rejected'
      ? 'Подать снова'
      : 'Пройти верификацию';

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
  document.getElementById('totp-start-btn')?.classList.toggle('screen-hidden', enabled);
  document.getElementById('totp-off-wrap')?.classList.toggle('screen-hidden', !enabled);
  if (!enabled) document.getElementById('totp-setup')?.classList.add('screen-hidden');
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
      const title = historyTitle(item);
      const kind = historyKind(item);
      const date = fmtHistoryDate(item.createdAt);
      const bal = item.balance != null ? fmtUsdt(item.balance) : '—';
      return `
        <div class="history-item">
          <div class="history-main">
            <div>
              <div class="history-title">${escapeHtml(title)}</div>
              <div class="history-meta">${escapeHtml(date)}</div>
            </div>
            <div class="mono ${isPositive ? 'history-amount-pos' : 'history-amount-neg'}">
              ${sign}${fmtUsdt(item.amount)}
            </div>
          </div>
          <div class="history-foot">
            <div class="history-type">Тип ${escapeHtml(kind)}</div>
            <div class="history-bal">Доступный баланс <span class="mono">${escapeHtml(bal)}</span></div>
          </div>
          ${item.meta ? `<div class="history-comment">${escapeHtml(item.meta)}</div>` : ''}
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('history-list').innerHTML =
      `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
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
  document.getElementById('trade-pair-btn').innerHTML = `${tradeSymbol}/USDT <span>▾</span>`;
  document.getElementById('trade-qty-lbl').textContent = tradeSymbol;
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

function drawTradeChart(canvas, candles) {
  if (!canvas || !candles?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = 340;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const volH = 72;
  const pad = { t: 8, r: 48, b: 18, l: 4 };
  const priceH = cssH - volH - pad.t - pad.b - 8;
  const w = cssW - pad.l - pad.r;
  let min = Infinity;
  let max = -Infinity;
  let maxVol = 0;
  candles.forEach((c) => {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
    maxVol = Math.max(maxVol, c.volume || 0);
  });
  const span = max - min || 1;
  const slot = w / candles.length;
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

  candles.forEach((c, i) => {
    const x = pad.l + i * slot + slot / 2;
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? '#2ebd85' : '#f6465d';
    ctx.fillStyle = up ? '#2ebd85' : '#f6465d';
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
    candles.forEach((_, i) => {
      const v = smaAt(candles, period, i);
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

  const last = candles[candles.length - 1];
  const yLast = yPrice(last.close);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = last.close >= last.open ? '#2ebd85' : '#f6465d';
  ctx.beginPath();
  ctx.moveTo(pad.l, yLast);
  ctx.lineTo(pad.l + w, yLast);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = last.close >= last.open ? '#2ebd85' : '#f6465d';
  const label = fmtUsdPrice(last.close);
  ctx.font = '11px IBM Plex Sans, sans-serif';
  const tw = ctx.measureText(label).width + 8;
  ctx.fillRect(cssW - pad.r, yLast - 8, pad.r - 2, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, cssW - pad.r + 3, yLast + 4);

  const volTop = pad.t + priceH + 10;
  candles.forEach((c, i) => {
    const x = pad.l + i * slot;
    const h = maxVol ? ((c.volume || 0) / maxVol) * volH : 0;
    ctx.fillStyle = c.close >= c.open ? 'rgba(46,189,133,0.55)' : 'rgba(246,70,93,0.55)';
    ctx.fillRect(x + 1, volTop + volH - h, Math.max(1, slot - 1.5), h);
  });

  ctx.fillStyle = '#5a5a5a';
  ctx.font = '10px IBM Plex Sans, sans-serif';
  ctx.fillText(fmtUsdPrice(max), cssW - pad.r + 2, pad.t + 10);
  ctx.fillText(fmtUsdPrice(min), cssW - pad.r + 2, pad.t + priceH);
}

function renderTickersList(quotes) {
  const list = document.getElementById('tickers-list');
  if (!list || !quotes?.length) return;
  list.innerHTML = quotes.map((q, i) => {
    const chg = fmtChange(q.change24h);
    const img = q.image
      ? `<img src="${escapeHtml(q.image)}" alt="" loading="lazy">`
      : `<div class="quote-ico">${escapeHtml(q.symbol.slice(0, 2))}</div>`;
    return `
      <button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}" data-change="${q.change24h ?? ''}" style="animation-delay:${i * 25}ms">
        ${img}
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
}

function fillTradePairList() {
  const box = document.getElementById('trade-pair-list');
  if (!box) return;
  const quotes = lastQuotes.length ? lastQuotes : [{ symbol: 'BTC', name: 'Bitcoin', price: null, change24h: null }];
  box.innerHTML = quotes.map((q) => {
    const chg = fmtChange(q.change24h);
    return `<button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}">
      <div class="quote-ico">${escapeHtml(q.symbol.slice(0, 2))}</div>
      <div><div class="quote-name">${escapeHtml(q.symbol)}/USDT</div></div>
      <div class="quote-right"><div class="quote-price mono">${fmtUsdPrice(q.price)}</div>
      <span class="chg-pill ${chg.up ? 'up' : 'down'}">${chg.text}</span></div>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-symbol]').forEach((row) => {
    row.onclick = () => {
      document.getElementById('trade-pair-sheet').classList.add('screen-hidden');
      openTrade(row.dataset.symbol);
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
  btn.addEventListener('click', () => {
    document.querySelectorAll('#trade-products .trade-prod').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const prod = btn.dataset.prod;
    if (prod === 'convert') showScreen('convert');
    else if (prod !== 'spot') tg.showAlert('Раздел скоро будет доступен. Сейчас открыт спот.');
  });
});

document.querySelectorAll('#trade-subtabs .trade-sub').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#trade-subtabs .trade-sub').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const sub = btn.dataset.sub;
    document.getElementById('trade-pane-chart').classList.toggle('screen-hidden', sub !== 'chart');
    document.getElementById('trade-pane-overview').classList.toggle('screen-hidden', sub !== 'overview');
    document.getElementById('trade-pane-data').classList.toggle('screen-hidden', sub !== 'data');
    document.getElementById('trade-pane-news').classList.toggle('screen-hidden', sub !== 'news');
  });
});

document.querySelectorAll('.trade-tf[data-interval]').forEach((btn) => {
  btn.addEventListener('click', () => {
    chartInterval = btn.dataset.interval;
    document.querySelectorAll('.trade-tf[data-interval]').forEach((b) => b.classList.toggle('active', b === btn));
    loadTradeChart();
  });
});

document.getElementById('trade-buy')?.addEventListener('click', () => {
  convertFromAsset = 'USDT';
  convertToAsset = tradeSymbol;
  showScreen('convert');
});
document.getElementById('trade-sell')?.addEventListener('click', () => {
  convertFromAsset = tradeSymbol;
  convertToAsset = 'USDT';
  showScreen('convert');
});
document.getElementById('trade-qty')?.addEventListener('click', () => {
  convertFromAsset = 'USDT';
  convertToAsset = tradeSymbol;
  showScreen('convert');
});
document.getElementById('tradfi-go-trade')?.addEventListener('click', () => openTrade(tradeSymbol));
document.getElementById('trade-depth')?.addEventListener('click', () => tg.showAlert('Стакан глубины — в следующей версии.'));

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
    const img = q.image
      ? `<img src="${escapeHtml(q.image)}" alt="" loading="lazy">`
      : `<div class="quote-ico">${escapeHtml(q.symbol.slice(0, 2))}</div>`;
    return `
      <button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}" data-change="${q.change24h ?? ''}" style="animation-delay:${i * 35}ms">
        ${img}
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
    const tick = document.getElementById('trade-ticker-text');
    if (tick && news[0]?.title) tick.textContent = news[0].title;
    const mini = document.getElementById('trade-news-mini');
    if (mini) mini.innerHTML = list.innerHTML;
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

document.getElementById('totp-start-btn')?.addEventListener('click', async () => {
  const err = document.getElementById('totp-error');
  if (err) err.textContent = '';
  try {
    const res = await apiFetch('/users/me/2fa/setup', { method: 'POST' });
    document.getElementById('totp-setup')?.classList.remove('screen-hidden');
    document.getElementById('totp-qr').innerHTML = res.qrSvg || '';
    document.getElementById('totp-secret').textContent = res.secret || '';
    document.getElementById('totp-enable-code').value = '';
  } catch (e) {
    if (err) err.textContent = e.message;
    else tg.showAlert(e.message);
  }
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

boot();
