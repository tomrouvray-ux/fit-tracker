// Progress: body weight, calories, training volume, activity heatmap, PRs.

import { state, save, dayKey, addDays, parseDay, toDisplayW, fromDisplayW, wUnit, dayFoodTotals } from './store.js';
import { esc, sheet, toast, fmtDate, r0, fmtInt } from './ui.js';
import { lineChart, e1rm, workoutVolume, showExercise } from './train.js';
import { getExercise } from './exercises.js';
import { rerender } from './app.js';

export function logWeight() {
  sheet('Log weight', (body, close) => {
    body.innerHTML = `
      <div class="grid2">
        <label class="field"><span>Weight (${wUnit()})</span><input type="number" inputmode="decimal" step="any" id="wv"></label>
        <label class="field"><span>Date</span><input type="date" id="wd" value="${dayKey()}"></label>
      </div>
      <button class="btn primary block" id="ws">Save</button>`;
    setTimeout(() => body.querySelector('#wv').focus(), 50);
    body.querySelector('#ws').onclick = () => {
      const kg = fromDisplayW(body.querySelector('#wv').value);
      const date = body.querySelector('#wd').value || dayKey();
      if (!kg) return toast('Enter your weight.');
      state.weights = state.weights.filter(w => w.date !== date);
      state.weights.push({ date, kg });
      save(); close(); rerender();
    };
  });
}

function barChart(bars, { goal, h = 130, color = 'var(--accent)', fmt = v => fmtInt(v) } = {}) {
  const W = 320, pad = 4, top = 14, bottom = 16;
  const max = Math.max(goal || 0, ...bars.map(b => b.v), 1) * 1.08;
  const bw = (W - pad * 2) / bars.length;
  const Y = v => top + (1 - v / max) * (h - top - bottom);
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Bar chart">
    ${goal ? `<line x1="0" x2="${W}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--muted)" stroke-dasharray="4 3"/><text x="${W - 2}" y="${Y(goal) - 3}" text-anchor="end">goal ${fmt(goal)}</text>` : ''}
    ${bars.map((b, i) => {
      const x = pad + i * bw + bw * 0.15, w = bw * 0.7;
      const y = Y(b.v);
      return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0, h - bottom - y)}" rx="3" fill="${goal && b.v > goal * 1.05 ? 'var(--warn)' : (b.color || color)}"><title>${esc(b.label)}: ${fmt(b.v)}</title></rect>
        ${bars.length <= 16 && (i % Math.ceil(bars.length / 8) === 0) ? `<text x="${x + w / 2}" y="${h - 4}" text-anchor="middle">${esc(b.short)}</text>` : ''}`;
    }).join('')}
  </svg>`;
}

function weekKey(d) {
  const x = new Date(d);
  const wd = (x.getDay() + 7 - state.settings.weekStart) % 7;
  x.setDate(x.getDate() - wd);
  return dayKey(x);
}

export function renderProgress(root) {
  const today = dayKey();

  // weight
  const ws = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).filter(w => w.date >= addDays(today, -180));
  const wPts = ws.map(w => ({ x: parseDay(w.date), y: toDisplayW(w.kg) }));
  const wChange = ws.length > 1 ? toDisplayW(ws.at(-1).kg) - toDisplayW(ws[0].kg) : null;

  // calories, last 14 days
  const cal = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    cal.push({ v: dayFoodTotals(d).kcal, label: d, short: String(parseDay(d).getDate()) });
  }
  const logged = cal.filter(c => c.v > 0);
  const avgCal = logged.length ? logged.reduce((n, c) => n + c.v, 0) / logged.length : 0;

  // weekly training time (gym + activities), last 10 weeks
  const weeks = [];
  for (let i = 9; i >= 0; i--) {
    const k = weekKey(parseDay(addDays(today, -7 * i)));
    weeks.push({ k, gym: 0, act: 0 });
  }
  const wIdx = Object.fromEntries(weeks.map((w, i) => [w.k, i]));
  for (const w of state.workouts) if (w.end) { const i = wIdx[weekKey(w.start)]; if (i != null) weeks[i].gym += (w.end - w.start) / 3600000; }
  for (const a of state.activities) { const i = wIdx[weekKey(a.start)]; if (i != null) weeks[i].act += (a.durationSec || 0) / 3600; }

  // heatmap, 26 weeks
  const counts = {};
  for (const w of state.workouts) if (w.end) counts[dayKey(w.start)] = (counts[dayKey(w.start)] || 0) + 1;
  for (const a of state.activities) counts[a.date] = (counts[a.date] || 0) + 1;
  const startHeat = weekKey(parseDay(addDays(today, -7 * 25)));
  const cells = [];
  for (let d = startHeat; d <= today; d = addDays(d, 1)) cells.push(`<i class="${counts[d] ? 'l' + Math.min(3, counts[d]) : ''}" title="${d}${counts[d] ? `: ${counts[d]}` : ''}"></i>`);
  const activeDays = Object.keys(counts).filter(d => d >= startHeat).length;

  // PRs
  const best = {};
  for (const w of state.workouts) if (w.end) for (const e of w.exercises) for (const s of e.sets) {
    if (s.warm || !s.done) continue;
    const v = e1rm(s.w, s.r);
    if (v && (!best[e.exId] || v > best[e.exId].v)) best[e.exId] = { v, s, date: w.start, name: e.name };
  }
  const prs = Object.entries(best).sort((a, b) => b[1].date - a[1].date).slice(0, 12);

  root.innerHTML = `
    <div class="card"><h2>Body weight <small>${wChange != null ? `${wChange > 0 ? '+' : ''}${Math.round(wChange * 10) / 10} ${wUnit()} over ${Math.round((parseDay(ws.at(-1).date) - parseDay(ws[0].date)) / 864e5)} days` : ''}</small></h2>
      ${wPts.length > 1 ? lineChart(wPts, { h: 150 }) : `<p class="small muted">${wPts.length ? 'Log one more weigh-in to see a trend.' : 'No weigh-ins yet.'}</p>`}
      <button class="btn sm" data-act="weight">Log weight</button></div>

    <div class="card"><h2>Calories eaten <small>${logged.length ? `avg ${fmtInt(avgCal)} on ${logged.length} logged days` : 'last 14 days'}</small></h2>
      ${barChart(cal, { goal: state.settings.calorieGoal })}</div>

    <div class="card"><h2>Training hours per week</h2>
      ${barChart(weeks.map(w => ({ v: w.gym + w.act, label: 'Week of ' + w.k, short: fmtDate(parseDay(w.k), { day: 'numeric', month: 'numeric' }) })), { fmt: v => (Math.round(v * 10) / 10) + 'h' })}
      <p class="small muted" style="margin:4px 0 0">Gym sessions plus Garmin activities.</p></div>

    <div class="card"><h2>Consistency <small>${activeDays} active days in 26 weeks</small></h2>
      <div class="heat">${cells.join('')}</div></div>

    <div class="card"><h2>Recent PRs <small>estimated 1RM</small></h2>
      ${prs.length ? `<ul class="list">${prs.map(([id, p]) => `<li class="tap" data-ex="${esc(id)}"><div class="grow"><div class="title">${esc((getExercise(id) || {}).n || p.name)}</div>
        <div class="sub">${toDisplayW(p.s.w)} ${wUnit()} × ${p.s.r} · ${fmtDate(p.date, { day: 'numeric', month: 'short' })}</div></div>
        <b class="num">${toDisplayW(p.v)} ${wUnit()}</b></li>`).join('')}</ul>` : '<p class="small muted">Finish a workout to start tracking PRs.</p>'}</div>

    ${ws.length ? `<div class="card"><h2>Weigh-ins</h2><ul class="list">${[...ws].reverse().slice(0, 10).map(w => `<li><span class="grow">${fmtDate(parseDay(w.date))}${w.source === 'garmin' ? ' <span class="chip garmin">Garmin</span>' : ''}</span><span class="num">${toDisplayW(w.kg)} ${wUnit()}</span><button class="btn ghost sm danger" data-delw="${w.date}">Delete</button></li>`).join('')}</ul></div>` : ''}`;

  const heat = root.querySelector('.heat');
  heat.scrollLeft = heat.scrollWidth;

  root.onclick = e => {
    const t = e.target.closest('[data-act],[data-ex],[data-delw]');
    if (!t) return;
    if (t.dataset.act === 'weight') logWeight();
    if (t.dataset.ex) showExercise(t.dataset.ex);
    if (t.dataset.delw) { state.weights = state.weights.filter(w => w.date !== t.dataset.delw); save(); rerender(); }
  };
}
