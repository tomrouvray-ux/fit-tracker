// Today: calories, today's training, Garmin wellness and weight at a glance.

import { state, dayKey, addDays, parseDay, toDisplayW, wUnit, latestWeight } from './store.js';
import { esc, fmtDuration, fmtTime, fmtInt } from './ui.js';
import { summaryCard, openAddFood } from './food.js';
import { todaysRoutines, workoutVolume } from './train.js';
import { actIcon, activitySub } from './garmin.js';
import { logWeight } from './progress.js';
import { go } from './app.js';

export function renderToday(root) {
  const key = dayKey();
  const routines = todaysRoutines();
  const gym = state.workouts.filter(w => w.end && dayKey(w.start) === key);
  const acts = state.activities.filter(a => a.date === key).sort((a, b) => a.start - b.start);
  const well = state.wellness[key] || state.wellness[addDays(key, -1)];
  const lw = latestWeight();
  const aw = state.activeWorkout;

  root.innerHTML = `
    <p class="muted" style="margin:0 4px">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    ${summaryCard(key, { link: true })}
    <div class="btn-row">
      <button class="btn primary" data-act="photo">📷 Snap a meal</button>
      <button class="btn" data-act="food">Add food</button>
    </div>

    <div class="card"><h2>Training</h2>
      ${aw ? `<button class="btn primary block" data-go="workout">Resume ${esc(aw.name)}</button>` : ''}
      ${!aw && !gym.length && routines.length ? routines.map(r => `<button class="btn block" style="margin-bottom:8px" data-go="train">Today: ${esc(r.name)} · ${r.exercises.length} exercises</button>`).join('') : ''}
      ${gym.length || acts.length ? `<ul class="list">
        ${gym.map(w => `<li class="tap" data-go="train"><div class="act-icon">🏋️</div><div class="grow"><div class="title">${esc(w.name)}</div>
          <div class="sub">${fmtDuration((w.end - w.start) / 1000)} · ${Math.round(toDisplayW(workoutVolume(w))).toLocaleString()} ${wUnit()}</div></div></li>`).join('')}
        ${acts.map(a => `<li class="tap" data-go="activity"><div class="act-icon">${actIcon(a.type)}</div><div class="grow"><div class="title">${esc(a.name)}</div>
          <div class="sub">${fmtTime(a.start)} · ${esc(activitySub(a))}</div></div></li>`).join('')}
      </ul>` : (!aw && !routines.length ? `<p class="small muted" style="margin:0">Nothing logged yet today.</p>` : '')}
    </div>

    ${well && (well.steps || well.sleepSecs || well.restingHR || well.hrv) ? `<div class="card"><h2>Garmin <small>${state.wellness[key] ? 'today' : 'yesterday'}</small></h2><div class="stats">
      ${well.steps ? `<div class="stat"><b>${fmtInt(well.steps)}</b><span>Steps</span></div>` : ''}
      ${well.sleepSecs ? `<div class="stat"><b>${fmtDuration(well.sleepSecs)}</b><span>Sleep${well.sleepScore ? ` · ${well.sleepScore}` : ''}</span></div>` : ''}
      ${well.restingHR ? `<div class="stat"><b>${well.restingHR}</b><span>Resting HR</span></div>` : ''}
      ${well.hrv ? `<div class="stat"><b>${Math.round(well.hrv)}</b><span>HRV</span></div>` : ''}
    </div></div>` : ''}

    <div class="card"><h2>Body weight ${lw ? `<small>${lw.date === key ? 'today' : parseDay(lw.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>` : ''}</h2>
      <div class="row between"><b style="font-size:24px" class="num">${lw ? `${toDisplayW(lw.kg)} ${wUnit()}` : '–'}</b>
      <button class="btn sm" data-act="weight">Log weight</button></div></div>`;

  root.onclick = e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'photo') openAddFood(undefined, 'photo');
    if (a === 'food') openAddFood();
    if (a === 'weight') logWeight();
  };
}
