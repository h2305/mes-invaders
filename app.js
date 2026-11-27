/* Mes Invaders : carte de collection + invaders restants autour de moi.
   Tout est stocké sur l'appareil (IndexedDB). */
(() => {
'use strict';

// ---------- Référentiel ----------
const CITY_NAMES = {
  PA: 'Paris', NY: 'New York', LA: 'Los Angeles', LDN: 'Londres', TK: 'Tokyo', HK: 'Hong Kong',
  MARS: 'Marseille', MIA: 'Miami', ROM: 'Rome', BAB: 'Bayonne-Anglet-Biarritz', DJBA: 'Djerba',
  GRN: 'Grenoble', AIX: 'Aix-en-Provence', AMS: 'Amsterdam', AVI: 'Avignon', BBO: 'Bilbao',
  BGK: 'Bangkok', BSL: 'Bâle', BXL: 'Bruxelles', FKF: 'Francfort', GNV: 'Genève', IST: 'Istanbul',
  KAT: 'Katmandou', LIL: 'Lille', LJU: 'Ljubljana', LY: 'Lyon', MAN: 'Manchester', MLB: 'Melbourne',
  MLGA: 'Malaga', MPL: 'Montpellier', MRAK: 'Marrakech', MUN: 'Munich', PRT: 'Perth', RA: 'Ravenne',
  RTD: 'Rotterdam', SD: 'San Diego', SP: 'São Paulo', TLS: 'Toulouse', VRS: 'Versailles', WN: 'Vienne',
  LSN: 'Lausanne', NCL: 'Newcastle', MBSA: 'Mombasa', REUN: 'La Réunion', PAU: 'Pau', NIM: 'Nîmes',
  ORLN: 'Orléans', SPACE: 'Espace'
};
const STATUS = { ok: 'En place', damaged: 'Abîmé', destroyed: 'Détruit', hidden: 'Caché', unknown: 'Inconnu' };
const cityName = c => CITY_NAMES[c] || c;
const keyOf = id => {
  const m = /^([A-Za-z]+)[ _\-]?0*(\d+)$/.exec(String(id).trim());
  return m ? m[1].toUpperCase() + '_' + parseInt(m[2], 10) : String(id).trim().toUpperCase();
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const fmtN = n => n.toLocaleString('fr-FR');
const fmtDist = m => {
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  const km = m / 1000;
  return (Number.isInteger(km) || km >= 10 ? Math.round(km) : km.toFixed(1).replace('.', ',')) + ' km';
};

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearing(a, b) {
  const toR = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
  const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
  const deg = (Math.atan2(y, x) / toR + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}

// ---------- Stockage local (IndexedDB, repli mémoire) ----------
const store = (() => {
  const mem = { kv: new Map(), photos: new Map(), thumbs: new Map() };
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('mes-invaders', 1);
        r.onupgradeneeded = () => ['kv', 'photos', 'thumbs'].forEach(n => r.result.createObjectStore(n));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
    return dbp;
  }
  async function run(name, mode, fn) {
    const db = await open();
    if (!db) return fn(null, mem[name]);
    return new Promise((res, rej) => {
      const t = db.transaction(name, mode);
      const req = fn(t.objectStore(name));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const memOp = (op) => (s, m) => op(m);
  return {
    get: (n, k) => run(n, 'readonly', (s, m) => s ? s.get(k) : { result: m.get(k) }),
    put: (n, k, v) => run(n, 'readwrite', (s, m) => s ? s.put(v, k) : (m.set(k, v), null)),
    del: (n, k) => run(n, 'readwrite', (s, m) => s ? s.delete(k) : (m.delete(k), null)),
    clear: (n) => run(n, 'readwrite', (s, m) => s ? s.clear() : (m.clear(), null)),
    keys: (n) => run(n, 'readonly', (s, m) => s ? s.getAllKeys() : { result: [...m.keys()] }),
    entries: async (n) => {
      const db = await open();
      if (!db) return [...mem[n].entries()];
      return new Promise((res, rej) => {
        const out = [];
        const t = db.transaction(n, 'readonly');
        const c = t.objectStore(n).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
      });
    },
    ok: async () => !!(await open()),
    _memOp: memOp
  };
})();

// ---------- État ----------
const S = {
  all: [], byKey: new Map(), cities: new Map(),
  flashed: new Set(), thumbs: new Map(),
  near: false, radius: 1000, showDead: false, collapsed: false,
  me: null, meAccuracy: null, nearOrigin: null, nearIsMapCenter: false,
  current: null
};
try {
  const p = JSON.parse(localStorage.getItem('mi-prefs') || '{}');
  if (p.radius) S.radius = p.radius;
  if (typeof p.showDead === 'boolean') S.showDead = p.showDead;
} catch (e) { /* préférences facultatives */ }
const savePrefs = () => { try { localStorage.setItem('mi-prefs', JSON.stringify({ radius: S.radius, showDead: S.showDead })); } catch (e) { /* rien */ } };
const saveFlashed = () => store.put('kv', 'flashed', [...S.flashed]).catch(() => toast("Impossible d'enregistrer sur cet appareil."));

// ---------- Carte ----------
const map = L.map('map', { zoomControl: false, worldCopyJump: true, tap: true }).setView([48.8566, 2.3522], 12);
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
let tiles = null;
function setTiles() {
  if (tiles) map.removeLayer(tiles);
  const style = darkMQ.matches ? 'dark_all' : 'rastertiles/voyager';
  tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    subdomains: 'abcd', maxZoom: 20, detectRetina: false,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  }).addTo(map);
}
setTiles();
darkMQ.addEventListener?.('change', setTiles);

const flashedLayer = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 48, spiderfyDistanceMultiplier: 1.6,
  disableClusteringAtZoom: 18,
  iconCreateFunction: c => {
    const n = c.getChildCount();
    const big = n >= 100;
    return L.divIcon({ html: `<div class="clu${big ? ' l' : ''}">${n}</div>`, className: '', iconSize: big ? [48, 48] : [40, 40] });
  }
}).addTo(map);
const nearLayer = L.layerGroup().addTo(map);
let radiusCircle = null, meMarker = null, meAcc = null;

function flashedIcon(inv) {
  const th = S.thumbs.get(inv.key);
  if (th) return L.divIcon({ className: '', html: `<div class="mk photo"><img src="${th}" alt=""></div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
  return L.divIcon({ className: '', html: '<div class="mk"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
}
function todoIcon(inv, pulse) {
  const dead = inv.status === 'destroyed';
  return L.divIcon({ className: '', html: `<div class="mk-todo${dead ? ' dead' : ''}${pulse ? ' pulse' : ''}"></div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}

const flashedMarkers = new Map();
function renderFlashed() {
  flashedLayer.clearLayers();
  flashedMarkers.clear();
  const ms = [];
  for (const k of S.flashed) {
    const inv = S.byKey.get(k);
    if (!inv || inv.lat == null) continue;
    const m = L.marker([inv.lat, inv.lng], { icon: flashedIcon(inv), title: inv.id, keyboard: true });
    m.on('click', () => openDetail(inv));
    flashedMarkers.set(k, m);
    ms.push(m);
  }
  flashedLayer.addLayers(ms);
}

// ---------- Statistiques ----------
function stats() {
  let pts = 0;
  const cities = new Set();
  for (const k of S.flashed) {
    const inv = S.byKey.get(k);
    if (inv) { pts += inv.points || 0; cities.add(inv.city); } else cities.add(k.split('_')[0]);
  }
  return { n: S.flashed.size, pts, cities: cities.size };
}
function renderStats() {
  const s = stats();
  $('statFlashed').textContent = fmtN(s.n);
  $('statPoints').textContent = fmtN(s.pts);
}

// ---------- Autour de moi ----------
let watchId = null;
function setNear(on) {
  S.near = on;
  $('nearToggle').setAttribute('aria-pressed', String(on));
  $('nearBody').hidden = !on;
  $('nearCollapse').hidden = !on;
  $('nearPanel').classList.toggle('collapsed', on && S.collapsed);
  if (on) {
    $('nearLabel').textContent = 'Localisation…';
    startWatch(true);
  } else {
    $('nearLabel').textContent = 'Invaders restants autour de moi';
    nearLayer.clearLayers();
    if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
    S.nearOrigin = null;
  }
}

function startWatch(fitAfter) {
  if (!('geolocation' in navigator)) { useMapCenter('La localisation n’est pas disponible.'); return; }
  let first = true;
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    const p = [pos.coords.latitude, pos.coords.longitude];
    const moved = !S.me || haversine(S.me, p) > 20;
    S.me = p; S.meAccuracy = pos.coords.accuracy;
    drawMe();
    if (S.near && (first || moved || S.nearIsMapCenter)) {
      S.nearIsMapCenter = false;
      S.nearOrigin = p;
      renderNear(first && fitAfter);
    }
    first = false;
  }, err => {
    const why = err.code === 1
      ? 'Localisation refusée. Active-la dans Réglages › Confidentialité › Service de localisation › Safari.'
      : 'Position introuvable pour l’instant.';
    if (S.near && !S.nearOrigin) useMapCenter(why);
    else toast(why);
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}

function useMapCenter(msg) {
  if (msg) toast(msg + ' J’utilise le centre de la carte.');
  const c = map.getCenter();
  S.nearOrigin = [c.lat, c.lng];
  S.nearIsMapCenter = true;
  renderNear(true);
}

function drawMe() {
  if (!S.me) return;
  if (!meMarker) {
    meMarker = L.marker(S.me, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    meAcc = L.circle(S.me, { radius: S.meAccuracy || 20, stroke: false, fillOpacity: .08, fillColor: getVar('--ink'), interactive: false }).addTo(map);
  } else {
    meMarker.setLatLng(S.me);
    meAcc.setLatLng(S.me).setRadius(S.meAccuracy || 20);
  }
}
const getVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#333';

let nearItems = [];
function renderNear(fit) {
  if (!S.near || !S.nearOrigin) return;
  const o = S.nearOrigin;
  // Pré-filtre rapide par boîte englobante avant le calcul exact
  const dLat = S.radius / 111320, dLng = S.radius / (111320 * Math.max(.2, Math.cos(o[0] * Math.PI / 180)));
  nearItems = [];
  for (const inv of S.all) {
    if (inv.lat == null || S.flashed.has(inv.key)) continue;
    if (!S.showDead && inv.status === 'destroyed') continue;
    if (Math.abs(inv.lat - o[0]) > dLat || Math.abs(inv.lng - o[1]) > dLng) continue;
    const d = haversine(o, [inv.lat, inv.lng]);
    if (d <= S.radius) nearItems.push({ inv, d });
  }
  nearItems.sort((a, b) => a.d - b.d);

  nearLayer.clearLayers();
  for (const { inv } of nearItems) {
    const m = L.marker([inv.lat, inv.lng], { icon: todoIcon(inv), title: inv.id, keyboard: true });
    m.on('click', () => openDetail(inv));
    m.addTo(nearLayer);
  }
  const col = getVar('--todo');
  if (radiusCircle) radiusCircle.setLatLng(o).setRadius(S.radius);
  else radiusCircle = L.circle(o, { radius: S.radius, color: col, weight: 2, dashArray: '6 6', fillColor: col, fillOpacity: .05, interactive: false }).addTo(map);
  if (fit) map.fitBounds(radiusCircle.getBounds(), { paddingTopLeft: [20, 90], paddingBottomRight: [20, Math.round(window.innerHeight * .45)] });

  const alive = nearItems.filter(x => x.inv.status !== 'destroyed');
  const pts = alive.reduce((s, x) => s + (x.inv.points || 0), 0);
  $('nearLabel').textContent = nearItems.length
    ? `${nearItems.length} à flasher dans ${fmtDist(S.radius)}`
    : `Rien à flasher dans ${fmtDist(S.radius)}`;
  const where = S.nearIsMapCenter ? 'autour du centre de la carte' : 'autour de toi';
  $('nearSummary').innerHTML = nearItems.length
    ? `<b>${alive.length}</b> en place ou abîmés ${where} · <b>${fmtN(pts)}</b> pts à gagner`
    : `Aucun invader non flashé ${where} dans ce rayon. Agrandis le rayon pour en trouver.`;

  const list = $('nearList');
  list.textContent = '';
  const frag = document.createDocumentFragment();
  nearItems.slice(0, 200).forEach(({ inv, d }) => {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="near-item">
      <span class="mk-todo${inv.status === 'destroyed' ? ' dead' : ''}"></span>
      <span class="ni-main"><span class="ni-id">${esc(inv.id)}</span>
        <span class="ni-sub">${esc([inv.points != null ? inv.points + ' pts' : '', STATUS[inv.status], inv.hint].filter(Boolean).join(' · '))}</span></span>
      <span class="ni-dist">${fmtDist(d)}<small>${bearing(o, [inv.lat, inv.lng])}</small></span>
    </button>`;
    li.firstElementChild.addEventListener('click', () => { focusInvader(inv); openDetail(inv); });
    frag.appendChild(li);
  });
  list.appendChild(frag);
}

// ---------- Fiche ----------
let photoURL = null;
async function openDetail(inv) {
  S.current = inv;
  const isF = S.flashed.has(inv.key);
  $('dId').textContent = inv.id;
  const flag = $('dFlag');
  flag.textContent = isF ? 'Flashé' : 'À flasher';
  flag.className = 'flag ' + (isF ? 'yes' : 'no');
  $('dCity').textContent = cityName(inv.city) + (CITY_NAMES[inv.city] ? '' : ' (code ville)');
  $('dPoints').textContent = inv.points != null ? inv.points : '?';
  const st = $('dStatus');
  st.textContent = STATUS[inv.status] || STATUS.unknown;
  st.className = 'st-' + (inv.status || 'unknown');
  const from = S.me || null;
  $('dDist').textContent = from && inv.lat != null ? fmtDist(haversine(from, [inv.lat, inv.lng])) : '—';
  $('dHint').textContent = inv.hint || '';
  const fb = $('dFlash');
  fb.textContent = isF ? 'Retirer de ma collection' : 'Je l’ai flashé';
  fb.classList.toggle('undo', isF);
  const route = $('dRoute');
  if (inv.lat != null) {
    route.href = `https://maps.apple.com/?daddr=${inv.lat},${inv.lng}&dirflg=w`;
    route.hidden = false;
  } else route.hidden = true;

  // Photo
  const box = $('dPhoto');
  if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
  box.textContent = '';
  let blob = null;
  try { blob = await store.get('photos', inv.key); } catch (e) { /* pas de photo */ }
  if (S.current !== inv) return;
  if (blob) {
    photoURL = URL.createObjectURL(blob);
    const img = new Image();
    img.alt = 'Photo de ' + inv.id;
    img.src = photoURL;
    box.appendChild(img);
    box.classList.remove('empty');
  } else {
    box.classList.add('empty');
    box.innerHTML = `<div class="ph-empty"><div class="ph-grid">${pixelGrid(inv.key)}</div><span>Pas encore de photo</span></div>`;
  }
  $('dPhotoBtn').textContent = blob ? 'Changer la photo' : 'Ajouter une photo';
  $('dPhotoDel').hidden = !blob;

  $('sheet').hidden = false;
  $('sheetScrim').hidden = false;
}
// Petit motif 5x5 symétrique, différent pour chaque invader (placeholder sans photo)
function pixelGrid(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let out = '';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const xx = x < 3 ? x : 4 - x;
    const on = (h >> ((y * 3 + xx) % 31)) & 1;
    out += `<i class="${on ? 'on' : ''}"></i>`;
  }
  return out;
}
function closeDetail() {
  $('sheet').hidden = true;
  $('sheetScrim').hidden = true;
  S.current = null;
  if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
}
function focusInvader(inv) {
  if (inv.lat == null) return;
  const z = Math.max(map.getZoom(), 17);
  if (S.flashed.has(inv.key) && flashedMarkers.has(inv.key)) {
    flashedLayer.zoomToShowLayer(flashedMarkers.get(inv.key), () => {});
  } else {
    map.setView([inv.lat, inv.lng], z, { animate: true });
  }
}

async function toggleFlash() {
  const inv = S.current;
  if (!inv) return;
  if (S.flashed.has(inv.key)) S.flashed.delete(inv.key);
  else S.flashed.add(inv.key);
  await saveFlashed();
  renderFlashed(); renderStats(); renderNear(false);
  toast(S.flashed.has(inv.key) ? `${inv.id} ajouté à ta collection` : `${inv.id} retiré de ta collection`);
  openDetail(inv);
}

// Photos : redimensionnement (1600 px max) + vignette carrée 128 px
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    img.src = url;
  });
}
async function processPhoto(file) {
  const img = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  const sc = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * sc); c.height = Math.round(h * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const full = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
  const t = document.createElement('canvas');
  t.width = t.height = 128;
  const s = Math.min(w, h);
  t.getContext('2d').drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 128, 128);
  return { full, thumb: t.toDataURL('image/jpeg', .75) };
}
async function onPhoto(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  const inv = S.current;
  if (!file || !inv) return;
  try {
    const { full, thumb } = await processPhoto(file);
    await store.put('photos', inv.key, full);
    await store.put('thumbs', inv.key, thumb);
    S.thumbs.set(inv.key, thumb);
    if (!S.flashed.has(inv.key)) { S.flashed.add(inv.key); await saveFlashed(); renderNear(false); }
    renderFlashed(); renderStats();
    toast('Photo enregistrée');
    openDetail(inv);
  } catch (err) {
    toast('Cette image ne peut pas être lue. Essaie une autre photo.');
  }
}
async function deletePhoto() {
  const inv = S.current;
  if (!inv) return;
  await store.del('photos', inv.key);
  await store.del('thumbs', inv.key);
  S.thumbs.delete(inv.key);
  renderFlashed();
  toast('Photo supprimée');
  openDetail(inv);
}

// ---------- Recherche ----------
function search(q) {
  q = q.trim().toUpperCase().replace(/[\s\-]+/g, '_');
  if (!q) return [];
  const m = /^([A-Z]+)_?0*(\d*)$/.exec(q);
  if (m && m[2]) {
    const exact = S.byKey.get(m[1] + '_' + parseInt(m[2], 10));
    const pref = S.all.filter(i => i.city === m[1] && String(i.num).startsWith(String(parseInt(m[2], 10))) && i !== exact).slice(0, 7);
    return exact ? [exact, ...pref] : pref;
  }
  if (m) return S.all.filter(i => i.city === m[1]).slice(0, 8);
  return [];
}
function renderSearch() {
  const res = search($('searchInput').value);
  const ul = $('searchResults');
  ul.textContent = '';
  if (!res.length) { ul.hidden = true; return; }
  res.forEach(inv => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="sid">${esc(inv.id)}</span><span class="smeta">${S.flashed.has(inv.key) ? 'flashé' : esc(STATUS[inv.status])}</span>`;
    b.addEventListener('click', () => pickSearch(inv));
    li.appendChild(b);
    ul.appendChild(li);
  });
  ul.hidden = false;
}
function pickSearch(inv) {
  $('searchResults').hidden = true;
  $('searchInput').value = '';
  $('searchInput').blur();
  if (inv.lat == null) toast(`${inv.id} n’a pas de position connue.`);
  focusInvader(inv);
  openDetail(inv);
}

// ---------- Collection ----------
function openPanel(tab) {
  $('panel').hidden = false;
  showTab(tab || 'cities');
}
function closePanel() { $('panel').hidden = true; }
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  document.querySelectorAll('.panel-body').forEach(v => { v.hidden = v.dataset.view !== tab; });
  if (tab === 'cities') renderCities();
}
const openCities = new Set();
function renderCities() {
  const s = stats();
  $('cFlashed').textContent = fmtN(s.n);
  $('cPoints').textContent = fmtN(s.pts);
  $('cCities').textContent = fmtN(s.cities);
  $('cPhotos').textContent = fmtN(S.thumbs.size);
  $('cEmpty').hidden = s.n > 0;
  const byCity = new Map();
  for (const k of S.flashed) {
    const c = k.split('_')[0];
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(k);
  }
  const rows = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length);
  const ul = $('cityList');
  ul.textContent = '';
  for (const [c, keys] of rows) {
    const total = (S.cities.get(c) || []).length;
    const pct = total ? Math.min(100, Math.round(keys.length / total * 100)) : 0;
    const li = document.createElement('li');
    li.className = 'city';
    li.innerHTML = `<button type="button" class="city-row" aria-expanded="${openCities.has(c)}">
      <span class="city-name">${esc(cityName(c))}<small>${esc(c)}</small></span>
      <span class="city-count">${keys.length}${total ? ' / ' + total : ''}</span>
      <span class="bar"><i style="width:${pct}%"></i></span></button>`;
    const grid = document.createElement('div');
    grid.className = 'city-grid';
    grid.hidden = !openCities.has(c);
    li.firstElementChild.addEventListener('click', e => {
      const open = grid.hidden;
      grid.hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
      if (open) { openCities.add(c); fillGrid(grid, keys); } else openCities.delete(c);
    });
    if (!grid.hidden) fillGrid(grid, keys);
    li.appendChild(grid);
    ul.appendChild(li);
  }
}
function fillGrid(grid, keys) {
  grid.textContent = '';
  keys.sort((a, b) => (parseInt(a.split('_')[1], 10) || 0) - (parseInt(b.split('_')[1], 10) || 0));
  for (const k of keys) {
    const inv = S.byKey.get(k);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile' + (!inv || inv.lat == null ? ' nogps' : '');
    const th = S.thumbs.get(k);
    b.innerHTML = (th ? `<img src="${th}" alt="" loading="lazy">` : '') + `<span>${esc(inv ? inv.id : k)}</span>`;
    b.addEventListener('click', () => {
      const target = inv || { key: k, id: k, city: k.split('_')[0], lat: null, lng: null, points: null, status: 'unknown', hint: 'Absent de la base de positions' };
      closePanel();
      focusInvader(target);
      openDetail(target);
    });
    grid.appendChild(b);
  }
}

// ---------- Import ----------
let parsed = null;
function parseList(text) {
  const known = new Set(S.cities.keys());
  const found = new Set(), unknownCodes = new Set();
  const re = /\b([A-Za-z]{2,5})[ _\-]?(\d{1,4})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const city = m[1].toUpperCase();
    if (!known.has(city)) { if (/[_\-]/.test(m[0])) unknownCodes.add(m[0]); continue; }
    found.add(city + '_' + parseInt(m[2], 10));
  }
  const keys = [...found];
  return {
    keys,
    inBase: keys.filter(k => S.byKey.has(k)),
    notInBase: keys.filter(k => !S.byKey.has(k)),
    noGps: keys.filter(k => S.byKey.has(k) && S.byKey.get(k).lat == null),
    unknownCodes: [...unknownCodes]
  };
}
function onParse() {
  parsed = parseList($('importText').value);
  const p = parsed;
  $('importPreview').hidden = false;
  if (!p.keys.length) {
    $('importSummary').textContent = 'Aucun code d’invader reconnu. Vérifie le format (par exemple PA_1234).';
    $('importApply').hidden = true;
  } else {
    const already = p.keys.filter(k => S.flashed.has(k)).length;
    let txt = `${p.keys.length} invaders reconnus`;
    if (already) txt += `, dont ${already} déjà dans ta collection`;
    txt += '.';
    if (p.noGps.length) txt += ` ${p.noGps.length} n’ont pas de position connue.`;
    if (p.notInBase.length) txt += ` ${p.notInBase.length} absents de la base (comptés, mais pas sur la carte) : ${p.notInBase.slice(0, 6).join(', ')}${p.notInBase.length > 6 ? '…' : ''}`;
    $('importSummary').textContent = txt;
    $('importApply').hidden = false;
  }
  $('importUnknownWrap').hidden = !p.unknownCodes.length;
  $('importUnknown').textContent = p.unknownCodes.join(', ');
}
async function onApply() {
  if (!parsed || !parsed.keys.length) return;
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const before = S.flashed.size;
  if (mode === 'replace') S.flashed = new Set(parsed.keys);
  else parsed.keys.forEach(k => S.flashed.add(k));
  await saveFlashed();
  renderFlashed(); renderStats(); renderNear(false);
  toast(mode === 'replace' ? `Collection remplacée : ${S.flashed.size} invaders` : `${S.flashed.size - before} invaders ajoutés`);
  $('importText').value = '';
  $('importPreview').hidden = true;
  parsed = null;
  showTab('cities');
  if (before === 0 && flashedLayer.getLayers().length) map.fitBounds(flashedLayer.getBounds(), { padding: [40, 40], maxZoom: 14 });
}

// ---------- Import depuis des captures de la galerie Flash Invaders ----------
let shot = null; // { found: Map(key -> {key, photo, label}), unread: [cells], off: Set }
const yieldUI = () => new Promise(r => setTimeout(r, 0));
function canvasThumb(c, size) {
  const t = document.createElement('canvas');
  t.width = t.height = size;
  const s = Math.min(c.width, c.height);
  t.getContext('2d').drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, size, size);
  return t.toDataURL('image/jpeg', .75);
}
function addFound(cell, key) {
  const prev = shot.found.get(key);
  // Garde la version avec une photo complète
  if (!prev || (!prev.photo && cell.photoCanvas)) {
    shot.found.set(key, { key, photo: cell.photoCanvas || (prev && prev.photo) || null, labelURL: cell.labelURL });
  }
}
async function onShots(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  const st = $('shotStatus');
  st.hidden = false;
  $('shotReview').hidden = true;
  const known = new Set(S.cities.keys());
  shot = { found: new Map(), unread: [], off: new Set(), bad: 0, files: files.length };
  for (let i = 0; i < files.length; i++) {
    st.textContent = `Lecture de la capture ${i + 1} sur ${files.length}…`;
    await yieldUI();
    let a;
    try { a = await ShotImport.analyze(files[i]); } catch (err) { a = { ok: false, cells: [] }; }
    if (!a.ok || !a.cells.length) { shot.bad++; continue; }
    for (const c of a.cells) {
      const r = ShotImport.readLabel(c.label, known);
      c.guess = r.text;
      c.labelURL = c.labelImg().toDataURL('image/png');
      // Découpe tout de suite les petites images pour libérer la grande capture
      c.photoCanvas = c.photo ? c.photo() : null;
      delete c.photo; delete c.labelImg;
      if (r.key) addFound(c, r.key);
      else shot.unread.push(c);
    }
  }
  st.hidden = true;
  renderShotReview();
}
function retryUnread() {
  const known = new Set(S.cities.keys());
  shot.unread = shot.unread.filter(c => {
    const r = ShotImport.readLabel(c.label, known);
    if (r.key) { addFound(c, r.key); return false; }
    c.guess = r.text;
    return true;
  });
}
function renderShotReview() {
  const keys = [...shot.found.keys()].sort((a, b) => {
    const [ca, na] = a.split('_'), [cb, nb] = b.split('_');
    return ca === cb ? na - nb : ca.localeCompare(cb);
  });
  const already = keys.filter(k => S.flashed.has(k)).length;
  let txt = `${keys.length} invaders lus sur ${shot.files} capture${shot.files > 1 ? 's' : ''}`;
  if (keys.length) txt += ` : ${keys.length - already} nouveaux, ${already} déjà dans ta collection.`;
  else txt += '.';
  if (shot.bad) txt += ` ${shot.bad} image${shot.bad > 1 ? 's' : ''} ne ressemble${shot.bad > 1 ? 'nt' : ''} pas à la galerie Flash Invaders.`;
  $('shotSummary').textContent = txt;

  const grid = $('shotGrid');
  grid.textContent = '';
  for (const k of keys) {
    const f = shot.found.get(k);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shot-tile' + (S.flashed.has(k) ? ' have' : '') + (shot.off.has(k) ? ' off' : '');
    b.setAttribute('aria-pressed', String(!shot.off.has(k)));
    if (!f.thumb) f.thumb = f.photo ? canvasThumb(f.photo, 128) : f.labelURL;
    const img = document.createElement('img');
    img.src = f.thumb; img.alt = '';
    const sp = document.createElement('span');
    sp.textContent = (S.byKey.get(k) || { id: k }).id;
    b.append(img, sp);
    b.addEventListener('click', () => {
      if (shot.off.has(k)) shot.off.delete(k); else shot.off.add(k);
      b.classList.toggle('off', shot.off.has(k));
      b.setAttribute('aria-pressed', String(!shot.off.has(k)));
      updateShotButton();
    });
    grid.appendChild(b);
  }

  const fixList = $('shotFixList');
  fixList.textContent = '';
  $('shotFix').hidden = !shot.unread.length;
  shot.unread.slice(0, 30).forEach((c, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = c.labelURL; img.alt = 'Étiquette illisible';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.id = 'shotFix' + i;
    inp.placeholder = 'ex. LDN_12';
    inp.value = c.guess.includes('?') ? '' : c.guess;
    inp.setAttribute('aria-label', 'Code de cet invader');
    inp.autocapitalize = 'characters';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn small'; ok.textContent = 'OK';
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'btn small'; skip.textContent = 'Ignorer';
    ok.addEventListener('click', () => {
      const key = keyOf(inp.value);
      if (!/^[A-Z]+_\d+$/.test(key) || !S.cities.has(key.split('_')[0])) { toast('Code non reconnu. Écris-le comme sur l’étiquette, par exemple LDN_12.'); return; }
      ShotImport.learn(c.label, key);
      shot.unread = shot.unread.filter(x => x !== c);
      addFound(c, key);
      retryUnread();
      renderShotReview();
    });
    skip.addEventListener('click', () => { shot.unread = shot.unread.filter(x => x !== c); renderShotReview(); });
    li.append(img, inp, ok, skip);
    fixList.appendChild(li);
  });

  $('shotReview').hidden = false;
  updateShotButton();
}
function updateShotButton() {
  const n = [...shot.found.keys()].filter(k => !shot.off.has(k) && !S.flashed.has(k)).length;
  const btn = $('shotApply');
  btn.textContent = n ? `Importer ${n} invader${n > 1 ? 's' : ''}` : 'Mettre à jour les photos';
  btn.disabled = !shot.found.size;
}
async function onShotApply() {
  if (!shot) return;
  const withPhotos = $('shotPhotos').checked;
  const btn = $('shotApply');
  btn.disabled = true;
  let added = 0, photos = 0;
  for (const [k, f] of shot.found) {
    if (shot.off.has(k)) continue;
    if (!S.flashed.has(k)) { S.flashed.add(k); added++; }
    if (withPhotos && f.photo) {
      let has = null;
      try { has = await store.get('photos', k); } catch (e) { /* aucune */ }
      if (!has) {
        const blob = await new Promise(r => f.photo.toBlob(r, 'image/jpeg', .85));
        const thumb = canvasThumb(f.photo, 128);
        await store.put('photos', k, blob);
        await store.put('thumbs', k, thumb);
        S.thumbs.set(k, thumb);
        photos++;
      }
    }
  }
  await saveFlashed();
  const first = flashedLayer.getLayers().length === 0;
  renderFlashed(); renderStats(); renderNear(false);
  toast(`${added} invader${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}` + (photos ? `, ${photos} photo${photos > 1 ? 's' : ''}` : ''));
  shot = null;
  $('shotReview').hidden = true;
  showTab('cities');
  if (first && flashedLayer.getLayers().length) map.fitBounds(flashedLayer.getBounds(), { padding: [40, 40], maxZoom: 14 });
}

// ---------- Sauvegarde ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
async function onExport() {
  const withPhotos = $('exportPhotos').checked;
  const data = { app: 'mes-invaders', version: 1, date: new Date().toISOString(), flashed: [...S.flashed], thumbs: Object.fromEntries(S.thumbs), photos: {} };
  if (withPhotos) for (const [k, b] of await store.entries('photos')) data.photos[k] = await blobToDataURL(b);
  const name = `mes-invaders-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function onRestore(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'mes-invaders' || !Array.isArray(data.flashed)) throw new Error('format');
    S.flashed = new Set(data.flashed.map(keyOf));
    await saveFlashed();
    await store.clear('thumbs');
    S.thumbs.clear();
    for (const [k, v] of Object.entries(data.thumbs || {})) {
      if (typeof v === 'string' && v.startsWith('data:image/')) { await store.put('thumbs', k, v); S.thumbs.set(k, v); }
    }
    for (const [k, v] of Object.entries(data.photos || {})) {
      if (typeof v === 'string' && v.startsWith('data:image/')) await store.put('photos', k, await dataURLToBlob(v));
    }
    renderFlashed(); renderStats(); renderNear(false); renderCities();
    toast(`Sauvegarde restaurée : ${S.flashed.size} invaders`);
  } catch (err) {
    toast('Ce fichier n’est pas une sauvegarde Mes Invaders.');
  }
}
async function onCopyList() {
  const txt = [...S.flashed].map(k => (S.byKey.get(k) || { id: k }).id).sort().join('\n');
  try { await navigator.clipboard.writeText(txt); toast(`${S.flashed.size} codes copiés`); }
  catch (e) { $('importText').value = txt; showTab('import'); toast('Liste affichée dans l’onglet Importer : sélectionne-la pour la copier.'); }
}

// ---------- Divers ----------
let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 3800);
}

function bind() {
  $('nearToggle').addEventListener('click', () => setNear(!S.near));
  $('nearCollapse').addEventListener('click', () => {
    S.collapsed = !S.collapsed;
    $('nearPanel').classList.toggle('collapsed', S.collapsed);
    $('nearCollapse').setAttribute('aria-label', S.collapsed ? 'Déplier la liste' : 'Replier la liste');
  });
  document.querySelectorAll('.chip').forEach(c => {
    c.setAttribute('role', 'radio');
    c.setAttribute('aria-checked', String(+c.dataset.r === S.radius));
    c.addEventListener('click', () => {
      S.radius = +c.dataset.r;
      document.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-checked', String(x === c)));
      savePrefs();
      renderNear(true);
    });
  });
  $('showDead').checked = S.showDead;
  $('showDead').addEventListener('change', e => { S.showDead = e.target.checked; savePrefs(); renderNear(false); });

  $('locateBtn').addEventListener('click', () => {
    if (S.me) { map.setView(S.me, Math.max(map.getZoom(), 16)); return; }
    toast('Localisation…');
    if (!('geolocation' in navigator)) { toast('La localisation n’est pas disponible.'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      S.me = [pos.coords.latitude, pos.coords.longitude]; S.meAccuracy = pos.coords.accuracy;
      drawMe(); map.setView(S.me, 16);
      if (S.near && S.nearIsMapCenter) { S.nearIsMapCenter = false; S.nearOrigin = S.me; renderNear(true); }
    }, err => toast(err.code === 1 ? 'Localisation refusée. Active-la dans Réglages › Confidentialité › Service de localisation › Safari.' : 'Position introuvable pour l’instant.'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 });
  });
  // Sans GPS, "autour de moi" suit le centre de la carte quand on la déplace
  map.on('moveend', () => {
    if (S.near && S.nearIsMapCenter) {
      const c = map.getCenter();
      S.nearOrigin = [c.lat, c.lng];
      renderNear(false);
    }
  });

  $('collectionBtn').addEventListener('click', () => openPanel('cities'));
  $('statsBtn').addEventListener('click', () => openPanel('cities'));
  $('panelClose').addEventListener('click', closePanel);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  $('sheetClose').addEventListener('click', closeDetail);
  $('sheetScrim').addEventListener('click', closeDetail);
  $('dFlash').addEventListener('click', toggleFlash);
  $('photoInput').addEventListener('change', onPhoto);
  $('dPhotoDel').addEventListener('click', deletePhoto);

  $('searchInput').addEventListener('input', renderSearch);
  $('searchInput').addEventListener('focus', renderSearch);
  $('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const r = search($('searchInput').value);
    if (r.length) pickSearch(r[0]); else toast('Aucun invader avec ce code.');
  });
  document.addEventListener('click', e => { if (!$('searchForm').contains(e.target)) $('searchResults').hidden = true; });

  $('shotFiles').addEventListener('change', onShots);
  $('shotApply').addEventListener('click', onShotApply);
  $('importParse').addEventListener('click', onParse);
  $('importApply').addEventListener('click', onApply);
  $('importFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) { $('importText').value = await f.text(); onParse(); }
  });
  $('exportBtn').addEventListener('click', onExport);
  $('restoreFile').addEventListener('change', onRestore);
  $('exportList').addEventListener('click', onCopyList);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('sheet').hidden) closeDetail();
    else if (!$('panel').hidden) closePanel();
  });
}

// ---------- Démarrage ----------
async function init() {
  bind();
  try {
    const res = await fetch('data/invaders.json');
    const json = await res.json();
    S.all = json.invaders.map(([id, city, lat, lng, points, status, hint]) => {
      const key = keyOf(id);
      return { id, key, city, lat, lng, points, status, hint, num: parseInt(key.split('_')[1], 10) };
    });
  } catch (e) {
    toast('La base des invaders n’a pas pu être chargée. Vérifie ta connexion puis rouvre l’app.');
    return;
  }
  for (const inv of S.all) {
    S.byKey.set(inv.key, inv);
    if (!S.cities.has(inv.city)) S.cities.set(inv.city, []);
    S.cities.get(inv.city).push(inv);
  }
  $('dataCount').textContent = fmtN(S.all.length);

  try {
    const f = await store.get('kv', 'flashed');
    if (Array.isArray(f)) S.flashed = new Set(f);
    for (const [k, v] of await store.entries('thumbs')) S.thumbs.set(k, v);
  } catch (e) { /* première ouverture */ }
  if (!(await store.ok())) toast('Stockage indisponible : ta collection ne sera pas conservée (navigation privée ?).');
  navigator.storage?.persist?.().catch(() => {});

  renderFlashed();
  renderStats();
  if (flashedLayer.getLayers().length) map.fitBounds(flashedLayer.getBounds(), { padding: [40, 40], maxZoom: 14 });
  else openPanel('import');
}
init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
