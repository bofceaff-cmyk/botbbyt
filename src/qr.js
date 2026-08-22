function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

async function qrSvg(text) {
  try {
    const QR = require('qrcode');
    return await QR.toString(text, {
      type: 'svg',
      margin: 1,
      width: 180,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    });
  } catch {
    const encoded = encodeURIComponent(text);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" fill="#fff"/>
      <text x="90" y="90" text-anchor="middle" font-size="10" fill="#111">${escapeXml('QR unavailable')}</text>
      <desc>${escapeXml(encoded)}</desc>
    </svg>`;
  }
}

module.exports = { qrSvg };
