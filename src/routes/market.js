const express = require('express');

const router = express.Router();

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', binance: 'BTCUSDT' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', binance: 'ETHUSDT' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', binance: 'BNBUSDT' },
  { id: 'solana', symbol: 'SOL', name: 'Solana', binance: 'SOLUSDT' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', binance: 'XRPUSDT' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', binance: 'DOGEUSDT' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', binance: 'ADAUSDT' },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin', binance: 'TONUSDT' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', binance: 'AVAXUSDT' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', binance: 'LINKUSDT' },
  { id: 'tron', symbol: 'TRX', name: 'TRON', binance: 'TRXUSDT' },
];

const FALLBACK_QUOTES = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 95000, change24h: 0.5, marketCap: null, image: null },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3400, change24h: -0.3, marketCap: null, image: null },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', price: 620, change24h: 0.2, marketCap: null, image: null },
  { id: 'solana', symbol: 'SOL', name: 'Solana', price: 180, change24h: 1.1, marketCap: null, image: null },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', price: 2.4, change24h: -0.8, marketCap: null, image: null },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', price: 0.18, change24h: 0.4, marketCap: null, image: null },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', price: 0.72, change24h: -0.2, marketCap: null, image: null },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin', price: 5.2, change24h: 0.6, marketCap: null, image: null },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', price: 28, change24h: -1.0, marketCap: null, image: null },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', price: 18, change24h: 0.9, marketCap: null, image: null },
  { id: 'tron', symbol: 'TRX', name: 'TRON', price: 0.25, change24h: 0.3, marketCap: null, image: null },
];

let quotesCache = { at: 0, data: null };
let newsCache = { at: 0, data: null };

const QUOTES_TTL = 45 * 1000;
const NEWS_TTL = 6 * 60 * 1000;
const NEWS_MAX_AGE_MS = 36 * 60 * 60 * 1000;

const FETCH_HEADERS = {
  Accept: 'application/json, application/rss+xml, application/xml, text/xml, */*',
  'User-Agent': 'Mozilla/5.0 (compatible; BybitWallet/1.0)',
};

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function rssTag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? decodeXml(m[1]).trim() : '';
}

function toIso(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== '') {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeItem({ id, title, url, source, image, publishedAt, body }) {
  const titleClean = stripHtml(decodeXml(title)).trim();
  const href = String(url || '').trim();
  if (!titleClean || !href || !/^https?:\/\//i.test(href)) return null;
  return {
    id: String(id || href),
    title: titleClean.slice(0, 180),
    url: href,
    source: source || 'News',
    image: image || null,
    publishedAt: toIso(publishedAt),
    body: stripHtml(decodeXml(body)).slice(0, 180),
  };
}

function parseRss(xml, source) {
  const blocks = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block, i) => {
    const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const media = block.match(/<(?:media:content|media:thumbnail)[^>]+url=["']([^"']+)["']/i);
    return normalizeItem({
      id: rssTag(block, 'guid') || rssTag(block, 'link') || `${source}-${i}`,
      title: rssTag(block, 'title'),
      url: rssTag(block, 'link'),
      source,
      image: (enclosure && enclosure[1]) || (media && media[1]) || null,
      publishedAt: rssTag(block, 'pubDate') || rssTag(block, 'published'),
      body: rssTag(block, 'description'),
    });
  }).filter(Boolean);
}

async function newsFromRss(url, source) {
  const xml = await fetchText(url);
  return parseRss(xml, source);
}

async function newsFromBybit() {
  const raw = await fetchJson('https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20');
  const list = raw?.result?.list || [];
  return list.map((n, i) => normalizeItem({
    id: n.url || `bybit-${i}`,
    title: n.title,
    url: n.url,
    source: 'Bybit',
    image: null,
    publishedAt: n.dateTimestamp || n.publishTime,
    body: n.description,
  })).filter(Boolean);
}

async function newsFromCryptoCompare() {
  const raw = await fetchJson('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
  const list = raw?.Data || [];
  return list.slice(0, 20).map((n, i) => normalizeItem({
    id: n.id || n.guid || `cc-${i}`,
    title: n.title,
    url: n.url || n.guid,
    source: n.source_info?.name || n.source || 'CryptoCompare',
    image: n.imageurl || null,
    publishedAt: n.published_on,
    body: n.body,
  })).filter(Boolean);
}

function mergeNews(lists) {
  const seen = new Set();
  const out = [];
  for (const item of lists.flat()) {
    if (!item) continue;
    const titleKey = item.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 90);
    if (seen.has(titleKey) || seen.has(item.url)) continue;
    seen.add(titleKey);
    seen.add(item.url);
    out.push(item);
  }
  out.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
  const now = Date.now();
  const fresh = out.filter((n) => n.publishedAt && now - Date.parse(n.publishedAt) <= NEWS_MAX_AGE_MS);
  return (fresh.length >= 6 ? fresh : out).slice(0, 16);
}

async function loadFreshNews() {
  const jobs = [
    newsFromBybit(),
    newsFromCryptoCompare(),
    newsFromRss('https://www.investing.com/rss/news_301.rss', 'Investing.com'),
    newsFromRss('https://cointelegraph.com/rss', 'Cointelegraph'),
    newsFromRss('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'),
  ];
  const settled = await Promise.allSettled(jobs);
  const lists = settled
    .filter((r) => r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length)
    .map((r) => r.value);
  return mergeNews(lists);
}

async function quotesFromCoinGecko() {
  const ids = COINS.map((c) => c.id).join(',');
  const url =
    `https://api.coingecko.com/api/v3/coins/markets` +
    `?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
  const raw = await fetchJson(url);
  const byId = Object.fromEntries(raw.map((c) => [c.id, c]));
  return COINS.map((coin) => {
    const row = byId[coin.id];
    if (!row) {
      return {
        id: coin.id, symbol: coin.symbol, name: coin.name,
        price: null, change24h: null, marketCap: null, image: null,
      };
    }
    return {
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: row.current_price,
      change24h: row.price_change_percentage_24h,
      marketCap: row.market_cap,
      image: row.image,
    };
  });
}

async function quotesFromBinance() {
  const symbols = COINS.map((c) => `"${c.binance}"`).join(',');
  const raw = await fetchJson(
    `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbols}]`
  );
  const bySym = Object.fromEntries(raw.map((r) => [r.symbol, r]));
  return COINS.map((coin) => {
    const row = bySym[coin.binance];
    if (!row) {
      return {
        id: coin.id, symbol: coin.symbol, name: coin.name,
        price: null, change24h: null, marketCap: null, image: null,
      };
    }
    return {
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: Number(row.lastPrice),
      change24h: Number(row.priceChangePercent),
      high24h: Number(row.highPrice),
      low24h: Number(row.lowPrice),
      volume24h: Number(row.quoteVolume),
      bid: Number(row.bidPrice),
      ask: Number(row.askPrice),
      marketCap: null,
      image: null,
    };
  });
}

const sseClients = new Set();
let quotesPumpStarted = false;

function broadcastQuotes(data) {
  if (!data) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

async function refreshQuotesLive() {
  try {
    let data;
    try {
      data = await quotesFromBinance();
    } catch {
      data = await quotesFromCoinGecko();
    }
    if (quotesCache.data) {
      const prev = Object.fromEntries(quotesCache.data.map((q) => [q.symbol, q]));
      data = data.map((q) => ({
        ...q,
        image: q.image || prev[q.symbol]?.image || null,
        name: q.name || prev[q.symbol]?.name,
      }));
    }
    quotesCache = { at: Date.now(), data };
    broadcastQuotes(data);
    return data;
  } catch {
    if (quotesCache.data) broadcastQuotes(quotesCache.data);
    return quotesCache.data;
  }
}

function ensureQuotesPump() {
  if (quotesPumpStarted) return;
  quotesPumpStarted = true;
  refreshQuotesLive().catch(() => {});
  setInterval(() => refreshQuotesLive().catch(() => {}), 2500);
}

router.get('/quotes', async (_req, res) => {
  ensureQuotesPump();
  try {
    if (quotesCache.data && Date.now() - quotesCache.at < QUOTES_TTL) {
      return res.json(quotesCache.data);
    }
    const data = await refreshQuotesLive();
    if (data) return res.json(data);
    res.json(FALLBACK_QUOTES);
  } catch (e) {
    if (quotesCache.data) return res.json(quotesCache.data);
    res.json(FALLBACK_QUOTES);
  }
});

router.get('/stream', (req, res) => {
  ensureQuotesPump();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (quotesCache.data) res.write(`data: ${JSON.stringify(quotesCache.data)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

router.get('/news', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (newsCache.data && Date.now() - newsCache.at < NEWS_TTL) {
      return res.json(newsCache.data);
    }

    const items = await loadFreshNews();
    if (items.length) {
      newsCache = { at: Date.now(), data: items };
      return res.json(items);
    }
    if (newsCache.data) return res.json(newsCache.data);
    res.json([]);
  } catch (e) {
    if (newsCache.data) return res.json(newsCache.data);
    res.json([]);
  }
});


const klinesCache = new Map();
const KLINES_TTL = 30 * 1000;

router.get('/klines', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC').toUpperCase().replace(/USDT$/, '');
    const coin = COINS.find((c) => c.symbol === symbol) || COINS[0];
    const interval = String(req.query.interval || '1h');
    const key = `${coin.binance}:${interval}`;
    const hit = klinesCache.get(key);
    if (hit && Date.now() - hit.at < KLINES_TTL) return res.json(hit.data);

    const raw = await fetchJson(
      `https://api.binance.com/api/v3/klines?symbol=${coin.binance}&interval=${interval}&limit=120`
    );
    const candles = raw.map((k) => ({
      time: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
    const data = {
      symbol: coin.symbol,
      name: coin.name,
      pair: coin.binance,
      interval,
      candles,
      last: candles.length ? candles[candles.length - 1].close : null,
    };
    klinesCache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'не удалось загрузить график' });
  }
});

const depthCache = new Map();
router.get('/depth', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
    const pair = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
    const futures = String(req.query.market || '') === 'futures';
    const key = `${futures ? 'f' : 's'}:${pair}`;
    const hit = depthCache.get(key);
    if (hit && Date.now() - hit.at < 1500) return res.json(hit.data);
    const url = futures
      ? `https://fapi.binance.com/fapi/v1/depth?symbol=${pair}&limit=12`
      : `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=12`;
    const raw = await fetchJson(url, 6000);
    const data = {
      pair,
      bids: (raw.bids || []).map((x) => ({ price: Number(x[0]), qty: Number(x[1]) })),
      asks: (raw.asks || []).map((x) => ({ price: Number(x[0]), qty: Number(x[1]) })),
    };
    depthCache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'стакан недоступен' });
  }
});

let futCache = { at: 0, data: null };
router.get('/futures', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
    const pair = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
    if (futCache.data && futCache.pair === pair && Date.now() - futCache.at < 2000) {
      return res.json(futCache.data);
    }
    const [t, p] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${pair}`, 6000),
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`, 6000),
    ]);
    const data = {
      pair,
      price: Number(t.lastPrice),
      change24h: Number(t.priceChangePercent),
      high24h: Number(t.highPrice),
      low24h: Number(t.lowPrice),
      volume24h: Number(t.quoteVolume),
      mark: Number(p.markPrice),
      index: Number(p.indexPrice),
      funding: Number(p.lastFundingRate) * 100,
      nextFunding: p.nextFundingTime,
    };
    futCache = { at: Date.now(), pair, data };
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'фьючерсы недоступны' });
  }
});

const coinCache = new Map();
router.get('/coin', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC').toUpperCase().replace(/USDT$/, '');
    const coin = COINS.find((c) => c.symbol === symbol) || COINS[0];
    const hit = coinCache.get(coin.id);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return res.json(hit.data);
    const raw = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=true&tickers=false&community_data=false&developer_data=false&sparkline=false`,
      8000,
    );
    const md = raw.market_data || {};
    const data = {
      symbol: coin.symbol,
      name: coin.name,
      description: String(raw.description?.ru || raw.description?.en || '').replace(/<[^>]+>/g, '').slice(0, 600),
      homepage: raw.links?.homepage?.[0] || null,
      github: raw.links?.repos_url?.github?.[0] || null,
      twitter: raw.links?.twitter_screen_name || null,
      telegram: raw.links?.telegram_channel_identifier || null,
      marketCap: md.market_cap?.usd ?? null,
      fdv: md.fully_diluted_valuation?.usd ?? null,
      circulating: md.circulating_supply ?? null,
      total: md.total_supply ?? null,
      max: md.max_supply ?? null,
    };
    coinCache.set(coin.id, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'обзор недоступен' });
  }
});

const ALPHA_SYMS = ['TRUMPUSDT', 'HYPEUSDT', 'PEPEUSDT', 'BONKUSDT', 'WIFUSDT', '1000SATSUSDT'];
let alphaCache = { at: 0, data: null };
router.get('/alpha', async (_req, res) => {
  try {
    if (alphaCache.data && Date.now() - alphaCache.at < 8000) return res.json(alphaCache.data);
    const raw = await fetchJson(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(ALPHA_SYMS))}`,
      8000,
    );
    const list = (Array.isArray(raw) ? raw : []).map((r) => ({
      symbol: String(r.symbol).replace(/USDT$/, ''),
      pair: r.symbol,
      price: Number(r.lastPrice),
      change24h: Number(r.priceChangePercent),
      volume24h: Number(r.quoteVolume),
    }));
    alphaCache = { at: Date.now(), data: list };
    res.json(list);
  } catch (e) {
    if (alphaCache.data) return res.json(alphaCache.data);
    res.status(502).json({ error: 'alpha недоступен' });
  }
});

router.use((_req, res) => {
  res.status(404).json({ error: 'unknown market endpoint' });
});

module.exports = router;

