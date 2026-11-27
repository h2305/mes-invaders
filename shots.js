/* Lecture des captures d'écran de la galerie Flash Invaders.
   Repère la grille de 3 colonnes, lit l'étiquette (ex. PA_1234) en bas à droite de chaque case,
   et découpe la photo des cases entièrement visibles. Tout se fait sur l'appareil. */
window.ShotImport = (() => {
'use strict';

async function fileToImageData(file) {
  let src;
  if (window.createImageBitmap) {
    try { src = await createImageBitmap(file); } catch (e) { src = null; }
  }
  if (!src) {
    src = await new Promise((res, rej) => {
      const u = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('image')); };
      im.src = u;
    });
  }
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  if (src.close) src.close();
  return { canvas: c, img: ctx.getImageData(0, 0, c.width, c.height) };
}

function runs(arr) {
  const out = [];
  let s = null, p = null;
  for (const v of arr) {
    if (s === null) { s = p = v; }
    else if (v === p + 1) p = v;
    else { out.push([s, p]); s = p = v; }
  }
  if (s !== null) out.push([s, p]);
  return out;
}

// ---- Grille ----
function findGrid(img) {
  const { data, width: W, height: H } = img;
  const sum = (x, y) => { const i = (y * W + x) * 4; return data[i] + data[i + 1] + data[i + 2]; };
  const dark = (x, y) => sum(x, y) < 75;
  const y0 = Math.round(H * .12), y1 = Math.round(H * .85);
  const colFrac = x => { let n = 0, t = 0; for (let y = y0; y < y1; y += 5) { t++; if (dark(x, y)) n++; } return n / t; };
  function sep(xa, xb) {
    let best = -1, bx = -1;
    for (let x = xa; x <= xb; x++) { const f = colFrac(x); if (f > best) { best = f; bx = x; } }
    if (best < .75) return null;
    let a = bx, b = bx;
    while (a > xa && colFrac(a - 1) > .6) a--;
    while (b < xb && colFrac(b + 1) > .6) b++;
    return [a, b];
  }
  const s1 = sep(Math.round(W * .26), Math.round(W * .41));
  const s2 = sep(Math.round(W * .59), Math.round(W * .74));
  if (!s1 || !s2) return null;
  const cols = [[0, s1[0]], [s1[1] + 1, s2[0]], [s2[1] + 1, W]];
  const cw = (s2[0] - s1[1] - 1);
  if (cw < W * .28 || cw > W * .36) return null;

  // Lignes horizontales sombres traversant les 3 colonnes
  const xs = [];
  for (const [a, b] of cols) for (let k = 1; k <= 10; k++) xs.push(Math.round(a + (b - a) * k / 11));
  const lineRows = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (const x of xs) if (dark(x, y)) n++;
    if (n >= xs.length * .9) lineRows.push(y);
  }
  const lines = runs(lineRows).filter(([a]) => a > H * .03);

  // Haut de la grille : premières lignes où les séparateurs verticaux sont sombres mais leurs voisins non
  let top = 0;
  const off = Math.max(6, Math.round(cw * .03));
  let streak = 0;
  for (let y = Math.round(H * .04); y < H * .5; y++) {
    let ok = 0;
    for (const s of [s1, s2]) {
      const mid = (s[0] + s[1]) >> 1;
      if (dark(mid, y) && (!dark(s[0] - off, y) || !dark(s[1] + off, y))) ok++;
    }
    streak = ok === 2 ? streak + 1 : 0;
    if (streak >= 12) { top = y - 11; break; }
  }
  return { W, H, cols, cw, lines, top };
}

// ---- Étiquette ----
function extractLabel(img, xa, xb, yb, cw) {
  const { data, width: W } = img;
  const rx0 = Math.round(xa + (xb - xa) * .3), rx1 = xb;
  const ry0 = Math.max(0, Math.round(yb - cw * .2)), ry1 = yb;
  const w = rx1 - rx0, h = ry1 - ry0;
  if (w <= 0 || h <= 0) return null;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((ry0 + y) * W + rx0 + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    if (mn >= 150 && mx - mn < 60) m[y * w + x] = 1;
  }
  // Fermeture d'1 px : la mise à l'échelle laisse des lignes grisées entre les blocs d'un même caractère
  const md = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) md[ny * w + nx] = 1;
    }
  }
  // Composantes connexes
  const lab = new Int32Array(w * h);
  const comps = [];
  const stack = [];
  for (let p = 0; p < w * h; p++) {
    if (!md[p] || lab[p]) continue;
    const id = comps.length + 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    stack.push(p); lab[p] = id;
    while (stack.length) {
      const q = stack.pop(), qx = q % w, qy = (q / w) | 0;
      n++;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      // 8-connexité : les polices pixel ont des marches en diagonale
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (md[r] && !lab[r]) { lab[r] = id; stack.push(r); }
      }
    }
    comps.push({ id, x0, y0, x1, y1, n, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  const gh = c => c.h >= cw * .035 && c.h <= cw * .09 && c.w <= cw * .085 && c.w >= cw * .004;
  const glyphs = comps.filter(gh);
  if (glyphs.length < 3) return null;
  // Groupe principal : même hauteur de ligne, le plus à droite
  glyphs.sort((a, b) => b.x1 - a.x1);
  const tol = Math.max(3, cw * .012);
  let best = null;
  for (const g of glyphs) {
    const row = glyphs.filter(o => Math.abs(o.y0 - g.y0) <= tol && Math.abs(o.y1 - g.y1) <= tol);
    if (row.length >= 3 && (!best || row.length > best.length || (row.length === best.length && g.x1 > best[0].x1))) best = row;
  }
  if (!best) return null;
  best.sort((a, b) => b.x1 - a.x1);
  const chain = [best[0]];
  const gap = cw * .1;
  for (let i = 1; i < best.length; i++) {
    if (chain[chain.length - 1].x0 - best[i].x1 <= gap) chain.push(best[i]);
    else break;
  }
  if (chain.length < 3) return null;
  const ty0 = Math.min(...chain.map(c => c.y0)), ty1 = Math.max(...chain.map(c => c.y1));
  if (ty1 > h - cw * .04) return null;
  const tx0 = Math.min(...chain.map(c => c.x0)), tx1 = Math.max(...chain.map(c => c.x1));
  // Tiret bas : composante plate sous la ligne de base, entre les glyphes
  const keep = new Set(chain.map(c => c.id));
  for (const c of comps) {
    if (keep.has(c.id)) continue;
    if (c.h <= cw * .025 && c.w >= cw * .015 && c.w <= cw * .08 && c.x0 >= tx0 - 2 && c.x1 <= tx1 + 2 && c.y1 >= ty1 - tol && c.y0 <= ty1 + tol) keep.add(c.id);
  }
  // Glyphes dans l'ordre de lecture, échantillonnés sur une grille 8x10
  const all = comps.filter(c => keep.has(c.id)).sort((a, b) => a.x0 - b.x0);
  const glyphs2 = [];
  for (const c of all) {
    const flat = c.h <= cw * .025;
    if (flat) { glyphs2.push({ ch: '_', flat: true }); continue; }
    const GW = 8, GH = 10, v = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const sx0 = c.x0 + Math.floor(gx * c.w / GW), sx1 = c.x0 + Math.max(Math.floor(gx * c.w / GW) + 1, Math.floor((gx + 1) * c.w / GW));
      const sy0 = c.y0 + Math.floor(gy * c.h / GH), sy1 = c.y0 + Math.max(Math.floor(gy * c.h / GH) + 1, Math.floor((gy + 1) * c.h / GH));
      let n = 0, t = 0;
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { t++; if (m[y * w + x] && lab[y * w + x] === c.id) n++; }
      v[gy * GW + gx] = t ? n / t : 0;
    }
    glyphs2.push({ v, aspect: c.w / c.h });
  }
  // Vignette de l'étiquette en couleur (pour la vérification à l'écran)
  const pad = Math.round((ty1 - ty0) * .5);
  const lx = Math.max(0, rx0 + tx0 - pad), ly = Math.max(0, ry0 + ty0 - pad);
  const lw = Math.min(img.width - lx, tx1 - tx0 + 1 + pad * 2), lh = Math.min(img.height - ly, ty1 - ty0 + 1 + pad * 2);
  return { glyphs: glyphs2, rect: [lx, ly, lw, lh] };
}

function cropCanvas(src, x, y, w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

// Analyse d'une capture : liste des cases avec étiquette lisible
async function analyze(file) {
  const { canvas, img } = await fileToImageData(file);
  const g = findGrid(img);
  if (!g) return { ok: false, cells: [] };
  const cells = [];
  let prevEnd = -1e9;
  const seen = [];
  for (const [ly, le] of g.lines) {
    const yb = ly; // bas de case = début de la ligne sombre
    const afterLine = yb - prevEnd < g.cw * .05;
    prevEnd = le;
    if (afterLine || yb < g.top + g.cw * .2) continue;
    for (const [xa, xb] of g.cols) {
      const col = g.cols.findIndex(c => c[0] === xa);
      if (seen.some(s => s.col === col && Math.abs(s.yb - yb) < g.cw * .1)) continue;
      const label = extractLabel(img, xa, xb, yb, g.cw);
      if (!label || label.rect[1] < g.top) continue;
      seen.push({ col, yb });
      const cellTop = yb - (xb - xa);
      const visTop = Math.max(cellTop, g.top);
      const full = visTop - cellTop <= g.cw * .03;
      cells.push({
        label, yb, col,
        labelImg: () => cropCanvas(canvas, ...label.rect, 240),
        visible: (yb - visTop) / (xb - xa),
        photo: full ? () => cropCanvas(canvas, xa, Math.max(0, cellTop), xb - xa, xb - xa, 640) : null
      });
    }
  }
  return { ok: true, cells };
}

// ---- Reconnaissance des caractères (police pixel de Flash Invaders) ----
// Modèles moyens tirés de vraies captures. Chaque modèle : rapport largeur/hauteur + densités 8x10 (0-f).
const BASE = {"0":{"a":0.757,"v":"0088884015ffffa38f1000ba8f102ffa8f15a5da8f48e0ba8ff900ba8f6300ba36aaaaa300aaaa50"},"1":{"a":0.751,"v":"00046000005bc00001ffc0008f29c0003509c0000009c0000009c0000009c0005aadeaa75aaaaaa7"},"2":{"a":0.757,"v":"0088884015ffffa38f1000ba010000ba0005aa930007ff7000f900006f6300008faaaaa65aaaaaa6"},"3":{"a":0.754,"v":"488888856ffffffa000000ba00002f800005bf800007ff80000000ba6f0000ba36aaaa9300aaaa50"},"4":{"a":0.756,"v":"0000284000027f700008ff7000fa5f705a633f708f425f818ffffffa25557fa300003f7000002a50"},"5":{"a":0.755,"v":"488888858ffffffa8f1000008f10000035aaaa5000ffff81000000ba7f0000ba36aaaa9300aaaa50"},"6":{"a":0.757,"v":"00048885005bfff900f900008f2000008faaaa408fffff818f0000ba8f1000ba36aaaa9300aaaa40"},"7":{"a":0.754,"v":"488888856ffffffa000000ba00003f70000595200018d00000f9000000f9000000f9000000a70000"},"8":{"a":0.756,"v":"0088884015ffffa38f0000ba8f0000ba35aaaa9302ffff918f1000ba8f1000ba36aaaa9300aaaa50"},"9":{"a":0.755,"v":"0088884015ffffa38f0000ba8f0000ba35aaaada00fffffa000000ba00002fa35aaaa6305aaa9000"},"A":{"a":0.755,"v":"00047000005ae52001f93f708f2001b98f0000ba8f3121ba8ffffffa8f5555ca8f0000ba5a000077"},"P":{"a":0.755,"v":"488888408fffff938f0000ba8f0000ba8faaaa838fffff608f1000008f0000008f1000005a000000"}};
const LEARN_KEY = 'mi-glyphs-v1';
const decode = t => ({ a: t.a, v: Float32Array.from(t.v, ch => parseInt(ch, 16) / 15) });
const encode = g => ({ a: +g.aspect.toFixed(3), v: Array.from(g.v, x => Math.round(x * 15).toString(16)).join('') });
function loadLearned() {
  try { return JSON.parse(localStorage.getItem(LEARN_KEY) || '{}'); } catch (e) { return {}; }
}
let MODELS = null;
function models() {
  if (MODELS) return MODELS;
  MODELS = [];
  for (const [ch, t] of Object.entries(BASE)) MODELS.push({ ch, ...decode(t) });
  for (const [ch, list] of Object.entries(loadLearned())) for (const t of list) MODELS.push({ ch, ...decode(t) });
  return MODELS;
}
function dist(g, m) {
  let d = 0;
  for (let i = 0; i < g.v.length; i++) { const e = g.v[i] - m.v[i]; d += e * e; }
  const da = g.aspect - m.a;
  return d / g.v.length + da * da * .5;
}
const MAX_D = 0.04;
function readGlyph(g) {
  let best = null, bd = Infinity;
  for (const m of models()) { const d = dist(g, m); if (d < bd) { bd = d; best = m.ch; } }
  return { ch: best, d: bd };
}
function readLabel(label, knownCities) {
  let text = '', worst = 0;
  for (const g of label.glyphs) {
    if (g.flat) { text += '_'; continue; }
    const r = readGlyph(g);
    worst = Math.max(worst, r.d);
    text += r.d <= MAX_D ? r.ch : '?';
  }
  const m = /^([A-Z]{1,5})_(\d{1,4})$/.exec(text);
  const key = m && knownCities.has(m[1]) ? m[1] + '_' + parseInt(m[2], 10) : null;
  return { text, key, worst };
}
// Apprend les caractères d'une étiquette corrigée à la main (ex. une nouvelle ville)
function learn(label, code) {
  const chars = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const gl = label.glyphs.filter(g => !g.flat);
  if (gl.length !== chars.length) return false;
  const L = loadLearned();
  gl.forEach((g, i) => {
    const ch = chars[i];
    if (readGlyph(g).ch === ch && readGlyph(g).d <= MAX_D / 2) return;
    (L[ch] = L[ch] || []).push(encode(g));
    if (L[ch].length > 6) L[ch].shift();
  });
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(L)); } catch (e) { /* facultatif */ }
  MODELS = null;
  return true;
}

return { _encode: encode, analyze, readLabel, learn };
})();
