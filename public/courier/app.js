const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(value) || 0);
const timeOf = value => { const d = new Date(String(value).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); };
const mapsUrl = address => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

let socket = null;
let knownIds = new Set();
let hasRenderedOnce = false; // ilk yuklemede mevcut siparisleri "yeni" gibi seslendirmemek icin

/* Servis calisani kaydi - "Ana ekrana ekle / Uygulama olarak yukle" istemi
   (beforeinstallprompt) icin Chrome bunu gerekli sayabiliyor. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/courier/sw.js').catch(() => {}));
}

/* Sesli konusma ("Siparişiniz var") cogu telefonda/hoparlorde zayif/kisik
   cikiyor - bunun yaninda Web Audio ile ureteceğimiz, sesi kendimiz
   ayarladigimiz (tam guc, gain=1) net ve YUKSEK iki "bip" sesi calariz.
   Bu, cihazin/tarayicinin konusma motorunun sessine bagli kalmadigi icin
   her zaman ayni yuksekllikte, dikkat cekici bir uyari verir. */
let audioCtx = null;
function unlockAudioAlert() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* Web Audio desteklenmiyor olabilir */ }
}
function playAlertTone() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [0, 0.32].forEach(offset => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square'; // sine'dan daha keskin/dikkat cekici
      osc.frequency.value = 1046.5; // C6 - net, tiz bir bip
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    });
  } catch { /* sessizce gec */ }
}

/* Yeni sipariş atandığında sesli uyarı: yuksek "bip bip" + "Siparişiniz var"
   konusmasi + titresim (uygulama açıkken calisir). */
function announceNewOrder() {
  playAlertTone();
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance('Siparişiniz var');
    utter.lang = 'tr-TR';
    utter.volume = 1;
    speechSynthesis.speak(utter);
  } catch { /* Speech API desteklenmiyor olabilir - sessizce gec */ }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
}
/* Cogu mobil tarayici, sesli uyariyi yalnizca gercek bir kullanici dokunusu
   icinde ilk kez calistirilirsa sonraki cagrilarda (yoklama zamanlayicisindan
   gelen yeni siparis anonsu gibi) sessizce izin veriyor - kilidi sayfadaki
   ilk dokunusta (ve giris butonunda) burada aciyoruz. */
function unlockSpeech() {
  try {
    const utter = new SpeechSynthesisUtterance('');
    utter.volume = 0;
    speechSynthesis.speak(utter);
  } catch { /* Speech API desteklenmiyor olabilir */ }
  unlockAudioAlert();
}
document.addEventListener('pointerdown', unlockSpeech, { once: true });

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

function badgeClass(status) { return status === 'Yolda' ? 'yolda' : 'bekliyor'; }

function renderOrders(orders) {
  const host = $('orders');
  $('empty').hidden = orders.length > 0;
  const currentIds = new Set(orders.map(o => o.id));
  const isNewOrder = hasRenderedOnce && [...currentIds].some(id => !knownIds.has(id));
  if (isNewOrder) announceNewOrder();
  hasRenderedOnce = true;
  host.innerHTML = orders.map(order => `
    <div class="order${knownIds.has(order.id) ? '' : ' new'}" data-id="${esc(order.id)}">
      <div class="order-top">
        <span class="num">Fiş ${esc(order.number)}</span>
        <span class="amount">${money(order.total)}</span>
      </div>
      <div class="order-name">${esc(order.customerName)}</div>
      ${order.address ? `<div class="order-address">${esc(order.address)}</div>` : ''}
      <div class="order-meta">
        <span>${esc(timeOf(order.date))}</span>
        <span class="badge ${badgeClass(order.packageStatus)}">${esc(order.packageStatus || 'Bekliyor')}</span>
      </div>
      <div class="actions">
        ${order.phone ? `<a href="tel:${esc(order.phone)}">📞 Ara</a>` : '<span class="unavailable">📞 Numara yok</span>'}
        ${order.address ? `<a href="${esc(mapsUrl(order.address))}" target="_blank" rel="noopener">🗺️ Yol tarifi</a>` : '<span class="unavailable">🗺️ Adres yok</span>'}
      </div>
      <button class="content-toggle" data-content="${esc(order.id)}">Sipariş içeriğini göster</button>
      <button class="deliver-btn" data-deliver="${esc(order.id)}">✓ Teslim Edildi</button>
    </div>
  `).join('');
  knownIds = currentIds;
}

async function showContent(id) {
  $('detailBody').innerHTML = '<p class="muted">Yükleniyor…</p>';
  $('detailSheet').hidden = false;
  try {
    const data = await api(`/api/courier/orders/${id}/content`);
    $('detailBody').innerHTML = data.items.length
      ? data.items.map(item => `<div class="content-row"><span><span class="qty">${esc(item.quantity)}x</span>${esc(item.name)}</span><span>${esc(money(item.price * item.quantity))}</span></div>`).join('')
      : '<p class="muted">Ürün bulunamadı.</p>';
  } catch (error) { $('detailBody').innerHTML = `<p class="err">${esc(error.message)}</p>`; }
}

async function markDelivered(id, button) {
  if (!confirm('Teslim edildi ve ödeme alındı olarak işaretlensin mi?\nAdisyon kapatılacak.')) return;
  button.disabled = true; button.textContent = 'Kaydediliyor…';
  try {
    const data = await api(`/api/courier/orders/${id}/delivered`, { method: 'POST' });
    const message = data.paymentInserted
      ? `✓ Teslim edildi\n${money(data.amountCollected)} nakit tahsil edildi.\nAdisyon kapatıldı.`
      : '✓ Teslim edildi\nAdisyon kapatıldı.';
    alert(message);
    loadMyStats();
  } catch (error) {
    alert(error.message);
    button.disabled = false; button.textContent = '✓ Teslim Edildi';
  }
}

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
    } catch { /* yok say */ }
  };
}

/* Kurye izin verdigi surece konumu ~20 saniyede bir sunucuya gonderir (canli takip icin). */
let watchId = null;
function startLocationSharing() {
  if (!('geolocation' in navigator) || watchId !== null) return;
  let lastSent = 0;
  watchId = navigator.geolocation.watchPosition(
    position => {
      const now = Date.now();
      if (now - lastSent < 15000) return; // asiri sik gonderimi onle
      lastSent = now;
      api('/api/courier/location', { method: 'POST', body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }) }).catch(() => {});
    },
    () => { /* izin reddedildi/hata - sessizce devam, konum paylasilmadan da uygulama calisir */ },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

async function loadMyStats() {
  try {
    const data = await api('/api/courier/my-summary');
    $('myStats').innerHTML = `<b>${data.count}</b> paket teslim edildi · <b>${money(data.total)}</b> tahsilat <span class="muted">(bugün)</span>`;
  } catch { /* sessizce gec, istatistik olmadan da uygulama calisir */ }
}

/* Ekranin kilitlenip zamanlayicilarin/WS baglantisinin uykuya gecmesini
   geciktirir; uygulama on plandayken tarayici izin verdigi surece calisir.
   Arka plandan donulunce de hemen taze veri cekilir (WS baglantisi
   sessizce kopmus olabilir). */
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    if (!$('mainView').hidden) { api('/api/courier/orders').then(d => renderOrders(d.orders)).catch(() => {}); }
  }
});

async function enterMain(courierName) {
  $('loginView').hidden = true;
  $('mainView').hidden = false;
  $('courierName').textContent = courierName;
  startLocationSharing();
  loadMyStats();
  setInterval(loadMyStats, 30000);
  try { const data = await api('/api/courier/orders'); renderOrders(data.orders); } catch { /* WS gelince tekrar dolacak */ }
  connectSocket();
  requestWakeLock();
}

/* PIN telefonda saklanir - oturum cerezinin suresi dolsa bile (uzun sure
   uygulama acilmazsa) tekrar elle girmeye gerek kalmadan otomatik giris
   yapilir. Cikis yapinca silinir. */
const CREDS_KEY = 'kurye-creds';
function saveCreds(pin) { try { localStorage.setItem(CREDS_KEY, pin); } catch {} }
function loadCreds() { try { return localStorage.getItem(CREDS_KEY); } catch { return null; } }
function clearCreds() { try { localStorage.removeItem(CREDS_KEY); } catch {} }

async function doLogin(pin) {
  const data = await api('/api/courier/login', { method: 'POST', body: JSON.stringify({ pin }) });
  saveCreds(pin);
  enterMain(data.courierName);
}

$('loginBtn').onclick = async () => {
  unlockSpeech();
  const pin = $('pin').value.trim();
  const err = $('loginErr');
  err.hidden = true;
  if (!pin) return;
  $('loginBtn').disabled = true;
  try {
    await doLogin(pin);
  } catch (error) { err.textContent = error.message; err.hidden = false; }
  finally { $('loginBtn').disabled = false; }
};
$('pin').addEventListener('keydown', event => { if (event.key === 'Enter') $('loginBtn').click(); });
$('logoutBtn').onclick = async () => { clearCreds(); await api('/api/logout', { method: 'POST' }); location.reload(); };

/* Sayfa acilir acilmaz gecerli bir oturum var mi kontrol edilir (cerez zaten
   12 saat gecerli) - varsa PIN ekranina hic ugramadan direkt ana ekrana
   gecilir. Cerez de gecersizse, telefonda saklanmis PIN varsa onunla
   otomatik giris denenir. */
(async () => {
  try {
    const { courierName } = await api('/api/session');
    enterMain(courierName);
  } catch {
    const pin = loadCreds();
    if (!pin) return;
    try { await doLogin(pin); } catch { clearCreds(); }
  }
})();
$('closeDetail').onclick = () => { $('detailSheet').hidden = true; };
document.addEventListener('click', event => {
  const contentBtn = event.target.closest('[data-content]');
  if (contentBtn) return showContent(contentBtn.dataset.content);
  const deliverBtn = event.target.closest('[data-deliver]');
  if (deliverBtn) return markDelivered(deliverBtn.dataset.deliver, deliverBtn);
});


