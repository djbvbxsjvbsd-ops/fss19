// Roda no PC onde o FS19 está. Envia o save (farms.xml / vehicles.xml) para o servidor no Railway
// e baixa para a pasta mods daqui os mods que foram enviados pelo app/bot.
// Config no .env desta pasta:  SYNC_URL=https://seu-bot.up.railway.app   e   ADMIN_PASSWORD=...
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Readable } = require('stream'), { pipeline } = require('stream/promises');
const paths = require('./paths');

const base = String(process.env.SYNC_URL || '').trim().replace(/\/+$/, '');
const password = process.env.ADMIN_PASSWORD || '';
if (!/^https?:\/\//i.test(base)) { console.error('[ERRO] Defina SYNC_URL no .env (ex.: SYNC_URL=https://seu-bot.up.railway.app)'); process.exit(1); }
if (paths.CLOUD) { console.error('[ERRO] Este script é para rodar no PC do jogo, não no Railway.'); process.exit(1); }

let token = null;
const stamp = {};   // arquivo -> mtime já enviado
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a);

async function api(p, opt = {}, retry = true) {
  if (!token) {
    const r = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Login ADM falhou: ' + (j.error || r.status));
    token = j.token;
  }
  const r = await fetch(base + p, { ...opt, signal: AbortSignal.timeout(opt.timeout || 60000), headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token } });
  if (r.status === 401 && retry) { token = null; return api(p, opt, false); }
  return r;
}

async function syncSave() {
  paths.resolve();
  const dir = process.env.SAVEGAME_PATH;
  if (!dir) return log('Save do FS19 não encontrado. Abra o jogo e salve uma vez, ou defina SAVEGAME_PATH no .env.');
  for (const f of ['farms.xml', 'vehicles.xml']) {
    const file = path.join(dir, f);
    let t; try { t = fs.statSync(file).mtimeMs; } catch { continue; }
    if (stamp[f] === t) continue;
    const r = await api('/api/admin/save/' + f, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(file) });
    if (!r.ok) throw new Error(`Envio de ${f} falhou: ` + ((await r.json().catch(() => ({}))).error || r.status));
    stamp[f] = t; log('Enviado', f);
  }
}

async function syncMods() {
  paths.resolve();
  const dir = process.env.MODS_PATH;
  if (!dir) return;
  const r = await api('/api/admin/mods');
  if (!r.ok) return;
  const { mods } = await r.json();
  fs.mkdirSync(dir, { recursive: true });
  for (const m of mods) {
    const dest = path.join(dir, m.name);
    if (fs.existsSync(dest)) continue;
    log('Baixando mod', m.name, '...');
    const d = await api('/api/admin/mods/' + encodeURIComponent(m.name), { timeout: 600000 });
    if (!d.ok) { log('Falhou ao baixar', m.name); continue; }
    await pipeline(Readable.fromWeb(d.body), fs.createWriteStream(dest + '.part'));
    fs.renameSync(dest + '.part', dest); log('Mod instalado:', m.name);
  }
}

async function loop(fn, ms) {
  for (;;) {
    try { await fn(); } catch (e) { log('[aviso]', e.cause?.code || e.message); }
    await new Promise(r => setTimeout(r, ms));
  }
}
log('Sincronizando com', base);
loop(syncSave, 30e3);
loop(syncMods, 5 * 60e3);
