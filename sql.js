/* C:\ensari\server.js'deki sql()/rows() deseninin uyarlanmasi.
   ONEMLI FARK: sorgu komut satiri argumani olarak degil, gecici bir dosyadan (-i) okutulur.
   Cift tirnak iceren (JSON_MODIFY, TicketStates JSON'u gibi) sorgular Windows'un execFile
   komut satiri quoting'inde bozuluyordu ("Unexpected argument" hatasi) - dosya bazli
   yaklasim bu sorunu tamamen ortadan kaldirir. DOGRULANDI: sqlcmd -i ile dosya OKURKEN
   Windows-1254 (Turkce ANSI) codepage bekliyor, ama STDOUT'a YAZARKEN hala cp857 (DOS
   Turkce, server.js'deki gibi) kullaniyor - iki yon farkli codepage, ikisi de test edildi. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const iconv = require('iconv-lite');

const config = fs.existsSync(path.join(__dirname, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) : {};
const SQL_SERVER = process.env.SAMBAPOS_SQL_SERVER || config.server || 'localhost';
const SQL_DATABASE = process.env.SAMBAPOS_DB || config.database || 'SAMBAPOS5';
const SQL_USER = process.env.SAMBAPOS_SQL_USER || config.user || '';
const SQL_PASSWORD = process.env.SAMBAPOS_SQL_PASSWORD || config.password || '';

function sql(query, { wide = false } = {}) {
  return new Promise((resolve, reject) => {
    const auth = SQL_USER && SQL_PASSWORD ? ['-U', SQL_USER, '-P', SQL_PASSWORD] : ['-E'];
    const trust = config.options && config.options.trustServerCertificate ? ['-C'] : [];
    const widthFlag = wide ? ['-y', '8000'] : ['-W'];
    const tempFile = path.join(os.tmpdir(), `kurye-sql-${crypto.randomBytes(8).toString('hex')}.sql`);
    fs.writeFileSync(tempFile, iconv.encode(query, 'win1254'));
    const args = ['-S', SQL_SERVER, ...auth, ...trust, '-d', SQL_DATABASE, '-h', '-1', ...widthFlag, '-s', '|', '-i', tempFile];
    execFile('sqlcmd', args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' }, (e, out, err) => {
      fs.unlink(tempFile, () => {});
      const decode = value => Buffer.isBuffer(value) ? iconv.decode(value, 'cp857') : String(value || '');
      const stdout = decode(out), stderr = decode(err);
      e ? reject(new Error(stderr.trim() || stdout.trim() || e.message)) : resolve(stdout.trim());
    });
  });
}
function rows(text, keys) {
  return text ? text.split(/\r?\n/).filter(Boolean).map(line => {
    const v = line.split('|').map(x => x.trim());
    return Object.fromEntries(keys.map((k, i) => [k, v[i] || '']));
  }) : [];
}

module.exports = { sql, rows, config };
