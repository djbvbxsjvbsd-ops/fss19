const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DATA_DIR } = require('./paths');
const FILE = path.join(DATA_DIR, 'keys.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
const norm = k => String(k || '').trim().toUpperCase();

function create(days, note = '') {
  const key = `FS19-${seg()}-${seg()}-${seg()}`;
  db[key] = { active: true, createdAt: Date.now(), expiresAt: days ? Date.now() + days * 864e5 : null, hwid: null, discordId: null, note };
  save();
  return key;
}
function check(k) {
  const e = db[norm(k)];
  if (!e) return { error: 'Key inexistente' };
  if (!e.active) return { error: 'Key revogada' };
  if (e.expiresAt && e.expiresAt < Date.now()) return { error: 'Key expirada' };
  return { e, key: norm(k) };
}
// App .exe: valida a key e prende ao HWID do primeiro PC que usar
function validate(k, hwid) {
  const c = check(k);
  if (c.error) return { ok: false, error: c.error };
  if (!hwid) return { ok: false, error: 'HWID ausente' };
  if (!c.e.hwid) { c.e.hwid = hwid; save(); }
  else if (c.e.hwid !== hwid) return { ok: false, error: 'Key vinculada a outro PC' };
  return { ok: true, key: c.key };
}
// Bot: .login KEY prende a key a uma conta do Discord
function linkDiscord(k, id) {
  const c = check(k);
  if (c.error) return { ok: false, error: c.error };
  if (c.e.discordId && c.e.discordId !== id) return { ok: false, error: 'Key já usada por outra conta' };
  c.e.discordId = id; save();
  return { ok: true };
}
function unlinkDiscord(id) { const e = Object.values(db).find(x => x.discordId === id); if (!e) return false; e.discordId = null; save(); return true; }
const byDiscord = id => Object.values(db).find(e => e.discordId === id && e.active && (!e.expiresAt || e.expiresAt > Date.now())) || null;
const get = k => db[norm(k)];
function reset(k) { const e = get(k); if (!e) return false; e.hwid = null; e.discordId = null; save(); return true; }
function revoke(k) { const e = get(k); if (!e) return false; e.active = false; save(); return true; }

function activate(k) { const e = get(k); if (!e) return false; e.active = true; save(); return true; }
function remove(k) { if (!get(k)) return false; delete db[norm(k)]; save(); return true; }
// Lista para o painel ADM (nunca devolve o HWID em si, só se está vinculado)
const list = () => Object.entries(db)
  .map(([key, e]) => ({ key, active: e.active, createdAt: e.createdAt, expiresAt: e.expiresAt, pc: !!e.hwid, discord: !!e.discordId, note: e.note || '' }))
  .sort((a, b) => b.createdAt - a.createdAt);

module.exports = { create, validate, linkDiscord, unlinkDiscord, byDiscord, get, reset, revoke, activate, remove, list };
