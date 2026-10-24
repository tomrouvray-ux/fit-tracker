// Workouts: routines, guided sessions with rest timer, history, exercise library.

import { state, save, uid, dayKey, toDisplayW, fromDisplayW, wUnit } from './store.js';
import { esc, sheet, toast, confirmSheet, fmtDuration, fmtDate, fmtClock, r1, bar } from './ui.js';
import { loadLibrary, getExercise, search, imageUrl, demo, isTimed, STARTERS, WEEKDAYS, MUSCLES, EQUIPMENT } from './exercises.js';
import { go, rerender } from './app.js';

// ---------- history helpers ----------

export const e1rm = (w, r) => (w > 0 && r > 0 ? (r === 1 ? w : w * (1 + Math.min(r, 12) / 30)) : 0);

function finished() {
  return state.workouts.filter(w => w.end).sort((a, b) => b.start - a.start);
}

export function lastSetsFor(exId, excludeId) {
  for (const w of finished()) {
    if (w.id === excludeId) continue;
    const ex = w.exercises.find(e => e.exId === exId);
    if (ex && ex.sets.some(s => s.done)) return ex.sets.filter(s => s.done && !s.warm);
  }
  return [];
}

export function bestE1rm(exId, excludeId) {
  let best = 0;
  for (const w of state.workouts) {
    if (w.id === excludeId || !w.end) continue;
    for (const e of w.exercises) if (e.exId === exId) for (const s of e.sets) if (s.done && !s.warm) best = Math.max(best, e1rm(s.w, s.r));
  }
  return best;
}

export function workoutVolume(w) {
  let v = 0;
  for (const e of w.exercises) for (const s of e.sets) if (s.done && !s.warm) v += (s.w || 0) * (s.r || 0);
  return v;
}

function exName(id, fallback) {
  const x = getExercise(id);
  return x ? x.n : fallback || id.replace(/_/g, ' ');
}

export function todaysRoutines() {
  const wd = new Date().getDay();
  return state.routines.filter(r => (r.days || []).includes(wd));
}

// ---------- Train tab ----------

export function renderTrain(root) {
  const aw = state.activeWorkout;
  const today = todaysRoutines();
  const hist = finished().slice(0, 15);
  root.innerHTML = `
    ${aw ? `<div class="card"><h2>Workout in progress <small>${esc(aw.name)}</small></h2>
      <button class="btn primary block" data-act="resume">Resume workout</button></div>` : ''}

    ${!aw ? `<div class="card"><h2>Today <small>${esc(WEEKDAYS[new Date().getDay()])}</small></h2>
      ${today.length ? today.map(r => `<button class="btn primary block" style="margin-bottom:8px" data-start="${r.id}">Start ${esc(r.name)}</button>`).join('')
        : `<p class="muted small" style="margin:0 0 10px">${state.routines.length ? 'Rest day in your plan.' : 'No routines yet. Load a starter plan or make your own.'}</p>`}
      <button class="btn block" data-act="empty">Start an empty workout</button></div>` : ''}

    <div class="section-title">Routines</div>
    <div class="card">
      ${state.routines.length ? `<ul class="list">${state.routines.map(r => `
        <li><div class="grow tap" data-edit="${r.id}"><div class="title">${esc(r.name)}</div>
          <div class="sub">${(r.days || []).map(d => WEEKDAYS[d]).join(', ') || 'Any day'} · ${r.exercises.length} exercises</div></div>
          ${aw ? '' : `<button class="btn sm" data-start="${r.id}">Start</button>`}</li>`).join('')}</ul>`
        : '<div class="empty">No routines yet.</div>'}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn sm" data-act="new-routine">New routine</button>
        <button class="btn sm" data-act="starters">Starter plans</button>
      </div>
    </div>

    <div class="section-title">Library</div>
    <div class="card"><button class="btn block" data-act="library">Browse 870+ exercises</button></div>

    <div class="section-title">History</div>
    <div class="card">${hist.length ? `<ul class="list">${hist.map(w => `
      <li class="tap" data-hist="${w.id}"><div class="grow"><div class="title">${esc(w.name)}</div>
        <div class="sub">${fmtDate(w.start)} · ${fmtDuration((w.end - w.start) / 1000)} · ${Math.round(toDisplayW(workoutVolume(w))).toLocaleString()} ${wUnit()}</div></div>
        ${w.prs ? `<span class="chip pr">${w.prs} PR</span>` : ''}</li>`).join('')}</ul>` : '<div class="empty">Finished workouts show up here.</div>'}
    </div>`;

  root.onclick = e => {
    const t = e.target.closest('[data-act],[data-start],[data-edit],[data-hist]');
    if (!t) return;
    if (t.dataset.start) return startWorkout(state.routines.find(r => r.id === t.dataset.start));
    if (t.dataset.edit) return editRoutine(state.routines.find(r => r.id === t.dataset.edit));
    if (t.dataset.hist) return showWorkout(state.workouts.find(w => w.id === t.dataset.hist));
    const a = t.dataset.act;
    if (a === 'resume') go('workout');
    if (a === 'empty') startWorkout(null);
    if (a === 'new-routine') editRoutine(null);
    if (a === 'starters') pickStarter();
    if (a === 'library') openLibrary();
  };
}

function pickStarter() {
  sheet('Starter plans', (body, close) => {
    body.innerHTML = STARTERS.map((p, i) => `<div class="card"><h2>${esc(p.name)}</h2>
      <p class="small muted" style="margin:0 0 10px">${p.routines.map(r => `${esc(r.name)} (${r.days.map(d => WEEKDAYS[d]).join(', ')})`).join(' · ')}</p>
      <button class="btn sm primary" data-i="${i}">Add these routines</button></div>`).join('');
    body.onclick = e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      for (const r of STARTERS[b.dataset.i].routines) {
        state.routines.push({ id: uid(), name: r.name, days: [...r.days], exercises: r.exercises.map(x => ({ ...x })) });
      }
      save();
      close();
      toast('Routines added. Tap one to edit.');
      rerender();
    };
  });
}

function editRoutine(r) {
  const isNew = !r;
  const draft = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), name: '', days: [], exercises: [] };
  sheet(isNew ? 'New routine' : 'Edit routine', (body, close) => {
    const draw = () => {
      body.innerHTML = `
        <label class="field"><span>Name</span><input type="text" id="rn" value="${esc(draft.name)}" placeholder="e.g. Push day"></label>
        <div class="small muted" style="margin:10px 0 4px">Days</div>
        <div class="row wrap">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${draft.days.includes(d) ? 'on' : ''}" data-day="${d}">${WEEKDAYS[d]}</button>`).join('')}</div>
        <div class="section-title">Exercises</div>
        ${draft.exercises.map((x, i) => `<div class="card" style="padding:10px 12px">
          <div class="row between"><b class="grow">${esc(exName(x.exId, x.name))}</b>
            <button class="btn ghost sm" data-up="${i}" aria-label="Move up">↑</button>
            <button class="btn ghost sm danger" data-rm="${i}">Remove</button></div>
          <div class="grid3" style="margin-top:6px">
            <label class="field" style="margin:0"><span>Sets</span><input type="number" inputmode="numeric" data-f="sets" data-i="${i}" value="${x.sets}"></label>
            <label class="field" style="margin:0"><span>${isTimed(getExercise(x.exId)) ? 'Time' : 'Reps'}</span><input type="text" data-f="reps" data-i="${i}" value="${esc(x.reps)}"></label>
            <label class="field" style="margin:0"><span>Rest (s)</span><input type="number" inputmode="numeric" data-f="rest" data-i="${i}" value="${x.rest}"></label>
          </div></div>`).join('') || '<div class="empty">Add your first exercise.</div>'}
        <button class="btn block" data-add>Add exercise</button>
        <div class="btn-row" style="margin-top:16px">
          ${isNew ? '' : '<button class="btn danger" data-del>Delete</button>'}
          <button class="btn primary" data-save>Save routine</button>
        </div>`;
    };
    draw();
    body.oninput = e => {
      if (e.target.id === 'rn') draft.name = e.target.value;
      const f = e.target.dataset.f;
      if (f) {
        const x = draft.exercises[e.target.dataset.i];
        x[f] = f === 'reps' ? e.target.value : parseInt(e.target.value) || 0;
      }
    };
    body.onclick = async e => {
      const t = e.target;
      if (t.dataset.day) {
        const d = +t.dataset.day;
        draft.days = draft.days.includes(d) ? draft.days.filter(x => x !== d) : [...draft.days, d];
        return draw();
      }
      if (t.dataset.rm) { draft.exercises.splice(+t.dataset.rm, 1); return draw(); }
      if (t.dataset.up && +t.dataset.up > 0) {
        const i = +t.dataset.up;
        [draft.exercises[i - 1], draft.exercises[i]] = [draft.exercises[i], draft.exercises[i - 1]];
        return draw();
      }
      if (t.closest('[data-add]')) {
        const ids = await pickExercises();
        for (const id of ids) draft.exercises.push({ exId: id, sets: 3, reps: isTimed(getExercise(id)) ? '60s' : '8-12', rest: state.settings.restDefault });
        return draw();
      }
      if (t.closest('[data-del]')) {
        if (await confirmSheet('Delete routine?', `“${draft.name}” will be removed. Your workout history stays.`)) {
          state.routines = state.routines.filter(x => x.id !== draft.id);
          save(); close(); rerender();
        }
        return;
      }
      if (t.closest('[data-save]')) {
        if (!draft.name.trim()) draft.name = 'Routine';
        const i = state.routines.findIndex(x => x.id === draft.id);
        if (i >= 0) state.routines[i] = draft; else state.routines.push(draft);
        save(); close(); rerender();
      }
    };
  });
}

// ---------- exercise picker / library ----------

export function pickExercises() {
  return new Promise(resolve => {
    const picked = [];
    let done = false;
    sheet('Add exercises', (body, close) => {
      libraryUI(body, {
        picking: picked,
        onDone: () => { done = true; resolve(picked); close(); },
      });
    }, { onClose: () => { if (!done) resolve(picked); } });
  });
}

function openLibrary() {
  sheet('Exercise library', body => libraryUI(body, {}));
}

function libraryUI(body, { picking, onDone }) {
  let q = '', muscle = '', equipment = '';
  body.innerHTML = `
    <input type="search" id="exq" placeholder="Search exercises" autocomplete="off">
    <div class="grid2" style="margin-top:8px">
      <select id="exm"><option value="">All muscles</option>${MUSCLES.map(m => `<option>${m}</option>`).join('')}</select>
      <select id="exe"><option value="">All equipment</option>${EQUIPMENT.map(m => `<option>${m}</option>`).join('')}</select>
    </div>
    ${picking ? '<div class="row between" style="margin-top:10px"><span class="small muted" id="pc">0 selected</span><button class="btn sm primary" id="pdone">Add selected</button></div>' : ''}
    <ul class="list" id="exlist" style="margin-top:6px"></ul>
    <button class="btn block" id="custom" style="margin-top:10px">Create your own exercise</button>`;
  const list = body.querySelector('#exlist');
  const draw = () => {
    const res = search(q, { muscle, equipment });
    list.innerHTML = res.map(x => {
      const img = imageUrl(x);
      const sel = picking && picking.includes(x.id);
      return `<li class="tap" data-id="${esc(x.id)}">
        ${img ? `<img class="ex-thumb" loading="lazy" src="${img}" alt="">` : '<div class="ex-thumb"></div>'}
        <div class="grow"><div class="title">${esc(x.n)}</div><div class="sub">${esc((x.m || []).join(', '))} · ${esc(x.e)}</div></div>
        ${picking ? `<span class="chip ${sel ? 'on' : ''}">${sel ? 'Added' : 'Add'}</span>` : ''}</li>`;
    }).join('') || '<li class="empty">No matches.</li>';
    if (picking) body.querySelector('#pc').textContent = `${picking.length} selected`;
  };
  loadLibrary().then(draw);
  body.querySelector('#exq').oninput = e => { q = e.target.value; draw(); };
  body.querySelector('#exm').onchange = e => { muscle = e.target.value; draw(); };
  body.querySelector('#exe').onchange = e => { equipment = e.target.value; draw(); };
  if (picking) body.querySelector('#pdone').onclick = onDone;
  body.querySelector('#custom').onclick = () => createCustomExercise(id => {
    if (picking) picking.push(id);
    draw();
  });
  list.onclick = e => {
    const li = e.target.closest('[data-id]');
    if (!li) return;
    const id = li.dataset.id;
    if (picking) {
      const i = picking.indexOf(id);
      if (i >= 0) picking.splice(i, 1); else picking.push(id);
      draw();
    } else {
      showExercise(id);
    }
  };
  setTimeout(() => body.querySelector('#exq').focus(), 50);
}

function createCustomExercise(done) {
  sheet('New exercise', (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Name</span><input type="text" id="cn"></label>
      <div class="grid2">
        <label class="field"><span>Main muscle</span><select id="cm">${MUSCLES.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label class="field"><span>Equipment</span><select id="ce">${EQUIPMENT.map(m => `<option>${m}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="ct"> Logged by time (planks, holds, cardio)</label>
      <button class="btn primary block" id="cs">Save exercise</button>`;
    body.querySelector('#cs').onclick = () => {
      const n = body.querySelector('#cn').value.trim();
      if (!n) return toast('Give it a name first.');
      const x = { id: 'custom_' + uid(), n, c: body.querySelector('#ct').checked ? 'cardio' : 'strength', e: body.querySelector('#ce').value, m: [body.querySelector('#cm').value], s: [], i: [], custom: true };
      state.customExercises.push(x);
      save(); close(); done(x.id);
    };
  });
}

export function showExercise(id) {
  const x = getExercise(id);
  if (!x) return;
  const hist = [];
  for (const w of finished()) {
    const e = w.exercises.find(e => e.exId === id);
    if (!e) continue;
    const best = Math.max(0, ...e.sets.filter(s => s.done && !s.warm).map(s => e1rm(s.w, s.r)));
    const top = e.sets.filter(s => s.done && !s.warm).sort((a, b) => (b.w || 0) - (a.w || 0))[0];
    if (top) hist.push({ date: w.start, best, top });
  }
  sheet(x.n, body => {
    body.innerHTML = `${demo(x)}
      <p class="small muted">${esc((x.m || []).join(', '))}${x.s && x.s.length ? ` · also ${esc(x.s.join(', '))}` : ''} · ${esc(x.e)}${x.l ? ` · ${esc(x.l)}` : ''}</p>
      ${hist.length ? `<div class="card"><h2>Your history <small>best est. 1RM ${toDisplayW(Math.max(...hist.map(h => h.best)))} ${wUnit()}</small></h2>
        ${hist.length > 1 ? lineChart(hist.slice().reverse().map(h => ({ x: h.date, y: toDisplayW(h.best) }))) : ''}
        <ul class="list">${hist.slice(0, 8).map(h => `<li><span class="grow">${fmtDate(h.date)}</span><span class="num">${toDisplayW(h.top.w)} ${wUnit()} × ${h.top.r}</span></li>`).join('')}</ul></div>` : ''}
      ${x.i && x.i.length ? `<div class="card"><h2>How to</h2><ol style="margin:0;padding-left:20px">${x.i.map(s => `<li style="margin:6px 0">${esc(s)}</li>`).join('')}</ol></div>` : ''}`;
  });
}

// ---------- workout session ----------

export function startWorkout(routine) {
  if (state.activeWorkout) return go('workout');
  const w = {
    id: uid(),
    routineId: routine ? routine.id : null,
    name: routine ? routine.name : 'Workout',
    start: Date.now(),
    end: null,
    exercises: [],
  };
  if (routine) for (const r of routine.exercises) w.exercises.push(buildExercise(r.exId, r));
  state.activeWorkout = w;
  save();
  go('workout');
}

function buildExercise(exId, plan = {}) {
  const prev = lastSetsFor(exId);
  const n = plan.sets || Math.max(prev.length, 3);
  const timed = isTimed(getExercise(exId));
  const target = parseInt(plan.reps) || null;
  const sets = [];
  for (let i = 0; i < n; i++) {
    const p = prev[i] || prev[prev.length - 1];
    sets.push({ w: p ? p.w : null, r: timed ? null : (p ? p.r : target), t: timed ? (p ? p.t : parseInt(plan.reps) || 60) : null, done: false, warm: false });
  }
  return { exId, name: exName(exId), target: plan.reps || '', rest: plan.rest || state.settings.restDefault, sets };
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.activeWorkout) keepAwake(true);
});

export function renderWorkout(root) {
  const w = state.activeWorkout;
  if (!w) return go('train');
  keepAwake(true);
  const unit = wUnit();
  const elapsed = () => fmtDuration((Date.now() - w.start) / 1000);
  root.innerHTML = `
    <div class="card"><div class="row between">
      <div class="grow"><input type="text" id="wname" value="${esc(w.name)}" style="font-weight:700;font-size:18px;background:none;border:0;padding:0;min-height:0">
      <div class="small muted"><span id="elapsed">${elapsed()}</span> · started ${new Date(w.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div></div>
      <button class="btn primary sm" data-act="finish">Finish</button></div></div>
    ${w.exercises.map((ex, ei) => {
      const x = getExercise(ex.exId);
      const timed = isTimed(x);
      const prev = lastSetsFor(ex.exId, w.id);
      const showDemo = state.settings.showDemos !== false;
      return `<section class="ex-card" data-ei="${ei}">
        ${showDemo ? demo(x, { minimize: true }) : ''}
        <header>${showDemo ? '' : demo(x, { thumb: true })}<div class="grow tap" data-info="${esc(ex.exId)}"><h3>${esc(ex.name)}</h3>
          <div class="hint">${ex.target ? `Target ${esc(ex.target)} · ` : ''}rest ${fmtClock(ex.rest)}</div></div>
          <button class="btn ghost sm" data-exmenu="${ei}" aria-label="Exercise options">•••</button></header>
        <table class="sets"><thead><tr><th>Set</th><th>Last</th><th>${unit}</th><th>${timed ? 'Sec' : 'Reps'}</th><th></th></tr></thead><tbody>
        ${ex.sets.map((s, si) => {
          const p = prev[si];
          const prevTxt = p ? (timed ? `${p.w ? toDisplayW(p.w) + '×' : ''}${p.t}s` : `${toDisplayW(p.w) || 0}×${p.r}`) : '–';
          return `<tr class="${s.done ? 'done' : ''} ${s.warm ? 'warm' : ''}">
            <td class="tap" data-setmenu="${ei}:${si}">${s.warm ? 'W' : ex.sets.filter((z, k) => !z.warm && k <= si).length}${s.pr ? ' 🏆' : ''}</td>
            <td class="prev">${prevTxt}</td>
            <td><input type="number" inputmode="decimal" step="any" data-w="${ei}:${si}" value="${s.w != null ? toDisplayW(s.w) : ''}" placeholder="0"></td>
            <td><input type="number" inputmode="numeric" data-${timed ? 't' : 'r'}="${ei}:${si}" value="${timed ? (s.t ?? '') : (s.r ?? '')}" placeholder="0"></td>
            <td><button class="tick" data-tick="${ei}:${si}" aria-label="Complete set">✓</button></td></tr>`;
        }).join('')}
        </tbody></table>
        <div class="ex-foot"><button class="btn sm grow" data-addset="${ei}">Add set</button></div>
      </section>`;
    }).join('')}
    <div class="btn-row"><button class="btn" data-act="addex">Add exercise</button></div>
    <div class="btn-row" style="margin-top:20px"><button class="btn danger" data-act="discard">Discard workout</button></div>`;

  const tick = setInterval(() => {
    const el = root.querySelector('#elapsed');
    if (!el || !state.activeWorkout) return clearInterval(tick);
    el.textContent = elapsed();
  }, 1000);

  const at = s => s.split(':').map(Number);
  root.oninput = e => {
    const d = e.target.dataset;
    if (e.target.id === 'wname') { w.name = e.target.value; return save(); }
    if (d.w) { const [a, b] = at(d.w); w.exercises[a].sets[b].w = fromDisplayW(e.target.value); }
    if (d.r) { const [a, b] = at(d.r); w.exercises[a].sets[b].r = parseInt(e.target.value) || null; }
    if (d.t) { const [a, b] = at(d.t); w.exercises[a].sets[b].t = parseInt(e.target.value) || null; }
    save();
  };
  root.onclick = async e => {
    if (e.target.closest('[data-demomin],[data-demoshow]')) {
      state.settings.showDemos = !!e.target.closest('[data-demoshow]');
      save();
      return renderWorkout(root);
    }
    const t = e.target.closest('[data-act],[data-tick],[data-addset],[data-exmenu],[data-setmenu],[data-info]');
    if (!t) return;
    const d = t.dataset;
    if (d.info) return showExercise(d.info);
    if (d.tick) {
      const [a, b] = at(d.tick);
      const ex = w.exercises[a], s = ex.sets[b];
      s.done = !s.done;
      if (s.done) {
        if (!isTimed(getExercise(ex.exId)) && !s.r) { s.done = false; return toast('Enter reps first.'); }
        if (!s.warm && s.w && s.r) {
          const best = Math.max(bestE1rm(ex.exId, w.id), ...ex.sets.filter((z, k) => k !== b && z.done && !z.warm).map(z => e1rm(z.w, z.r)));
          s.pr = best > 0 && e1rm(s.w, s.r) > best + 0.01;
          if (s.pr) toast(`New PR on ${ex.name}: ${toDisplayW(s.w)} ${unit} × ${s.r}`);
        }
        startRest(ex.rest);
      } else {
        s.pr = false;
      }
      save();
      return renderWorkout(root);
    }
    if (d.addset) {
      const ex = w.exercises[+d.addset];
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ w: last ? last.w : null, r: last ? last.r : null, t: last ? last.t : null, done: false, warm: false });
      save();
      return renderWorkout(root);
    }
    if (d.setmenu) return setMenu(root, ...at(d.setmenu));
    if (d.exmenu) return exMenu(root, +d.exmenu);
    if (d.act === 'addex') {
      const ids = await pickExercises();
      for (const id of ids) w.exercises.push(buildExercise(id));
      save();
      return renderWorkout(root);
    }
    if (d.act === 'discard') {
      if (await confirmSheet('Discard workout?', 'Nothing from this session will be saved.', 'Discard')) {
        state.activeWorkout = null; stopRest(); keepAwake(false); save(); go('train');
      }
    }
    if (d.act === 'finish') finishWorkout();
  };
}

function setMenu(root, ei, si) {
  const w = state.activeWorkout;
  const ex = w.exercises[ei];
  const s = ex.sets[si];
  sheet('Set ' + (si + 1), (body, close) => {
    body.innerHTML = `<div class="btn-row" style="flex-direction:column">
      <button class="btn" data-a="warm">${s.warm ? 'Make it a working set' : 'Mark as warm-up'}</button>
      <button class="btn" data-a="copy">Duplicate set</button>
      <button class="btn danger" data-a="del">Delete set</button></div>`;
    body.onclick = e => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'warm') s.warm = !s.warm;
      if (a === 'copy') ex.sets.splice(si + 1, 0, { ...s, done: false, pr: false });
      if (a === 'del') ex.sets.splice(si, 1);
      save(); close(); renderWorkout(root);
    };
  });
}

function exMenu(root, ei) {
  const w = state.activeWorkout;
  const ex = w.exercises[ei];
  sheet(ex.name, (body, close) => {
    body.innerHTML = `
      <label class="field"><span>Rest between sets (seconds)</span><input type="number" inputmode="numeric" id="rest" value="${ex.rest}"></label>
      <div class="btn-row" style="flex-direction:column">
        <button class="btn" data-a="up">Move up</button>
        <button class="btn" data-a="swap">Swap exercise</button>
        <button class="btn danger" data-a="del">Remove exercise</button></div>`;
    body.querySelector('#rest').oninput = e => { ex.rest = parseInt(e.target.value) || 0; save(); };
    body.onclick = async e => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'up' && ei > 0) [w.exercises[ei - 1], w.exercises[ei]] = [w.exercises[ei], w.exercises[ei - 1]];
      if (a === 'del') w.exercises.splice(ei, 1);
      if (a === 'swap') {
        close();
        const ids = await pickExercises();
        if (ids[0]) { const n = buildExercise(ids[0], { sets: ex.sets.length, reps: ex.target, rest: ex.rest }); w.exercises[ei] = n; }
        save();
        return renderWorkout(root);
      }
      save(); close(); renderWorkout(root);
    };
  });
}

function finishWorkout() {
  const w = state.activeWorkout;
  const doneSets = w.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
  if (!doneSets) return toast('Tick off at least one set, or discard the workout.');
  for (const e of w.exercises) e.sets = e.sets.filter(s => s.done);
  w.exercises = w.exercises.filter(e => e.sets.length);
  w.end = Date.now();
  w.prs = w.exercises.reduce((n, e) => n + e.sets.filter(s => s.pr).length, 0);
  state.workouts.push(w);
  state.activeWorkout = null;
  stopRest();
  keepAwake(false);
  save();
  go('train');
  showWorkout(w, true);
}

export function showWorkout(w, justFinished = false) {
  if (!w) return;
  sheet(justFinished ? 'Workout complete' : w.name, (body, close) => {
    const sets = w.exercises.reduce((n, e) => n + e.sets.filter(s => !s.warm).length, 0);
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${fmtDuration((w.end - w.start) / 1000)}</b><span>Duration</span></div>
        <div class="stat"><b>${Math.round(toDisplayW(workoutVolume(w))).toLocaleString()}</b><span>Volume (${wUnit()})</span></div>
        <div class="stat"><b>${sets}</b><span>Sets</span></div>
        <div class="stat"><b>${w.prs || 0}</b><span>PRs</span></div>
      </div>
      <p class="small muted">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      ${w.exercises.map(e => `<div class="card"><h2>${esc(e.name)}</h2>
        <div class="small">${e.sets.map(s => `<span class="chip ${s.pr ? 'pr' : ''}" style="margin:2px">${s.warm ? 'W ' : ''}${s.t ? `${s.w ? toDisplayW(s.w) + wUnit() + ' · ' : ''}${s.t}s` : `${toDisplayW(s.w) || 0} × ${s.r}`}</span>`).join('')}</div></div>`).join('')}
      ${justFinished ? '' : '<button class="btn danger block" data-del>Delete workout</button>'}`;
    const del = body.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (await confirmSheet('Delete workout?', 'This removes it from your history and stats.')) {
        state.workouts = state.workouts.filter(x => x.id !== w.id);
        save(); close(); rerender();
      }
    };
  });
}

// ---------- rest timer ----------

let restTick = null;
let audioCtx = null;

function beep() {
  if (!state.settings.restSound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      o.start(t0); o.stop(t0 + 0.2);
    }
  } catch (e) {}
}

export function startRest(sec) {
  const w = state.activeWorkout;
  if (!w || !sec) return;
  w.rest = { end: Date.now() + sec * 1000, total: sec };
  // Unlock audio on iOS while we still have the user gesture.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
  save();
  runRest();
}

export function stopRest() {
  clearInterval(restTick);
  restTick = null;
  const bar = document.getElementById('restbar');
  bar.hidden = true;
  bar.classList.remove('flash');
  if (state.activeWorkout) state.activeWorkout.rest = null;
}

export function runRest() {
  const w = state.activeWorkout;
  const el = document.getElementById('restbar');
  if (!w || !w.rest) { el.hidden = true; return; }
  clearInterval(restTick);
  el.hidden = false;
  el.classList.remove('flash');
  const draw = () => {
    const r = state.activeWorkout && state.activeWorkout.rest;
    if (!r) return stopRest();
    const left = (r.end - Date.now()) / 1000;
    if (left <= 0) {
      clearInterval(restTick);
      el.innerHTML = `<div class="grow"><b>Rest over</b><div class="small">Next set</div></div><button data-r="x">Dismiss</button>`;
      el.classList.add('flash');
      beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      state.activeWorkout.rest = null;
      save();
      setTimeout(() => { if (!state.activeWorkout || !state.activeWorkout.rest) el.hidden = true; }, 6000);
      return;
    }
    el.innerHTML = `<b>${fmtClock(left)}</b><div class="grow">${bar(1 - left / r.total, 'var(--bg)')}</div>
      <button data-r="-15">−15</button><button data-r="15">+15</button><button data-r="x">Skip</button>`;
  };
  el.onclick = e => {
    const v = e.target.dataset.r;
    if (!v) return;
    const r = state.activeWorkout && state.activeWorkout.rest;
    if (v === 'x' || !r) return stopRest();
    r.end += +v * 1000;
    r.total = Math.max(r.total + +v, 1);
    save();
    draw();
  };
  draw();
  restTick = setInterval(draw, 250);
}

// ---------- tiny chart used in the exercise sheet ----------

export function lineChart(points, { h = 120, color = 'var(--accent)', unit = '' } = {}) {
  if (points.length < 2) return '';
  const W = 320, pad = 26;
  const xs = points.map(p => +p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const yr = y1 - y0; y0 -= yr * 0.1; y1 += yr * 0.1;
  const X = x => pad + (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * (W - pad - 8);
  const Y = y => 8 + (1 - (y - y0) / (y1 - y0)) * (h - 26);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(+p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const ticks = [y0 + (y1 - y0) * 0.15, (y0 + y1) / 2, y1 - (y1 - y0) * 0.15];
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Trend chart">
    ${ticks.map(t => `<line class="grid" x1="${pad}" x2="${W - 8}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad - 4}" y="${Y(t) + 3}" text-anchor="end">${r1(t)}${unit}</text>`).join('')}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map(p => `<circle cx="${X(+p.x)}" cy="${Y(p.y)}" r="2.5" fill="${color}"/>`).join('')}
    <text x="${pad}" y="${h - 4}">${fmtDate(x0, { day: 'numeric', month: 'short' })}</text>
    <text x="${W - 8}" y="${h - 4}" text-anchor="end">${fmtDate(x1, { day: 'numeric', month: 'short' })}</text>
  </svg>`;
}
