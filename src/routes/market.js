const express = require('express');

const router = express.Router();

// Топ-10 популярных монет (CoinGecko ids)
const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
];

let quotesCache = { at: 0, data: null };
let newsCache = { at: 0, data: null };

const QUOTES_TTL = 60 * 1000;
const NEWS_TTL = 5 * 60 * 1000;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'telegram-mini-app' },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

router.get('/quotes', async (_req, res) => {
  try {
    if (quotesCache.data && Date.now() - quotesCache.at < QUOTES_TTL) {
      return res.json(quotesCache.data);
    }

    const ids = COINS.map((c) => c.id).join(',');
    const url =
      `https://api.coingecko.com/api/v3/coins/markets` +
      `?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;

    const raw = await fetchJson(url);
    const byId = Object.fromEntries(raw.map((c) => [c.id, c]));

    const data = COINS.map((coin) => {
      const row = byId[coin.id];
      if (!row) {
        return {
          id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          price: null,
          change24h: null,
          marketCap: null,
          image: null,
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

    quotesCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    if (quotesCache.data) return res.json(quotesCache.data);
    res.status(502).json({ error: 'не удалось загрузить котировки' });
  }
});

router.get('/news', async (_req, res) => {
  try {
    if (newsCache.data && Date.now() - newsCache.at < NEWS_TTL) {
      return res.json(newsCache.data);
    }

    // CryptoCompare news — без ключа отдаёт ограниченную ленту
    const raw = await fetchJson(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,Trading,Blockchain'
    );

    const items = (raw.Data || []).slice(0, 12).map((n) => ({
      id: n.id,
      title: n.title,
      url: n.url,
      source: n.source_info?.name || n.source,
      image: n.imageurl || null,
      publishedAt: n.published_on ? new Date(n.published_on * 1000).toISOString() : null,
      body: n.body ? String(n.body).slice(0, 180) : '',
    }));

    newsCache = { at: Date.now(), data: items };
    res.json(items);
  } catch (e) {
    if (newsCache.data) return res.json(newsCache.data);
    res.status(502).json({ error: 'не удалось загрузить новости' });
  }
});

module.exports = router;
