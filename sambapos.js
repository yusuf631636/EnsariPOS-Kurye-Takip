/* SambaPOS ile ilgili tum SQL okuma/yazma islemleri burada toplanir.
   Sema gercekleri (Faz 1 kesfinde dogrulandi):
   - Kuryeler: Entities, EntityTypeId=3 ("Paketciler"), CustomData=[{Telefon},{Sifresi},{PIN},{Durum}]
   - Siparis-kurye eslesmesi: Tickets.TicketStates JSON dizisinde SN="Paketci Adi" (deger=kurye Entity.Name)
     ve SN="Paket" (deger=Bekliyor/Yolda/Teslim Edildi). Her elemanin D (tarih) alani da var.
   - Musteri bilgisi: TicketEntities -> Entities (EntityTypeId IN musteri tipleri), CustomData=[{Adres},{Musteri Adi}]. */
const { sql, rows } = require('./sql');
const { allCourierPhones } = require('./db');

/* sqlcmd varsayilan sutun genisligi 256 karakterle sinirlidir; TicketStates JSON'u
   bundan uzun olabildigi icin -y 0 (sinirsiz) ile cagiriyoruz. */
function sqlWide(query) { return sql(query, { wide: true }); }

const COURIER_ENTITY_TYPE = 3;
/* Online siparis/musteri entegrasyonlarinin EntityTypeId'leri (YS/Getir/Trendyol/Migros/Musteriler). */
const CUSTOMER_ENTITY_TYPES = '1,4,6,8,22';
/* Kurye ve admin PIN'leri Entities.CustomData'da DEGIL, gercekte SambaPOS'un kendi
   Personel/Users tablosunda kullanilir (kuryeler POS'a bu PIN ile giris yapiyor).
   UserRoles: 1=Admin, 3=Paketciler (SQL'de encoding sorunu yasamamak icin sabit ID kullanilir). */
const COURIER_USER_ROLE = 3;
const ADMIN_USER_ID = 1; // "Administrator" kaydi

function parseCustomData(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Object.fromEntries(arr.filter(item => item && item.Name).map(item => [item.Name, item.Value]));
  } catch { return {}; }
}
function parseNetDate(value) {
  const match = String(value || '').match(/\/Date\((\d+)([+-]\d+)?\)\//);
  return match ? new Date(Number(match[1])) : null;
}
function parsePhoneFromName(name) {
  const match = String(name || '').match(/(\d{10,11})\s*$/);
  return match ? match[1] : '';
}

/* Kurye listesi: Users'tan (SambaPOS'taki gercek giris PIN'i, "Paketciler" rolu).
   Telefon numarasi SambaPOS'a HIC yazilmaz - sadece bizim kendi veritabanimizda (courier_phones)
   tutulur ve admin panelinden elle girilir/duzenlenir. */
async function couriers() {
  const userQuery = `SET NOCOUNT ON; SELECT Id, Name, PinCode FROM Users WHERE UserRole_Id=${COURIER_USER_ROLE} ORDER BY Name;`;
  const users = rows(await sqlWide(userQuery), ['id', 'name', 'pin']);
  const phones = allCourierPhones();
  /* "Paketciler" rolunde genel grup hesaplari / entegrasyon test hesaplari da olabiliyor
     (orn. "paketciler", "RFTG"); gercek kurye atamalari her zaman "Paketci-N" formatinda
     oldugu icin (TicketEntities'te dogrulandi) listeyi bu desenle sinirliyoruz. */
  return users
    .filter(user => /^paketçi-\d+$/i.test(user.name))
    .map(user => ({ id: user.id, name: user.name, phone: phones[user.name] || '', pin: user.pin }));
}

/* Kurye girisi SambaPOS'taki gercek personel PIN'i ile yapilir (Entities.CustomData'daki
   PIN alani kullanilmiyor, kuryeler bunu bilmez/kullanmaz). */
async function courierByPin(pin) {
  if (!/^\d+$/.test(String(pin || ''))) return null;
  const query = `SET NOCOUNT ON; SELECT Id, Name FROM Users WHERE UserRole_Id=${COURIER_USER_ROLE} AND PinCode=N'${String(pin).replace(/'/g, '')}';`;
  const found = rows(await sqlWide(query), ['id', 'name'])[0];
  return found ? { id: found.id, name: found.name } : null;
}
/* Admin girisi SambaPOS'un Administrator kullanicisinin PIN'i ile yapilir. */
async function adminValidByPin(pin) {
  if (!/^\d+$/.test(String(pin || ''))) return false;
  const query = `SET NOCOUNT ON; SELECT 1 FROM Users WHERE Id=${ADMIN_USER_ID} AND PinCode=N'${String(pin).replace(/'/g, '')}';`;
  return !!(await sqlWide(query)).trim();
}

/* Acik (IsClosed=0) ve bir kuryeye atanmis (Paketci Adi seti) tum siparisler. */
async function activeCourierOrders() {
  const query = `SET NOCOUNT ON;
    SELECT
      t.Id, COALESCE(t.TicketNumber,''), CONVERT(varchar(19),t.Date,120), COALESCE(t.TotalAmount,0),
      COALESCE(pk.S,''), COALESCE(pc.D,''),
      COALESCE(cur.Name,''),
      COALESCE(cust.Name,''), COALESCE(cust.CustomData,'')
    FROM Tickets t
    OUTER APPLY (SELECT TOP 1 JSON_VALUE(value,'$.S') AS S FROM OPENJSON(CASE WHEN ISJSON(t.TicketStates)=1 THEN t.TicketStates END) WHERE JSON_VALUE(value,'$.SN')='Paket') pk
    OUTER APPLY (SELECT TOP 1 JSON_VALUE(value,'$.D') AS D FROM OPENJSON(CASE WHEN ISJSON(t.TicketStates)=1 THEN t.TicketStates END) WHERE JSON_VALUE(value,'$.SN')=N'Paketçi Adı') pc
    /* Kurye atamasi SambaPOS'un kendi rapor motorunun ("Paketçi Raporu") da kullandigi
       TicketEntities baglantisidir (EntityTypeId=3, ad/tip dogrudan bu tabloda tutulur,
       Entities'e JOIN gerekmez) - TicketStates JSON yerine bunu birincil kaynak aliyoruz. */
    OUTER APPLY (SELECT TOP 1 EntityName AS Name FROM TicketEntities WHERE Ticket_Id=t.Id AND EntityTypeId=${COURIER_ENTITY_TYPE} ORDER BY Id DESC) cur
    OUTER APPLY (SELECT TOP 1 EntityName AS Name, EntityCustomData AS CustomData FROM TicketEntities WHERE Ticket_Id=t.Id AND EntityTypeId IN (${CUSTOMER_ENTITY_TYPES}) ORDER BY Id DESC) cust
    WHERE t.IsClosed=0 AND cur.Name IS NOT NULL AND cur.Name <> ''
    ORDER BY t.Date DESC;`;
  const text = await sqlWide(query);
  return rows(text, ['id', 'number', 'date', 'total', 'packageStatus', 'assignedAt', 'courierName', 'customerEntity', 'customerData'])
    .map(row => {
      const customer = parseCustomData(row.customerData);
      return {
        id: row.id,
        number: row.number,
        date: row.date,
        total: +row.total,
        packageStatus: row.packageStatus,
        courierName: row.courierName,
        assignedAt: parseNetDate(row.assignedAt),
        customerName: customer['Müşteri Adı'] || row.customerEntity || 'Bilinmeyen',
        address: customer['Adres'] || '',
        phone: parsePhoneFromName(row.customerEntity)
      };
    });
}

async function orderContent(ticketId) {
  if (!/^\d+$/.test(String(ticketId))) throw new Error('Geçersiz sipariş numarası.');
  const query = `SET NOCOUNT ON; SELECT COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(o.Quantity,0),COALESCE(o.Price,0) FROM Orders o WHERE o.TicketId=${Number(ticketId)} ORDER BY o.OrderNumber,o.Id;`;
  return rows(await sql(query), ['name', 'quantity', 'price']).map(row => ({ ...row, quantity: +row.quantity, price: +row.price }));
}

/* SambaPOS'un kapali biletlerinde gozlenen sabit degerler (DepartmentId/UserId/TerminalId/
   ExchangeRate hep ayni); Payments_insert_trigger sadece senkronizasyon takibi yapiyor,
   muhasebeyle ilgili degil - guvenle INSERT edilebilir (dogrulandi). */
const PAYMENT_TYPE_CASH = 1; // Nakit
const PAYMENT_DEPARTMENT_ID = 1, PAYMENT_USER_ID = 1, PAYMENT_TERMINAL_ID = 1;

/* Simdiki zamani SambaPOS'un kendi state'lerinde kullandigi .NET JSON tarih formatiyla uretir. */
function netDateNow() { return `/Date(${Date.now()}+0300)/`; }
/* states dizisinde SN'si verilen elemani S=value ile gunceller; yoksa yeni eleman ekler
   (SambaPOS'un normal akista urettigi elemanlarla ayni sekilde: D/S/SN/SV). */
function upsertState(states, sn, value) {
  const idx = states.findIndex(item => item && item.SN === sn);
  if (idx === -1) { states.push({ D: netDateNow(), S: value, SN: sn, SV: '' }); }
  else { states[idx] = { ...states[idx], D: netDateNow(), S: value }; }
}

/* Kurye "Teslim edildi" dedigi anda: (1) kalan tutar kadar Nakit tahsilat kaydi acar,
   (2) adisyonu kapatir, (3) SambaPOS'un kendi Paket VE Durum state'lerini gunceller.
   Not: sadece "Paket" state'ini guncellemek yetmiyor - SambaPOS'un arayuzu "Durum"
   state'ine (Odendi/Odenmedi) gore "acik/kapali" gosterimi yapiyor; bu dogrulandi
   (17312/17306 test edildi: veritabaninda IsClosed=1 olmasina ragmen Durum="Odenmedi"
   kaldigi icin SambaPOS ekraninda hala acik/odenmemis gorunuyordu). */
async function markDelivered(ticketId) {
  if (!/^\d+$/.test(String(ticketId))) throw new Error('Geçersiz sipariş numarası.');
  const id = Number(ticketId);
  const row = rows(await sqlWide(`SET NOCOUNT ON; SELECT TicketStates, COALESCE(RemainingAmount,0) FROM Tickets WHERE Id=${id};`), ['states', 'remaining'])[0];
  if (!row) throw new Error('Sipariş bulunamadı.');
  let states;
  try { states = JSON.parse(row.states); } catch { throw new Error('Sipariş durumu okunamadı.'); }
  if (!Array.isArray(states)) throw new Error('Sipariş durumu beklenmeyen formatta.');
  if (!states.some(item => item && item.SN === 'Paket')) throw new Error('Bu siparişte paket durumu bulunamadı.');

  const remaining = +row.remaining || 0;
  const paymentInserted = remaining > 0;
  upsertState(states, 'Paket', 'Teslim Edildi');
  upsertState(states, 'Durum', 'Ödendi');
  const json = JSON.stringify(states).replace(/'/g, "''");
  /* Odeme kaydi ile adisyon kapatma TEK islem (transaction) icinde: biri
     basarisiz olursa digeri de geri alinir, "odeme girildi ama adisyon acik
     kaldi" gibi yarim kalmis bir durum olusmaz. Ayni siparis icin cakisan iki
     istek (cift tiklama, ayni anda admin+kurye) gelirse WHERE RemainingAmount>0
     kosulu ikinci istegin hicbir satiri etkilememesini saglar - RemainingAmount
     zaten SQL Server tarafinda satir kilidiyle korunur, bu yuzden iki kez nakit
     tahsilat kaydi acilamaz (onceki halde bu bir para/muhasebe hatasiydi). */
  const paymentSql = paymentInserted ? `
    INSERT INTO Payments (TicketId, PaymentTypeId, DepartmentId, Name, Description, Date, AccountTransactionId, Amount, TenderedAmount, UserId, TerminalId, ExchangeRate, CanAdjustTip)
    SELECT ${id}, ${PAYMENT_TYPE_CASH}, ${PAYMENT_DEPARTMENT_ID}, N'Nakit', N'Kurye teslimat tahsilatı', GETDATE(), 0, ${remaining}, ${remaining}, ${PAYMENT_USER_ID}, ${PAYMENT_TERMINAL_ID}, 1, 0
    WHERE EXISTS (SELECT 1 FROM Tickets WITH (UPDLOCK, ROWLOCK) WHERE Id=${id} AND RemainingAmount=${remaining});` : '';
  const result = rows(await sqlWide(`SET NOCOUNT ON;
    BEGIN TRY
      BEGIN TRANSACTION;
      ${paymentSql}
      UPDATE Tickets SET TicketStates=N'${json}', IsClosed=1, RemainingAmount=0
        WHERE Id=${id} AND RemainingAmount=${remaining};
      DECLARE @rc INT = @@ROWCOUNT;
      COMMIT TRANSACTION;
      SELECT @rc;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH`), ['updated'])[0];
  /* updated=0 demek: bu istek geldiginde siparis zaten (cakisan baska bir
     istek tarafindan) teslim edilmis ve kapatilmis demektir - RemainingAmount
     artik eslesmedigi icin UPDATE hicbir satiri etkilemedi. Boyle bir durumda
     "basarili" gibi gorunup ikinci kez tahsilat yapilmis izlenimi vermek yerine
     acikca bildiriyoruz. */
  if (!result || Number(result.updated) === 0) throw new Error('Bu sipariş az önce başka bir istek tarafından teslim edildi olarak işaretlendi.');
  return { paymentInserted, amountCollected: remaining };
}

module.exports = { couriers, courierByPin, adminValidByPin, activeCourierOrders, orderContent, markDelivered };
