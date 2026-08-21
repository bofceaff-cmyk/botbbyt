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
];

const FALLBACK_NEWS = [
  {
    id: 'fb1',
    title: 'Bitcoin удерживает внимание рынка на фоне волатильности',
    url: 'https://www.coindesk.com/',
    source: 'Market',
    image: null,
    publishedAt: new Date().toISOString(),
    body: 'Следите за динамикой BTC/USDT и новостями по регуляции.',
  },
  {
    id: 'fb2',
    title: 'Ethereum и альткоины: что смотреть инвесторам сегодня',
    url: 'https://cointelegraph.com/',
    source: 'Market',
    image: null,
    publishedAt: new Date().toISOString(),
    body: 'ETH, SOL и другие ликвидные активы остаются в фокусе трейдеров.',
  },
  {
    id: 'fb3',
    title: 'USDT остаётся основной стейблкойн-парой на споте',
    url: 'https://www.bybit.com/',
    source: 'Market',
    image: null,
    publishedAt: new Date().toISOString(),
    body: 'Большинство пар в приложении котируются к USDT.',
  },
];

let quotesCache = { at: 0, data: null };
let newsCache = { at: 0, data: null };

const QUOTES_TTL = 45 * 1000;
const NEWS_TTL = 5 * 60 * 1000;

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'bybit-wallet-miniapp' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
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
      marketCap: null,
      image: null,
    };
  });
}

router.get('/quotes', async (_req, res) => {
  try {
    if (quotesCache.data && Date.now() - quotesCache.at < QUOTES_TTL) {
      return res.json(quotesCache.data);
    }

    let data;
    try {
      data = await quotesFromCoinGecko();
    } catch {
      data = await quotesFromBinance();
    }

    quotesCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    if (quotesCache.data) return res.json(quotesCache.data);
    res.json(FALLBACK_QUOTES);
  }
});

router.get('/news', async (_req, res) => {
  try {
    if (newsCache.data && Date.now() - newsCache.at < NEWS_TTL) {
      return res.json(newsCache.data);
    }

    let items = null;
    try {
      const raw = await fetchJson(
        'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent('https://www.coindesk.com/arc/outboundfeeds/rss/')
      );
      if (raw.status !== 'ok' || !Array.isArray(raw.items)) throw new Error('rss bad');
      items = raw.items.slice(0, 12).map((n, i) => ({
        id: n.guid || n.link || `rss-${i}`,
        title: n.title,
        url: n.link,
        source: raw.feed?.title || 'CoinDesk',
        image: n.thumbnail || (n.enclosure && n.enclosure.link) || null,
        publishedAt: n.pubDate ? new Date(n.pubDate).toISOString() : null,
        body: n.description ? String(n.description).replace(/<[^>]+>/g, '').slice(0, 180) : '',
      }));
    } catch {
      items = FALLBACK_NEWS;
    }

    if (!items.length) items = FALLBACK_NEWS;
    newsCache = { at: Date.now(), data: items };
    res.json(items);
  } catch (e) {
    if (newsCache.data) return res.json(newsCache.data);
    res.json(FALLBACK_NEWS);
  }
});

module.exports = router;
