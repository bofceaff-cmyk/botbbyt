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
  { id: 'odaily', name: 'Odaily', verified: true, avatar: 'od' },
  { id: 'techflow', name: 'TechFlow', verified: true, avatar: 'tf' },
  { id: 'sattu', name: 'Sattu Star', verified: false, avatar: 'photo' },
  { id: 'sultan', name: 'CryptoSultanX', verified: false, avatar: 'photo' },
  { id: 'fear', name: 'fear&greed_of', verified: false, avatar: 'none' },
  { id: 'nova', name: 'NovaLedger', verified: false, avatar: 'nl' },
  { id: 'mira', name: 'Mira.trade', verified: false, avatar: 'none' },
  { id: 'hash', name: 'HashRabbit', verified: false, avatar: 'photo' },
  { id: 'lena', name: 'Elena.fx', verified: false, avatar: 'photo' },
  { id: 'ken', name: 'KenOnChain', verified: false, avatar: 'none' },
  { id: 'pulse', name: 'PulseDesk', verified: true, avatar: 'pd' },
];

const POST_TEXTS = [
  {
    title: 'Создайте ИИ-город будущего — зарабатывайте до 2 500 $ с пользователя!',
    body: 'AI-цепочки поставок уже переписывают оценки SNDK, NVDA, MRVL и DELL. Следим за отчётностью и потоком капитала в полупроводники.',
    tag: 'ByXIMPACT',
    kind: 'promo',
  },
  {
    title: 'Биткоин и Эфириум взлетают!',
    body: 'Восемь альткоинов заслуживают внимания на дальнейшую перспективу. Ликвидность возвращается в крупные L1.',
    tag: null,
    kind: 'news',
    coins: ['BTC', 'ETH'],
  },
  {
    title: '🚨 Я ПРЕДУПРЕЖДАЛ ВАС ОБ ЭТОМ ПАМПЕ',
    body: 'ETHUSDT отработал уровень. Кто держал — молодец. Кто шортил без стопа — сам виноват.',
    tag: null,
    kind: 'hype',
    coins: ['ETH'],
  },
  {
    title: 'XAUT держит структуру',
    body: 'Золото в токене снова в работе. Не гонитесь за тенью — ждите ретест 4h.',
    tag: null,
    kind: 'chart',
    coins: ['XAUT'],
  },
  {
    title: 'Далио из Bridgewater предупреждает',
    body: 'Кризис госдолга США может наступить в ближайшие три года. Это не призыв паниковать, это повод смотреть на золото и BTC как на хедж.',
    tag: null,
    kind: 'news',
    coins: ['BTC'],
  },
  {
    title: 'Ликвидность стейблкоинов',
    body: 'Недельный приток USDT/USDC снова зелёный. Когда стейблы едут на биржи — обычно это не «продавать всё».',
    tag: null,
    kind: 'text',
    coins: ['USDT', 'USDC'],
  },
  {
    title: 'ФРС и риск-он',
    body: 'Рынок уже заложил мягкость. Если спикер будет ястребом — альты просядут быстрее BTC.',
    tag: null,
    kind: 'text',
    coins: ['BTC'],
  },
  {
    title: 'SOL выглядит сильнее рынка',
    body: 'Объём на споте держится. Не путать импульс с трендом, но структура выше прошлой недели.',
    tag: null,
    kind: 'chart',
    coins: ['SOL'],
  },
];

const COMMENTS = [
  ['i believe you are wrong, yes a slight retracement but look at the history of gold since 2020 post covid, it will tell you more then your smaller timeframe', 'exactly you\'re right'],
  ['Норм тейк. На 4h согласен, на 15м шум.', 'Спасибо, жду ретест'],
  ['Кто-то ещё шортит это?', 'Лучше не надо без хеджа'],
  ['Похоже на развод ликвидности перед импульсом.', 'Да, стакан тонкий'],
  ['Переведите на русский плз', 'По факту: держим, стоп ниже свипа'],
];

const PROMO_LINKS = [
  {
    id: 'cyber',
    title: 'Сезон отчетности: торгуйте, прогнозируйте и выиграйте Cybertruck!',
    sub: 'Сезон отчетности: торгуйте, прогнозируйте и выиграйте Cybertruck!',
    until: '2026-08-31',
    url: 'https://www.bybit.com/en/promo/',
    tone: 'truck',
  },
  {
    id: 'galaxy',
    title: 'Bybit Galaxy',
    sub: 'Присоединяйтесь к Bybit Galaxy, исследуйте вселенную и получайте крупные награды',
    until: '2026-10-31',
    url: 'https://www.bybit.com/en/promo/bybit-galaxy',
    tone: 'galaxy',
  },
  {
    id: 'loyalty',
    title: 'Программа лояльности Bybit',
    sub: 'Регулярно используйте платформу Bybit, копите баллы и обменивайте их на ценные призы',
    until: '2026-10-03',
    url: 'https://www.bybit.com/en/help-center/article/Introduction-to-Bybit-Rewards-Hub',
    tone: 'loyalty',
  },
  {
    id: 'tradfi',
    title: 'Арена торговых инструментов TradFi',
    sub: 'Осваивайте рынки с торговыми инструментами TradFi.',
    until: '2026-09-12',
    url: 'https://www.bybit.com/en/trade/spot/tradfi',
    tone: 'arena',
  },
];

function monthLabel(d) {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function agoLabel(ts, now) {
  const m = Math.max(1, Math.round((now - ts) / 60000));
  if (m < 60) return `${m} мин. назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч. назад`;
  return `${Math.round(h / 24)} дн. назад`;
}

function buildFeed(now = Date.now()) {
  const slots = [];
  const intervals = [67, 83, 103, 73, 127, 91].map((m) => m * 60 * 1000);
  let t = now - 36 * 3600 * 1000;
  let i = 0;
  while (t < now - 12 * 60 * 1000) {
    const step = intervals[i % intervals.length];
    t += step;
    i += 1;
    if (t < now - 8 * 60 * 1000) slots.push(t);
  }
  const posts = slots.slice(-14).reverse().map((ts, idx) => {
    const rng = mulberry((Math.floor(ts / 60000) ^ 0xC0FFEE) >>> 0);
    const user = pick(rng, USERS);
    const text = pick(rng, POST_TEXTS);
    const likes = 8 + Math.floor(rng() * 220);
    const commentsN = Math.floor(rng() * 28);
    const reposts = Math.floor(rng() * 12);
    const shares = 1 + Math.floor(rng() * 10);
    const coin = (text.coins && text.coins[0]) || pick(rng, ['BTC', 'ETH', 'SOL', 'XAUT']);
    const chg = (rng() * 2.4 - 0.4);
    const thread = pick(rng, COMMENTS).map((c, ci) => ({
      id: `${idx}-c${ci}`,
      user: ci === 1 ? user : { id: 'anon', name: 'not***@****', avatar: 'none', verified: false },
      author: ci === 1,
      text: c,
      ago: agoLabel(ts + (ci + 1) * 3.6e6, now),
      likes: ci === 0 ? 1 : 0,
    }));
    return {
      id: `p${Math.floor(ts / 1000)}`,
      ts,
      date: monthLabel(new Date(ts)),
      user,
      title: text.title,
      body: text.body,
      tag: text.tag,
      kind: text.kind,
      coin,
      change: Number(chg.toFixed(2)),
      likes,
      comments: commentsN,
      reposts,
      shares,
      thread,
      chart: text.kind === 'chart' || text.kind === 'hype' || (idx % 3 === 0),
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
      id: 'f-tsla',
      type: 'market',
      status: 'live',
      timer: 'Прогнозы доступны',
      pair: 'TSLAUSDT',
      change: 0.46,
      people: '2.1M',
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
    ['PUMP', /\b(pump\.fun|pump)\b/i],
  ];
  return map.filter(([, re]) => re.test(t)).map(([s]) => s);
}

module.exports = { buildFeed, newsSymbols, clamp };
