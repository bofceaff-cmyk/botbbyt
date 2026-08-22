(function (root) {
  function flag(iso) {
    return String(iso || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2)
      .split('')
      .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
      .join('');
  }

  const COUNTRIES = [
    { iso: 'RU', name: 'Россия', dial: '7', nsn: [10, 10] },
    { iso: 'KZ', name: 'Казахстан', dial: '7', nsn: [10, 10] },
    { iso: 'BY', name: 'Беларусь', dial: '375', nsn: [9, 9] },
    { iso: 'UA', name: 'Украина', dial: '380', nsn: [9, 9] },
    { iso: 'UZ', name: 'Узбекистан', dial: '998', nsn: [9, 9] },
    { iso: 'KG', name: 'Кыргызстан', dial: '996', nsn: [9, 9] },
    { iso: 'TJ', name: 'Таджикистан', dial: '992', nsn: [9, 9] },
    { iso: 'TM', name: 'Туркменистан', dial: '993', nsn: [8, 8] },
    { iso: 'AM', name: 'Армения', dial: '374', nsn: [8, 8] },
    { iso: 'AZ', name: 'Азербайджан', dial: '994', nsn: [9, 9] },
    { iso: 'GE', name: 'Грузия', dial: '995', nsn: [9, 9] },
    { iso: 'MD', name: 'Молдова', dial: '373', nsn: [8, 8] },
    { iso: 'TR', name: 'Турция', dial: '90', nsn: [10, 10] },
    { iso: 'DE', name: 'Германия', dial: '49', nsn: [10, 11] },
    { iso: 'PL', name: 'Польша', dial: '48', nsn: [9, 9] },
    { iso: 'CZ', name: 'Чехия', dial: '420', nsn: [9, 9] },
    { iso: 'SK', name: 'Словакия', dial: '421', nsn: [9, 9] },
    { iso: 'HU', name: 'Венгрия', dial: '36', nsn: [8, 9] },
    { iso: 'RO', name: 'Румыния', dial: '40', nsn: [9, 9] },
    { iso: 'BG', name: 'Болгария', dial: '359', nsn: [8, 9] },
    { iso: 'RS', name: 'Сербия', dial: '381', nsn: [8, 9] },
    { iso: 'GR', name: 'Греция', dial: '30', nsn: [10, 10] },
    { iso: 'IT', name: 'Италия', dial: '39', nsn: [9, 10] },
    { iso: 'ES', name: 'Испания', dial: '34', nsn: [9, 9] },
    { iso: 'PT', name: 'Португалия', dial: '351', nsn: [9, 9] },
    { iso: 'FR', name: 'Франция', dial: '33', nsn: [9, 9] },
    { iso: 'GB', name: 'Великобритания', dial: '44', nsn: [10, 10] },
    { iso: 'IE', name: 'Ирландия', dial: '353', nsn: [9, 9] },
    { iso: 'NL', name: 'Нидерланды', dial: '31', nsn: [9, 9] },
    { iso: 'BE', name: 'Бельгия', dial: '32', nsn: [8, 9] },
    { iso: 'AT', name: 'Австрия', dial: '43', nsn: [10, 11] },
    { iso: 'CH', name: 'Швейцария', dial: '41', nsn: [9, 9] },
    { iso: 'SE', name: 'Швеция', dial: '46', nsn: [7, 9] },
    { iso: 'NO', name: 'Норвегия', dial: '47', nsn: [8, 8] },
    { iso: 'DK', name: 'Дания', dial: '45', nsn: [8, 8] },
    { iso: 'FI', name: 'Финляндия', dial: '358', nsn: [9, 10] },
    { iso: 'EE', name: 'Эстония', dial: '372', nsn: [7, 8] },
    { iso: 'LV', name: 'Латвия', dial: '371', nsn: [8, 8] },
    { iso: 'LT', name: 'Литва', dial: '370', nsn: [8, 8] },
    { iso: 'US', name: 'США', dial: '1', nsn: [10, 10] },
    { iso: 'CA', name: 'Канада', dial: '1', nsn: [10, 10] },
    { iso: 'MX', name: 'Мексика', dial: '52', nsn: [10, 10] },
    { iso: 'BR', name: 'Бразилия', dial: '55', nsn: [10, 11] },
    { iso: 'AE', name: 'ОАЭ', dial: '971', nsn: [9, 9] },
    { iso: 'SA', name: 'Саудовская Аравия', dial: '966', nsn: [9, 9] },
    { iso: 'IL', name: 'Израиль', dial: '972', nsn: [8, 9] },
    { iso: 'EG', name: 'Египет', dial: '20', nsn: [10, 10] },
    { iso: 'IN', name: 'Индия', dial: '91', nsn: [10, 10] },
    { iso: 'CN', name: 'Китай', dial: '86', nsn: [11, 11] },
    { iso: 'HK', name: 'Гонконг', dial: '852', nsn: [8, 8] },
    { iso: 'JP', name: 'Япония', dial: '81', nsn: [10, 10] },
    { iso: 'KR', name: 'Южная Корея', dial: '82', nsn: [9, 10] },
    { iso: 'SG', name: 'Сингапур', dial: '65', nsn: [8, 8] },
    { iso: 'TH', name: 'Таиланд', dial: '66', nsn: [9, 9] },
    { iso: 'VN', name: 'Вьетнам', dial: '84', nsn: [9, 9] },
    { iso: 'ID', name: 'Индонезия', dial: '62', nsn: [9, 12] },
    { iso: 'AU', name: 'Австралия', dial: '61', nsn: [9, 9] },
    { iso: 'NZ', name: 'Новая Зеландия', dial: '64', nsn: [8, 10] },
    { iso: 'ZA', name: 'ЮАР', dial: '27', nsn: [9, 9] },
    { iso: 'NG', name: 'Нигерия', dial: '234', nsn: [8, 10] },
    { iso: 'CY', name: 'Кипр', dial: '357', nsn: [8, 8] },
  ];

  function byIso(iso) {
    const id = String(iso || '').toUpperCase();
    return COUNTRIES.find((c) => c.iso === id) || null;
  }

  function byName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    return COUNTRIES.find((c) => c.name.toLowerCase() === n || c.iso.toLowerCase() === n) || null;
  }

  function digitsOnly(s) {
    return String(s || '').replace(/\D/g, '');
  }

  function toE164(iso, national) {
    const c = byIso(iso);
    if (!c) return '';
    const n = digitsOnly(national);
    if (!n) return '';
    return `+${c.dial}${n}`;
  }

  function validateNational(iso, national) {
    const c = byIso(iso);
    if (!c) return { ok: false, error: 'выберите страну' };
    const n = digitsOnly(national);
    if (n.length < c.nsn[0] || n.length > c.nsn[1]) {
      const need = c.nsn[0] === c.nsn[1] ? `${c.nsn[0]}` : `${c.nsn[0]}–${c.nsn[1]}`;
      return { ok: false, error: `номер ${c.name}: ${need} цифр после +${c.dial}` };
    }
    return { ok: true, e164: `+${c.dial}${n}`, country: c };
  }

  function parseE164(raw) {
    let d = digitsOnly(raw);
    if (!d) return null;
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      if (d.startsWith(c.dial)) {
        const n = d.slice(c.dial.length);
        if (n.length >= c.nsn[0] && n.length <= c.nsn[1]) {
          return { country: c, national: n, e164: `+${c.dial}${n}` };
        }
      }
    }
    return null;
  }

  function label(c) {
    if (!c) return '';
    return `${flag(c.iso)}  ${c.name}`;
  }

  const api = {
    COUNTRIES,
    flag,
    byIso,
    byName,
    digitsOnly,
    toE164,
    validateNational,
    parseE164,
    label,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEO = api;
})(typeof window !== 'undefined' ? window : globalThis);
