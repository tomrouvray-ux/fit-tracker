// Garmin activities: synced through Intervals.icu (which links to Garmin Connect), or imported from files.

import { state, save, uid, dayKey, addDays, toDisplayW, wUnit } from './store.js';
import { esc, sheet, toast, confirmSheet, fmtDuration, fmtDate, fmtTime, r1, fmtInt } from './ui.js';
import { readActivityFile } from './fileimport.js';
import { workoutVolume } from './train.js';
import { go, rerender } from './app.js';

const ICONS = {
  Run: '🏃', VirtualRun: '🏃', TrailRun: '🏃', Ride: '🚴', VirtualRide: '🚴', GravelRide: '🚴', MountainBikeRide: '🚵', EBikeRide: '🚴',
  Swim: '🏊', OpenWaterSwim: '🏊', Walk: '🚶', Hike: '🥾', WeightTraining: '🏋️', Workout: '💪', Yoga: '🧘', Rowing: '🚣',
  HighIntensityIntervalTraining: '🔥', Elliptical: '⚙️', NordicSki: '⛷️', AlpineSki: '⛷️', Tennis: '🎾', Padel: '🎾', Soccer: '⚽',
};
export const actIcon = t => ICONS[t] || '⌚';
export const actLabel = t => (t || 'Activity').replace(/([a-z])([A-Z])/g, '$1 $2');

function fmtDist(m) {
  if (!m) return '';
  return state.settings.units === 'lb' ? `${r1(m / 1609.34)} mi` : `${r1(m / 1000)} km`;
}

function fmtPace(a) {
  if (!a.distanceM || !a.durationSec) return '';
  if (/Run|Walk|Hike/.test(a.type)) {
    const per = state.settings.units === 'lb' ? 1609.34 : 1000;
    const s = a.durationSec / (a.distanceM / per);
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/${state.settings.units === 'lb' ? 'mi' : 'km'}`;
  }
  if (/Ride/.test(a.type)) {
    const k = state.settings.units === 'lb' ? 1609.34 : 1000;
    return `${r1(a.distanceM / k / (a.durationSec / 3600))} ${state.settings.units === 'lb' ? 'mph' : 'km/h'}`;
  }
  return '';
}

export function activitySub(a) {
  return [fmtDuration(a.durationSec), fmtDist(a.distanceM), fmtPace(a), a.avgHr ? `${Math.round(a.avgHr)} bpm` : '', a.kcal ? `${fmtInt(a.kcal)} kcal` : '']
    .filter(Boolean).join(' · ');
}

// ---------- Intervals.icu ----------

function icuHeaders() {
  return { Authorization: 'Basic ' + btoa('API_KEY:' + state.settings.icuKey.trim()) };
}

async function icuGet(path) {
  const ath = (state.settings.icuAthlete || '0').trim() || '0';
  let r;
  try {
    r = await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(ath)}${path}`, { headers: icuHeaders() });
  } catch (e) {
    throw new Error('Could not reach Intervals.icu. Check your connection, or import files from Garmin Connect instead.');
  }
  if (r.status === 401 || r.status === 403) throw new Error('Intervals.icu rejected the API key or athlete ID. Check them in Settings.');
  if (!r.ok) throw new Error(`Intervals.icu error ${r.status}`);
  return r.json();
}

export async function syncIntervals({ days = state.settings.icuDays || 30, quiet = false } = {}) {
  if (!state.settings.icuKey) throw new Error('Add your Intervals.icu API key in Settings first.');
  const oldest = addDays(dayKey(), -days);
  const newest = addDays(dayKey(), 1);
  const [acts, well] = await Promise.all([
    icuGet(`/activities?oldest=${oldest}&newest=${newest}`),
    icuGet(`/wellness?oldest=${oldest}&newest=${newest}`).catch(() => []),
  ]);
  let added = 0;
  for (const a of acts || []) {
    if (!a || !a.start_date_local) continue;
    const id = 'icu_' + a.id;
    const start = new Date(a.start_date_local).getTime();
    const rec = {
      id, source: 'icu', icuId: a.id,
      name: a.name || actLabel(a.type), type: a.type || 'Workout',
      start, date: dayKey(start),
      durationSec: a.moving_time || a.elapsed_time || null, elapsedSec: a.elapsed_time || null,
      distanceM: a.distance || null, elevGain: a.total_elevation_gain || null,
      kcal: a.calories || null, avgHr: a.average_heartrate || null, maxHr: a.max_heartrate || null,
      load: a.icu_training_load || null, device: a.device_name || '',
    };
    const i = state.activities.findIndex(x => x.id === id);
    if (i >= 0) state.activities[i] = { ...state.activities[i], ...rec };
    else { state.activities.push(rec); added++; }
  }
  for (const w of well || []) {
    if (!w || !w.id) continue;
    state.wellness[w.id] = {
      weight: w.weight || null, restingHR: w.restingHR || null, hrv: w.hrv || null,
      sleepSecs: w.sleepSecs || null, sleepScore: w.sleepScore || null, steps: w.steps || null,
    };
    if (w.weight && !state.weights.some(x => x.date === w.id)) state.weights.push({ date: w.id, kg: w.weight, source: 'garmin' });
  }
  state.settings.icuLastSync = Date.now();
  save();
  if (!quiet) toast(added ? `Synced ${added} new activit${added === 1 ? 'y' : 'ies'}` : 'Up to date');
  return added;
}

// Quietly sync when the app opens, at most every 15 minutes.
export function autoSync() {
  const s = state.settings;
  if (!s.icuKey || (s.icuLastSync && Date.now() - s.icuLastSync < 15 * 60 * 1000)) return;
  syncIntervals({ quiet: true, days: 7 }).then(n => { if (n) rerender(); }).catch(() => {});
}

// ---------- Activity tab ----------

function feed() {
  const items = state.activities.map(a => ({ kind: 'act', t: a.start, a }));
  for (const w of state.workouts) if (w.end) items.push({ kind: 'gym', t: w.start, w });
  return items.sort((x, y) => y.t - x.t);
}

export function renderActivity(root) {
  const s = state.settings;
  const all = feed();
  const weekStart = addDays(dayKey(), -6);
  const week = all.filter(x => dayKey(x.t) >= weekStart);
  const weekTime = week.reduce((n, x) => n + (x.kind === 'act' ? x.a.durationSec || 0 : (x.w.end - x.w.start) / 1000), 0);
  const weekKcal = week.reduce((n, x) => n + (x.kind === 'act' ? x.a.kcal || 0 : 0), 0);
  const weekDist = week.reduce((n, x) => n + (x.kind === 'act' ? x.a.distanceM || 0 : 0), 0);

  let lastDay = '';
  root.innerHTML = `
    <div class="card"><h2>Last 7 days</h2><div class="stats">
      <div class="stat"><b>${week.length}</b><span>Sessions</span></div>
      <div class="stat"><b>${fmtDuration(weekTime)}</b><span>Time</span></div>
      <div class="stat"><b>${fmtDist(weekDist) || '0'}</b><span>Distance</span></div>
      <div class="stat"><b>${fmtInt(weekKcal)}</b><span>Active kcal</span></div>
    </div></div>

    <div class="card"><h2>Garmin <small>${s.icuLastSync ? 'synced ' + fmtDate(s.icuLastSync, { day: 'numeric', month: 'short' }) + ' ' + fmtTime(s.icuLastSync) : 'not connected'}</small></h2>
      ${s.icuKey ? '' : '<p class="small muted" style="margin-top:0">Connect Intervals.icu in Settings to pull your Garmin activities automatically, or import files exported from Garmin Connect.</p>'}
      <div class="btn-row">
        ${s.icuKey ? '<button class="btn primary" data-act="sync">Sync now</button>' : '<button class="btn primary" data-act="settings">Connect</button>'}
        <label class="btn">Import file<input type="file" accept=".fit,.zip,.gpx,.tcx" multiple id="imp" hidden></label>
        <button class="btn" data-act="manual">Add manually</button>
      </div></div>

    ${all.length ? all.slice(0, 80).map(x => {
      const d = dayKey(x.t);
      const head = d !== lastDay ? `<div class="section-title">${fmtDate(x.t, { weekday: 'long', day: 'numeric', month: 'short' })}</div>` : '';
      lastDay = d;
      if (x.kind === 'gym') return `${head}<div class="card tap" data-go="train" style="padding:10px 14px"><div class="row">
        <div class="act-icon">🏋️</div><div class="grow"><div class="title">${esc(x.w.name)}</div>
        <div class="sub small muted">${fmtDuration((x.w.end - x.w.start) / 1000)} · ${Math.round(toDisplayW(workoutVolume(x.w))).toLocaleString()} ${wUnit()} lifted</div></div>
        <span class="chip">Gym log</span></div></div>`;
      const a = x.a;
      return `${head}<div class="card tap" data-a="${a.id}" style="padding:10px 14px"><div class="row">
        <div class="act-icon">${actIcon(a.type)}</div><div class="grow" style="min-width:0"><div class="title">${esc(a.name)}</div>
        <div class="sub small muted">${fmtTime(a.start)} · ${esc(activitySub(a))}</div></div>
        <span class="chip ${a.source === 'icu' || a.source === 'file' ? 'garmin' : ''}">${a.source === 'manual' ? 'Manual' : 'Garmin'}</span></div></div>`;
    }).join('') : '<div class="empty">No activities yet.</div>'}`;

  root.onclick = async e => {
    const t = e.target.closest('[data-act],[data-a]');
    if (!t) return;
    if (t.dataset.a) return showActivity(state.activities.find(a => a.id === t.dataset.a));
    const a = t.dataset.act;
    if (a === 'settings') go('settings');
    if (a === 'manual') manualActivity();
    if (a === 'sync') {
      t.disabled = true;
      t.innerHTML = '<span class="spinner"></span>';
      try { await syncIntervals(); } catch (err) { toast(err.message, 5000); }
      rerender();
    }
  };
  root.querySelector('#imp').onchange = async e => {
    let n = 0;
    for (const f of e.target.files) {
      try {
        for (const s of await readActivityFile(f)) {
          const id = 'file_' + s.start;
          if (state.activities.some(a => a.id === id || (Math.abs(a.start - s.start) < 60000 && a.type === s.type))) continue;
          state.activities.push({ id, source: 'file', name: s.name || actLabel(s.type), ...s, date: dayKey(s.start) });
          n++;
        }
      } catch (err) { toast(`${f.name}: ${err.message}`, 5000); }
    }
    save();
    if (n) toast(`Imported ${n} activit${n === 1 ? 'y' : 'ies'}`);
    rerender();
  };
}

function showActivity(a) {
  if (!a) return;
  sheet(a.name, (body, close) => {
    const w = state.wellness[a.date];
    body.innerHTML = `
      <p class="muted small" style="margin-top:0">${actIcon(a.type)} ${esc(actLabel(a.type))} · ${fmtDate(a.start, { weekday: 'long', day: 'numeric', month: 'long' })} at ${fmtTime(a.start)}${a.device ? ' · ' + esc(a.device) : ''}</p>
      <div class="stats">
        ${a.durationSec ? `<div class="stat"><b>${fmtDuration(a.durationSec)}</b><span>Moving time</span></div>` : ''}
        ${a.distanceM ? `<div class="stat"><b>${fmtDist(a.distanceM)}</b><span>Distance</span></div>` : ''}
        ${fmtPace(a) ? `<div class="stat"><b>${fmtPace(a)}</b><span>${/Ride/.test(a.type) ? 'Speed' : 'Pace'}</span></div>` : ''}
        ${a.avgHr ? `<div class="stat"><b>${Math.round(a.avgHr)}</b><span>Avg HR</span></div>` : ''}
        ${a.maxHr ? `<div class="stat"><b>${Math.round(a.maxHr)}</b><span>Max HR</span></div>` : ''}
        ${a.kcal ? `<div class="stat"><b>${fmtInt(a.kcal)}</b><span>kcal</span></div>` : ''}
        ${a.elevGain ? `<div class="stat"><b>${Math.round(a.elevGain)} m</b><span>Elevation</span></div>` : ''}
        ${a.load ? `<div class="stat"><b>${Math.round(a.load)}</b><span>Training load</span></div>` : ''}
      </div>
      ${w && (w.sleepSecs || w.restingHR) ? `<p class="small muted">That day: ${w.sleepSecs ? `slept ${fmtDuration(w.sleepSecs)}` : ''}${w.sleepSecs && w.restingHR ? ' · ' : ''}${w.restingHR ? `resting HR ${w.restingHR}` : ''}</p>` : ''}
      ${a.icuId ? `<p><a href="https://intervals.icu/activities/${encodeURIComponent(a.icuId)}" target="_blank" rel="noopener">Open in Intervals.icu</a></p>` : ''}
      ${a.source === 'icu' ? '' : '<button class="btn danger block" data-del>Delete</button>'}`;
    const del = body.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (await confirmSheet('Delete activity?', 'It will be removed from this app.')) {
        state.activities = state.activities.filter(x => x.id !== a.id);
        save(); close(); rerender();
      }
    };
  });
}

function manualActivity() {
  sheet('Add activity', (body, close) => {
    const now = new Date();
    const local = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    body.innerHTML = `
      <label class="field"><span>Type</span><select id="mt">${['Run', 'Ride', 'Walk', 'Hike', 'Swim', 'Workout', 'Yoga', 'Rowing', 'Tennis', 'Padel', 'Soccer'].map(t => `<option value="${t}">${actLabel(t)}</option>`).join('')}</select></label>
      <label class="field"><span>Name</span><input type="text" id="mn" placeholder="Optional"></label>
      <label class="field"><span>Start</span><input type="datetime-local" id="ms" value="${local}" style="width:100%;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);padding:8px"></label>
      <div class="grid3">
        <label class="field"><span>Minutes</span><input type="number" inputmode="numeric" id="mm"></label>
        <label class="field"><span>${state.settings.units === 'lb' ? 'Miles' : 'Km'}</span><input type="number" inputmode="decimal" id="md"></label>
        <label class="field"><span>kcal</span><input type="number" inputmode="numeric" id="mk"></label>
      </div>
      <button class="btn primary block" id="msave">Save</button>`;
    body.querySelector('#msave').onclick = () => {
      const v = id => parseFloat(body.querySelector(id).value) || null;
      const type = body.querySelector('#mt').value;
      const start = new Date(body.querySelector('#ms').value).getTime() || Date.now();
      const d = v('#md');
      state.activities.push({
        id: 'man_' + uid(), source: 'manual', type, name: body.querySelector('#mn').value.trim() || actLabel(type),
        start, date: dayKey(start), durationSec: v('#mm') ? v('#mm') * 60 : null,
        distanceM: d ? d * (state.settings.units === 'lb' ? 1609.34 : 1000) : null, kcal: v('#mk'),
      });
      save(); close(); rerender();
    };
  });
}
