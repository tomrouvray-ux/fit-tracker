// Food sources beyond Open Food Facts: UK everyday foods (bundled CoFID) and USDA FoodData Central.

import { state } from './store.js';

// ---------- ranking shared by all sources ----------

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = s => norm(s).split(/[^a-z0-9%]+/).filter(Boolean);
const stem = w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

// Higher is better; -1 means "doesn't match".
export function score(q, name, brand = '') {
  const qw = words(q).map(stem);
  if (!qw.length) return -1;
  const nw = words(name).map(stem);
  const bw = words(brand).map(stem);
  let s = 0;
  for (const w of qw) {
    if (nw.includes(w)) s += 10;
    else if (nw.some(x => x.startsWith(w))) s += 6;
    else if (bw.some(x => x.startsWith(w))) s += 4;
    else return -1;
  }
  // The food's main name (before the first comma) matters most: "Chicken, breast" beats "Soup, chicken".
  const head = words(name.split(',')[0]).map(stem);
  if (head[0] === qw[0]) s += 8;
  if (qw.every(w => head.includes(w))) s += 6;
  // Prefer plain, short names over long recipe descriptions.
  s -= Math.max(0, nw.length - qw.length) * 0.8;
  if (/\b(raw|flesh only|boiled|grilled)\b/i.test(name)) s += 1;
  return s;
}

// keepAll keeps results that don't contain every word (online databases also match on
// categories and ingredients) but puts them after the ones that do.
export function rank(q, list, { keepAll = false } = {}) {
  return list
    .map(f => ({ f, s: score(q, f.name, f.brand) }))
    .map(x => (x.s < 0 && keepAll ? { ...x, s: -1000 } : x))
    .filter(x => x.s >= 0 || keepAll)
    .sort((a, b) => b.s - a.s)
    .map(x => x.f);
}

// ---------- UK everyday foods (McCance and Widdowson's CoFID) ----------

let uk = null;
let ukLoading = null;

export function loadUK() {
  if (!ukLoading) {
    ukLoading = fetch('data/foods-uk.json')
      .then(r => r.json())
      .then(j => {
        uk = j.foods.map(([name, kcal, p, c, f, fib, sug, na]) => ({
          name, brand: '', source: 'uk', per100: { kcal, p, c, f, fib, sug, na },
        }));
      })
      .catch(() => { uk = []; });
  }
  return ukLoading;
}

export function searchUK(q, limit = 25) {
  return uk ? rank(q, uk).slice(0, limit) : [];
}

// ---------- USDA FoodData Central ----------

// DEMO_KEY works without signing up but allows only ~30 searches an hour.
const usdaKey = () => (state.settings.usdaKey || '').trim() || 'DEMO_KEY';

const NUTRIENTS = { 1008: 'kcal', 2047: 'kcal2', 2048: 'kcal3', 1003: 'p', 1005: 'c', 1004: 'f', 1079: 'fib', 2000: 'sug', 1093: 'na' };

function fromUSDA(item) {
  const n = {};
  for (const x of item.foodNutrients || []) {
    const k = NUTRIENTS[x.nutrientId];
    if (k && x.value != null) n[k] = x.value;
  }
  const kcal = n.kcal ?? n.kcal2 ?? n.kcal3;
  if (kcal == null) return null;
  const branded = item.dataType === 'Branded';
  const servingG = branded && /^(g|grm|ml|mlt)$/i.test(item.servingSizeUnit || '') ? item.servingSize : null;
  const title = s => s.charAt(0) + s.slice(1).toLowerCase();
  return {
    name: branded ? title(item.description) : item.description,
    brand: branded ? title(item.brandName || item.brandOwner || '') : '',
    source: 'usda',
    per100: { kcal, p: n.p || 0, c: n.c || 0, f: n.f || 0, fib: n.fib || 0, sug: n.sug || 0, na: n.na || 0 },
    servingG: servingG || null,
    servingLabel: servingG ? (item.householdServingFullText || `${servingG} g`) : '',
  };
}

export async function searchUSDA(q, signal) {
  const params = new URLSearchParams({
    api_key: usdaKey(), query: q, pageSize: '30', requireAllWords: 'true',
    // Generic foods only: US branded products add noise, and Open Food Facts covers UK brands.
    dataType: 'Foundation,SR Legacy,Survey (FNDDS)',
  });
  const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, { signal });
  if (r.status === 429) throw new Error('USDA search limit reached. Add your own free key in Settings.');
  if (r.status === 403) throw new Error('USDA rejected the API key. Check it in Settings.');
  if (!r.ok) throw new Error('USDA search is unavailable right now.');
  const j = await r.json();
  return rank(q, (j.foods || []).map(fromUSDA).filter(Boolean), { keepAll: true });
}
