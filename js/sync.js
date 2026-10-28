// Sync between devices through a private GitHub Gist.
// Each sync is a three-way merge of this device, the Gist, and the copy both agreed on last time,
// so additions and deletions from either device are kept.

import { state, save, kvGet, kvSet } from './store.js';

const API = 'https://api.github.com';
const FILE = 'fittrack.json';
const DESC = 'FitTrack sync';
const BASE = 'syncBase';

// Settings that stay on each device: secrets and sync bookkeeping.
const LOCAL_SETTINGS = ['anthropicKey', 'icuKey', 'usdaKey', 'ghToken', 'gistId', 'syncLast', 'icuLastSync', 'icuHistoryDone'];

const foodKey = f => (f.name + '|' + (f.brand || '')).toLowerCase();
const LISTS = {
  routines: x => x.id,
  customExercises: x => x.id,
  workouts: x => x.id,
  activities: x => x.id,
  weights: x => x.date,
  recentFoods: foodKey,
  myFoods: foodKey,
  meals: x => x.id,
};
const MAPS = ['water', 'wellness'];

export const syncStatus = { busy: false, error: '' };
let onApplied = () => {};
let timer = null;
let running = null;
let again = false;

// ---------- merge ----------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Three-way merge of two key → value maps. Local wins when both sides changed the same item.
function mergeMap(base, local, remote) {
  const out = new Map();
  for (const [k, l] of local) {
    const b = base.get(k);
    if (remote.has(k)) {
      const r = remote.get(k);
      out.set(k, b !== undefined && same(l, b) ? r : l);
    } else if (b === undefined || !same(l, b)) {
      out.set(k, l); // new here, or edited here after the other device deleted it
    }
  }
  for (const [k, r] of remote) {
    if (local.has(k)) continue;
    const b = base.get(k);
    if (b === undefined || !same(r, b)) out.set(k, r);
  }
  return out;
}

const listMap = (arr, key) => new Map((arr || []).map(x => [key(x), x]));
const objMap = o => new Map(Object.entries(o || {}));
const foodMap = foods => {
  const m = new Map();
  for (const [day, list] of Object.entries(foods || {})) for (const e of list) m.set(day + '/' + e.id, e);
  return m;
};

export function pick(s) {
  const out = { v: 1 };
  for (const k of Object.keys(LISTS)) out[k] = s[k] || [];
  for (const k of MAPS) out[k] = s[k] || {};
  out.foods = s.foods || {};
  out.settings = {};
  for (const [k, v] of Object.entries(s.settings || {})) if (!LOCAL_SETTINGS.includes(k)) out.settings[k] = v;
  return out;
}

export function merge(base, local, remote) {
  base = base || {};
  const out = { v: 1 };
  for (const [k, key] of Object.entries(LISTS)) {
    out[k] = [...mergeMap(listMap(base[k], key), listMap(local[k], key), listMap(remote[k], key)).values()];
  }
  out.recentFoods = out.recentFoods.slice(0, 60);
  for (const k of MAPS) out[k] = Object.fromEntries(mergeMap(objMap(base[k]), objMap(local[k]), objMap(remote[k])));
  out.foods = {};
  for (const [k, e] of mergeMap(foodMap(base.foods), foodMap(local.foods), foodMap(remote.foods))) {
    const day = k.slice(0, k.indexOf('/'));
    (out.foods[day] = out.foods[day] || []).push(e);
  }
  for (const list of Object.values(out.foods)) list.sort((a, b) => (a.time || 0) - (b.time || 0));
  out.settings = Object.fromEntries(mergeMap(objMap(base.settings), objMap(local.settings), objMap(remote.settings)));
  return out;
}

// ---------- GitHub ----------

async function gh(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + state.settings.ghToken,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  if (r.status === 401) throw new Error('GitHub rejected the sync token. Check it in Settings.');
  if (r.status === 403 || r.status === 429) throw new Error('GitHub is limiting requests. Sync will try again later.');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Sync failed (GitHub error ' + r.status + ').');
  return r.json();
}

// The oldest FitTrack Gist is the shared one. If two devices each made one before seeing the
// other's, they both settle on the oldest.
async function findGist() {
  const found = [];
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    if (!list || !list.length) break;
    found.push(...list.filter(x => x.description === DESC && x.files && x.files[FILE]));
    if (list.length < 100) break;
  }
  found.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return found.length ? found[0].id : null;
}

async function readGist(id) {
  const g = await gh('/gists/' + id);
  if (!g || !g.files[FILE]) return undefined;
  const f = g.files[FILE];
  // The API cuts files over 1 MB short; the full text is at raw_url.
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  return JSON.parse(text);
}

// ---------- running a sync ----------

export const syncOn = () => !!state.settings.ghToken;

async function run() {
  const s = state.settings;
  let remote = null;
  let base = await kvGet(BASE);
  let extra = null;
  const shared = await findGist();
  if (shared && s.gistId && shared !== s.gistId) {
    // This device was using its own Gist: fold it into the shared one and remove the duplicate.
    extra = { id: s.gistId, data: await readGist(s.gistId) };
    base = null;
  }
  if (shared) s.gistId = shared;
  if (s.gistId) {
    remote = await readGist(s.gistId);
    if (remote === undefined) { s.gistId = ''; remote = null; base = null; }
  }
  const local = pick(state);
  let merged = remote ? merge(base, local, remote) : local;
  if (extra && extra.data) merged = merge(null, merged, extra.data);
  const text = JSON.stringify(merged);
  // Something was logged while GitHub answered: start again rather than overwrite it.
  if (!same(pick(state), local)) { again = true; return; }

  if (!same(merged, local)) {
    for (const k of [...Object.keys(LISTS), ...MAPS, 'foods']) state[k] = merged[k];
    Object.assign(state.settings, merged.settings);
  }
  if (!remote || !same(merged, remote)) {
    const body = JSON.stringify({ description: DESC, files: { [FILE]: { content: text } } });
    if (s.gistId) await gh('/gists/' + s.gistId, { method: 'PATCH', body });
    else s.gistId = (await gh('/gists', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), public: false }) })).id;
  }
  await kvSet(BASE, merged);
  if (extra) await gh('/gists/' + extra.id, { method: 'DELETE' }).catch(() => {});
  s.syncLast = Date.now();
  save();
  if (!same(merged, local)) onApplied();
}

export function syncNow() {
  if (!syncOn()) return Promise.resolve();
  if (running) { again = true; return running; }
  clearTimeout(timer);
  syncStatus.busy = true;
  running = run()
    .then(() => { syncStatus.error = ''; })
    .catch(e => { syncStatus.error = e.message || 'Sync failed.'; })
    .finally(() => {
      syncStatus.busy = false;
      running = null;
      if (again) { again = false; syncNow(); }
    });
  return running;
}

// Push a few seconds after the last change, unless nothing that syncs has changed.
export function changed() {
  if (!syncOn()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const base = await kvGet(BASE);
    if (!base || !same(pick(state), base)) syncNow();
  }, 4000);
}

export function startSync(applied) {
  onApplied = applied;
  syncNow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  // A computer keeps the app visible in a window, so also check on focus and once a minute.
  window.addEventListener('focus', () => syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
}
