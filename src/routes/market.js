const express = require('express');

const router = express.Router();

function coinPng(symbol) {
  const s = String(symbol || 'BTC').toUpperCase().replace(/\.PNG$/i, '');
  const id = (s.endsWith('USDT') && s !== 'USDT') ? s.replace(/USDT$/, '') : (s || 'USDT');
  return `/api/market/icon/${id}`;
}

const GECKO_ICONS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  ADA: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  TON: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  TRX: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  ZEC: 'https://assets.coingecko.com/coins/images/486/small/circle-zcash-color.png',
  TRUMP: 'https://assets.coingecko.com/coins/images/53746/small/trump.png',
  HYPE: 'https://assets.coingecko.com/coins/images/50882/small/hyperliquid.jpg',
  PEPE: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  BONK: 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  WIF: 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  FLOKI: 'https://assets.coingecko.com/coins/images/16746/small/PNG_image.png',
  PENGU: 'https://assets.coingecko.com/coins/images/52622/small/PUDGY_PENGUINS_PENGU_PFP.png',
  WLD: 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
};

const iconMem = new Map();

function allowImgUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return /(coingecko\.com|coincap\.io|bnbstatic\.com|clearbit\.com|cryptologos\.cc|coinmarketcap\.com|unsplash\.com|bybit\.com)$/i.test(u.hostname)
      || /\.(coingecko|coincap|bnbstatic|clearbit|cryptologos|coinmarketcap|unsplash|bybit)\./i.test(u.hostname);
  } catch {
    return false;
  }
}

function letterIconBuf(id) {
  const letters = String(id || '?').slice(0, 3);
  const hue = [...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="hsl(${hue} 42% 32%)"/>` +
    `<text x="32" y="39" text-anchor="middle" fill="#fff" font-size="${letters.length > 2 ? 14 : 18}" ` +
    `font-family="Arial,sans-serif" font-weight="700">${letters.replace(/[<&]/g, '')}</text></svg>`;
  return Buffer.from(svg);
}

async function fetchImageBuf(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'image/*,*/*', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 80) return null;
    return { buf, ctype: r.headers.get('content-type') || 'image/png' };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

router.get('/icon/:symbol', async (req, res) => {
  let id = String(req.params.symbol || '').toUpperCase().replace(/\.PNG$/i, '');
  if (id.endsWith('USDT') && id !== 'USDT') id = id.replace(/USDT$/, '');
  id = id.replace(/[^A-Z0-9]/g, '') || 'USDT';
  const extra = String(req.query.img || '').trim();
  const cacheKey = extra ? `${id}::${extra}` : id;
  const hit = iconMem.get(cacheKey) || iconMem.get(id);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(hit.ctype);
    return res.send(hit.buf);
  }
  const slug = id.toLowerCase();
  const urls = [
    allowImgUrl(extra) ? extra : null,
    GECKO_ICONS[id],
    `https://assets.coincap.io/assets/icons/${slug}@2x.png`,
    `https://bin.bnbstatic.com/static/assets/logos/${id}.png`,
  ].filter(Boolean);
  for (const url of urls) {
    const rec = await fetchImageBuf(url);
    if (!rec) continue;
    const stored = { ...rec, at: Date.now() };
    iconMem.set(cacheKey, stored);
    iconMem.set(id, stored);
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(rec.ctype);
    return res.send(rec.buf);
  }
  try {
    const raw = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(id)}`, 6000);
    const coin = (raw.coins || []).find((c) => String(c.symbol || '').toUpperCase() === id) || (raw.coins || [])[0];
    const gurl = coin?.large || coin?.thumb || coin?.small;
    if (gurl) {
      const rec = await fetchImageBuf(gurl);
      if (rec) {
        const stored = { ...rec, at: Date.now() };
        iconMem.set(cacheKey, stored);
        iconMem.set(id, stored);
        res.set('Cache-Control', 'public, max-age=86400');
        res.type(rec.ctype);
        return res.send(rec.buf);
      }
    }
  } catch { /* svg fallback */ }
  const buf = letterIconBuf(id);
  const stored = { buf, ctype: 'image/svg+xml', at: Date.now() };
  iconMem.set(cacheKey, stored);
  res.set('Cache-Control', 'public, max-age=3600');
  res.type(stored.ctype);
  return res.send(buf);
});

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
const NEWS_TTL = 45 * 1000;
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
  const { newsSymbols } = require('../feed');
  const symbols = newsSymbols(titleClean, body);
  return {
    id: String(id || href),
    title: titleClean.slice(0, 180),
    url: href,
    source: source || 'News',
    image: image || null,
    publishedAt: toIso(publishedAt),
    body: stripHtml(decodeXml(body)).slice(0, 180),
    symbols,
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
  const locales = ['ru-RU', 'en-US'];
  const lists = await Promise.all(locales.map(async (locale) => {
    const raw = await fetchJson(`https://api.bybit.com/v5/announcements/index?locale=${locale}&limit=20`);
    const list = raw?.result?.list || [];
    return list.map((n, i) => normalizeItem({
      id: n.url || `bybit-${locale}-${i}`,
      title: n.title,
      url: n.url,
      source: 'Bybit',
      image: n.announcementImg || null,
      publishedAt: n.dateTimestamp || n.publishTime,
      body: n.description,
    })).filter(Boolean);
  }));
  return lists.flat();
}

async function newsFromBinance() {
  const raw = await fetchJson('https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=5');
  const catalogs = raw?.data?.catalogs || [];
  const out = [];
  for (const cat of catalogs) {
    for (const n of cat.articles || []) {
      const code = n.code || n.id;
      if (!code) continue;
      out.push(normalizeItem({
        id: `binance-${code}`,
        title: n.title,
        url: `https://www.binance.com/en/support/announcement/${code}`,
        source: 'Binance',
        image: n.coverImage || cat.icon || null,
        publishedAt: n.releaseDate,
        body: cat.catalogName,
      }));
    }
  }
  return out.filter(Boolean).slice(0, 24);
}

async function newsFromCryptoCompare(symbol) {
  const key = String(process.env.CRYPTOCOMPARE_KEY || '').trim();
  const cat = symbol ? `&categories=${encodeURIComponent(String(symbol).toUpperCase())}` : '';
  const qs = key ? `&api_key=${encodeURIComponent(key)}` : '';
  try {
    const raw = await fetchJson(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN${cat}${qs}`, 8000);
    const list = raw?.Data || [];
    return list.slice(0, 24).map((n, i) => normalizeItem({
      id: n.id || n.guid || `cc-${i}`,
      title: n.title,
      url: n.url || n.guid,
      source: n.source_info?.name || n.source || 'CryptoCompare',
      image: n.imageurl || null,
      publishedAt: n.published_on,
      body: n.body,
    })).filter(Boolean);
  } catch {
    return [];
  }
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
    newsFromBinance(),
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

setInterval(() => {
  loadFreshNews()
    .then((items) => {
      if (items.length) newsCache = { at: Date.now(), data: items };
    })
    .catch(() => {});
}, NEWS_TTL).unref?.();

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
        price: null, change24h: null, marketCap: null, image: coinPng(coin.symbol),
      };
    }
    return {
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: row.current_price,
      change24h: row.price_change_percentage_24h,
      marketCap: row.market_cap,
      image: row.image || coinPng(coin.symbol),
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
        price: null, change24h: null, marketCap: null, image: coinPng(coin.symbol),
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

const tokenNewsCache = new Map();

router.get('/news', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const symbol = String(req.query.symbol || '').toUpperCase().replace(/USDT$/, '');
  try {
    let items;
    if (newsCache.data && Date.now() - newsCache.at < NEWS_TTL) {
      items = newsCache.data;
    } else {
      items = await loadFreshNews();
      if (items.length) newsCache = { at: Date.now(), data: items };
      else items = newsCache.data || [];
    }
    if (symbol) {
      const hit = tokenNewsCache.get(symbol);
      let extra = [];
      if (hit && Date.now() - hit.at < NEWS_TTL) extra = hit.data;
      else {
        extra = await newsFromCryptoCompare(symbol);
        tokenNewsCache.set(symbol, { at: Date.now(), data: extra });
      }
      const merged = [...extra, ...items].filter((n) => {
        const tags = (n.symbols || []).map((s) => String(s).toUpperCase());
        const blob = `${n.title || ''} ${n.body || ''}`;
        return tags.includes(symbol) || new RegExp(`\\b${symbol}\\b`, 'i').test(blob)
          || (symbol === 'BTC' && /bitcoin|биткоин/i.test(blob))
          || (symbol === 'ETH' && /ethereum|эфир/i.test(blob));
      });
      const seen = new Set();
      const out = [];
      for (const n of merged) {
        if (seen.has(n.id) || seen.has(n.url)) continue;
        seen.add(n.id);
        seen.add(n.url);
        out.push(n);
      }
      return res.json(out.slice(0, 24));
    }
    res.json(items);
  } catch (e) {
    if (newsCache.data) return res.json(newsCache.data);
    res.json([]);
  }
});


const EXTRA_GECKO = {
  TRUMP: { id: 'official-trump', name: 'Official Trump' },
  HYPE: { id: 'hyperliquid', name: 'Hyperliquid' },
  PEPE: { id: 'pepe', name: 'Pepe' },
  BONK: { id: 'bonk', name: 'Bonk' },
  WIF: { id: 'dogwifcoin', name: 'dogwifhat' },
  FLOKI: { id: 'floki', name: 'FLOKI' },
  PENGU: { id: 'pudgy-penguins', name: 'Pudgy Penguins' },
  WLD: { id: 'worldcoin-wld', name: 'Worldcoin' },
  PUMP: { id: 'pump-fun', name: 'Pump.fun' },
  ZEC: { id: 'zcash', name: 'Zcash' },
};

const geckoCoinCache = new Map();

async function resolveCoin(symbol) {
  const s = String(symbol || 'BTC').toUpperCase().replace(/USDT$/, '');
  const listed = COINS.find((c) => c.symbol === s);
  if (listed) return listed;
  const extra = EXTRA_GECKO[s];
  if (extra) return { id: extra.id, symbol: s, name: extra.name, binance: `${s}USDT` };
  if (geckoCoinCache.has(s)) return geckoCoinCache.get(s);
  try {
    const raw = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(s)}`, 7000);
    const hit = (raw.coins || []).find((c) => String(c.symbol || '').toUpperCase() === s)
      || (raw.coins || [])[0];
    if (hit?.id) {
      const row = {
        id: hit.id,
        symbol: String(hit.symbol || s).toUpperCase(),
        name: hit.name || s,
        binance: `${s}USDT`,
      };
      geckoCoinCache.set(s, row);
      return row;
    }
  } catch { /* ignore */ }
  return { id: null, symbol: s, name: s, binance: `${s}USDT` };
}

function geckoDays(interval) {
  if (interval === '15m' || interval === '1h') return 1;
  if (interval === '4h') return 7;
  if (interval === '1d') return 30;
  return 90;
}

async function klinesFromBinance(pair, interval) {
  const raw = await fetchJson(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=120`,
    8000,
  );
  if (!Array.isArray(raw) || !raw.length) throw new Error('empty');
  return raw.map((k) => ({
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

async function klinesFromGecko(geckoId, interval) {
  if (!geckoId) throw new Error('no gecko');
  const raw = await fetchJson(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(geckoId)}/ohlc?vs_currency=usd&days=${geckoDays(interval)}`,
    8000,
  );
  if (!Array.isArray(raw) || !raw.length) throw new Error('empty');
  return raw.map((k) => ({
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: 0,
  }));
}

const klinesCache = new Map();
const KLINES_TTL = 30 * 1000;

router.get('/klines', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC').toUpperCase().replace(/USDT$/, '');
    const interval = String(req.query.interval || '1h');
    const coin = await resolveCoin(symbol);
    const pair = coin.binance || `${symbol}USDT`;
    const key = `${pair}:${interval}`;
    const hit = klinesCache.get(key);
    if (hit && Date.now() - hit.at < KLINES_TTL) return res.json(hit.data);

    let candles = null;
    try {
      candles = await klinesFromBinance(pair, interval);
    } catch {
      candles = await klinesFromGecko(coin.id, interval);
    }
    const data = {
      symbol: coin.symbol || symbol,
      name: coin.name || symbol,
      pair,
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
    const coin = await resolveCoin(symbol);
    if (!coin.id) return res.status(404).json({ error: 'монета не найдена' });
    const hit = coinCache.get(coin.id);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return res.json(hit.data);
    const raw = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin.id)}?localization=true&tickers=false&community_data=false&developer_data=false&sparkline=false`,
      8000,
    );
    const md = raw.market_data || {};
    const data = {
      symbol: coin.symbol,
      name: raw.name || coin.name,
      description: String(raw.description?.ru || raw.description?.en || '').replace(/<[^>]+>/g, '').slice(0, 900),
      homepage: raw.links?.homepage?.[0] || null,
      github: raw.links?.repos_url?.github?.[0] || null,
      twitter: raw.links?.twitter_screen_name || null,
      telegram: raw.links?.telegram_channel_identifier || null,
      marketCap: md.market_cap?.usd ?? null,
      fdv: md.fully_diluted_valuation?.usd ?? null,
      circulating: md.circulating_supply ?? null,
      total: md.total_supply ?? null,
      max: md.max_supply ?? null,
      price: md.current_price?.usd ?? null,
      change24h: md.price_change_percentage_24h ?? null,
      volume24h: md.total_volume?.usd ?? null,
      high24h: md.high_24h?.usd ?? null,
      low24h: md.low_24h?.usd ?? null,
      image: raw.image?.small || raw.image?.thumb || null,
    };
    coinCache.set(coin.id, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'обзор недоступен' });
  }
});

const ALPHA_MARKET = [
  { gecko: 'official-trump', symbol: 'TRUMP', name: 'TRUMP', chip: 'new' },
  { gecko: 'hyperliquid', symbol: 'HYPE', name: 'HYPE', chip: 'hot' },
  { gecko: 'pepe', symbol: 'PEPE', name: 'PEPE', chip: 'hot' },
  { gecko: 'bonk', symbol: 'BONK', name: 'BONK', chip: 'new' },
  { gecko: 'dogwifcoin', symbol: 'WIF', name: 'WIF', chip: 'hot' },
  { gecko: 'floki', symbol: 'FLOKI', name: 'FLOKI', chip: 'new' },
  { gecko: 'pudgy-penguins', symbol: 'PENGU', name: 'PENGU', chip: 'new' },
  { gecko: 'worldcoin-wld', symbol: 'WLD', name: 'WLD', chip: 'hot' },
];

const ALPHA_FARMS = [
  {
    pair: 'SPCX-USDC', tag: 'RWA', apr: 3.65, tvl: 158530, popular: true,
    a: 'SP', aId: 'SPCX', aBg: '#111827',
    logoA: 'https://logo.clearbit.com/spacex.com',
  },
  {
    pair: 'NVDAx-USDC', tag: 'Популярное', apr: 1.67, tvl: 92140, popular: true,
    a: 'NV', aId: 'NVDA', aBg: '#76b900',
    logoA: 'https://logo.clearbit.com/nvidia.com',
  },
  {
    pair: 'TSLAx-USDC', tag: 'Stocks', apr: 2.14, tvl: 54010, popular: false,
    a: 'TS', aId: 'TSLA', aBg: '#cc0000',
    logoA: 'https://logo.clearbit.com/tesla.com',
  },
];

const ALPHA_FALLBACK = [
  { symbol: 'TRUMP', name: 'TRUMP', price: 2.4107, change24h: 26.78, volume24h: 184580000, marketCap: 604570000, chip: 'new' },
  { symbol: 'HYPE', name: 'HYPE', price: 80.1449, change24h: 6.55, volume24h: 99400000, marketCap: 56930000, chip: 'hot' },
  { symbol: 'PEPE', name: 'PEPE', price: 0.0000124, change24h: 4.12, volume24h: 412000000, marketCap: 5200000000, chip: 'hot' },
  { symbol: 'BONK', name: 'BONK', price: 0.000021, change24h: -3.4, volume24h: 88000000, marketCap: 1400000000, chip: 'new' },
  { symbol: 'WIF', name: 'WIF', price: 1.82, change24h: 1.15, volume24h: 71490, marketCap: 391840, chip: 'hot' },
  { symbol: 'FLOKI', name: 'FLOKI', price: 0.00018, change24h: -1.2, volume24h: 52000000, marketCap: 1750000000, chip: 'new' },
  { symbol: 'PENGU', name: 'PENGU', price: 0.01402, change24h: -8.88, volume24h: 21000000, marketCap: 880000000, chip: 'new' },
  { symbol: 'WLD', name: 'WLD', price: 2.05, change24h: 2.4, volume24h: 120000000, marketCap: 2100000000, chip: 'hot' },
];

let alphaCache = { at: 0, data: null };

function mapAlphaRow(meta, row) {
  if (!row) return { ...ALPHA_FALLBACK.find((f) => f.symbol === meta.symbol), ...meta };
  return {
    symbol: meta.symbol,
    name: meta.name,
    chip: meta.chip,
    price: row.current_price ?? row.price,
    change24h: row.price_change_percentage_24h ?? row.change24h,
    volume24h: row.total_volume ?? row.volume24h,
    marketCap: row.market_cap ?? row.marketCap,
    image: row.image || null,
  };
}

router.get('/alpha', async (_req, res) => {
  try {
    if (alphaCache.data && Date.now() - alphaCache.at < 20000) return res.json(alphaCache.data);
    let market = ALPHA_FALLBACK.map((x) => ({ ...x }));
    try {
      const ids = ALPHA_MARKET.map((c) => c.gecko).join(',');
      const raw = await fetchJson(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`,
        9000,
      );
      if (Array.isArray(raw) && raw.length) {
        const byId = Object.fromEntries(raw.map((c) => [c.id, c]));
        market = ALPHA_MARKET.map((meta) => mapAlphaRow(meta, byId[meta.gecko]));
      }
    } catch { /* fallback list */ }

    let sniping = market.slice(0, 2).map((c, i) => ({
      ...c,
      tag: i === 0 ? 'Новые' : 'Мемы',
      popular: true,
      created: i === 0 ? '8D' : null,
    }));
    try {
      const tr = await fetchJson('https://api.coingecko.com/api/v3/search/trending', 7000);
      const coins = (tr.coins || []).slice(0, 2).map((x) => x.item).filter(Boolean);
      if (coins.length) {
        sniping = coins.map((item, i) => {
          const rawPx = item.data?.price;
          const usd = typeof rawPx === 'number' ? rawPx : Number(String(rawPx || '').replace(/[^0-9.-]/g, ''));
          return {
            symbol: String(item.symbol || '').toUpperCase(),
            name: item.name,
            tag: i === 0 ? 'Новые' : 'Мемы',
            popular: true,
            price: Number.isFinite(usd) ? usd : null,
            change24h: Number(item.data?.price_change_percentage_24h?.usd ?? 0),
            volume24h: Number(String(item.data?.total_volume || '').replace(/[^0-9.]/g, '')) || null,
            marketCap: Number(String(item.data?.market_cap || '').replace(/[^0-9.]/g, '')) || null,
            created: i === 0 ? '8D' : null,
            image: item.large || item.small || item.thumb || null,
          };
        });
      }
    } catch { /* keep sniping from market */ }

    const data = { sniping, farms: ALPHA_FARMS, market };
    alphaCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    if (alphaCache.data) return res.json(alphaCache.data);
    res.json({ sniping: ALPHA_FALLBACK.slice(0, 2), farms: ALPHA_FARMS, market: ALPHA_FALLBACK });
  }
});

router.get('/feed', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const { buildFeed } = require('../feed');
  res.json(buildFeed(Date.now()));
});

router.get('/feed/chart', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC').toUpperCase().replace(/USDT$/, '');
  const pair = `${symbol}USDT`;
  let candles = [];
  try {
    candles = await klinesFromBinance(pair, '1h');
  } catch {
    try { candles = await klinesFromGecko((await resolveCoin(symbol)).id, '1h'); } catch { candles = []; }
  }
  const w = 640;
  const h = 280;
  const slice = candles.slice(-48);
  const max = Math.max(...slice.map((c) => c.high), 1);
  const min = Math.min(...slice.map((c) => c.low), 0);
  const span = max - min || 1;
  const bw = slice.length ? (w - 40) / slice.length : 8;
  const body = slice.map((c, i) => {
    const x = 20 + i * bw;
    const yHigh = 20 + ((max - c.high) / span) * (h - 40);
    const yLow = 20 + ((max - c.low) / span) * (h - 40);
    const yO = 20 + ((max - c.open) / span) * (h - 40);
    const yC = 20 + ((max - c.close) / span) * (h - 40);
    const up = c.close >= c.open;
    const top = Math.min(yO, yC);
    const bh = Math.max(2, Math.abs(yC - yO));
    const col = up ? '#0ecb81' : '#f6465d';
    return `<line x1="${x}" x2="${x}" y1="${yHigh}" y2="${yLow}" stroke="${col}" stroke-width="1"/>`
      + `<rect x="${x - bw * 0.28}" y="${top}" width="${Math.max(2, bw * 0.55)}" height="${bh}" fill="${col}"/>`;
  }).join('');
  const last = slice[slice.length - 1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="100%" height="100%" fill="#0b0e11"/>`
    + `<text x="24" y="36" fill="#3a4250" font-size="42" font-family="Arial" font-weight="700">BYBIT</text>`
    + body
    + `<text x="24" y="${h - 18}" fill="#eaecef" font-size="18" font-family="Arial">${symbol}USDT ${last ? last.close.toFixed(2) : ''}</text>`
    + `</svg>`;
  res.type('image/svg+xml');
  res.set('Cache-Control', 'public, max-age=60');
  res.send(svg);
});

let fxCache = { at: 0, data: { USD: 1, EUR: 0.92, RUB: 92 } };
router.get('/fx', async (_req, res) => {
  try {
    if (Date.now() - fxCache.at < 30 * 60 * 1000 && fxCache.data) return res.json(fxCache.data);
    const raw = await fetchJson('https://open.er-api.com/v6/latest/USD', 8000);
    const r = raw.rates || {};
    fxCache = {
      at: Date.now(),
      data: { USD: 1, EUR: Number(r.EUR) || 0.92, RUB: Number(r.RUB) || 92 },
    };
    res.json(fxCache.data);
  } catch {
    res.json(fxCache.data);
  }
});

router.use((_req, res) => {
  res.status(404).json({ error: 'unknown market endpoint' });
});

module.exports = router;

