// Muscle map: which muscles you've trained, how fatigued they are, and where you're getting stronger.

import { state } from './store.js';
import { esc } from './ui.js';
import { getExercise } from './exercises.js';
import { e1rm } from './train.js';
import { BODY } from './bodydata.js';

// Library muscle names → shapes on the body map.
const SHAPES = {
  chest: ['chest'], shoulders: ['front-deltoids', 'back-deltoids'], biceps: ['biceps'], triceps: ['triceps'],
  forearms: ['forearm'], abdominals: ['abs', 'obliques'], lats: ['upper-back'], 'middle back': ['upper-back'],
  'lower back': ['lower-back'], traps: ['trapezius'], neck: ['neck'], quadriceps: ['quadriceps'],
  hamstrings: ['hamstring'], glutes: ['gluteal'], calves: ['calves', 'left-soleus', 'right-soleus'],
  adductors: ['abductors'], abductors: ['adductor'],
};
const LABEL = { abdominals: 'Abs', 'middle back': 'Middle back', 'lower back': 'Lower back' };
const label = m => LABEL[m] || m.charAt(0).toUpperCase() + m.slice(1);

const DAY = 86400000;
const RANGES = { week: 7, '30d': 30, '90d': 90, all: Infinity };
let tab = 'balance';
let range = 'week';

// Calls fn(muscle, share, set, workout) for every working set; secondary muscles count half.
function eachSet(since, fn) {
  for (const w of state.workouts) {
    if (!w.end || w.start < since) continue;
    for (const e of w.exercises) {
      const x = getExercise(e.exId);
      if (!x) continue;
      for (const s of e.sets) {
        if (!s.done || s.warm) continue;
        for (const m of x.m || []) fn(m, 1, s, w, e);
        for (const m of x.s || []) fn(m, 0.5, s, w, e);
      }
    }
  }
}

function balance() {
  const sets = {};
  eachSet(Date.now() - RANGES[range] * DAY, (m, k) => { sets[m] = (sets[m] || 0) + k; });
  return sets;
}

// Each set adds fatigue that halves every 36 hours.
function fatigue() {
  const f = {};
  const now = Date.now();
  eachSet(now - 7 * DAY, (m, k, s, w) => { f[m] = (f[m] || 0) + k * Math.pow(0.5, (now - (w.end || w.start)) / (36 * 3600000)); });
  return f;
}

// Best estimated 1RM per exercise in the last 30 days against the 30 days before, averaged per muscle.
function strength() {
  const now = Date.now();
  const best = {};
  eachSet(now - 60 * DAY, (m, k, s, w, e) => {
    if (k < 1) return;
    const v = e1rm(s.w, s.r);
    if (!v) return;
    const key = m + '|' + e.exId;
    const b = (best[key] = best[key] || { m, recent: 0, before: 0 });
    if (w.start >= now - 30 * DAY) b.recent = Math.max(b.recent, v); else b.before = Math.max(b.before, v);
  });
  const sum = {};
  for (const b of Object.values(best)) {
    if (!b.recent || !b.before) continue;
    const t = (sum[b.m] = sum[b.m] || { n: 0, pct: 0 });
    t.n++;
    t.pct += (b.recent / b.before - 1) * 100;
  }
  const out = {};
  for (const [m, t] of Object.entries(sum)) out[m] = t.pct / t.n;
  return out;
}

function figure(side, fills) {
  return `<svg viewBox="0 0 100 200" class="body-fig" role="img" aria-label="${side === 'front' ? 'Front' : 'Back'} of body">
    ${BODY[side].map(([shape, polys]) => polys.map(p => `<polygon points="${p}" style="fill:${fills[shape] || (shape === 'head' || shape === 'knees' ? 'var(--body-base)' : 'var(--body-off)')}"></polygon>`).join('')).join('')}
  </svg>`;
}

function shapeFills(values, color) {
  const fills = {};
  for (const [m, v] of Object.entries(values)) for (const s of SHAPES[m] || []) {
    const c = color(v);
    if (c) fills[s] = c;
  }
  return fills;
}

const mix = (pct, c) => `color-mix(in srgb, ${c} ${Math.round(pct)}%, var(--body-off))`;

function view() {
  let values, fills, legend, list;
  if (tab === 'balance') {
    values = balance();
    const max = Math.max(1, ...Object.values(values));
    fills = shapeFills(values, v => (v > 0 ? mix(30 + 70 * v / max, 'var(--accent)') : ''));
    const ranked = Object.entries(values).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const missing = Object.keys(SHAPES).filter(m => !values[m]);
    legend = 'Sets worked, counting secondary muscles as half a set.';
    list = ranked.length
      ? `<div class="mchips">${ranked.map(([m, v]) => `<span class="chip">${esc(label(m))} <b>${Math.round(v * 2) / 2}</b></span>`).join('')}</div>
         ${missing.length ? `<p class="small muted" style="margin:8px 0 0">Not trained: ${missing.map(label).join(', ')}.</p>` : ''}`
      : '<p class="small muted" style="margin:0">No sets logged in this period yet.</p>';
  } else if (tab === 'fatigue') {
    values = fatigue();
    const level = v => (v >= 6 ? 'var(--danger)' : v >= 2.5 ? 'var(--warn)' : 'var(--m-good)');
    fills = shapeFills(Object.fromEntries(Object.keys(SHAPES).map(m => [m, values[m] || 0])), level);
    const tired = Object.entries(values).filter(([, v]) => v >= 2.5).sort((a, b) => b[1] - a[1]);
    legend = '<span class="dot" style="background:var(--m-good)"></span> Ready <span class="dot" style="background:var(--warn)"></span> Recovering <span class="dot" style="background:var(--danger)"></span> Fatigued';
    list = tired.length
      ? `<p class="small" style="margin:0">Give these a rest: ${tired.map(([m, v]) => `<b>${esc(label(m))}</b>${v >= 6 ? ' (fatigued)' : ''}`).join(', ')}.</p>`
      : '<p class="small muted" style="margin:0">Everything is recovered and ready to train.</p>';
  } else {
    values = strength();
    fills = shapeFills(values, v => (v > 1 ? mix(40 + Math.min(60, v * 6), 'var(--m-good)') : v < -1 ? mix(40 + Math.min(60, -v * 6), 'var(--danger)') : mix(45, 'var(--muted)')));
    const ranked = Object.entries(values).sort((a, b) => b[1] - a[1]);
    legend = 'Best estimated 1RM in the last 30 days against the 30 days before.';
    list = ranked.length
      ? `<div class="mchips">${ranked.map(([m, v]) => `<span class="chip" style="color:${v > 1 ? 'var(--m-good)' : v < -1 ? 'var(--danger)' : 'var(--muted)'}">${esc(label(m))} ${v > 0 ? '+' : ''}${Math.round(v)}%</span>`).join('')}</div>`
      : '<p class="small muted" style="margin:0">Log the same exercises across two months to see strength trends.</p>';
  }
  return `
    <div class="seg" data-mtabs>${[['balance', 'Balance'], ['fatigue', 'Fatigue'], ['strength', 'Strength']].map(([k, l]) => `<button data-mtab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${tab === 'balance' ? `<div class="seg sm" style="margin-top:8px">${[['week', 'Week'], ['30d', '30d'], ['90d', '90d'], ['all', 'All']].map(([k, l]) => `<button data-mrange="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <div class="body-map">${figure('front', fills)}${figure('back', fills)}</div>
    <p class="small muted mlegend">${legend}</p>
    ${list}`;
}

export function muscleCard() {
  return `<div class="card" id="muscles"><h2>Muscles</h2><div data-mbody>${view()}</div></div>`;
}

export function bindMuscles(root) {
  const card = root.querySelector('#muscles');
  if (!card) return;
  card.addEventListener('click', e => {
    const t = e.target.closest('[data-mtab],[data-mrange]');
    if (!t) return;
    if (t.dataset.mtab) tab = t.dataset.mtab;
    if (t.dataset.mrange) range = t.dataset.mrange;
    card.querySelector('[data-mbody]').innerHTML = view();
  });
}
