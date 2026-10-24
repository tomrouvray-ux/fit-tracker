// Food diary (MyFitnessPal-style): meals, goals, search, barcode, AI photo logging.

import { state, save, uid, dayKey, addDays, parseDay, MEALS, entryTotals, dayFoodTotals, dayExerciseKcal, macroGoals } from './store.js';
import { esc, sheet, toast, confirmSheet, ring, bar, r0, r1, fmtInt, resizeImage } from './ui.js';
import { searchOFF, lookupBarcode } from './off.js';
import { analyzeFood, hasKey } from './ai.js';
import { go, rerender } from './app.js';

const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };

export let foodDay = dayKey();

function defaultMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks';
}

function dayLabel(key) {
  const t = dayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, -1)) return 'Yesterday';
  if (key === addDays(t, 1)) return 'Tomorrow';
  return parseDay(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Calories left = goal - food + exercise (exercise optional, like MyFitnessPal)
export function calorieSummary(key) {
  const goal = state.settings.calorieGoal;
  const food = dayFoodTotals(key).kcal;
  const ex = state.settings.addExerciseCalories ? dayExerciseKcal(key) : 0;
  return { goal, food: r0(food), ex, left: r0(goal - food + ex) };
}

export function summaryCard(key, { link = false } = {}) {
  const s = calorieSummary(key);
  const t = dayFoodTotals(key);
  const g = macroGoals();
  const budget = s.goal + s.ex;
  return `<div class="card ${link ? 'tap' : ''}" ${link ? 'data-go="food"' : ''}>
    <h2>Calories <small>${s.left >= 0 ? 'remaining' : 'over'}</small></h2>
    <div class="ring-wrap">
      ${ring(budget ? s.food / budget : 0, fmtInt(Math.abs(s.left)), s.left >= 0 ? 'left' : 'over')}
      <div class="grow eq">
        <div><b>${fmtInt(s.goal)}</b>Goal</div>
        <div><b>${fmtInt(s.food)}</b>Food</div>
        <div><b>${fmtInt(s.ex)}</b>Exercise</div>
        <div><b>${fmtInt(s.left)}</b>Left</div>
      </div>
    </div>
    <div class="macros">
      ${[['p', 'Protein', 'var(--protein)'], ['c', 'Carbs', 'var(--carbs)'], ['f', 'Fat', 'var(--fat)']].map(([k, l, c]) => `
        <div><div class="lbl"><span>${l}</span><span class="num">${r0(t[k])}/${g[k]}g</span></div>${bar(t[k] / g[k], c)}</div>`).join('')}
    </div>
  </div>`;
}

export function renderFood(root) {
  const key = foodDay;
  const entries = state.foods[key] || [];
  const water = state.water[key] || 0;
  const t = dayFoodTotals(key);
  root.innerHTML = `
    <div class="datenav"><button data-day="-1" aria-label="Previous day">‹</button><b>${dayLabel(key)}</b><button data-day="1" aria-label="Next day">›</button></div>
    ${summaryCard(key)}
    ${MEALS.map(m => {
      const list = entries.filter(e => e.meal === m);
      const kcal = list.reduce((n, e) => n + entryTotals(e).kcal, 0);
      return `<div class="card">
        <div class="meal-head"><h3>${MEAL_LABEL[m]}</h3><span class="num">${fmtInt(kcal)} kcal</span></div>
        ${list.length ? `<ul class="list" style="margin-top:4px">${list.map(e => {
          const x = entryTotals(e);
          return `<li class="tap" data-entry="${e.id}"><div class="grow"><div class="title">${esc(e.name)}${e.source === 'ai' ? ' <span class="chip">AI</span>' : ''}</div>
            <div class="sub">${esc(amountLabel(e))}${e.brand ? ' · ' + esc(e.brand) : ''} · P ${r0(x.p)} C ${r0(x.c)} F ${r0(x.f)}</div></div>
            <span class="kcal">${fmtInt(x.kcal)}</span></li>`;
        }).join('')}</ul>` : ''}
        <div class="row" style="margin-top:6px"><button class="btn ghost" data-add="${m}">+ Add food</button>
          <span class="grow"></span>${!list.length && (state.foods[addDays(key, -1)] || []).some(e => e.meal === m) ? `<button class="btn ghost" data-copy="${m}">Copy yesterday</button>` : ''}</div>
      </div>`;
    }).join('')}
    <div class="card"><h2>Water <small>${fmtInt(water)} / ${fmtInt(state.settings.waterGoal)} ml</small></h2>
      ${bar(water / state.settings.waterGoal, 'var(--garmin)')}
      <div class="btn-row" style="margin-top:10px"><button class="btn sm" data-water="-250">−250</button><button class="btn sm" data-water="250">+250 ml</button><button class="btn sm" data-water="500">+500 ml</button></div></div>
    <div class="card"><h2>Nutrients</h2><div class="stats">
      <div class="stat"><b>${r0(t.fib)}g</b><span>Fibre</span></div>
      <div class="stat"><b>${r0(t.sug)}g</b><span>Sugar</span></div>
      <div class="stat"><b>${fmtInt(t.na)}mg</b><span>Sodium</span></div>
    </div></div>`;

  root.onclick = async e => {
    const b = e.target.closest('[data-day],[data-add],[data-entry],[data-water],[data-copy]');
    if (!b) return;
    const d = b.dataset;
    if (d.day) { foodDay = addDays(foodDay, +d.day); return renderFood(root); }
    if (d.add) return openAddFood(d.add);
    if (d.entry) return editEntry(entries.find(x => x.id === d.entry));
    if (d.water) { state.water[key] = Math.max(0, water + +d.water); save(); return renderFood(root); }
    if (d.copy) {
      const src = (state.foods[addDays(key, -1)] || []).filter(x => x.meal === d.copy);
      state.foods[key] = [...(state.foods[key] || []), ...src.map(x => ({ ...x, id: uid(), time: Date.now() }))];
      save(); toast(`Copied ${src.length} item${src.length === 1 ? '' : 's'}`); renderFood(root);
    }
  };
}

function amountLabel(e) {
  if (e.unit === 'serving') return `${r1(e.amount)} serving${e.amount === 1 ? '' : 's'}${e.gramsPerUnit && e.source !== 'quick' ? ` (${r0(e.amount * e.gramsPerUnit)} g)` : ''}`;
  return `${r0(e.amount)} ${e.unit || 'g'}`;
}

function addEntry(food, meal, amount, unit) {
  const e = {
    id: uid(), meal, time: Date.now(),
    name: food.name, brand: food.brand || '', code: food.code || '', source: food.source || 'custom',
    per100: food.per100, servingG: food.servingG || null, servingLabel: food.servingLabel || '',
    amount, unit, gramsPerUnit: unit === 'serving' ? (food.servingG || 100) : 1,
  };
  (state.foods[foodDay] = state.foods[foodDay] || []).push(e);
  rememberFood(food, amount, unit);
  save();
  return e;
}

function rememberFood(food, amount, unit) {
  const k = (food.name + '|' + (food.brand || '')).toLowerCase();
  state.recentFoods = state.recentFoods.filter(f => (f.name + '|' + (f.brand || '')).toLowerCase() !== k);
  state.recentFoods.unshift({ ...food, lastAmount: amount, lastUnit: unit });
  state.recentFoods = state.recentFoods.slice(0, 60);
}

function editEntry(e) {
  if (!e) return;
  sheet(e.name, (body, close) => {
    amountForm(body, e, {
      meal: e.meal,
      amount: e.amount,
      unit: e.unit,
      okLabel: 'Save',
      extra: '<button class="btn danger" data-del>Delete</button>',
      onOk: ({ amount, unit, meal }) => {
        e.amount = amount; e.unit = unit; e.meal = meal;
        e.gramsPerUnit = unit === 'serving' ? (e.servingG || e.gramsPerUnit || 100) : 1;
        save(); close(); rerender();
      },
    });
    body.querySelector('[data-del]').onclick = () => {
      state.foods[foodDay] = (state.foods[foodDay] || []).filter(x => x.id !== e.id);
      save(); close(); rerender();
    };
  });
}

// Amount picker with live nutrition preview.
function amountForm(body, food, { meal, amount, unit, okLabel = 'Add', onOk, extra = '' }) {
  const isQuick = food.source === 'quick';
  const hasServing = !!food.servingG || isQuick;
  unit = unit || (hasServing ? 'serving' : 'g');
  amount = amount ?? (unit === 'serving' ? 1 : 100);
  body.innerHTML = `
    ${food.brand ? `<p class="muted small" style="margin-top:0">${esc(food.brand)}</p>` : ''}
    <div class="grid2">
      <label class="field"><span>Amount</span><input type="number" inputmode="decimal" step="any" id="amt" value="${amount}"></label>
      <label class="field"><span>Unit</span><select id="unit">
        ${hasServing ? `<option value="serving" ${unit === 'serving' ? 'selected' : ''}>${isQuick ? 'serving' : `serving${food.servingLabel ? ` (${esc(food.servingLabel)})` : ` (${r0(food.servingG)} g)`}`}</option>` : ''}
        ${isQuick ? '' : `<option value="g" ${unit === 'g' ? 'selected' : ''}>grams</option><option value="ml" ${unit === 'ml' ? 'selected' : ''}>ml</option>`}
      </select></label>
    </div>
    <label class="field"><span>Meal</span><select id="meal">${MEALS.map(m => `<option value="${m}" ${m === meal ? 'selected' : ''}>${MEAL_LABEL[m]}</option>`).join('')}</select></label>
    <div class="stats" id="prev"></div>
    <p class="small muted">Per 100 g: ${r0(food.per100.kcal)} kcal · P ${r1(food.per100.p)} · C ${r1(food.per100.c)} · F ${r1(food.per100.f)}</p>
    <div class="btn-row" style="margin-top:12px">${extra}<button class="btn primary" id="ok">${okLabel}</button></div>`;
  const read = () => {
    const unit = body.querySelector('#unit').value;
    return { amount: parseFloat(body.querySelector('#amt').value) || 0, unit, meal: body.querySelector('#meal').value };
  };
  const draw = () => {
    const v = read();
    const x = entryTotals({ per100: food.per100, amount: v.amount, gramsPerUnit: v.unit === 'serving' ? (food.servingG || 100) : 1 });
    body.querySelector('#prev').innerHTML = `
      <div class="stat"><b>${fmtInt(x.kcal)}</b><span>kcal</span></div>
      <div class="stat"><b>${r0(x.p)}g</b><span>Protein</span></div>
      <div class="stat"><b>${r0(x.c)}g</b><span>Carbs</span></div>
      <div class="stat"><b>${r0(x.f)}g</b><span>Fat</span></div>`;
  };
  body.querySelector('#amt').oninput = draw;
  body.querySelector('#unit').onchange = draw;
  body.querySelector('#ok').onclick = () => {
    const v = read();
    if (!v.amount) return toast('Enter an amount.');
    onOk(v);
  };
  draw();
}

function chooseAmount(food, meal, done) {
  sheet(food.name, (body, close) => {
    amountForm(body, food, {
      meal,
      amount: food.lastAmount,
      unit: food.lastUnit,
      onOk: ({ amount, unit, meal }) => {
        addEntry(food, meal, amount, unit);
        close();
        toast(`Added to ${MEAL_LABEL[meal]}`);
        done && done();
      },
    });
  });
}

// ---------- Add food sheet ----------

export function openAddFood(meal = defaultMeal(), tab = 'search') {
  sheet('Add to ' + MEAL_LABEL[meal], (body, close) => {
    const finish = () => { close(); rerender(); };
    body.innerHTML = `
      <div class="seg" role="tablist">
        <button data-tab="search">Search</button><button data-tab="photo">Photo</button>
        <button data-tab="scan">Barcode</button><button data-tab="quick">Quick add</button>
      </div>
      <div id="tab" style="margin-top:12px"></div>`;
    const pane = body.querySelector('#tab');
    const show = t => {
      stopCamera();
      body.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      ({ search: searchTab, photo: photoTab, scan: scanTab, quick: quickTab })[t](pane, meal, finish);
    };
    body.querySelector('.seg').onclick = e => e.target.dataset.tab && show(e.target.dataset.tab);
    show(tab);
  }, { onClose: () => { stopCamera(); rerender(); } });
}

function foodRow(f, i) {
  return `<li class="tap" data-i="${i}"><div class="grow"><div class="title">${esc(f.name)}</div>
    <div class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}${r0(f.per100.kcal)} kcal/100g${f.servingG ? ` · serving ${r0(f.servingG)} g` : ''}</div></div></li>`;
}

function searchTab(pane, meal, finish) {
  pane.innerHTML = `
    <form id="sf" class="row"><input type="search" id="q" placeholder="Search foods or brands" autocomplete="off" class="grow"><button class="btn primary">Search</button></form>
    <div id="res"></div>`;
  const res = pane.querySelector('#res');
  let items = [];
  let ctrl;
  const local = q => {
    const ql = q.toLowerCase();
    const pool = [...state.myFoods.map(f => ({ ...f, mine: true })), ...state.recentFoods];
    const seen = new Set();
    return pool.filter(f => {
      const k = (f.name + '|' + (f.brand || '')).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return !ql || k.includes(ql);
    }).slice(0, 20);
  };
  const draw = (title, list, extra = '') => {
    items = list;
    res.innerHTML = `${extra}${list.length ? `<div class="section-title">${title}</div><div class="card" style="padding:4px 14px"><ul class="list">${list.map(foodRow).join('')}</ul></div>` : ''}`;
  };
  const aiButton = q => q && hasKey() ? `<button class="btn block" data-ai style="margin-top:10px">Estimate “${esc(q)}” with AI</button>` : '';
  draw('Recent and saved', local(''), state.recentFoods.length ? '' : '<p class="muted small">Search Open Food Facts, scan a barcode, or snap a photo and let AI log it.</p>');

  const q = pane.querySelector('#q');
  q.oninput = () => draw('Recent and saved', local(q.value.trim()), aiButton(q.value.trim()));
  pane.querySelector('#sf').onsubmit = async e => {
    e.preventDefault();
    const term = q.value.trim();
    if (!term) return;
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const mine = local(term);
    res.innerHTML = '<p class="muted"><span class="spinner"></span> Searching…</p>';
    try {
      const found = await searchOFF(term, ctrl.signal);
      items = [...mine, ...found];
      res.innerHTML = `${aiButton(term)}
        ${mine.length ? `<div class="section-title">Recent and saved</div><div class="card" style="padding:4px 14px"><ul class="list">${mine.map(foodRow).join('')}</ul></div>` : ''}
        <div class="section-title">Open Food Facts</div>
        <div class="card" style="padding:4px 14px"><ul class="list">${found.map((f, i) => foodRow(f, i + mine.length)).join('') || '<li class="empty">No products found. Try fewer words, or use AI.</li>'}</ul></div>`;
    } catch (err) {
      if (err.name !== 'AbortError') res.innerHTML = `<p class="notice warn">${esc(err.message)}</p>${aiButton(term)}`;
    }
  };
  res.onclick = e => {
    if (e.target.closest('[data-ai]')) return describeWithAI(pane, meal, finish, q.value.trim());
    const li = e.target.closest('[data-i]');
    if (li) chooseAmount(items[+li.dataset.i], meal);
  };
  setTimeout(() => q.focus(), 50);
}

// ---------- AI ----------

function noKeyNotice() {
  return `<div class="notice">AI logging needs your Claude API key. <a href="#" data-settings>Add it in Settings</a>. Each photo costs about a cent.</div>`;
}

function photoTab(pane, meal, finish) {
  if (!hasKey()) {
    pane.innerHTML = noKeyNotice();
    pane.querySelector('[data-settings]').onclick = e => { e.preventDefault(); finish(); go('settings'); };
    return;
  }
  pane.innerHTML = `
    <p class="small muted" style="margin-top:0">Take a photo of your plate or a package label. Claude identifies each item and estimates the portion.</p>
    <div class="btn-row">
      <label class="btn primary">Take photo<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
      <label class="btn">Choose photo<input type="file" accept="image/*" id="pick" hidden></label>
    </div>
    <label class="field"><span>Anything Claude should know? (optional)</span><input type="text" id="note" placeholder="e.g. cooked in butter, half portion"></label>
    <div id="out"></div>`;
  const onFile = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const out = pane.querySelector('#out');
    let dataUrl;
    try { dataUrl = await resizeImage(file); } catch (err) { return toast(err.message); }
    out.innerHTML = `<img class="photo-prev" src="${dataUrl}" alt="Your food"><p class="muted"><span class="spinner"></span> Analysing…</p>`;
    runAI(out, meal, finish, { imageDataUrl: dataUrl, text: pane.querySelector('#note').value.trim() }, dataUrl);
  };
  pane.querySelector('#cam').onchange = onFile;
  pane.querySelector('#pick').onchange = onFile;
}

function describeWithAI(pane, meal, finish, text) {
  pane.innerHTML = `<p class="muted"><span class="spinner"></span> Estimating “${esc(text)}”…</p><div id="out"></div>`;
  runAI(pane, meal, finish, { text });
}

async function runAI(out, meal, finish, input, preview) {
  let result;
  try {
    result = await analyzeFood(input);
  } catch (err) {
    out.innerHTML = `${preview ? `<img class="photo-prev" src="${preview}" alt="">` : ''}<p class="notice warn">${esc(err.message)}</p>`;
    return;
  }
  let product = null;
  if (result.barcode) product = await lookupBarcode(result.barcode).catch(() => null);
  const items = result.items.map(i => ({ ...i, on: true, base: { ...i } }));
  const draw = () => {
    out.innerHTML = `
      ${preview ? `<img class="photo-prev" src="${preview}" alt="Your food">` : ''}
      ${product ? `<div class="notice">Barcode found: <b>${esc(product.name)}</b>. <a href="#" data-product>Use the exact product data</a></div>` : ''}
      ${result.notes ? `<p class="small muted">${esc(result.notes)}</p>` : ''}
      ${items.length ? items.map((it, i) => `<div class="ai-item">
        <label class="check" style="margin:0 0 6px"><input type="checkbox" data-on="${i}" ${it.on ? 'checked' : ''}>
          <input type="text" data-name="${i}" value="${esc(it.name)}" style="flex:1;min-width:0;min-height:36px;padding:4px 8px"></label>
        <div class="grid3">
          <label class="field" style="margin:0"><span>Grams</span><input type="number" inputmode="decimal" data-g="${i}" value="${r0(it.grams)}"></label>
          <div class="stat"><b data-k="${i}">${fmtInt(it.kcal)}</b><span>kcal</span></div>
          <div class="small muted" data-m="${i}" style="align-self:center">P ${r0(it.protein)} · C ${r0(it.carbs)} · F ${r0(it.fat)}</div>
        </div>
        <div class="small muted" style="margin-top:4px">Confidence: ${esc(it.confidence)}</div></div>`).join('')
        : '<p class="empty">No food recognised.</p>'}
      <label class="field"><span>Meal</span><select id="meal">${MEALS.map(m => `<option value="${m}" ${m === meal ? 'selected' : ''}>${MEAL_LABEL[m]}</option>`).join('')}</select></label>
      ${items.length ? '<button class="btn primary block" data-addall>Add selected</button>' : ''}`;
  };
  draw();
  out.oninput = e => {
    const d = e.target.dataset;
    if (d.name) items[d.name].name = e.target.value;
    if (d.g) {
      const it = items[d.g], f = (parseFloat(e.target.value) || 0) / (it.base.grams || 1);
      it.grams = parseFloat(e.target.value) || 0;
      for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar']) it[k] = it.base[k] * f;
      out.querySelector(`[data-k="${d.g}"]`).textContent = fmtInt(it.kcal);
      out.querySelector(`[data-m="${d.g}"]`).textContent = `P ${r0(it.protein)} · C ${r0(it.carbs)} · F ${r0(it.fat)}`;
    }
  };
  out.onchange = e => { if (e.target.dataset.on) items[e.target.dataset.on].on = e.target.checked; };
  out.onclick = e => {
    if (e.target.closest('[data-product]')) { e.preventDefault(); return chooseAmount(product, out.querySelector('#meal').value, finish); }
    if (!e.target.closest('[data-addall]')) return;
    const m = out.querySelector('#meal').value;
    let n = 0;
    for (const it of items) {
      if (!it.on || !it.grams) continue;
      const g = it.grams;
      const per100 = { kcal: it.kcal / g * 100, p: it.protein / g * 100, c: it.carbs / g * 100, f: it.fat / g * 100, fib: it.fiber / g * 100, sug: it.sugar / g * 100, na: 0 };
      addEntry({ name: it.name, per100, source: 'ai' }, m, g, 'g');
      n++;
    }
    toast(`Added ${n} item${n === 1 ? '' : 's'} to ${MEAL_LABEL[m]}`);
    finish();
  };
}

// ---------- barcode ----------

let stream = null;
let scanLoop = null;
function stopCamera() {
  cancelAnimationFrame(scanLoop);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

function scanTab(pane, meal, finish) {
  const live = 'BarcodeDetector' in window && navigator.mediaDevices;
  pane.innerHTML = `
    ${live ? '<video class="scan" playsinline muted></video><p class="small muted">Point the camera at the barcode.</p>'
      : `<p class="small muted" style="margin-top:0">This browser can't scan barcodes live. Type the number, or use the Photo tab: Claude reads barcodes from photos too.</p>`}
    <form id="bf" class="row" style="margin-top:8px"><input type="text" inputmode="numeric" id="code" placeholder="Barcode number" class="grow"><button class="btn primary">Look up</button></form>
    <div id="bres"></div>`;
  const found = async code => {
    stopCamera();
    const out = pane.querySelector('#bres');
    out.innerHTML = '<p class="muted"><span class="spinner"></span> Looking up…</p>';
    const f = await lookupBarcode(code).catch(() => null);
    if (!f) {
      out.innerHTML = `<p class="notice warn">Barcode ${esc(code)} isn't in Open Food Facts yet.${hasKey() ? ' Try the Photo tab with the nutrition label in view.' : ''}</p>`;
      return;
    }
    out.innerHTML = '';
    chooseAmount(f, meal, finish);
  };
  pane.querySelector('#bf').onsubmit = e => {
    e.preventDefault();
    const c = pane.querySelector('#code').value.replace(/\D/g, '');
    if (c) found(c);
  };
  if (!live) return;
  const video = pane.querySelector('video');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async s => {
    stream = s;
    video.srcObject = s;
    await video.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const loop = async () => {
      if (!stream) return;
      try {
        const codes = await det.detect(video);
        if (codes.length) return found(codes[0].rawValue);
      } catch (e) {}
      scanLoop = requestAnimationFrame(loop);
    };
    loop();
  }).catch(() => {
    video.replaceWith(Object.assign(document.createElement('p'), { className: 'notice warn', textContent: 'Camera not available. Type the number instead.' }));
  });
}

// ---------- quick add ----------

function quickTab(pane, meal, finish) {
  pane.innerHTML = `
    <label class="field"><span>Name</span><input type="text" id="qn" placeholder="e.g. Coffee shop sandwich"></label>
    <label class="field"><span>Calories</span><input type="number" inputmode="numeric" id="qk"></label>
    <div class="grid3">
      <label class="field"><span>Protein g</span><input type="number" inputmode="decimal" id="qp"></label>
      <label class="field"><span>Carbs g</span><input type="number" inputmode="decimal" id="qc"></label>
      <label class="field"><span>Fat g</span><input type="number" inputmode="decimal" id="qf"></label>
    </div>
    <label class="check"><input type="checkbox" id="qs"> Save to My foods</label>
    <button class="btn primary block" id="qa">Add</button>`;
  pane.querySelector('#qa').onclick = () => {
    const v = id => parseFloat(pane.querySelector(id).value) || 0;
    const kcal = v('#qk');
    if (!kcal) return toast('Enter the calories.');
    const food = { name: pane.querySelector('#qn').value.trim() || 'Quick add', per100: { kcal, p: v('#qp'), c: v('#qc'), f: v('#qf') }, servingG: 100, source: 'quick' };
    addEntry(food, meal, 1, 'serving');
    if (pane.querySelector('#qs').checked) { state.myFoods.unshift(food); save(); }
    toast(`Added to ${MEAL_LABEL[meal]}`);
    finish();
  };
}
