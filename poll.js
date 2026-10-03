/* SambaPOS'u periyodik yoklayip degisiklikleri tespit eden dongu.
   SambaPOS'a dokunmadan degisiklik yakalamanin tek yolu bu (native trigger/webhook yok);
   istemciler WebSocket uzerinden anlik guncellenir, kendileri yoklamaz. */
const sambapos = require('./sambapos');
const { logEvent } = require('./db');
const ws = require('./ws');

const POLL_MS = 6000;

let previous = new Map(); // ticketId -> {courierName, packageStatus}
let latestOrders = [];
let firstTick = true; // sunucu her baslattiginda mevcut siparisleri "yeni atama" gibi loglamamak icin

function getLatestOrders() { return latestOrders; }

async function tick() {
  let current;
  try { current = await sambapos.activeCourierOrders(); }
  catch (error) { console.error('Poll hatası:', error.message); return; }

  const currentIds = new Set(current.map(o => o.id));
  for (const order of current) {
    const before = previous.get(order.id);
    if (!before && firstTick) {
      // baslangic durumu: sunucu yeni acildi, halihazirda atanmis siparisler "yeni" sayilmaz.
    } else if (!before) {
      logEvent(order.id, order.courierName, 'atandi', `Sipariş ${order.number} → ${order.courierName}`);
      ws.broadcastEvent({ kind: 'atandi', ticketId: order.id, number: order.number, courierName: order.courierName });
    } else if (before.courierName !== order.courierName) {
      logEvent(order.id, order.courierName, 'kurye-degisti', `${before.courierName} → ${order.courierName}`);
      ws.broadcastEvent({ kind: 'kurye-degisti', ticketId: order.id, number: order.number, from: before.courierName, to: order.courierName });
    } else if (before.packageStatus !== order.packageStatus) {
      logEvent(order.id, order.courierName, 'durum-degisti', `${before.packageStatus} → ${order.packageStatus}`);
    }
  }
  for (const [ticketId, before] of previous) {
    if (!currentIds.has(ticketId)) logEvent(ticketId, before.courierName, 'listeden-cikti', 'Kapandı veya kurye ataması kaldırıldı');
  }

  previous = new Map(current.map(o => [o.id, { courierName: o.courierName, packageStatus: o.packageStatus }]));
  latestOrders = current;
  firstTick = false;
  ws.broadcastOrders(current);
}

function start() {
  tick();
  return setInterval(tick, POLL_MS);
}

module.exports = { start, getLatestOrders };
