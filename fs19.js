const fs = require('fs'), path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { enrich } = require('./equipment');
const paths = require('./paths');
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: n => ['vehicle', 'farm'].includes(n) });
const readXml = f => {
  paths.resolve();
  const file = path.join(process.env.SAVEGAME_PATH || '', f);
  try { return parser.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT' && paths.CLOUD) throw new Error('O servidor ainda não recebeu o save do jogo. No PC onde o FS19 roda, abra o sync-save.bat e deixe aberto.');
    if (e.code === 'ENOENT') throw new Error(`Não achei o save em "${file}". Abra o FS19 e salve o jogo uma vez, ou corrija SAVEGAME_PATH no .env (troque SEUUSER pelo seu usuário do Windows).`);
    throw e;
  }
};

function findAll(node, key, out = []) {
  if (node && typeof node === 'object') {
    if (Array.isArray(node)) node.forEach(n => findAll(n, key, out));
    else for (const [k, v] of Object.entries(node)) {
      if (k === key) (Array.isArray(v) ? v : [v]).forEach(x => out.push(x));
      findAll(v, key, out);
    }
  }
  return out;
}
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function nameOf(v) {
  const f = String(v.filename || '').split(/[\\/]/).pop().replace(/\.xml$/i, '');
  const b = f.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim();
  return b.charAt(0).toUpperCase() + b.slice(1);
}

let cache = null, cacheAt = 0;
function getState(fresh = false) {
  paths.resolve();
  if (!fresh && cache && Date.now() - cacheAt < 5000) return cache;
  const farmId = String(process.env.FARM_ID || 1);
  let farms = [];
  try { farms = readXml('farms.xml').farms.farm || []; } catch {}
  const farm = farms.find(f => String(f.farmId) === farmId) || {};
  const raw = readXml('vehicles.xml').vehicles?.vehicle || [];
  const vehicles = raw
    .filter(v => v.farmId === undefined || String(v.farmId) === farmId)
    .map(v => {
      const w = Array.isArray(v.wearable) ? v.wearable[0] : v.wearable;
      const fuel = [...findAll(v, 'unit'), ...findAll(v, 'fillUnitIndex')]
        .filter(u => /diesel/i.test(u.fillType || ''))
        .reduce((a, u) => a + (+u.fillLevel || 0), 0);
      return {
        id: v.id, name: nameOf(v), mod: v.modName || null, motorized: v.motorized !== undefined,
        hours: Math.round((+v.operatingTime || 0) / 360000) / 10,
        damage: +(w && w.damage) || 0,
        wear: avg(findAll(v, 'wearNode').map(n => +n.wearAmount || 0)),
        dirt: avg(findAll(v, 'dirtNode').map(n => +n.amount || 0)),
        fuel: Math.round(fuel), price: +v.price || 0, state: v.propertyState || 'OWNED',
      };
    });
  let list = vehicles;
  try { list = enrich(vehicles, raw); } catch (e) { console.error('equipamentos:', e.message); }
  cache = {
    farm: { name: farm.name || 'Minha fazenda', money: +farm.money || 0, loan: +farm.loan || 0 },
    vehicles: list, mods: listMods(), updatedAt: Date.now(),
  };
  cacheAt = Date.now();
  return cache;
}

function listMods() {
  paths.resolve();
  try {
    return fs.readdirSync(process.env.MODS_PATH)
      .filter(n => /\.zip$/i.test(n) || fs.statSync(path.join(process.env.MODS_PATH, n)).isDirectory())
      .map(n => ({ name: n, size: fs.statSync(path.join(process.env.MODS_PATH, n)).size }));
  } catch { return []; }
}
// FS19 exige nome de mod sem espaço/símbolo e começando por letra
function safeModName(raw) {
  const n = path.basename(String(raw || ''));
  if (!/\.zip$/i.test(n)) return null;
  let b = n.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
  if (!b) return null;
  if (!/^[A-Za-z]/.test(b)) b = 'mod_' + b;
  return b + '.zip';
}
function saveMod(name, buf) {
  paths.resolve();
  fs.mkdirSync(process.env.MODS_PATH, { recursive: true });
  fs.writeFileSync(path.join(process.env.MODS_PATH, name), buf);
}
// Recebe um arquivo do save enviado pelo PC (só farms.xml e vehicles.xml; escrita atômica)
const SAVE_FILES = ['farms.xml', 'vehicles.xml'];
function saveSaveFile(name, buf) {
  if (!SAVE_FILES.includes(name)) throw new Error('Arquivo não permitido');
  paths.resolve();
  fs.mkdirSync(process.env.SAVEGAME_PATH, { recursive: true });
  const dest = path.join(process.env.SAVEGAME_PATH, name), tmp = dest + '.tmp';
  fs.writeFileSync(tmp, buf); fs.renameSync(tmp, dest);
  cache = null;
}
module.exports = { getState, listMods, safeModName, saveMod, saveSaveFile, SAVE_FILES };
