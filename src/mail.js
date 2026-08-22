function smtpHost() {
  if (process.env.SMTP_HOST) return process.env.SMTP_HOST;
  const u = String(process.env.SMTP_USER || '');
  if (/@gmail\.com$/i.test(u)) return 'smtp.gmail.com';
  return '';
}

function smtpReady() {
  return Boolean(smtpHost() && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function fromHeader() {
  return process.env.SMTP_FROM || `Bybit <${process.env.SMTP_USER}>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapBybit(inner) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px 40px;background:#fff">
    <div style="text-align:center;padding:8px 0 22px">
      <div style="font-size:28px;font-weight:800;letter-spacing:0.14em;color:#000">BYBIT</div>
      <div style="margin-top:8px;font-size:12px;color:#8c8c8c">#TheCryptoArk and Gateway to Web3</div>
    </div>
    ${inner}
    <div style="margin-top:28px;padding:16px 18px;background:#f2f2f2;color:#111;font-size:12px;line-height:1.55">
      <p style="margin:0 0 10px;color:#c00;font-weight:700">Внимание: в последнее время участились попытки фишинга. Мошенники создают поддельные сайты, чтобы украсть пароли и коды подтверждения.</p>
      <p style="margin:0 0 8px">Перейдите на страницу безопасности аккаунта: <a href="https://www.bybit.com/app/user/security" style="color:#1a73e8">https://www.bybit.com/app/user/security</a></p>
      <p style="margin:0">1. Настройте двухфакторную аутентификацию (2FA) для входа, вывода средств и восстановления пароля.<br>
      2. Задайте антифишинговый код — он будет отображаться во всех официальных письмах Bybit.<br>
      3. Включите блокировку вывода на новые адреса на 24 часа.</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendMail({ to, subject, html, text }) {
  if (!smtpReady()) {
    const err = new Error('Почта не настроена на сервере (SMTP)');
    err.code = 'smtp_missing';
    throw err;
  }
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    const err = new Error('Почтовый модуль не установлен');
    err.code = 'smtp_missing';
    throw err;
  }

  const host = smtpHost();
  const userPort = Number(process.env.SMTP_PORT || 587);
  const attempts = [];
  const push = (port, secure, requireTLS) => {
    attempts.push({
      host,
      port,
      secure,
      requireTLS: Boolean(requireTLS),
      family: 4,
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { servername: host, minVersion: 'TLSv1.2' },
    });
  };
  // Railway часто блокирует 465 — сначала STARTTLS 587
  if (userPort === 465 || process.env.SMTP_SECURE === '1') {
    push(587, false, true);
    push(465, true, false);
  } else {
    push(userPort || 587, false, true);
    if (userPort !== 587) push(587, false, true);
    push(465, true, false);
  }

  let lastErr;
  for (const opts of attempts) {
    try {
      const transporter = nodemailer.createTransport(opts);
      await transporter.sendMail({ from: fromHeader(), to, subject, html, text });
      return;
    } catch (e) {
      lastErr = e;
      console.error('[mail]', opts.port, e.message || e);
    }
  }
  throw lastErr || new Error('не удалось отправить письмо');
}

function utcStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} (UTC)`;
}

const COUNTRY_NAMES = {
  RU: 'Russia', UA: 'Ukraine', BY: 'Belarus', KZ: 'Kazakhstan', UZ: 'Uzbekistan',
  US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
  NL: 'Netherlands', PL: 'Poland', TR: 'Turkey', AE: 'United Arab Emirates',
  CN: 'China', HK: 'Hong Kong', SG: 'Singapore', JP: 'Japan', KR: 'South Korea',
  IN: 'India', BR: 'Brazil', IT: 'Italy', ES: 'Spain', FI: 'Finland', EE: 'Estonia',
  LV: 'Latvia', LT: 'Lithuania', CZ: 'Czechia', AT: 'Austria', CH: 'Switzerland',
};

function loginMetaFromReq(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  const ip = (xf.split(',')[0] || '').trim()
    || req.ip
    || req.socket?.remoteAddress
    || '—';
  const ua = String(req.headers['user-agent'] || '—');
  const code = String(
    req.headers['cf-ipcountry']
    || req.headers['x-vercel-ip-country']
    || req.headers['x-country-code']
    || '',
  ).toUpperCase();
  const country = COUNTRY_NAMES[code] || code || '—';
  return { ip, ua, country, time: utcStamp() };
}

async function sendLoginNotice(to, meta) {
  const ua = escapeHtml(meta.ua || '—');
  const ip = escapeHtml(meta.ip || '—');
  const country = escapeHtml(meta.country || '—');
  const time = escapeHtml(meta.time || utcStamp());
  const html = wrapBybit(`
    <p style="margin:0 0 14px;font-size:15px">Уважаемый трейдер Bybit,</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55">Вы вошли в свою учетную запись на Bybit со следующего устройства:</p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.7"><b>Сервер:</b> ${ua}</p>
    <p style="margin:0 0 6px;font-size:14px"><b>IP-адрес:</b> ${ip}</p>
    <p style="margin:0 0 6px;font-size:14px"><b>Страна/регион:</b> ${country}</p>
    <p style="margin:0 0 18px;font-size:14px"><b>Время:</b> ${time}</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.55">Если вы заподозрили несанкционированный вход в аккаунт, немедленно свяжитесь с нашей Службой поддержки в чате или через
      <a href="https://www.bybit.com/en/help-center/" style="color:#1a73e8">эту форму</a>
      или можно нажать здесь, чтобы <a href="https://www.bybit.com/app/user/security" style="color:#1a73e8">Заблокировать этот аккаунт</a>.</p>
    <p style="margin:0;font-size:15px">С уважением,<br>Команда Bybit</p>
  `);
  await sendMail({
    to,
    subject: '[Bybit] Уведомление о входе в систему',
    html,
    text: `Уважаемый трейдер Bybit,\nВы вошли в свою учетную запись на Bybit со следующего устройства:\nСервер: ${meta.ua}\nIP-адрес: ${meta.ip}\nСтрана/регион: ${meta.country}\nВремя: ${meta.time}`,
  });
}

function notifyLogin(to, req) {
  if (!to || !smtpReady()) return;
  sendLoginNotice(to, loginMetaFromReq(req)).catch((e) => console.error('[mail-login]', e.message || e));
}

async function sendResetCode(to, code) {
  const html = wrapBybit(`
    <p style="margin:0 0 12px;font-size:15px">Уважаемый клиент,</p>
    <p style="margin:0 0 12px;font-size:15px">Сброс пароля.</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Ваш код для аутентификации по электронной почте -
      <b style="color:#f7a600;font-size:18px">${escapeHtml(code)}</b>
      (действителен в течение 5 минут).</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55">В целях безопасности, пожалуйста, не сообщайте данный код никому, в том числе, сотрудникам Bybit.</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Для получения дополнительной помощи свяжитесь с нами через чат или напишите нам по адресу
      <a href="mailto:support-ru@bybit.com" style="color:#1a73e8">support-ru@bybit.com</a>.</p>
    <p style="margin:0;font-size:15px">С уважением,<br>Команда Bybit</p>
  `);
  await sendMail({
    to,
    subject: '[Bybit]аутентификация по электронной почте',
    html,
    text: `Уважаемый клиент,\nСброс пароля.\nВаш код для аутентификации по электронной почте - ${code} (действителен в течение 5 минут).`,
  });
}

async function sendEmailVerify(to, code) {
  const html = wrapBybit(`
    <p style="margin:0 0 12px;font-size:15px">Уважаемый клиент,</p>
    <p style="margin:0 0 12px;font-size:15px">Подтверждение электронной почты.</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Ваш код подтверждения —
      <b style="color:#f7a600;font-size:18px">${escapeHtml(code)}</b>
      (действителен в течение 5 минут).</p>
    <p style="margin:0 0 16px;font-size:14px">В целях безопасности не сообщайте код никому.</p>
    <p style="margin:0;font-size:15px">С уважением,<br>Команда Bybit</p>
  `);
  await sendMail({
    to,
    subject: '[Bybit]подтверждение электронной почты',
    html,
    text: `Код подтверждения почты Bybit: ${code}. Действует 5 минут.`,
  });
}

async function sendTempPassword(to, password) {
  const html = wrapBybit(`
    <p style="margin:0 0 12px;font-size:15px">Уважаемый клиент,</p>
    <p style="margin:0 0 16px;font-size:15px">Временный пароль для входа:
      <b style="color:#f7a600;font-size:18px">${escapeHtml(password)}</b></p>
    <p style="margin:0;font-size:15px">С уважением,<br>Команда Bybit</p>
  `);
  await sendMail({
    to,
    subject: '[Bybit] Временный пароль',
    html,
    text: `Временный пароль Bybit: ${password}`,
  });
}

module.exports = {
  smtpReady, sendMail, sendResetCode, sendEmailVerify, sendTempPassword, sendLoginNotice, notifyLogin, loginMetaFromReq,
};
