require('dotenv').config();
const express = require('express'), crypto = require('crypto');
const path = require('path'), fs = require('fs');
const keys = require('./keys'), fs19 = require('./fs19'), paths = require('./paths');

const app = express();
app.set('trust proxy', 1);   // atrás do proxy do Railway: pega o IP real (limite de tentativas da senha ADM)
app.use(express.json());
const sessions = new Map(), adminSessions = new Map(), fails = new Map();
const bearer = req => (req.headers.authorization || '').replace('Bearer ', '');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

function auth(req, res, next) {
  const s = sessions.get(bearer(req));
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'Sessão inválida, entre de novo' });
  const k = keys.get(s.key);
  if (!k || !k.active || (k.expiresAt && k.expiresAt < Date.now())) return res.status(403).json({ error: 'Key inválida ou expirada' });
  next();
}
function adminAuth(req, res, next) {
  const s = adminSessions.get(bearer(req));
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'Admin não autenticado' });
  next();
}
const dropSessions = key => { for (const [t, s] of sessions) if (s.key === key.trim().toUpperCase()) sessions.delete(t); };

app.get('/', (req, res) => res.send('FS19 Hub online'));
app.get('/api/ping', (req, res) => res.json({ ok: true }));

/* ---------- app do jogador ---------- */
app.post('/api/login', (req, res) => {
  const { key, hwid } = req.body || {};
  const r = keys.validate(key, hwid);
  if (!r.ok) return res.status(403).json({ error: r.error });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { key: r.key, exp: Date.now() + 12 * 3600e3 });
  res.json({ token });
});
app.get('/api/data', auth, (req, res) => {
  try { res.json(fs19.getState(req.query.fresh === '1')); }
  catch (e) { res.status(500).json({ error: 'Não consegui ler o save: ' + e.message }); }
});
app.put('/api/mod', auth, express.raw({ type: '*/*', limit: '1gb' }), (req, res) => {
  const name = fs19.safeModName(req.query.name);
  if (!name || !req.body?.length) return res.status(400).json({ error: 'Envie um .zip válido' });
  fs19.saveMod(name, req.body);
  res.json({ ok: true, name });
});

/* ---------- painel ADM (a senha fica SÓ aqui no servidor) ---------- */
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip, f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 5 minutos.' });
  const given = typeof req.body?.password === 'string' ? req.body.password : '';
  const ok = crypto.timingSafeEqual(sha(given), sha(process.env.ADMIN_PASSWORD || '1020'));
  if (!ok) {
    f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60e3; f.n = 0; }
    fails.set(ip, f);
    return res.status(403).json({ error: 'Senha incorreta' });
  }
  fails.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, { exp: Date.now() + 8 * 3600e3 });
  res.json({ token });
});
/* ---------- sincronização com o PC onde o FS19 roda (usada pelo sync-save) ---------- */
app.put('/api/admin/save/:file', adminAuth, express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  if (!fs19.SAVE_FILES.includes(req.params.file) || !req.body?.length) return res.status(400).json({ error: 'Arquivo inválido' });
  try { fs19.saveSaveFile(req.params.file, req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/mod-admin', adminAuth, express.raw({ type: '*/*', limit: '1gb' }), (req, res) => {
  const name = path.basename(String(req.query.name || ''));
  if (!/^[A-Za-z][A-Za-z0-9_]*\.zip$/.test(name) || !req.body?.length) return res.status(400).json({ error: 'Nome de mod inválido' });
  fs19.saveMod(name, req.body); res.json({ ok: true, name });
});
app.get('/api/admin/mods', adminAuth, (req, res) => res.json({ mods: fs19.listVolumeMods() }));
app.put('/api/admin/modlist', adminAuth, (req, res) => { try { fs19.saveModList(req.body?.mods); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/admin/mods/:name', adminAuth, (req, res) => {
  paths.resolve();
  const name = path.basename(req.params.name);
  if (!fs19.listVolumeMods().some(m => m.name === name)) return res.status(404).json({ error: 'Mod não encontrado' });
  res.sendFile(path.join(process.env.MODS_PATH, name));
});
app.get('/api/admin/keys', adminAuth, (req, res) => res.json({ keys: keys.list() }));
app.post('/api/admin/keys', adminAuth, (req, res) => {
  const days = Math.max(0, parseInt(req.body?.days) || 0);
  res.json({ key: keys.create(days, String(req.body?.note || '').slice(0, 60)) });
});
app.post('/api/admin/keys/:key/:op', adminAuth, (req, res) => {
  const { key, op } = req.params;
  const fn = { reset: keys.reset, revoke: keys.revoke, activate: keys.activate }[op];
  if (!fn) return res.status(400).json({ error: 'Ação inválida' });
  if (!fn(key)) return res.status(404).json({ error: 'Key não encontrada' });
  if (op !== 'activate') dropSessions(key);
  res.json({ ok: true });
});
app.delete('/api/admin/keys/:key', adminAuth, (req, res) => {
  if (!keys.remove(req.params.key)) return res.status(404).json({ error: 'Key não encontrada' });
  dropSessions(req.params.key);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('API online na porta', PORT, paths.CLOUD ? '(modo nuvem, dados em ' + paths.DATA_DIR + ')' : '(modo PC)'));
if (paths.CLOUD && !process.env.ADMIN_PASSWORD) console.log('[AVISO] ADMIN_PASSWORD não definida: usando a senha padrão. Defina em Variables no Railway!');
if (paths.CLOUD && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) console.log('[AVISO] Sem Volume: keys e mods serão apagados a cada deploy.');
process.on('unhandledRejection', e => console.error('[aviso]', e && e.message || e));
process.on('uncaughtException', e => console.error('[aviso]', e && e.message || e));
if (!process.env.DISCORD_TOKEN) console.log('[aviso] DISCORD_TOKEN vazio no .env: o bot do Discord ficou desligado, mas a API do app continua funcionando.');
else { try { require('./bot')({ keys, fs19 }); } catch (e) { console.error('[aviso] O bot do Discord não iniciou:', e.message, '- a API continua no ar.'); } }
