// Today: calories, today's training, Garmin wellness and weight at a glance.

import { state, dayKey, addDays, parseDay, toDisplayW, wUnit, latestWeight } from './store.js';
import { esc, fmtDuration, fmtTime, fmtInt, sheet } from './ui.js';
import { summaryCard, openAddFood } from './food.js';
import { workoutVolume, showWorkout, startWorkout } from './train.js';
import { getExercise, demo } from './exercises.js';
import { muscleCard, bindMuscles } from './muscles.js';
import { actIcon, activitySub } from './garmin.js';
import { logWeight } from './progress.js';
import { go } from './app.js';

export function renderToday(root) {
  const key = dayKey();
  const well = state.wellness[key] || state.wellness[addDays(key, -1)];
  const lw = latestWeight();
  root.innerHTML = `
    <p class="muted" style="margin:0 4px">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    ${summaryCard(key, { link: true })}
    <div class="btn-row">
      <button class="btn primary" data-act="photo">📷 Snap a meal</button>
      <button class="btn" data-act="food">Add food</button>
    </div>

    ${weekCard(key)}

    ${muscleCard()}

    ${well && (well.steps || well.sleepSecs || well.restingHR || well.hrv) ? `<div class="card"><h2>Garmin <small>${state.wellness[key] ? 'today' : 'yesterday'}</small></h2><div class="stats">
      ${well.steps ? `<div class="stat"><b>${fmtInt(well.steps)}</b><span>Steps</span></div>` : ''}
      ${well.sleepSecs ? `<div class="stat"><b>${fmtDuration(well.sleepSecs)}</b><span>Sleep${well.sleepScore ? ` · ${well.sleepScore}` : ''}</span></div>` : ''}
      ${well.restingHR ? `<div class="stat"><b>${well.restingHR}</b><span>Resting HR</span></div>` : ''}
      ${well.hrv ? `<div class="stat"><b>${Math.round(well.hrv)}</b><span>HRV</span></div>` : ''}
    </div></div>` : ''}

    <div class="card"><h2>Body weight ${lw ? `<small>${lw.date === key ? 'today' : parseDay(lw.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>` : ''}</h2>
      <div class="row between"><b style="font-size:24px" class="num">${lw ? `${toDisplayW(lw.kg)} ${wUnit()}` : '–'}</b>
      <button class="btn sm" data-act="weight">Log weight</button></div></div>`;

  bindMuscles(root);
  root.onclick = e => {
    const t = e.target.closest('[data-act],[data-wk],[data-day],[data-wid],[data-start],[data-routine]');
    if (!t) return;
    const d = t.dataset;
    if (d.wk) { weekOff += +d.wk; selDay = addDays(weekStartKey(key), weekOff * 7 + (weekOff ? 0 : dayIndex(key))); return renderToday(root); }
    if (d.day) { selDay = d.day; return renderToday(root); }
    if (d.wid) return showWorkout(state.workouts.find(w => w.id === d.wid));
    if (d.start) return startWorkout(state.routines.find(r => r.id === d.start));
    if (d.routine) return viewRoutine(state.routines.find(r => r.id === d.routine));
    const a = d.act;
    if (a === 'photo') openAddFood(undefined, 'photo');
    if (a === 'food') openAddFood();
    if (a === 'weight') logWeight();
  };
}

// ---------- This week ----------

let selDay = null;
let weekOff = 0;

const dayIndex = key => (parseDay(key).getDay() - state.settings.weekStart + 7) % 7;
const weekStartKey = key => addDays(key, -dayIndex(key));
const routinesOn = key => state.routines.filter(r => (r.days || []).includes(parseDay(key).getDay()));
const workoutsOn = key => state.workouts.filter(w => w.end && dayKey(w.start) === key);
const activitiesOn = key => state.activities.filter(a => a.date === key).sort((a, b) => a.start - b.start);

function weekCard(today) {
  if (!selDay) selDay = today;
  const start = addDays(weekStartKey(today), weekOff * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const title = weekOff === 0 ? 'This week' : weekOff === -1 ? 'Last week' : weekOff === 1 ? 'Next week'
    : `${parseDay(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${parseDay(days[6]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  const strip = days.map(k => {
    const done = workoutsOn(k).length + activitiesOn(k).length > 0;
    const planned = !done && k >= today && routinesOn(k).length > 0;
    const d = parseDay(k);
    return `<button data-day="${k}" class="${k === today ? 'today' : ''} ${k === selDay ? 'sel' : ''}">
      <span class="wd">${d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</span>
      <span class="dn">${d.getDate()}</span>
      <span class="dots">${done ? '<i></i>' : ''}${planned ? '<i class="plan"></i>' : ''}</span></button>`;
  }).join('');
  return `<div class="card">
    <div class="week-head"><button data-wk="-1" aria-label="Previous week">‹</button><b>${title}</b><button data-wk="1" aria-label="Next week">›</button></div>
    <div class="week">${strip}</div>
    <div class="day-items">${dayItems(selDay, today)}</div>
  </div>`;
}

function dayItems(key, today) {
  const when = key === today ? 'Today' : parseDay(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  const aw = state.activeWorkout;
  const gym = workoutsOn(key);
  const acts = activitiesOn(key);
  const plans = gym.length ? [] : routinesOn(key);
  const rows = [];
  if (aw && key === today) rows.push(`<div class="day-row tap" data-go="workout"><div class="ic">🏋️</div><div class="grow"><div class="k">In progress</div><div class="t">${esc(aw.name)}</div></div><button class="btn primary sm">Resume</button></div>`);
  for (const w of gym) rows.push(`<div class="day-row tap" data-wid="${w.id}"><div class="ic">🏋️</div><div class="grow"><div class="k">${when} · done</div><div class="t">${esc(w.name)}</div>
    <div class="small muted">${fmtDuration((w.end - w.start) / 1000)} · ${Math.round(toDisplayW(workoutVolume(w))).toLocaleString()} ${wUnit()}</div></div></div>`);
  for (const a of acts) rows.push(`<div class="day-row tap" data-go="activity"><div class="ic">${actIcon(a.type)}</div><div class="grow"><div class="k">${when} · ${fmtTime(a.start)}</div><div class="t">${esc(a.name)}</div>
    <div class="small muted">${esc(activitySub(a))}</div></div></div>`);
  if (!(aw && key === today)) for (const r of plans) {
    const label = key === today ? 'Today' : key > today ? `${when} · planned` : `${when} · planned, not done`;
    rows.push(`<div class="day-row tap" data-routine="${r.id}"><div class="ic plan">🏋️</div><div class="grow"><div class="k">${label}</div><div class="t">${esc(r.name)}</div>
      <div class="small muted">${r.exercises.length} exercise${r.exercises.length === 1 ? "" : "s"}</div></div>${key === today ? `<button class="btn primary sm" data-start="${r.id}">Start</button>` : ''}</div>`);
  }
  if (!rows.length) rows.push(`<p class="small muted" style="margin:10px 2px 0">${key > today ? 'Nothing planned.' : key === today ? 'Nothing logged yet today.' : 'Rest day.'}</p>`);
  return rows.join('');
}

function viewRoutine(r) {
  if (!r) return;
  sheet(r.name, (body, close) => {
    body.innerHTML = `<ul class="list">${r.exercises.map(e => {
      const x = getExercise(e.exId);
      return `<li>${x ? demo(x, { thumb: true }) : ''}<div class="grow"><div class="title">${esc(x ? x.n : e.exId)}</div>
        <div class="sub">${e.sets || 3} × ${esc(String(e.reps || ''))}</div></div></li>`;
    }).join('')}</ul>
    <button class="btn primary block" data-s>Start ${esc(r.name)}</button>`;
    body.querySelector('[data-s]').onclick = () => { close(); startWorkout(r); };
  });
}
