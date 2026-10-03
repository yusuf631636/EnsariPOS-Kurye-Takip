/* Kurye/admin istemcilerine anlik guncelleme yayini. Kurye sadece kendi siparislerini,
   admin tum siparisleri gorur - sunucu tarafinda filtrelenir, istemciye baskasinin
   verisi hic gonderilmez (madde 11 - guvenlik). */
const { WebSocketServer } = require('ws');
const auth = require('./auth');

let wss = null;
const clients = new Set(); // {ws, role, courierName}

function attach(server) {
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') { socket.destroy(); return; }
    const session = auth.currentSession(req);
    if (!session) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const client = { ws, role: session.role, courierName: session.courierName || null };
      clients.add(client);
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => clients.delete(client));
    });
  });
}

function send(client, payload) {
  if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(payload));
}

/* allOrders: sambapos.activeCourierOrders() ciktisi. Her istemciye rolune gore filtrelenmis gonderilir. */
function broadcastOrders(allOrders) {
  for (const client of clients) {
    const scoped = client.role === 'admin' ? allOrders : allOrders.filter(o => o.courierName === client.courierName);
    send(client, { type: 'orders', orders: scoped });
  }
}
function broadcastEvent(event) {
  for (const client of clients) if (client.role === 'admin') send(client, { type: 'event', event });
}

module.exports = { attach, broadcastOrders, broadcastEvent };
