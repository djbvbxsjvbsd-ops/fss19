// Define onde ficam os dados (keys, canais, save e mods).
// - Na nuvem (Railway): tudo dentro de DATA_DIR (um Volume montado, ex.: /data). O save é enviado pelo PC com o sync-save.
// - No PC (modo antigo): descobre sozinho a pasta do save e a pasta mods do FS19.
const fs = require('fs'), path = require('path'), os = require('os');
let last = 0;

// Railway define RAILWAY_VOLUME_MOUNT_PATH quando existe um Volume anexado.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const CLOUD = !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.RAILWAY_ENVIRONMENT || process.env.CLOUD_MODE);

function bases() {
  const h = os.homedir();
  const docs = [path.join(h, 'Documents'), path.join(h, 'Documentos'), path.join(h, 'OneDrive', 'Documents'), path.join(h, 'OneDrive', 'Documentos')];
  if (process.env.OneDrive) docs.push(path.join(process.env.OneDrive, 'Documents'), path.join(process.env.OneDrive, 'Documentos'));
  return [...new Set(docs)].map(d => path.join(d, 'My Games', 'FarmingSimulator2019'));
}

function resolve() {
  if (Date.now() - last < 10000) return;
  last = Date.now();
  if (CLOUD) {   // na nuvem não existe FS19 instalado: usa as pastas do volume
    process.env.SAVEGAME_PATH = path.join(DATA_DIR, 'savegame');
    process.env.MODS_PATH = path.join(DATA_DIR, 'mods');
    return;
  }
  const saveOk = p => p && fs.existsSync(path.join(p, 'vehicles.xml'));
  if (!saveOk(process.env.SAVEGAME_PATH)) {
    let best = null, bt = 0;
    for (const base of bases()) {
      let dirs = [];
      try { dirs = fs.readdirSync(base).filter(d => /^savegame\d+$/.test(d)); } catch { continue; }
      for (const d of dirs) {
        try { const t = fs.statSync(path.join(base, d, 'vehicles.xml')).mtimeMs; if (t > bt) { bt = t; best = path.join(base, d); } } catch {}
      }
    }
    if (best) { process.env.SAVEGAME_PATH = best; console.log('[auto] Savegame encontrado:', best); }
  }
  if (!process.env.MODS_PATH || !fs.existsSync(process.env.MODS_PATH)) {
    const m = bases().map(b => path.join(b, 'mods')).find(p => fs.existsSync(p));
    if (m) { process.env.MODS_PATH = m; console.log('[auto] Pasta mods encontrada:', m); }
  }
}
module.exports = { resolve, DATA_DIR, CLOUD, bases };
