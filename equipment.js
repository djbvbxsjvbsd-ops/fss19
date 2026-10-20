// Classificação de equipamentos FS19: categoria, função e recomendação de trator.
// A categoria vem do XML do veículo (jogo base em GAME_PATH ou ZIP do mod em MODS_PATH).
const fs = require('fs'), path = require('path');
const { XMLParser } = require('fast-xml-parser');
const AdmZip = require('adm-zip');

const X = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: n => n === 'text' });

// cv mínimo típico quando o XML não informa a potência exigida. self = autopropelido (não usa trator)
const RULES = [
  { re: /tractor/, id: 'trator', label: 'Trator', fn: 'Máquina base: puxa e aciona todos os implementos.', hp: 0, tractor: true },
  { re: /plow/, id: 'arado', label: 'Arado', fn: 'Vira e afofa a terra antes do plantio, enterrando restos de cultura e ervas daninhas.', hp: 200, tip: 'Exige muita tração: prefira trator pesado com lastro.' },
  { re: /subsoil/, id: 'subsolador', label: 'Subsolador', fn: 'Rompe camadas compactadas profundas do solo.', hp: 220, tip: 'Trabalha fundo: precisa de muita força de tração.' },
  { re: /discharrow|disc/, id: 'grade', label: 'Grade de discos', fn: 'Prepara o solo e incorpora a palha; alternativa mais rápida ao arado.', hp: 160, tip: 'Trator médio-pesado rende melhor que um leve.' },
  { re: /cultivat/, id: 'cultivador', label: 'Cultivador', fn: 'Revolve a camada superficial e prepara a cama de semeadura.', hp: 140, tip: 'Trator médio resolve na maioria dos casos.' },
  { re: /harrow/, id: 'grade_rot', label: 'Grade rotativa', fn: 'Afina o solo para a semeadura, deixando a superfície nivelada.', hp: 110 },
  { re: /seeder|drill/, id: 'semeadeira', label: 'Semeadeira', fn: 'Planta grãos e sementes finas (trigo, cevada, canola, soja).', hp: 110, tip: 'Peso com a carga cheia pede trator médio.' },
  { re: /planter/, id: 'plantadeira', label: 'Plantadeira', fn: 'Planta culturas em linha (milho, girassol, beterraba, batata).', hp: 100 },
  { re: /sprayer/, id: 'pulverizador', label: 'Pulverizador', fn: 'Aplica fertilizante líquido, herbicida e defensivos.', hp: 90, tip: 'Mais leve; trator leve a médio com pneus estreitos poupa a lavoura.' },
  { re: /manure|slurry/, id: 'esterco', label: 'Esterqueira / espalhador', fn: 'Espalha esterco e chorume, adubando o solo.', hp: 150, tip: 'Tanque cheio é pesado: trator médio-pesado.' },
  { re: /spreader|fertili|lime/, id: 'espalhador', label: 'Espalhador de fertilizante', fn: 'Distribui fertilizante sólido e calcário.', hp: 100 },
  { re: /weeder|hoe/, id: 'capinadeira', label: 'Capinadeira', fn: 'Controla ervas daninhas mecanicamente, sem herbicida.', hp: 90 },
  { re: /roller/, id: 'rolo', label: 'Rolo', fn: 'Compacta e nivela o solo após a semeadura.', hp: 100 },
  { re: /stone/, id: 'pedras', label: 'Removedor de pedras', fn: 'Tira pedras do campo e protege as lâminas das máquinas.', hp: 120 },
  { re: /mulch/, id: 'mulcher', label: 'Triturador', fn: 'Tritura restos de cultura e vegetação.', hp: 130 },
  { re: /mower/, id: 'ceifadeira', label: 'Ceifadeira', fn: 'Corta capim para silagem e feno.', hp: 80, tip: 'Trator leve basta para a maioria dos modelos.' },
  { re: /tedder/, id: 'ancinho', label: 'Revirador de feno', fn: 'Espalha e vira o capim cortado para secar.', hp: 70 },
  { re: /windrow|rake/, id: 'leira', label: 'Enleirador', fn: 'Junta o capim em leiras para a enfardadeira.', hp: 80 },
  { re: /wrapper/, id: 'envolvedora', label: 'Envolvedora de fardos', fn: 'Envolve fardos em filme plástico para fazer silagem.', hp: 70 },
  { re: /baler/, id: 'enfardadeira', label: 'Enfardadeira', fn: 'Compacta feno, palha e silagem em fardos.', hp: 120, tip: 'Fardos grandes pedem trator médio.' },
  { re: /cutter|header/, id: 'plataforma', label: 'Plataforma / cabeçote', fn: 'Acessório de corte para colheitadeiras e forrageiras.', hp: 0, self: true },
  { re: /combine|harvest|forager|forage/, id: 'colheitadeira', label: 'Colheitadeira', fn: 'Colhe e processa a cultura no campo.', hp: 0, self: true },
  { re: /augerwagon|loaderwagon|trailer|wagon/, id: 'carreta', label: 'Carreta / reboque', fn: 'Transporta grãos, silagem, fardos e materiais.', hp: 140, tip: 'Cheia, exige trator médio-pesado com bom freio.' },
  { re: /frontloader|loader|tele|skid/, id: 'carregadeira', label: 'Carregadeira / manipulador', fn: 'Carrega e movimenta fardos, paletes e materiais.', hp: 0, self: true },
  { re: /truck/, id: 'caminhao', label: 'Caminhão', fn: 'Transporte rodoviário de carga.', hp: 0, self: true },
];
const FALLBACK = { id: 'outro', label: 'Implemento', fn: 'Equipamento acoplável ao trator.', hp: 100 };

const nameHints = [[/plow|arado|titan|diamant|juwel|vari/i, 'plow'], [/seeder|drill|solitair|primera/i, 'seeder'],
  [/sprayer/i, 'sprayer'], [/cultivator|grubber|kultivator/i, 'cultivat'], [/mower|disc ?mower/i, 'mower'],
  [/baler/i, 'baler'], [/trailer|wagon/i, 'trailer'], [/combine|harvester/i, 'combine']];

const cache = new Map(), zips = new Map();
const loc = v => (v && typeof v === 'object') ? (v.en || v.de || Object.values(v).find(x => typeof x === 'string')) : v;

function readXml(v) {
  const file = String(v.filename || '').replace(/\\/g, '/');
  const mod = v.modName;
  try {
    if (mod && process.env.MODS_PATH) {
      const rel = file.replace(/^\$moddir\$[^/]*\//, '').replace(/^.*\/mods\/[^/]+\//i, '');
      const zp = path.join(process.env.MODS_PATH, mod + '.zip');
      if (fs.existsSync(zp)) {
        if (!zips.has(zp)) zips.set(zp, new AdmZip(zp));
        const z = zips.get(zp), e = z.getEntry(rel);
        if (!e) return null;
        let l10n = {};
        const md = z.getEntry('modDesc.xml');
        if (md) for (const t of X.parse(md.getData().toString('utf8')).modDesc?.l10n?.text || []) l10n[t['@name']] = loc(t);
        return { text: e.getData().toString('utf8'), l10n };
      }
      const fp = path.join(process.env.MODS_PATH, mod, rel);
      if (fs.existsSync(fp)) return { text: fs.readFileSync(fp, 'utf8'), l10n: {} };
    } else {
      const game = process.env.GAME_PATH || [
        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Farming Simulator 19', 'C:\\Program Files\\Farming Simulator 19',
      ].find(p => fs.existsSync(p));
      if (game) {
        const fp = path.join(game, file.replace(/^\$data\//, 'data/'));
        if (fs.existsSync(fp)) return { text: fs.readFileSync(fp, 'utf8'), l10n: {} };
      }
    }
  } catch {}
  return null;
}

// Retorna { name, brand, category (texto cru), needKw (potência exigida em kW, se existir) }
function inspect(v) {
  const ck = (v.modName || '') + '|' + v.filename;
  if (cache.has(ck)) return cache.get(ck);
  const out = { name: null, brand: null, category: '', needKw: 0 };
  const r = readXml(v);
  if (r) {
    try {
      const root = X.parse(r.text).vehicle || {};
      const sd = root.storeData || {};
      let n = loc(sd.name);
      if (typeof n === 'string' && n.startsWith('$l10n_')) n = r.l10n[n.slice(6)] || null;
      out.name = typeof n === 'string' && !n.startsWith('$') ? n : null;
      out.brand = typeof sd.brand === 'string' ? sd.brand : null;
      out.category = String(sd.category || '').trim();
      const sp = sd.specs?.neededPower;
      const kw = parseFloat(root.powerConsumer?.['@neededMinPower'] ?? (typeof sp === 'object' ? sp['@minPower'] : sp));
      if (Number.isFinite(kw)) out.needKw = kw;
    } catch {}
  }
  cache.set(ck, out);
  return out;
}

function classify(v, info, nameGuess) {
  let key = info.category.toLowerCase();
  if (!key) {
    const h = nameHints.find(([re]) => re.test(v.filename + ' ' + nameGuess));
    key = h ? h[1] : (v.motorized ? 'tractor' : '');
  }
  const rule = RULES.find(r => r.re.test(key)) || (v.motorized ? RULES[0] : FALLBACK);
  return rule;
}

// Estimativa de potência dos seus tratores pelo preço de tabela (aproximação).
const hpFromPrice = p => (p < 70000 ? 110 : p < 160000 ? 200 : 320);

function enrich(vehicles, raw) {
  const byId = new Map(raw.map(r => [String(r.id), r]));
  const list = vehicles.map(v => {
    const r = byId.get(String(v.id)) || {};
    const info = inspect(r);
    const rule = classify({ ...r, motorized: v.motorized }, info, v.name);
    const name = info.name || v.name;
    const isTractor = !!rule.tractor && v.motorized;
    const needHp = info.needKw ? Math.round(info.needKw * 1.36) : rule.hp;
    return { ...v, name, brand: info.brand, category: rule.label, catId: rule.id, fn: rule.fn, tip: rule.tip || '',
      isTractor, selfPropelled: !!rule.self, needHp, hpEst: isTractor ? hpFromPrice(v.price) : 0, rec: null };
  });
  const tractors = list.filter(v => v.isTractor).sort((a, b) => a.hpEst - b.hpEst);
  for (const v of list) {
    if (v.isTractor || v.selfPropelled || v.motorized) continue;
    const ok = tractors.filter(t => t.hpEst >= v.needHp);
    const best = ok.slice(0, 3).map(t => ({ id: t.id, name: t.name, hp: t.hpEst }));
    v.rec = best.length
      ? { ok: true, best, text: `Melhor encaixe entre os seus: ${best[0].name}.` }
      : { ok: false, best: [], text: `Nenhum dos seus tratores atende bem (precisa de ~${v.needHp} cv ou mais).` };
  }
  return list;
}

module.exports = { enrich };
