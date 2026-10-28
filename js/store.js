// App state, kept in IndexedDB (falls back to localStorage) on this device.

const DB_NAME = 'fittrack';
const KEY = 'state';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export function defaultState() {
  return {
    v: 1,
    settings: {
      units: 'kg',
      theme: 'auto',
      weekStart: 1,
      restDefault: 90,
      restSound: true,
      showDemos: true,
      calorieGoal: 2200,
      macroPct: { p: 30, c: 40, f: 30 },
      waterGoal: 2500,
      addExerciseCalories: true,
      profile: { sex: 'male', age: 35, heightCm: 178, activity: 1.375, goal: 0 },
      anthropicKey: '',
      aiModel: 'claude-opus-5-5',
      icuKey: '',
      icuAthlete: '0',
      icuLastSync: null,
      icuDays: 30,
      icuHistoryDone: false,
      foodRegion: 'uk',
      usdaKey: '',
      usdaOff: false,
      ghToken: '',
      gistId: '',
      syncLast: null,
    },
    routines: [],
    customExercises: [],
    workouts: [],
    activeWorkout: null,
    weights: [],
    foods: {},
    water: {},
    recentFoods: [],
    myFoods: [],
    meals: [],
    activities: [],
    wellness: {},
  };
}

export let state = defaultState();

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, val) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function merge(base, saved) {
  const out = { ...base, ...saved };
  out.settings = { ...base.settings, ...(saved.settings || {}) };
  out.settings.profile = { ...base.settings.profile, ...((saved.settings || {}).profile || {}) };
  out.settings.macroPct = { ...base.settings.macroPct, ...((saved.settings || {}).macroPct || {}) };
  return out;
}

export async function load() {
  let saved = null;
  try { saved = await idbGet(KEY); } catch (e) {
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e2) {}
  }
  state = saved ? merge(defaultState(), saved) : defaultState();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return state;
}

// Other stores (the sync base copy) live beside the state.
export async function kvGet(key) {
  try { return await idbGet(key); } catch (e) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e2) { return null; }
  }
}
export async function kvSet(key, val) {
  try { await idbSet(key, val); } catch (e) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e2) {}
  }
}

let timer = null;
let onChange = null;
export const setOnChange = fn => { onChange = fn; };
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
  if (onChange) onChange();
}

export async function flush() {
  clearTimeout(timer);
  const copy = JSON.parse(JSON.stringify(state));
  try { await idbSet(KEY, copy); } catch (e) {
    try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch (e2) {}
  }
}

export async function replaceState(next) {
  state = merge(defaultState(), next);
  // Forget the last synced copy so sync merges rather than treating missing items as deleted.
  await kvSet('syncBase', null);
  return flush();
}

// Helpers

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export const LB = 2.20462;
export function toDisplayW(kg) {
  if (kg == null || kg === '') return '';
  const v = state.settings.units === 'lb' ? kg * LB : kg;
  return Math.round(v * 10) / 10;
}
export function fromDisplayW(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  return state.settings.units === 'lb' ? n / LB : n;
}
export const wUnit = () => state.settings.units;

// Food totals for one entry
export function entryTotals(e) {
  const g = (e.amount || 0) * (e.gramsPerUnit || 1);
  const f = g / 100;
  const p = e.per100 || {};
  return { kcal: (p.kcal || 0) * f, p: (p.p || 0) * f, c: (p.c || 0) * f, f: (p.f || 0) * f, fib: (p.fib || 0) * f, sug: (p.sug || 0) * f, na: (p.na || 0) * f };
}

export function dayFoodTotals(key) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, sug: 0, na: 0 };
  for (const e of state.foods[key] || []) {
    const x = entryTotals(e);
    for (const k in t) t[k] += x[k];
  }
  return t;
}

export function dayExerciseKcal(key) {
  let k = 0;
  for (const a of state.activities) if (a.date === key && a.kcal) k += a.kcal;
  return Math.round(k);
}

export function macroGoals() {
  const s = state.settings;
  const kcal = s.calorieGoal;
  return {
    kcal,
    p: Math.round(kcal * s.macroPct.p / 100 / 4),
    c: Math.round(kcal * s.macroPct.c / 100 / 4),
    f: Math.round(kcal * s.macroPct.f / 100 / 9),
  };
}

export function latestWeight() {
  if (!state.weights.length) return null;
  return [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}
