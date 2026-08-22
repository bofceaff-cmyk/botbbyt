const prisma = require('./db');

const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_ERC20 = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const INTERVAL_MS = 10 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BybitWallet-deposit-watch/1.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function btcUsdPrice() {
  try {
    const raw = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const n = Number(raw.price);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function saveIncoming(row) {
  if (!row.txHash) return false;
  try {
    await prisma.incomingDeposit.create({ data: row });
    return true;
  } catch (e) {
    if (/unique|P2002/i.test(String(e.message || e))) return false;
    console.warn('[deposits]', String(e.message || e).split('\n')[0]);
    return false;
  }
}

async function watchTrc20(item) {
  const url =
    `https://api.trongrid.io/v1/accounts/${encodeURIComponent(item.address)}/transactions/trc20` +
    `?only_to=true&limit=40&contract_address=${USDT_TRC20}`;
  const raw = await fetchJson(url);
  const list = Array.isArray(raw?.data) ? raw.data : [];
  let n = 0;
  for (const tx of list) {
    const contract = String(tx.token_info?.address || tx.token_info?.tokenId || '').toUpperCase();
    if (contract && contract !== USDT_TRC20.toUpperCase()) continue;
    const decimals = Number(tx.token_info?.decimals != null ? tx.token_info.decimals : 6);
    const rawVal = Number(tx.value);
    if (!Number.isFinite(rawVal) || rawVal <= 0) continue;
    const amount = rawVal / (10 ** decimals);
    const ok = await saveIncoming({
      txHash: String(tx.transaction_id || tx.transactionId || ''),
      fromAddress: String(tx.from || ''),
      toAddress: item.address,
      amount,
      usdAmount: Math.round(amount * 100) / 100,
      asset: 'USDT',
      network: 'TRC20',
      branchCode: item.code,
      confirmed: true,
      seenAt: tx.block_timestamp ? new Date(Number(tx.block_timestamp)) : new Date(),
    });
    if (ok) n += 1;
  }
  return n;
}

async function watchBtc(item, btcUsd) {
  const raw = await fetchJson(
    `https://blockstream.info/api/address/${encodeURIComponent(item.address)}/txs`
  );
  const list = Array.isArray(raw) ? raw : [];
  let n = 0;
  for (const tx of list.slice(0, 25)) {
    const vouts = Array.isArray(tx.vout) ? tx.vout : [];
    let sat = 0;
    for (const o of vouts) {
      if (String(o.scriptpubkey_address || '') === item.address) sat += Number(o.value) || 0;
    }
    if (sat <= 0) continue;
    const amount = sat / 1e8;
    const vin = (tx.vin && tx.vin[0] && tx.vin[0].prevout) || {};
    const usd = btcUsd ? Math.round(amount * btcUsd * 100) / 100 : null;
    const ok = await saveIncoming({
      txHash: String(tx.txid || ''),
      fromAddress: String(vin.scriptpubkey_address || ''),
      toAddress: item.address,
      amount,
      usdAmount: usd,
      asset: 'BTC',
      network: 'BTC',
      branchCode: item.code,
      confirmed: Boolean(tx.status?.confirmed),
      seenAt: tx.status?.block_time ? new Date(tx.status.block_time * 1000) : new Date(),
    });
    if (ok) n += 1;
  }
  return n;
}

async function watchErc20(item) {
  const key = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken';
  const url =
    `https://api.etherscan.io/api?module=account&action=tokentx` +
    `&contractaddress=${USDT_ERC20}` +
    `&address=${encodeURIComponent(item.address)}` +
    `&page=1&offset=40&sort=desc&apikey=${encodeURIComponent(key)}`;
  const raw = await fetchJson(url);
  const list = Array.isArray(raw?.result) ? raw.result : [];
  let n = 0;
  for (const tx of list) {
    if (String(tx.to || '').toLowerCase() !== item.address.toLowerCase()) continue;
    const decimals = Number(tx.tokenDecimal || 6);
    const amount = Number(tx.value) / (10 ** decimals);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const ok = await saveIncoming({
      txHash: String(tx.hash || ''),
      fromAddress: String(tx.from || ''),
      toAddress: item.address,
      amount,
      usdAmount: Math.round(amount * 100) / 100,
      asset: 'USDT',
      network: 'ERC20',
      branchCode: item.code,
      confirmed: true,
      seenAt: tx.timeStamp ? new Date(Number(tx.timeStamp) * 1000) : new Date(),
    });
    if (ok) n += 1;
  }
  return n;
}

async function scanOnce() {
  const wallets = await prisma.walletPool.findMany({ where: { active: true } });
  if (!wallets.length) return { scanned: 0, newCount: 0 };
  const btcUsd = wallets.some((w) => w.asset === 'BTC') ? await btcUsdPrice() : null;
  let newCount = 0;
  for (const w of wallets) {
    try {
      if (w.asset === 'USDT' && w.network === 'TRC20') newCount += await watchTrc20(w);
      else if (w.asset === 'BTC' && w.network === 'BTC') newCount += await watchBtc(w, btcUsd);
      else if (w.asset === 'USDT' && w.network === 'ERC20') newCount += await watchErc20(w);
    } catch (e) {
      console.warn(`[deposits] ${w.code} ${w.asset}/${w.network}:`, String(e.message || e).split('\n')[0]);
    }
    await sleep(400);
  }
  return { scanned: wallets.length, newCount };
}

function startDepositWatch(bot) {
  const tick = async () => {
    try {
      const r = await scanOnce();
      if (r.newCount > 0) {
        const chat = process.env.ADMIN_CHAT_ID;
        if (bot && chat) {
          bot.telegram.sendMessage(
            chat,
            `Пополнения: ${r.newCount} новых. Админка → Пополнения.`
          ).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[deposits] scan', String(e.message || e).split('\n')[0]);
    }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVAL_MS);
  return { scanOnce };
}

module.exports = { startDepositWatch, scanOnce };
