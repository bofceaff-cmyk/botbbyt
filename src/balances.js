const ASSETS = ['USDT', 'BTC', 'ETH', 'TRX', 'SOL'];

function toNum(v) {
  return Number(v || 0);
}

function roundAsset(asset, n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  // USDT — 6 знаков, остальное — 8
  const digs = asset === 'USDT' ? 1e6 : 1e8;
  return Math.round(x * digs) / digs;
}

async function getAssetAmount(db, userId, asset, userRow = null) {
  const a = String(asset || '').toUpperCase();
  if (a === 'USDT') {
    const u = userRow || await db.user.findUnique({ where: { id: userId } });
    return roundAsset('USDT', u?.usdtBalance);
  }
  const row = await db.assetBalance.findUnique({
    where: { userId_asset: { userId, asset: a } },
  });
  return roundAsset(a, row?.amount);
}

async function setAssetDelta(db, userId, asset, delta) {
  const a = String(asset || '').toUpperCase();
  const d = roundAsset(a, delta);
  if (d === 0) return;

  if (a === 'USDT') {
    const u = await db.user.findUnique({ where: { id: userId } });
    const next = roundAsset('USDT', toNum(u.usdtBalance) + d);
    if (next < -1e-12) throw new Error('недостаточно средств');
    await db.user.update({
      where: { id: userId },
      data: { usdtBalance: Math.max(0, next) },
    });
    return;
  }

  const cur = await getAssetAmount(db, userId, a);
  const next = roundAsset(a, cur + d);
  if (next < -1e-12) throw new Error('недостаточно средств');
  await db.assetBalance.upsert({
    where: { userId_asset: { userId, asset: a } },
    create: { userId, asset: a, amount: Math.max(0, next) },
    update: { amount: Math.max(0, next) },
  });
}

async function listBalances(db, userId, userRow = null) {
  const u = userRow || await db.user.findUnique({ where: { id: userId } });
  const rows = await db.assetBalance.findMany({ where: { userId } });
  const map = { USDT: roundAsset('USDT', u?.usdtBalance) };
  for (const a of ASSETS) {
    if (a === 'USDT') continue;
    map[a] = 0;
  }
  for (const r of rows) {
    map[r.asset] = roundAsset(r.asset, r.amount);
  }
  return map;
}

/** Примерный курс актива к USD через котировки биржи */
async function fetchUsdPrices() {
  const prices = { USDT: 1 };
  const pairs = [
    ['BTC', 'BTCUSDT'],
    ['ETH', 'ETHUSDT'],
    ['TRX', 'TRXUSDT'],
    ['SOL', 'SOLUSDT'],
  ];
  await Promise.all(
    pairs.map(async ([asset, symbol]) => {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
        const data = await r.json();
        const px = Number(data?.price);
        if (Number.isFinite(px) && px > 0) prices[asset] = px;
      } catch (_) { /* fallback below */ }
    })
  );
  if (!prices.BTC) prices.BTC = 95000;
  if (!prices.ETH) prices.ETH = 3500;
  if (!prices.TRX) prices.TRX = 0.25;
  if (!prices.SOL) prices.SOL = 180;
  return prices;
}

function convertAmount(fromAsset, toAsset, amount, prices) {
  const from = String(fromAsset).toUpperCase();
  const to = String(toAsset).toUpperCase();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  if (from === to) return roundAsset(to, amt);
  const fromPx = prices[from];
  const toPx = prices[to];
  if (!fromPx || !toPx) return null;
  const usd = amt * fromPx;
  return roundAsset(to, usd / toPx);
}

module.exports = {
  ASSETS,
  toNum,
  roundAsset,
  getAssetAmount,
  setAssetDelta,
  listBalances,
  fetchUsdPrices,
  convertAmount,
};
