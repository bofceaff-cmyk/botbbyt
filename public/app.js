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
let profileTimer = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientError(msg, status) {
  if (status === 502 || status === 503 || status === 504) return true;
  return /502|503|504|Failed to fetch|NetworkError|Нет связи|Application failed/i.test(String(msg || ''));
}

async function apiFetch(path, options = {}, { retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(API_BASE + path, {
        ...options,
        headers: {
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          'X-Telegram-Init-Data': tg.initData || '',
          ...(options.headers || {}),
        },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data.error || `Ошибка сервера (${r.status})`;
        if (isTransientError(msg, r.status) && attempt < retries) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw new Error(msg);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (isTransientError(e.message) && attempt < retries) {
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
  const r = await fetch(API_BASE + path, {
    headers: { 'X-Telegram-Init-Data': tg.initData || '' },
  });
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

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('screen-hidden'));
  const screen = document.getElementById(`screen-${name}`);
  if (!screen) return;
  screen.classList.remove('screen-hidden');

  document.querySelectorAll('.tab').forEach((t) => {
    const walletScreens = new Set([
      'deposit', 'transfer', 'history', 'withdraw', 'convert', 'earn', 'card',
    ]);
    const tab = MAIN_TABS.has(name) ? name : (
      walletScreens.has(name) ? 'wallet' : 'profile'
    );
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  if (name === 'history') loadHistory();
  if (name === 'support') {
    loadSupportThread();
    startSupportPoll();
  } else {
    stopSupportPoll();
  }
  if (name === 'deposit') renderDepositNetworks();
  if (name === 'transfer' && profile) {
    document.getElementById('transfer-hint').textContent =
      `Доступно: ${fmtUsdt(profile.usdtBalance)} USDT`;
  }
  if (name === 'edit-profile' && profile) fillEditForm();
  if (name === 'kyc') initKycScreen();
  if (name === 'card') renderCardScreen();
  if (name === 'withdraw') prepareWithdrawScreen();
  if (name === 'convert') prepareConvertScreen();
  if (name === 'earn') prepareEarnScreen();
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
      return `
          <div class="assets-coin-row">
            <div class="assets-coin-left">
              <img class="assets-coin-logo" src="${a.icon}" alt="${a.id}" width="36" height="36">
              <div>
                <div class="assets-coin-sym">${a.id}</div>
                <div class="assets-coin-chg muted">0.00 (0.00%)</div>
              </div>
            </div>
            <div class="assets-coin-right">
              <div class="mono assets-coin-amt">${maskBal(amtStr)}</div>
              <div class="muted assets-coin-fiat">${maskBal(`${fmtUsdt(fiat)} USD`)}</div>
            </div>
          </div>`;
    }).join('');
    list.innerHTML = rows || '';
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

  const pnl = document.querySelector('#wallet-pnl .pnl-val');
  if (pnl) pnl.textContent = '+0.00 USD (+0.00%)';
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
  { id: 'TRX', name: 'TRON', icon: '/img/trx.svg?v=1' },
  { id: 'SOL', name: 'Solana', icon: '/img/sol.svg?v=1' },
];

let convertFromAsset = 'USDT';
let convertToAsset = 'BTC';
let convertPickSide = 'to';
let assetPrices = { USDT: 1 };

function convertAssetMeta(id) {
  return CONVERT_ASSETS.find((a) => a.id === id) || CONVERT_ASSETS[0];
}

function coinIconHtml(a, size = 22) {
  return `<img class="coin-logo" src="${a.icon}" alt="" width="${size}" height="${size}">`;
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

function setConvertFromAsset(id) {
  if (id === convertToAsset) convertToAsset = convertFromAsset;
  convertFromAsset = id;
  const meta = convertAssetMeta(id);
  document.getElementById('convert-from-asset').value = id;
  document.getElementById('convert-from-label').textContent = id;
  const ico = document.getElementById('convert-from-icon');
  if (ico) { ico.src = meta.icon; ico.alt = id; }
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
  if (ico) { ico.src = meta.icon; ico.alt = id; }
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
    assetPrices = { USDT: 1 };
    if (Array.isArray(quotes)) {
      for (const q of quotes) {
        const sym = String(q.symbol || '').toUpperCase();
        const px = Number(q.price);
        if (Number.isFinite(px) && px > 0 && ['BTC', 'ETH', 'TRX', 'SOL'].includes(sym)) {
          assetPrices[sym] = px;
        }
      }
    }
  } catch { /* keep previous */ }
  if (!assetPrices.BTC) assetPrices.BTC = lastBtcPrice || 95000;
  if (!assetPrices.ETH) assetPrices.ETH = 3500;
  if (!assetPrices.TRX) assetPrices.TRX = 0.25;
  if (!assetPrices.SOL) assetPrices.SOL = 180;
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
  await loadAssetPrices();
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

function setAuthTab(which) {
  const isReg = which === 'register';
  document.getElementById('tab-register').classList.toggle('active', isReg);
  document.getElementById('tab-login').classList.toggle('active', !isReg);
  document.getElementById('auth-register').classList.toggle('screen-hidden', !isReg);
  document.getElementById('auth-login').classList.toggle('screen-hidden', isReg);
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
  if (mode === 'success') {
    document.getElementById('auth-forms').classList.add('screen-hidden');
    document.getElementById('auth-success').classList.remove('screen-hidden');
  } else if (mode === 'loading') {
    showAuthLoading(true);
  } else {
    document.getElementById('auth-forms').classList.remove('screen-hidden');
    document.getElementById('auth-success').classList.add('screen-hidden');
    setAuthTab('register');
    setRegStep(1);
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
  document.getElementById('header-balance').textContent = fmtUsdt(
    (Number(me.usdtBalance) || 0) + (Number(me.earnBalance) || 0)
  );
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
  const sep = apiPath.includes('?') ? '&' : '?';
  return apiPath + sep + 'initData=' + encodeURIComponent(tg.initData || '');
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
let chartInterval = '1h';
let chartChange24h = null;

function openChart(symbol, change24h) {
  chartSymbol = symbol || 'BTC';
  chartChange24h = change24h;
  chartInterval = '1h';
  document.querySelectorAll('#chart-intervals .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.interval === '1h');
  });
  showScreen('chart');
  loadChart();
}

async function fetchKlines(symbol, interval) {
  const pair = `${String(symbol).toUpperCase().replace(/USDT$/, '')}USDT`;
  // 1) напрямую Binance (без Telegram auth)
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=96`
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

async function loadChart() {
  const canvas = document.getElementById('chart-canvas');
  const empty = document.getElementById('chart-empty');
  empty.classList.remove('screen-hidden');
  empty.textContent = 'Загрузка графика…';
  document.getElementById('chart-title').textContent = `${chartSymbol} / USDT`;
  try {
    const data = await fetchKlines(chartSymbol, chartInterval);
    empty.classList.add('screen-hidden');
    document.getElementById('chart-price').textContent = `$${fmtUsdPrice(data.last)}`;
    document.getElementById('chart-pair').textContent = data.pair || `${chartSymbol}USDT`;
    const chg = fmtChange(chartChange24h == null || chartChange24h === '' ? null : Number(chartChange24h));
    const chgEl = document.getElementById('chart-change');
    chgEl.textContent = chg.text;
    chgEl.className = chg.up ? 'chg-up' : 'chg-down';
    drawCandles(canvas, data.candles);
  } catch (e) {
    empty.classList.remove('screen-hidden');
    empty.textContent = 'Не удалось загрузить график. Попробуйте позже.';
    console.error('[chart]', e);
  }
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

  // grid
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
async function loadQuotes() {
  try {
    const r = await fetch('/api/market/quotes');
    const quotes = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(quotes)) throw new Error(quotes?.error || 'bad');
    const btcQ = quotes.find((q) => String(q.symbol).toUpperCase() === 'BTC');
    if (btcQ?.price) {
      lastBtcPrice = Number(btcQ.price) || lastBtcPrice;
      if (profile) applyBalanceVisibility();
    }
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
        <button type="button" class="quote-row" data-symbol="${escapeHtml(q.symbol)}" data-change="${q.change24h ?? ''}" style="animation-delay:${i * 35}ms">
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

    document.querySelectorAll('#quotes-list [data-symbol]').forEach((row) => {
      row.addEventListener('click', () => openChart(row.dataset.symbol, row.dataset.change));
    });
    document.querySelectorAll('#ticker-strip .ticker-chip').forEach((chip, idx) => {
      const q = quotes[idx];
      if (!q) return;
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => openChart(q.symbol, q.change24h));
    });

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
  showAuthGate('loading');
  await wakeServer();
  try {
    const me = await apiFetch('/users/me', {}, { retries: 5 });
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
    // не показываем Alert с 502 — это холодный старт Railway
  }
}

boot();
