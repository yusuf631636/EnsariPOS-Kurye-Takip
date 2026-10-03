/* Kendi Cloudflare tunelimizin (NSSM servisi olarak calisan cloudflared, port 4021)
   log dosyasini periyodik izler; yeni/degisen bir link gorunce notifyTunnelLink'i cagirir.
   C:\WP'nin kendi tuneline (port 3055) HIC dokunulmaz - bu tamamen ayri, kendi tunelimiz. */
const fs = require('fs');
const path = require('path');

const RUNTIME_DIR = path.join(process.env.PROGRAMDATA || process.env.TEMP || __dirname, 'EnsariPOS', 'KuryeTakip');
fs.mkdirSync(path.join(RUNTIME_DIR, 'logs'), { recursive: true });
const TUNNEL_LOG = path.join(RUNTIME_DIR, 'logs', 'tunnel.log');
const LINK_FILE = path.join(RUNTIME_DIR, 'tunnel-link.txt');

let lastUrl = null;

function currentLink() { return fs.existsSync(LINK_FILE) ? fs.readFileSync(LINK_FILE, 'utf8').trim() : ''; }

function start(onNewLink) {
  lastUrl = currentLink() || null;
  setInterval(() => {
    if (!fs.existsSync(TUNNEL_LOG)) return;
    const text = fs.readFileSync(TUNNEL_LOG, 'utf8');
    const matches = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    if (!matches || !matches.length) return;
    const url = matches[matches.length - 1];
    if (url === lastUrl) return;
    lastUrl = url;
    fs.writeFileSync(LINK_FILE, url, 'utf8');
    Promise.resolve(onNewLink(url)).catch(err => console.error('Tünel bildirimi hatası:', err.message));
  }, 10000);
}

module.exports = { start, currentLink, RUNTIME_DIR, TUNNEL_LOG, LINK_FILE };
