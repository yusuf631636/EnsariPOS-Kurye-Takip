const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(value) || 0);

function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeToggle').textContent = theme === 'light' ? '☀️' : '🌙';
  try { localStorage.setItem('kurye-theme', theme); } catch { /* gizli gezinti modu olabilir */ }
}
try { setTheme(localStorage.getItem('kurye-theme') || 'dark'); } catch { setTheme('dark'); }
$('themeToggle').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

async function api(path, options) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options && options.headers) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Sunucu hatası.');
  return data;
}
function ago(iso) {
  if (!iso) return '';
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 1000));
  if (diff < 60) return `${diff} sn önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  return `${Math.floor(diff / 3600)} sa önce`;
}

function locationStatus(updatedAt) {
  if (!updatedAt) return '<span class="loc-off">📍 Konum paylaşmıyor</span>';
  const diff = Math.max(0, Math.round((Date.now() - new Date(String(updatedAt).replace(' ', 'T') + 'Z')) / 1000));
  const fresh = diff < 120;
  return `<span class="${fresh ? 'loc-on' : 'loc-stale'}">📍 Konum: ${ago(updatedAt) || 'az önce'}</span>`;
}
function renderCouriers(couriers) {
  $('couriers').innerHTML = couriers.map(c => `
    <div class="courier">
      <b>${esc(c.name)}</b>
      <span class="pin">🔑 Giriş şifresi (PIN): ${esc(c.pin)}</span>
      ${locationStatus(c.locationUpdatedAt)}
      <input type="tel" placeholder="Telefon (05XX XXX XX XX)" value="${esc(c.phone)}" data-phone-input="${esc(c.name)}">
      <div class="save-row">
        <button class="save" data-save-phone="${esc(c.name)}">Kaydet</button>
        <span class="saved" data-saved="${esc(c.name)}" hidden>✓ Kaydedildi</span>
      </div>
    </div>`).join('') || '<p class="empty">Kurye bulunamadı.</p>';
}
function renderOrders(orders) {
  $('orderCount').textContent = `(${orders.length})`;
  $('orders').innerHTML = orders.length ? orders.map(o => `
    <div class="row">
      <span>${esc(o.customerName)} · ${esc(o.courierName)}</span>
      <span>${money(o.total)}</span>
      <span class="t2">Fiş ${esc(o.number)} · ${esc(o.packageStatus)}</span>
    </div>`).join('') : '<p class="empty">Aktif sipariş yok.</p>';
}
function renderEvents(events) {
  $('events').innerHTML = events.length ? events.map(e => `
    <div class="row">
      <span>${esc(e.detail || e.event)}</span>
      <span>${e.amount ? money(e.amount) : ''}</span>
      <span class="t2">${esc(e.at)}</span>
    </div>`).join('') : '<p class="empty">Henüz olay yok.</p>';
}
function renderReport(summary) {
  const total = summary.reduce((sum, r) => sum + r.total, 0);
  $('reportRows').innerHTML = summary.length ? summary.map(r => `
    <div class="row">
      <span>${esc(r.courier_name || 'Bilinmeyen')}</span>
      <span>${money(r.total)}</span>
      <span class="t2">${r.count} teslimat</span>
    </div>`).join('') + `<div class="row" style="background:var(--accent);color:#06121f;font-weight:700"><span>Toplam</span><span>${money(total)}</span><span></span></div>`
    : '<p class="empty">Bu tarihte teslimat yok.</p>';
}
function renderCourierBreakdown(byCourier) {
  const host = $('courierBreakdown');
  if (!host) return;
  host.innerHTML = byCourier.length ? byCourier.map(c => `
    <div class="row">
      <span>${esc(c.courierName || 'Bilinmeyen')}</span>
      <span>${c.pending} bekliyor · ${c.enroute} yolda</span>
      <span class="t2">${c.deliveredCount} teslim edildi · ${money(c.deliveredTotal)}</span>
    </div>`).join('') : '<p class="empty">Veri yok.</p>';
}

let map = null, markers = new Map();
function ensureMap() {
  if (map) return;
  map = L.map('map').setView([39.92, 32.85], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
}
function focusCourier(name) {
  const marker = markers.get(name);
  if (!marker) return;
  map.setView(marker.getLatLng(), 17);
  marker.openPopup();
}
function renderLocations(locations) {
  ensureMap();
  $('locationList').innerHTML = locations.length ? locations.map(l => `
    <div class="row" data-focus-courier="${esc(l.courier_name)}" style="cursor:pointer"><span>${esc(l.courier_name)}</span><span></span><span class="t2">Son güncelleme: ${ago(l.updated_at)}</span></div>
  `).join('') : '<p class="empty">Henüz konum paylaşan kurye yok.</p>';
  const seen = new Set();
  locations.forEach(l => {
    seen.add(l.courier_name);
    const pos = [l.lat, l.lng];
    if (markers.has(l.courier_name)) markers.get(l.courier_name).setLatLng(pos);
    else markers.set(l.courier_name, L.marker(pos).addTo(map).bindPopup(esc(l.courier_name)));
    markers.get(l.courier_name).setPopupContent(`<b>${esc(l.courier_name)}</b><br>${ago(l.updated_at)}`);
  });
  for (const [name, marker] of markers) if (!seen.has(name)) { map.removeLayer(marker); markers.delete(name); }
  if (locations.length && !ensureMap.centered) { map.setView([locations[0].lat, locations[0].lng], 13); ensureMap.centered = true; }
}

async function loadAll() {
  try {
    const [couriers, orders, events, locations, tunnel] = await Promise.all([
      api('/api/admin/couriers'), api('/api/courier/orders'), api('/api/admin/events'), api('/api/admin/locations'), api('/api/admin/tunnel')
    ]);
    renderCouriers(couriers.couriers);
    renderOrders(orders.orders);
    renderEvents(events.events);
    if ($('pane-harita').classList.contains('active')) renderLocations(locations.locations);
    $('tunnelBox').innerHTML = tunnel.url
      ? `<div class="row"><span>${esc(tunnel.url)}</span><span></span><span class="t2">Kurye: ${esc(tunnel.url)}/courier · Yönetim: ${esc(tunnel.url)}/admin</span></div>`
      : '<p class="empty">Tünel henüz hazır değil.</p>';
  } catch (error) { console.error(error.message); }
}
async function loadReport() {
  try {
    const data = await api(`/api/admin/report?date=${$('reportDate').value}`);
    renderReport(data.summary);
    renderCourierBreakdown(data.byCourier || []);
  } catch (error) { $('reportRows').innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}
/* "Genel" sekmesindeki bugunku ozet kutucuklari - ayni /api/admin/report
   verisinden turetilir, ekstra bir uc gerekmez. */
async function loadOverviewStats() {
  try {
    const data = await api(`/api/admin/report?date=${new Date().toISOString().slice(0, 10)}`);
    const deliveredCount = data.summary.reduce((sum, r) => sum + r.count, 0);
    const deliveredTotal = data.summary.reduce((sum, r) => sum + r.total, 0);
    const activeCouriers = new Set((data.byCourier || []).filter(c => c.pending > 0 || c.enroute > 0).map(c => c.courierName)).size;
    $('statDelivered').textContent = deliveredCount;
    $('statRevenue').textContent = money(deliveredTotal);
    $('statActiveCouriers').textContent = activeCouriers;
  } catch { /* sessizce gec, ozet olmadan da panel calisir */ }
}
function refreshAll() { loadAll(); loadOverviewStats(); }

/* Kurye ekranindaki gibi WebSocket baglantisi: yeni siparis/teslimat olaylari
   8 saniyelik yoklamayi beklemeden aninda gorunur (sunucu tarafi bunu zaten
   yayinliyordu - admin ekrani bu baglantiyi hic kurmuyordu, eksikti). */
let socket = null;
function connectSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => { $('connDot').classList.remove('off'); };
  socket.onclose = () => { $('connDot').classList.add('off'); setTimeout(connectSocket, 3000); };
  socket.onerror = () => socket.close();
  socket.onmessage = event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'orders') renderOrders(msg.orders);
      else if (msg.type === 'event') {
        api('/api/admin/events').then(d => renderEvents(d.events)).catch(() => {});
        loadOverviewStats();
      }
    } catch { /* yok say */ }
  };
}

function enterAdmin() {
  $('loginView').hidden = true;
  $('mainView').hidden = false;
  $('reportDate').value = new Date().toISOString().slice(0, 10);
  refreshAll();
  loadReport();
  connectSocket();
  setInterval(refreshAll, 8000);
}

$('loginBtn').onclick = async () => {
  const password = $('password').value;
  const err = $('loginErr');
  err.hidden = true;
  if (!password) return;
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    enterAdmin();
  } catch (error) { err.textContent = error.message; err.hidden = false; }
};
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('loginBtn').click(); });
$('logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };
$('reportDate').addEventListener('change', loadReport);

/* Sayfa acilir acilmaz gecerli bir oturum var mi kontrol edilir - varsa PIN
   ekranina hic ugramadan direkt ana ekrana gecilir (sayfa yenilendiginde
   tekrar sifre sormasi bekleniyordu, bu kontrol eksikti). */
(async () => {
  try {
    const { role } = await api('/api/session');
    if (role === 'admin') enterAdmin();
  } catch { /* oturum yok/suresi dolmus - giris ekraninda kal */ }
})();

document.addEventListener('click', event => {
  const seg = event.target.closest('.seg[data-pane]');
  if (seg) {
    document.querySelectorAll('.seg[data-pane]').forEach(s => s.classList.toggle('active', s === seg));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === seg.dataset.pane));
    if (seg.dataset.pane === 'pane-harita') { ensureMap(); api('/api/admin/locations').then(d => renderLocations(d.locations)); }
    return;
  }
  const focusBtn = event.target.closest('[data-focus-courier]');
  if (focusBtn) return focusCourier(focusBtn.dataset.focusCourier);
  const saveBtn = event.target.closest('[data-save-phone]');
  if (saveBtn) {
    const name = saveBtn.dataset.savePhone;
    const input = document.querySelector(`[data-phone-input="${CSS.escape(name)}"]`);
    api(`/api/admin/couriers/${encodeURIComponent(name)}/phone`, { method: 'POST', body: JSON.stringify({ phone: input.value.trim() }) })
      .then(() => {
        const saved = document.querySelector(`[data-saved="${CSS.escape(name)}"]`);
        saved.hidden = false; setTimeout(() => { saved.hidden = true; }, 2000);
      })
      .catch(err => alert(err.message));
  }
});
