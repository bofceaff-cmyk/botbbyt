function mulberry(seed) {
  let t = (seed >>> 0) + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

const USERS = [
  { id: 'bybitx', name: 'BybitX', verified: true, avatar: 'logo' },
  { id: 'odaily', name: 'Odaily', verified: true, avatar: 'photo' },
  { id: 'techflow', name: 'TechFlow', verified: true, avatar: 'photo' },
  { id: 'sattu', name: 'Sattu Star', verified: false, avatar: 'photo' },
  { id: 'sultan', name: 'CryptoSultanX', verified: false, avatar: 'photo' },
  { id: 'fear', name: 'fear&greed_of', verified: false, avatar: 'none' },
  { id: 'nova', name: 'NovaLedger', verified: false, avatar: 'photo' },
  { id: 'mira', name: 'Mira.trade', verified: false, avatar: 'none' },
  { id: 'hash', name: 'HashRabbit', verified: false, avatar: 'photo' },
  { id: 'lena', name: 'Elena.fx', verified: false, avatar: 'photo' },
  { id: 'ken', name: 'KenOnChain', verified: false, avatar: 'none' },
  { id: 'pulse', name: 'PulseDesk', verified: true, avatar: 'photo' },
  { id: 'dex', name: 'DexOwl', verified: false, avatar: 'photo' },
  { id: 'rio', name: 'Rio.alpha', verified: false, avatar: 'none' },
  { id: 'maya', name: 'MayaLabs', verified: false, avatar: 'photo' },
  { id: 'anon1', name: 'user***1842', verified: false, avatar: 'none' },
];

const POST_TEXTS = [
  {
    title: 'Создайте ИИ-город будущего — зарабатывайте до 2 500 $ с пользователя!',
    body: 'AI-цепочки поставок уже переписывают оценки SNDK, NVDA, MRVL и DELL. Следим за отчётностью и потоком капитала в полупроводники.',
    tag: 'ByXIMPACT',
    media: 'banner',
    banner: 'ai',
    coins: ['NVDA'],
  },
  {
    title: 'Биткоин и Эфириум взлетают!',
    body: 'Восемь альткоинов заслуживают внимания на дальнейшую перспективу. Ликвидность возвращается в крупные L1.',
    media: 'banner',
    banner: 'crypto',
    coins: ['BTC', 'ETH'],
  },
  {
    title: '🚨 Я ПРЕДУПРЕЖДАЛ ВАС ОБ ЭТОМ ПАМПЕ',
    body: 'ETHUSDT отработал уровень. Кто держал — молодец. Кто шортил без стопа — сам виноват.',
    media: 'chart',
    coins: ['ETH'],
  },
  {
    title: 'XAUT держит структуру',
    body: 'Золото в токене снова в работе. Не гонитесь за тенью — ждите ретест 4h.',
    media: 'chart',
    coins: ['XAUT'],
  },
  {
    title: 'Далио из Bridgewater предупреждает',
    body: 'Кризис госдолга США может наступить в ближайшие три года. Это не призыв паниковать, это повод смотреть на золото и BTC как на хедж.',
    media: 'none',
    coins: ['BTC'],
  },
  {
    title: 'Ликвидность стейблкоинов',
    body: 'Недельный приток USDT/USDC снова зелёный. Когда стейблы едут на биржи — обычно это не «продавать всё».',
    media: 'none',
    coins: ['USDT', 'USDC'],
  },
  {
    title: 'ФРС и риск-он',
    body: 'Рынок уже заложил мягкость. Если спикер будет ястребом — альты просядут быстрее BTC.',
    media: 'chart',
    coins: ['BTC'],
  },
  {
    title: 'SOL выглядит сильнее рынка',
    body: 'Объём на споте держится. Не путать импульс с трендом, но структура выше прошлой недели.',
    media: 'chart',
    coins: ['SOL'],
  },
  {
    title: 'MNT: локальный импульс',
    body: 'Нативные объёмы выросли. Не ловлю хвост, жду откат к зоне спроса.',
    media: 'chart',
    coins: ['MNT'],
  },
  {
    title: 'Gold vs BTC: кто хедж сейчас',
    body: 'Корреляция плавает. На этой неделе золото спокойнее, биткоин нервничает на новостях.',
    media: 'chart',
    coins: ['XAUT'],
  },
  {
    title: 'Не торгуйте новости без плана',
    body: 'Три правила: размер позиции, стоп до входа, не усреднять против тренда. Всё остальное — шум.',
    media: 'none',
  },
  {
    title: 'Альты: селективный риск',
    body: 'Не «покупай всё, что зелёное». Смотрю только пары с объёмом и чистой структурой.',
    media: 'banner',
    banner: 'alts',
    coins: ['ETH'],
  },
  {
    title: 'Funding на фьючах остыл',
    body: 'Перегрев лонгов спал. Это не сигнал покупать, это сигнал не шортить из злости.',
    media: 'none',
    coins: ['BTC'],
  },
  {
    title: 'Разбор 4h: где ликвидность',
    body: 'Свипы сверху уже были. Если закрепимся выше вчерашнего mid — можно смотреть лонг от ретеста.',
    media: 'chart',
    coins: ['BTC'],
  },
  {
    title: 'TON: объём есть, тренда нет',
    body: 'Боковик с ложными выносами. Пока без идеи, жду расширение диапазона.',
    media: 'chart',
    coins: ['TON'],
  },
  {
    title: 'Почему я не гоняюсь за 100x',
    body: 'Счёт растёт от серии +1–3R, не от одного скрина в ленте. Скучно — и это нормально.',
    media: 'none',
  },
];

const COMMENT_POOL = [
  'i believe you are wrong, yes a slight retracement but look at the history of gold since 2020 post covid',
  'exactly you\'re right, smaller timeframe is just noise',
  'Норм тейк. На 4h согласен, на 15м шум.',
  'Кто-то ещё шортит это без хеджа?',
  'Похоже на развод ликвидности перед импульсом.',
  'Переведите на русский плз',
  'По факту: держим, стоп ниже свипа.',
  'График красивый, но объём слабый.',
  'Я заходил от этой зоны, пока в плюсе.',
  'Не похоже на разворот, скорее пауза.',
  'Спасибо за разбор, жду апдейт после США.',
  'А какой таймфрейм основной?',
  'На споте спокойнее, на фьючах режут стопы.',
  'Согласен про стейблы, приток реально виден.',
  'Слишком рано для эйфории.',
  'Где стоп ставишь, если не секрет?',
  'Это уже в цене, имхо.',
  'Добавил в избранное, слежу.',
  'Автор как всегда вовремя.',
  'Не вижу подтверждения на дневке.',
  'Лонг только после ретеста, иначе лотерея.',
  'Кто держал с прошлой недели — молодец.',
  'Мне кажется, это ещё не всё.',
  'Фундаментально ок, технически рано.',
  'not financial advice but structure is clean',
  'looks like a liquidity grab tbh',
];

const PROMO_LINKS = [
  {
    id: 'cybertruck',
    title: 'Сезон отчетности: торгуйте, прогнозируйте и выиграйте Cybertruck!',
    sub: 'Сезон отчетности: торгуйте, прогнозируйте и выиграйте Cybertruck!',
    until: '2026-08-31',
    url: 'https://www.bybit.com/en/promo/campaign/SuperGiveaway2026',
    img: '/api/market/feed/promo/cybertruck',
  },
  {
    id: 'galaxy',
    title: 'Bybit Galaxy',
    sub: 'Присоединяйтесь к Bybit Galaxy, исследуйте вселенную и получайте крупные награды',
    until: '2026-10-31',
    url: 'https://www.bybit.com/en/promo/campaign/Dual_Boost_Mission_Triple',
    img: '/api/market/feed/promo/galaxy',
  },
  {
    id: 'loyalty',
    title: 'Программа лояльности Bybit',
    sub: 'Регулярно используйте платформу Bybit, копите баллы и обменивайте их на ценные призы',
    until: '2026-10-03',
    url: 'https://www.bybit.com/en/promo/campaign/Bybit_Reward_Season',
    img: '/api/market/feed/promo/loyalty',
  },
  {
    id: 'tradfi',
    title: 'Арена торговых инструментов TradFi',
    sub: 'Осваивайте рынки с торговыми инструментами TradFi.',
    until: '2026-09-12',
    url: 'https://www.bybit.com/en/promo/campaign/TradFicreditcampaign_upto10000',
    img: '/api/market/feed/promo/tradfi',
  },
  {
    id: 'live',
    title: 'Watch & Earn: прямые эфиры',
    sub: 'Смотрите эфиры и выполняйте задания кампании Stream to Win.',
    until: '2026-09-30',
    url: 'https://www.bybit.com/en/promo/campaign/StreamToWin',
    img: '/api/market/feed/promo/live',
  },
];

function monthLabel(d) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function agoLabel(ts, now) {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 50) return 'только что';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} мин. назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч. назад`;
  return `${Math.floor(h / 24)} дн. назад`;
}

function maskName(rng) {
  const n = 1000 + Math.floor(rng() * 9000);
  return pick(rng, [`not***@****`, `user***${n}`, `trader_${n}`, `0x${n}aa`]);
}

function buildThread(rng, count, author, ts, now) {
  const n = clamp(count, 3, 16);
  const used = new Set();
  const thread = [];
  for (let i = 0; i < n; i += 1) {
    let text = pick(rng, COMMENT_POOL);
    let guard = 0;
    while (used.has(text) && guard < 8) {
      text = pick(rng, COMMENT_POOL);
      guard += 1;
    }
    used.add(text);
    const isAuthor = i > 0 && rng() < 0.22;
    const user = isAuthor
      ? author
      : (rng() < 0.35
        ? { id: `anon-${i}`, name: maskName(rng), avatar: 'none', verified: false }
        : pick(rng, USERS.filter((u) => u.id !== author.id)));
    const replyTo = i > 2 && rng() < 0.35 ? thread[Math.floor(rng() * i)].user.name : null;
    const postAgeMin = Math.max(6, (now - ts) / 60000);
    const fromEnd = n - i;
    const minutesAgo = Math.min(
      postAgeMin - 1,
      4 + fromEnd * (7 + rng() * 16) + rng() * 9,
    );
    const cTs = now - Math.max(3, minutesAgo) * 60000;
    thread.push({
      id: `c${i}`,
      user,
      author: isAuthor,
      text: replyTo ? `Ответ ${replyTo}: ${text}` : text,
      ts: Math.floor(cTs),
      ago: agoLabel(cTs, now),
      likes: Math.floor(rng() * 8),
    });
  }
  return thread;
}

function buildFeed(now = Date.now()) {
  const slots = [];
  const intervals = [67, 83, 103, 73, 127, 91, 109, 71].map((m) => m * 60 * 1000);
  let t = now - 40 * 3600 * 1000;
  let i = 0;
  while (t < now - 10 * 60 * 1000) {
    t += intervals[i % intervals.length];
    i += 1;
    if (t < now - 6 * 60 * 1000) slots.push(t);
  }
  const recent = slots.slice(-POST_TEXTS.length);
  const posts = recent.reverse().map((ts, idx) => {
    const rng = mulberry((Math.floor(ts / 60000) ^ 0xA11CE) >>> 0);
    const text = POST_TEXTS[idx % POST_TEXTS.length];
    const user = USERS[(idx * 3 + Math.floor(rng() * 3)) % USERS.length];
    const thread = buildThread(rng, 4 + Math.floor(rng() * 11), user, ts, now);
    const coin = (text.coins && text.coins[0]) || null;
    const chg = Number(((rng() * 2.6) - 0.5).toFixed(2));
    return {
      id: `p${Math.floor(ts / 1000)}`,
      ts,
      date: monthLabel(new Date(ts)),
      user,
      title: text.title,
      body: text.body,
      tag: text.tag || null,
      media: text.media || 'none',
      banner: text.banner || 'crypto',
      coin,
      change: chg,
      likes: 12 + Math.floor(rng() * 210),
      comments: thread.length,
      reposts: Math.floor(rng() * 9),
      shares: 1 + Math.floor(rng() * 12),
      thread,
    };
  });

  const forecasts = [
    {
      id: 'f-cxmt',
      type: 'yesno',
      status: 'live',
      timer: 'Прогноз 6д 20ч 18м',
      question: 'Останется ли Changxin Technology (CXMT) крупнейшей компанией Китая по выпуску DRAM?',
      yes: 87,
      people: '9.0K',
    },
    {
      id: 'f-spider',
      type: 'multi',
      status: 'closed',
      timer: 'Прием прогнозов окончен',
      question: '«Человек-паук: Совсем новый день» (2026): мировые кассовые сборы к 27 авг.',
      options: [
        { label: 'Ниже $1.8B', odd: '2.37x', pct: 45 },
        { label: '$1.8B – $2.1B', odd: '3.50x', pct: 29 },
        { label: 'Выше $2.1B', odd: '3.43x', pct: 27 },
      ],
      people: '4.4K',
    },
    {
      id: 'f-hormuz',
      type: 'yesno',
      status: 'closed',
      timer: 'Прием прогнозов окончен',
      question: 'Вернётся ли движение через Ормузский пролив к норме до 23 авг.?',
      yes: 55,
      people: '8.0K',
    },
    {
      id: 'f-mnt',
      type: 'market',
      status: 'live',
      timer: 'Прогнозы доступны',
      pair: 'MNTUSDT',
      change: 6.16,
      people: '10.3M',
    },
    {
      id: 'f-btc',
      type: 'market',
      status: 'live',
      timer: 'Прогнозы доступны',
      pair: 'BTCUSDT',
      change: 0.12,
      people: '10.4M',
    },
    {
      id: 'f-eth',
      type: 'market',
      status: 'live',
      timer: 'Прогнозы доступны',
      pair: 'ETHUSDT',
      change: 0.51,
      people: '8.8M',
    },
  ];

  return { posts, promos: PROMO_LINKS, forecasts, generatedAt: now };
}

function newsSymbols(title, body) {
  const t = `${title || ''} ${body || ''}`;
  const map = [
    ['BTC', /\b(bitcoin|btc|биткоин)\b/i],
    ['ETH', /\b(ethereum|eth|эфир)\b/i],
    ['SOL', /\b(solana|sol)\b/i],
    ['XRP', /\b(ripple|xrp)\b/i],
    ['USDT', /\b(tether|usdt)\b/i],
    ['USDC', /\b(usdc)\b/i],
    ['BNB', /\b(bnb|binance coin)\b/i],
    ['DOGE', /\b(doge|dogecoin)\b/i],
    ['TON', /\b(toncoin|ton)\b/i],
    ['TRX', /\b(tron|trx)\b/i],
    ['LINK', /\b(chainlink|link)\b/i],
    ['HYPE', /\b(hyperliquid|hype)\b/i],
    ['XAUT', /\b(xaut|gold|золото)\b/i],
    ['MNT', /\b(mnt|mantle)\b/i],
  ];
  return map.filter(([, re]) => re.test(t)).map(([s]) => s);
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function syntheticCandles(seed, n = 48, start = 100) {
  const rng = mulberry(seed);
  let p = start;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const drift = (rng() - 0.48) * p * 0.012;
    const open = p;
    const close = Math.max(0.01, p + drift);
    const high = Math.max(open, close) * (1 + rng() * 0.006);
    const low = Math.min(open, close) * (1 - rng() * 0.006);
    out.push({ open, high, low, close });
    p = close;
  }
  return out;
}

function chartSvg(candles, symbol) {
  const w = 720;
  const h = 320;
  const slice = (candles && candles.length ? candles : syntheticCandles(1)).slice(-56);
  const max = Math.max(...slice.map((c) => c.high));
  const min = Math.min(...slice.map((c) => c.low));
  const span = (max - min) || 1;
  const bw = (w - 48) / slice.length;
  const body = slice.map((c, i) => {
    const x = 28 + i * bw + bw * 0.5;
    const y = (v) => 28 + ((max - v) / span) * (h - 64);
    const up = c.close >= c.open;
    const col = up ? '#0ecb81' : '#f6465d';
    const top = Math.min(y(c.open), y(c.close));
    const bh = Math.max(2, Math.abs(y(c.close) - y(c.open)));
    return `<line x1="${x}" x2="${x}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${col}" stroke-width="1.4"/>`
      + `<rect x="${x - bw * 0.28}" y="${top}" width="${Math.max(2.2, bw * 0.56)}" height="${bh}" fill="${col}"/>`;
  }).join('');
  const last = slice[slice.length - 1];
  const price = last ? Number(last.close).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="100%" height="100%" fill="#0b0e11"/>`
    + `<text x="50%" y="52%" fill="#2a313c" font-size="64" font-family="Arial" font-weight="700" text-anchor="middle">BYBIT</text>`
    + body
    + `<text x="24" y="${h - 16}" fill="#eaecef" font-size="20" font-family="Arial">${escapeXml(symbol)}USDT ${price}</text>`
    + `</svg>`;
}

function hueOf(id) {
  return [...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
}

function avatarSvg(id, name) {
  const hue = hueOf(id);
  const letter = String(name || id || '?').replace(/^user/, 'U').slice(0, 1).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 50% 22%)"/>`
    + `</linearGradient></defs>`
    + `<circle cx="48" cy="48" r="48" fill="url(#g)"/>`
    + `<circle cx="34" cy="36" r="10" fill="#fff" opacity=".15"/>`
    + `<text x="48" y="58" text-anchor="middle" fill="#fff" font-size="36" font-family="Arial" font-weight="700">${escapeXml(letter)}</text>`
    + `</svg>`;
}

function promoSvg(id) {
  const themes = {
    giveaway: { a: '#f7a600', b: '#111827', t: 'SUPER GIVEAWAY', s: 'Loyalty points · prizes' },
    rewards: { a: '#fb923c', b: '#1c1917', t: 'REWARD SEASON', s: 'iPhone · USDT · tasks' },
    tradfi: { a: '#38bdf8', b: '#0f172a', t: 'TRADFI CREDIT', s: 'Up to $10,000' },
    boost: { a: '#a855f7', b: '#1e1b4b', t: 'DUAL BOOST', s: '100,000 USDT pool' },
    live: { a: '#ef4444', b: '#111827', t: 'BYBIT LIVE', s: 'Watch & earn' },
  };
  const th = themes[id] || themes.giveaway;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360">`
    + `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${th.a}"/><stop offset="1" stop-color="${th.b}"/></linearGradient></defs>`
    + `<rect width="800" height="360" fill="url(#p)"/>`
    + `<circle cx="640" cy="80" r="120" fill="#fff" opacity=".08"/>`
    + `<circle cx="700" cy="280" r="90" fill="#000" opacity=".2"/>`
    + `<text x="40" y="150" fill="#fff" font-size="42" font-family="Arial" font-weight="800">${th.t}</text>`
    + `<text x="40" y="198" fill="#fff" opacity=".85" font-size="22" font-family="Arial">${th.s}</text>`
    + `<rect x="40" y="240" width="168" height="40" rx="20" fill="#111" opacity=".45"/>`
    + `<text x="124" y="266" text-anchor="middle" fill="#fff" font-size="14" font-family="Arial">BYBIT</text>`
    + `</svg>`;
}

function bannerSvg(kind, seed) {
  const rng = mulberry(Number(String(seed).replace(/\D/g, '')) || 7);
  if (kind === 'ai') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360">`
      + `<rect width="800" height="360" fill="#020617"/>`
      + `<rect x="80" y="160" width="70" height="140" fill="#1d4ed8"/>`
      + `<rect x="170" y="110" width="80" height="190" fill="#2563eb"/>`
      + `<rect x="270" y="80" width="90" height="220" fill="#38bdf8"/>`
      + `<rect x="380" y="130" width="75" height="170" fill="#6366f1"/>`
      + `<text x="40" y="50" fill="#fbbf24" font-size="22" font-family="Arial" font-weight="800">BUILD YOUR AI FUTURE CITY</text>`
      + `<text x="40" y="84" fill="#fff" font-size="28" font-family="Arial" font-weight="700">$2500 / user</text>`
      + `</svg>`;
  }
  if (kind === 'alts') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360">`
      + `<rect width="800" height="360" fill="#0b1220"/>`
      + `<circle cx="400" cy="180" r="90" fill="#f59e0b"/>`
      + `<circle cx="280" cy="140" r="40" fill="#627eea"/>`
      + `<circle cx="520" cy="210" r="36" fill="#14f195"/>`
      + `<text x="400" y="320" text-anchor="middle" fill="#fff" font-size="26" font-family="Arial" font-weight="700">ALT SEASON WATCH</text>`
      + `</svg>`;
  }
  const c1 = Math.floor(rng() * 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360">`
    + `<defs><radialGradient id="r" cx="50%" cy="45%"><stop offset="0" stop-color="hsl(${c1} 80% 45%)"/><stop offset="1" stop-color="#020617"/></radialGradient></defs>`
    + `<rect width="800" height="360" fill="url(#r)"/>`
    + `<circle cx="400" cy="160" r="70" fill="#111827" stroke="#f7a600" stroke-width="6"/>`
    + `<text x="400" y="280" text-anchor="middle" fill="#fff" font-size="28" font-family="Arial" font-weight="800">CRYPTOCURRENCY NEWS</text>`
    + `</svg>`;
}

module.exports = {
  buildFeed,
  newsSymbols,
  clamp,
  chartSvg,
  syntheticCandles,
  avatarSvg,
  promoSvg,
  bannerSvg,
};
