function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function fromHeader() {
  return process.env.SMTP_FROM || `Bybit <${process.env.SMTP_USER}>`;
}

function wrapHtml({ title, body }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#0b0e11;font-family:Arial,Helvetica,sans-serif;color:#eaecef">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="font-size:22px;font-weight:800;letter-spacing:0.08em;color:#fff">BY<span style="color:#f7a600">BIT</span></div>
    <h1 style="font-size:20px;margin:24px 0 12px;color:#fff">${title}</h1>
    ${body}
    <p style="margin-top:28px;font-size:12px;color:#6b7685">Это автоматическое письмо Bybit Wallet. Если вы не запрашивали его, просто проигнорируйте.</p>
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
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: fromHeader(),
    to,
    subject,
    html,
    text,
  });
}

async function sendResetCode(to, code) {
  const html = wrapHtml({
    title: 'Код для сброса пароля',
    body: `<p style="color:#9aa4b2;line-height:1.5">Используйте этот код в приложении Bybit, чтобы задать новый пароль. Код действует 15 минут.</p>
      <div style="margin:20px 0;padding:14px 18px;background:#151a21;border:1px solid #242c38;border-radius:10px;font-size:28px;letter-spacing:0.28em;font-weight:700;color:#f7a600;text-align:center">${code}</div>`,
  });
  await sendMail({
    to,
    subject: 'Bybit | Код сброса пароля',
    html,
    text: `Ваш код сброса пароля Bybit: ${code}. Действует 15 минут.`,
  });
}

async function sendTempPassword(to, password) {
  const html = wrapHtml({
    title: 'Временный пароль',
    body: `<p style="color:#9aa4b2;line-height:1.5">Мы создали временный пароль для входа. После входа рекомендуем сменить его.</p>
      <div style="margin:20px 0;padding:14px 18px;background:#151a21;border:1px solid #242c38;border-radius:10px;font-size:20px;letter-spacing:0.04em;font-weight:700;color:#f7a600;text-align:center">${password}</div>`,
  });
  await sendMail({
    to,
    subject: 'Bybit | Временный пароль',
    html,
    text: `Временный пароль Bybit: ${password}`,
  });
}

module.exports = { smtpReady, sendMail, sendResetCode, sendTempPassword };
