/* C:\WP\index.js'teki mevcut WhatsApp API'sini cagirir (port 3055, POST /send).
   O sistemin kendisine HIC dokunulmaz, sadece dısarıdan API cagrisi yapilir. */
const http = require('http');
const { config } = require('./sql');

const WHATSAPP_BASE = config.whatsappApiUrl || 'http://localhost:3055';

function sendWhatsapp(number, message) {
  return new Promise((resolve) => {
    try {
      const url = new URL('/send', WHATSAPP_BASE);
      const body = JSON.stringify({ number, message });
      const req = http.request({
        hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 8000
      }, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: data })); });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(body); req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

module.exports = { sendWhatsapp };
