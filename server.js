const http = require('http');
const fs = require('fs');
const path = require('path');
const { config } = require('./sql');
const sambapos = require('./sambapos');
const auth = require('./auth');
const { logEvent, recentEvents, deliverySummary, setCourierPhone, setCourierLocation, allCourierLocations, wasLinkSent, markLinkSent } = require('./db');
const poll = require('./poll');
const wsServer = require('./ws');
const { sendWhatsapp } = require('./whatsapp');
const tunnelWatch = require('./tunnel-watch');

const PORT = Number(process.env.PORT || config.port || 4021);
const ROOT = __dirname;
const APP_NAME = config.appName || 'Ensari Kurye Takip';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png' };

function serveStatic(req, res, pathname) {
  const map = { '/courier': '/courier/index.html', '/admin': '/admin/index.html', '/': '/courier/index.html' };
  const rel = map[pathname] || pathname;
  const file = path.join(ROOT, 'public', rel);
  if (!file.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Bulunamadı' });
  /* Cloudflare, origin bir Cache-Control gondermezse .js/.css dosyalarini
     kendi varsayilan sureleriyle (4 saate kadar) onbellege aliyor - guncelleme
     yaptigimizda kullanicilar eski dosyayi gormeye devam ediyordu. Bunu onlemek
     icin acikca "onbelleklemeyin" diyoruz. */
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

/* "day" (YYYY-MM-DD) sunucunun YEREL takvim gunu olarak yorumlanir (Turkiye
   saatiyle "bugun"), ama delivery_events.at SQLite'in datetime('now')'iyla
   HER ZAMAN UTC olarak yazilir. Onceki hali gun sonunu "toISOString().slice(0,10)"
   ile geri tarihe donusturup start ile ayni degere collapse ediyordu (bos aralik,
   raporlar her zaman 0 donuyordu) - getTime() bazli hesap buna dusmez. */
function dayRangeUtc(day) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ');
  return { start: fmt(start), end: fmt(end) };
}

/* Kurye kendi siparislerinin disinda bir sipariste islem yapamaz. */
function ownsOrder(session, order) { return session.role === 'admin' || (session.role === 'courier' && order.courierName === session.courierName); }

/* Yeni/degisen tunel linkini, henuz bu linki almamis her aktif kurye + yoneticiye
   WhatsApp ile gonderir (link_notifications tablosuyla ayni linki tekrar tekrar
   gondermeyi onler - sunucu her yeniden basladiginda spam olmaz). */
async function notifyTunnelLink(url) {
  const list = await sambapos.couriers();
  const sent = [];
  for (const courier of list) {
    if (!courier.phone || wasLinkSent(url, courier.name)) continue;
    const message = `Merhaba ${courier.name},\n\nKurye takip sisteminiz aktif edilmiştir.\n\nKurye paneline giriş: ${url}/courier\nPIN kodunuzla giriş yapabilirsiniz.\n\nBu link üzerinden size atanan siparişleri görebilir, müşteriyi arayabilir, yol tarifi alabilir ve teslimatı onaylayabilirsiniz.`;
    const result = await sendWhatsapp(courier.phone, message);
    if (result.ok) { markLinkSent(url, courier.name); sent.push(courier.name); }
  }
  if (config.managerPhone && !wasLinkSent(url, 'yonetici')) {
    const message = `Ensari Kurye Takip sistemi aktif.\n\nYönetim paneli: ${url}/admin\n\nBu linkten kuryeleri, canlı konumlarını ve teslimat raporlarını görebilirsiniz.`;
    const result = await sendWhatsapp(config.managerPhone, message);
    if (result.ok) { markLinkSent(url, 'yonetici'); sent.push('yönetici'); }
  }
  return sent;
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const ip = auth.clientIp(req);

    if (u.pathname === '/api/courier/login' && req.method === 'POST') {
      const wait = auth.lockedForMs(ip);
      if (wait > 0) return json(res, 429, { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` });
      const body = await auth.readJsonBody(req);
      const courier = await auth.courierLogin(String(body.pin || ''));
      if (!courier) { auth.registerFail(ip); return json(res, 401, { error: 'PIN hatalı.' }); }
      auth.registerSuccess(ip);
      const token = auth.newSession({ role: 'courier', courierId: courier.id, courierName: courier.name });
      auth.setSessionCookie(req, res, token, 'courier');
      return json(res, 200, { ok: true, courierName: courier.name });
    }
    if (u.pathname === '/api/admin/login' && req.method === 'POST') {
      const wait = auth.lockedForMs(ip);
      if (wait > 0) return json(res, 429, { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` });
      const body = await auth.readJsonBody(req);
      if (!(await auth.adminLogin(String(body.password || '')))) { auth.registerFail(ip); return json(res, 401, { error: 'PIN hatalı.' }); }
      auth.registerSuccess(ip);
      const token = auth.newSession({ role: 'admin' });
      auth.setSessionCookie(req, res, token, 'admin');
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/logout' && req.method === 'POST') {
      auth.destroySession(req);
      auth.clearSessionCookie(req, res);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/config') return json(res, 200, { appName: APP_NAME });

    /* Tunel linki degistiginde (bkz. tunnel-watch.js) veya elle test icin bu uctan tetiklenebilir.
       Sadece bu bilgisayardan (localhost) kabul edilir - dis dunyaya acik bir uc degil. */
    if (u.pathname === '/api/internal/tunnel-link' && req.method === 'POST') {
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return json(res, 403, { error: 'Yalnızca yerelden.' });
      const body = await auth.readJsonBody(req);
      const url = String(body.url || '').trim();
      if (!/^https:\/\//.test(url)) return json(res, 400, { error: 'Geçersiz link.' });
      return json(res, 200, { ok: true, sentTo: await notifyTunnelLink(url) });
    }

    /* C:\ensari\server.js'in bulut gonderimi (cloudPush) icin - sadece bu
       bilgisayardan kabul edilir, oturum gerektirmez (ayni PC'deki kardes
       surecin kendi ic cagrisi, /api/internal/tunnel-link ile ayni desen). */
    if (u.pathname === '/api/internal/summary' && req.method === 'GET') {
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return json(res, 403, { error: 'Yalnızca yerelden.' });
      const { start, end } = dayRangeUtc(new Date().toISOString().slice(0, 10));
      return json(res, 200, { orders: poll.getLatestOrders(), deliverySummary: deliverySummary(start, end) });
    }

    if (u.pathname.startsWith('/api/')) {
      const session = auth.currentSession(req);
      if (!session) return json(res, 401, { error: 'Oturum gerekli.' });

      /* Sayfa yenilendiginde/yeniden acildiginda giris ekranina dusmemesi icin:
         istemci once bunu cagirip gecerli bir oturum (cerez+DB) var mi bakar,
         varsa dogrudan ana ekrana gecer - PIN'i tekrar sormaya gerek kalmaz. */
      if (u.pathname === '/api/session' && req.method === 'GET') {
        return json(res, 200, { role: session.role, courierName: session.courierName || null });
      }
      if (u.pathname === '/api/courier/orders' && req.method === 'GET') {
        const all = poll.getLatestOrders();
        const scoped = session.role === 'admin' ? all : all.filter(o => o.courierName === session.courierName);
        return json(res, 200, { orders: scoped, appName: APP_NAME });
      }
      /* Kuryenin kendi ekraninda gorecegi "bugun kac paket goturdum, ne kadar
         tahsil ettim" ozeti - sadece kendi adina, admin degilse. */
      if (u.pathname === '/api/courier/my-summary' && req.method === 'GET') {
        if (session.role !== 'courier') return json(res, 403, { error: 'Yetkiniz yok.' });
        const { start, end } = dayRangeUtc(new Date().toISOString().slice(0, 10));
        const row = deliverySummary(start, end).find(r => r.courier_name === session.courierName);
        return json(res, 200, { count: row ? row.count : 0, total: row ? row.total : 0 });
      }
      const contentMatch = u.pathname.match(/^\/api\/courier\/orders\/(\d+)\/content$/);
      if (contentMatch && req.method === 'GET') {
        const order = poll.getLatestOrders().find(o => String(o.id) === contentMatch[1]);
        if (!order || !ownsOrder(session, order)) return json(res, 403, { error: 'Bu siparişe erişiminiz yok.' });
        return json(res, 200, { items: await sambapos.orderContent(contentMatch[1]) });
      }
      const deliveredMatch = u.pathname.match(/^\/api\/courier\/orders\/(\d+)\/delivered$/);
      if (deliveredMatch && req.method === 'POST') {
        const order = poll.getLatestOrders().find(o => String(o.id) === deliveredMatch[1]);
        if (!order || !ownsOrder(session, order)) return json(res, 403, { error: 'Bu siparişe erişiminiz yok.' });
        const result = await sambapos.markDelivered(deliveredMatch[1]);
        const detail = result.paymentInserted
          ? `Sipariş ${order.number} teslim edildi, ${result.amountCollected}₺ nakit tahsil edildi, adisyon kapandı`
          : `Sipariş ${order.number} teslim edildi, adisyon kapandı (bakiye zaten kapalıydı)`;
        logEvent(order.id, order.courierName, 'teslim-edildi', detail, result.amountCollected);
        wsServer.broadcastEvent({ kind: 'teslim-edildi', ticketId: order.id, number: order.number, courierName: order.courierName, amountCollected: result.amountCollected });
        return json(res, 200, { ok: true, amountCollected: result.amountCollected, paymentInserted: result.paymentInserted });
      }
      if (u.pathname === '/api/admin/couriers' && req.method === 'GET') {
        if (session.role !== 'admin') return json(res, 403, { error: 'Yetkiniz yok.' });
        const locations = Object.fromEntries(allCourierLocations().map(l => [l.courier_name, l.updated_at]));
        const couriers = (await sambapos.couriers()).map(c => ({ ...c, locationUpdatedAt: locations[c.name] || null }));
        return json(res, 200, { couriers });
      }
      if (u.pathname === '/api/admin/events' && req.method === 'GET') {
        if (session.role !== 'admin') return json(res, 403, { error: 'Yetkiniz yok.' });
        return json(res, 200, { events: recentEvents(150) });
      }
      const phoneMatch = u.pathname.match(/^\/api\/admin\/couriers\/([^/]+)\/phone$/);
      if (phoneMatch && req.method === 'POST') {
        if (session.role !== 'admin') return json(res, 403, { error: 'Yetkiniz yok.' });
        const body = await auth.readJsonBody(req);
        setCourierPhone(decodeURIComponent(phoneMatch[1]), String(body.phone || '').trim());
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/admin/report' && req.method === 'GET') {
        if (session.role !== 'admin') return json(res, 403, { error: 'Yetkiniz yok.' });
        const day = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('date') || '') ? u.searchParams.get('date') : new Date().toISOString().slice(0, 10);
        const { start, end } = dayRangeUtc(day);
        const delivered = deliverySummary(start, end);
        /* "Aktif" siparisler tarih araligiyla degil, su anki gercek durumla
           ilgilidir - hangi tarih secilirse secilsin canli listeden alinir. */
        const activeByCourier = {};
        for (const o of poll.getLatestOrders()) {
          const bucket = activeByCourier[o.courierName] || (activeByCourier[o.courierName] = { pending: 0, enroute: 0 });
          if (o.packageStatus === 'Yolda') bucket.enroute++; else bucket.pending++;
        }
        const names = new Set([...delivered.map(d => d.courier_name), ...Object.keys(activeByCourier)]);
        const byCourier = [...names].sort().map(name => {
          const d = delivered.find(row => row.courier_name === name);
          const a = activeByCourier[name] || { pending: 0, enroute: 0 };
          return { courierName: name, pending: a.pending, enroute: a.enroute, deliveredCount: d ? d.count : 0, deliveredTotal: d ? d.total : 0 };
        });
        return json(res, 200, { date: day, summary: delivered, byCourier });
      }
      if (u.pathname === '/api/courier/location' && req.method === 'POST') {
        if (session.role !== 'courier') return json(res, 403, { error: 'Yetkiniz yok.' });
        const body = await auth.readJsonBody(req);
        const lat = Number(body.lat), lng = Number(body.lng), accuracy = Number(body.accuracy) || null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json(res, 400, { error: 'Geçersiz konum.' });
        setCourierLocation(session.courierName, lat, lng, accuracy);
        wsServer.broadcastEvent({ kind: 'konum', courierName: session.courierName, lat, lng, accuracy });
        return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/admin/locations' && req.method === 'GET') {
        if (session.role !== 'admin') return json(res, 403, { error: 'Yetkiniz yok.' });
        return json(res, 200, { locations: allCourierLocations() });
      }
      if (u.pathname === '/api/admin/tunnel' && req.method === 'GET') {
        if (session.role !== 'admin') return json(res, 403, { error: 'Yetkiniz yok.' });
        /* config.json'da kalici bir domain (publicUrl) tanimliysa (bu restoranda
           oldugu gibi) o gosterilir; tanimli degilse (baska restoranlarda) her
           acilista degisebilen gecici tunnel linkine dusulur. */
        return json(res, 200, { url: config.publicUrl || tunnelWatch.currentLink() });
      }
      return json(res, 404, { error: 'Bulunamadı' });
    }

    serveStatic(req, res, u.pathname);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
}).listen(PORT, function () {
  wsServer.attach(this);
  poll.start();
  tunnelWatch.start(notifyTunnelLink);
  console.log(`${APP_NAME}: http://127.0.0.1:${PORT}`);
});
