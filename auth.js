/* C:\ensari\server.js'deki oturum/kilitleme deseninin kurye+admin icin uyarlanmasi.
   Kurye girisi SambaPOS'ta zaten var olan PIN'i kullanir; ayri bir sifre icat edilmiyor. */
const crypto = require('crypto');
const sambapos = require('./sambapos');
const { saveSession, touchSession, loadSession, deleteSession } = require('./db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOCK_THRESHOLD = 5, LOCK_MS = 5 * 60 * 1000;
/* Admin ve kurye AYRI cerezler kullanir - ayni tarayicida once kurye PIN'i ile
   test edip sonra yonetici sekmesine donulunce yonetici oturumunun sessizce
   kurye oturumuna donusup "Yetkiniz yok" hatasi vermesini onler (tek cerezle
   yasanan gercek bir hataydi, ikisi ayni anda gecerli olabilir artik). */
const COOKIE_NAMES = { admin: 'kurye_admin_session', courier: 'kurye_courier_session' };

const attempts = new Map(); // ip -> {count, lockUntil}

function parseCookies(req) {
  const header = req.headers.cookie, out = {};
  if (!header) return out;
  header.split(';').forEach(part => { const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted; }
function setSessionCookie(req, res, token, role) {
  const parts = [`${COOKIE_NAMES[role]}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req, res) {
  const isHttp = isHttps(req);
  const cookies = Object.values(COOKIE_NAMES).map(name => {
    const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isHttp) parts.push('Secure');
    return parts.join('; ');
  });
  res.setHeader('Set-Cookie', cookies);
}
function newSession(data) {
  const token = crypto.randomBytes(24).toString('hex');
  saveSession(token, { ...data, expires: Date.now() + SESSION_TTL_MS });
  return token;
}
function currentSession(req) {
  const cookies = parseCookies(req);
  for (const role of ['admin', 'courier']) {
    const token = cookies[COOKIE_NAMES[role]];
    if (!token) continue;
    const record = loadSession(token);
    if (!record) continue;
    if (record.expires < Date.now()) { deleteSession(token); continue; }
    const expires = Date.now() + SESSION_TTL_MS;
    touchSession(token, expires);
    return { ...record, expires };
  }
  return null;
}
function destroySession(req) {
  const cookies = parseCookies(req);
  for (const role of ['admin', 'courier']) {
    const token = cookies[COOKIE_NAMES[role]];
    if (token) deleteSession(token);
  }
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function lockedForMs(ip) { const state = attempts.get(ip); return state && state.lockUntil > Date.now() ? state.lockUntil - Date.now() : 0; }
function registerFail(ip) {
  const state = attempts.get(ip) || { count: 0, lockUntil: 0 };
  state.count += 1;
  if (state.count >= LOCK_THRESHOLD) { state.lockUntil = Date.now() + LOCK_MS; state.count = 0; }
  attempts.set(ip, state);
}
function registerSuccess(ip) { attempts.delete(ip); }
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(new Error('İstek çok büyük.')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
/* Giris, SambaPOS'un kendi Personel (Users) PIN'leriyle yapilir - ayri bir sifre
   sistemi icat edilmiyor. Kurye: UserRole "Paketciler" PIN'i. Admin: "Administrator" PIN'i. */
async function courierLogin(pin) { return sambapos.courierByPin(pin); } // {id, name} | null
async function adminLogin(pin) { return sambapos.adminValidByPin(pin); } // boolean

module.exports = {
  setSessionCookie, clearSessionCookie, newSession, currentSession, destroySession,
  clientIp, lockedForMs, registerFail, registerSuccess, readJsonBody,
  courierLogin, adminLogin
};
