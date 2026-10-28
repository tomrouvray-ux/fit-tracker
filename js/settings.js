// Settings: goals, units, API keys, backup.

import { state, save, flush, replaceState, latestWeight, dayKey, parseDay, suggestedCalories, calorieGoal, macroGoals, proteinPerKg, RECOMP_DEFICIT, toDisplayW, wUnit } from './store.js';
import { esc, toast, confirmSheet, fmtDate, fmtTime, fmtInt } from './ui.js';
import { syncIntervals } from './garmin.js';
import { applyTheme, rerender } from './app.js';
import { syncNow, syncStatus } from './sync.js';

const ACTIVITY = [[1.2, 'Desk job, little exercise'], [1.375, 'Light: 1–3 sessions a week'], [1.55, 'Moderate: 3–5 sessions a week'], [1.725, 'Very active: 6–7 sessions a week'], [1.9, 'Athlete: twice a day']];
const GOALS = [[-750, 'Lose fast (−0.75 kg/week)'], [-500, 'Lose (−0.5 kg/week)'], [-250, 'Lose slowly'], [0, 'Maintain'], [250, 'Gain slowly'], [500, 'Gain'], ['recomp', 'Build muscle and lose fat']];

// Percentage split used for recomposition when macros are set as % of calories.
const RECOMP_MACROS = { p: 35, c: 40, f: 25 };
const MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (most accurate)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']];

const ACT_LABEL = Object.fromEntries(ACTIVITY.map(([v, l]) => [v, l.split(':')[0].toLowerCase()]));
const GOAL_LABEL = Object.fromEntries(GOALS.map(([v, l]) => [v, l.toLowerCase()]));

// What the automatic goal is based on, so wrong details are easy to spot.
function basisText() {
  const p = state.settings.profile;
  const lw = latestWeight();
  return `Based on ${toDisplayW(lw.kg)} ${wUnit()} (${parseDay(lw.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}), ${p.heightCm} cm, age ${p.age}, ${p.sex}, ${ACT_LABEL[p.activity] || 'your'} activity, goal: ${GOAL_LABEL[p.goal] || 'maintain'}.`;
}

let goalsOpen = false;

function syncLine() {
  const s = state.settings;
  if (!s.ghToken) return 'Off. This device keeps its own data.';
  if (syncStatus.error) return esc(syncStatus.error);
  if (syncStatus.busy) return 'Syncing…';
  return s.syncLast ? `Last synced ${fmtDate(s.syncLast)} at ${fmtTime(s.syncLast)}. Syncs when the app opens and a few seconds after each change.` : 'Not synced yet.';
}

function suggestText(sug) {
  const recomp = state.settings.profile.goal === 'recomp';
  if (state.settings.autoGoal) return `Your goal: <b>${fmtInt(sug)} kcal</b>${recomp ? `, a small deficit of ${-RECOMP_DEFICIT} kcal with about ${proteinPerKg()} g protein per kg. Lift weights at least 3 times a week.` : '.'} It updates automatically from your latest weight.`;
  return `Suggested: <b>${fmtInt(sug)} kcal</b> (Mifflin–St Jeor, using your latest weight)${recomp
    ? `, a small deficit of ${-RECOMP_DEFICIT} kcal. Using it also sets macros to ${RECOMP_MACROS.p}% protein, ${RECOMP_MACROS.c}% carbs and ${RECOMP_MACROS.f}% fat. Lift weights at least 3 times a week and aim for about 2 g of protein per kg of body weight.`
    : '.'} <button class="btn sm" data-act="use">Use this</button>`;
}

export function renderSettings(root) {
  const s = state.settings;
  const p = s.profile;
  const sug = suggestedCalories();
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  root.innerHTML = `
    <div class="section-title">Daily goals</div>
    <div class="card">
      <label class="check"><input type="checkbox" id="autogoal" ${s.autoGoal ? 'checked' : ''}> Work out my calorie goal from my latest weight</label>
      ${s.autoGoal && sug ? `<p style="margin:6px 0 12px"><b class="num" style="font-size:22px">${fmtInt(sug)} kcal</b><br><span class="small muted">${esc(basisText())} Edit these under <b>Work out my calorie goal</b> below. It updates whenever a new weight comes in.</span></p>`
        : `${s.autoGoal ? '<p class="small muted" style="margin:4px 0 8px">Log your weight on the Today tab and fill in the details below to work this out. Using your own number until then.</p>' : ''}
          <label class="field"><span>Calorie goal (kcal)</span><input type="number" inputmode="numeric" id="kcal" value="${s.calorieGoal}"></label>`}
      <label class="field"><span>Protein, carbs and fat</span>${sel('macromode', [['weight', 'From my body weight'], ['pct', 'Percent of calories']], s.macroMode)}</label>
      ${s.macroMode === 'pct' ? `<div class="grid3">
        <label class="field" style="margin:0"><span>Protein %</span><input type="number" inputmode="numeric" id="mp" value="${s.macroPct.p}"></label>
        <label class="field" style="margin:0"><span>Carbs %</span><input type="number" inputmode="numeric" id="mc" value="${s.macroPct.c}"></label>
        <label class="field" style="margin:0"><span>Fat %</span><input type="number" inputmode="numeric" id="mf" value="${s.macroPct.f}"></label>
      </div>` : ''}
      <p class="small muted" id="macrog"></p>
      <label class="field"><span>Water goal (ml)</span><input type="number" inputmode="numeric" id="water" value="${s.waterGoal}"></label>
      <label class="check"><input type="checkbox" id="addex" ${s.addExerciseCalories ? 'checked' : ''}> Add Garmin exercise calories to my daily budget</label>
    </div>

    <details class="card" id="goaldetails" ${goalsOpen ? 'open' : ''}><summary>Work out my calorie goal</summary>
      <div class="grid2">
        <label class="field"><span>Sex</span>${sel('sex', [['male', 'Male'], ['female', 'Female']], p.sex)}</label>
        <label class="field"><span>Age</span><input type="number" inputmode="numeric" id="age" value="${p.age || ''}"></label>
      </div>
      <label class="field"><span>Height (cm)</span><input type="number" inputmode="numeric" id="height" value="${p.heightCm || ''}"></label>
      <label class="field"><span>Activity</span>${sel('activity', ACTIVITY, p.activity)}</label>
      <label class="field"><span>Goal</span>${sel('goal', GOALS, p.goal)}</label>
      <p id="sugg">${sug ? suggestText(sug) : '<span class="small muted">Log your weight on the Today tab to get a suggestion.</span>'}</p>
    </details>

    <div class="section-title">AI food photos</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Uses your own Claude API key, stored only on this device. Create one at <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a> under API keys. A photo costs roughly a cent.</p>
      <label class="field"><span>Claude API key</span><input type="password" id="akey" value="${esc(s.anthropicKey)}" placeholder="sk-ant-..." autocomplete="off"></label>
      <label class="field"><span>Model</span>${sel('model', MODELS, s.aiModel)}</label>
    </div>

    <div class="section-title">Food search</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Search uses UK everyday foods (built in, works offline), Open Food Facts for branded products, and the USDA database. The USDA works without a key for about 30 searches an hour. For more, get a free key at <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov</a>.</p>
      <label class="field"><span>Products from</span>${sel('region', [['uk', 'UK shops'], ['world', 'Everywhere']], s.foodRegion)}</label>
      <label class="field"><span>USDA API key (optional)</span><input type="password" id="ukey" value="${esc(s.usdaKey)}" placeholder="Uses DEMO_KEY if empty" autocomplete="off"></label>
      <label class="check"><input type="checkbox" id="usdaon" ${s.usdaOff ? '' : 'checked'}> Include USDA results</label>
    </div>

    <div class="section-title">Garmin</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Garmin's own API is only open to approved companies, so the app reads your Garmin data through <a href="https://intervals.icu" target="_blank" rel="noopener">Intervals.icu</a>, a free site that syncs with Garmin Connect. In Intervals.icu open Settings, connect Garmin, then under Developer Settings copy your API key and athlete ID.</p>
      <label class="field"><span>Intervals.icu API key</span><input type="password" id="ikey" value="${esc(s.icuKey)}" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Athlete ID</span><input type="text" id="iath" value="${esc(s.icuAthlete)}" placeholder="i123456"></label>
        <label class="field"><span>Days to sync</span><input type="number" inputmode="numeric" id="idays" value="${s.icuDays}"></label>
      </div>
      <button class="btn block" data-act="sync" ${s.icuKey ? '' : 'disabled'}>Test and sync now</button>
      <p class="small muted">${s.icuLastSync ? `Last synced ${fmtDate(s.icuLastSync)} at ${fmtTime(s.icuLastSync)}.` : 'Not synced yet.'} You can also import .fit, .gpx or .tcx files on the Activity tab.</p>
    </div>

    <div class="section-title">App</div>
    <div class="card">
      <label class="field"><span>Units</span>${sel('units', [['kg', 'Kilograms, km'], ['lb', 'Pounds, miles']], s.units)}</label>
      <label class="field"><span>Theme</span>${sel('theme', [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark'], ['navy', 'Dark blue'], ['orange', 'Black and orange']], s.theme)}</label>
      <label class="field"><span>Week starts on</span>${sel('weekstart', [[1, 'Monday'], [0, 'Sunday']], s.weekStart)}</label>
      <label class="field"><span>Default rest between sets (seconds)</span><input type="number" inputmode="numeric" id="rest" value="${s.restDefault}"></label>
      <label class="check"><input type="checkbox" id="sound" ${s.restSound ? 'checked' : ''}> Beep when rest is over</label>
    </div>

    <div class="section-title">Sync between devices</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Keeps your food, workouts, weights and settings the same on your phone and computer, using a private Gist on your GitHub account. <a href="https://github.com/settings/tokens/new?scopes=gist&description=FitTrack%20sync" target="_blank" rel="noopener">Create a token</a> with only the <b>gist</b> box ticked, then paste it here on each device. API keys are not synced.</p>
      <label class="field"><span>GitHub token</span><input type="password" id="ghtok" value="${esc(s.ghToken)}" placeholder="ghp_..." autocomplete="off"></label>
      <button class="btn block" data-act="gsync" ${s.ghToken ? '' : 'disabled'}>Sync now</button>
      <p class="small muted" id="syncst">${syncLine()}</p>
    </div>

    <div class="section-title">Your data</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Everything is stored in this browser on this device. Export a backup now and then, as a copy you keep yourself.</p>
      <div class="btn-row">
        <button class="btn" data-act="export">Export backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" id="importf" hidden></label>
      </div>
      <button class="btn danger block" style="margin-top:10px" data-act="reset">Erase all data</button>
    </div>
    <p class="small muted" style="text-align:center">Exercise library: free-exercise-db (public domain). Food data: McCance and Widdowson's CoFID (Open Government Licence v3.0), Open Food Facts (ODbL) and USDA FoodData Central (public domain).</p>`;

  const num = id => parseFloat(root.querySelector('#' + id).value);
  root.querySelector('#goaldetails').ontoggle = e => { goalsOpen = e.target.open; };
  const showMacros = () => {
    const g = macroGoals();
    const sum = s.macroPct.p + s.macroPct.c + s.macroPct.f;
    const lw = latestWeight();
    root.querySelector('#macrog').textContent = g.byWeight
      ? `${g.p} g protein (${proteinPerKg()} g per kg), ${g.f} g fat (0.8 g per kg) and ${g.c} g carbs (the rest of your calories), from ${toDisplayW(lw.kg)} ${wUnit()}.`
      : s.macroMode !== 'pct' ? 'Log your weight to set these from your body weight. Using 30% protein, 40% carbs and 30% fat until then.'
      : sum !== 100 ? `These add up to ${sum}%. Make them total 100%.`
      : `That's ${g.p} g protein, ${g.c} g carbs, ${g.f} g fat.`;
  };
  showMacros();

  root.oninput = root.onchange = e => {
    const id = e.target.id;
    if (!id || id === 'importf') return;
    const v = e.target.value;
    if (id === 'kcal') s.calorieGoal = num('kcal') || s.calorieGoal;
    if (id === 'mp') s.macroPct.p = num('mp') || 0;
    if (id === 'mc') s.macroPct.c = num('mc') || 0;
    if (id === 'mf') s.macroPct.f = num('mf') || 0;
    if (id === 'water') s.waterGoal = num('water') || s.waterGoal;
    if (id === 'addex') s.addExerciseCalories = e.target.checked;
    if (id === 'sex') p.sex = v;
    if (id === 'age') p.age = num('age') || null;
    if (id === 'height') p.heightCm = num('height') || null;
    if (id === 'activity') p.activity = +v;
    if (id === 'goal') p.goal = v === 'recomp' ? 'recomp' : +v;
    if (id === 'akey') s.anthropicKey = v.trim();
    if (id === 'model') s.aiModel = v;
    if (id === 'region') s.foodRegion = v;
    if (id === 'ukey') s.usdaKey = v.trim();
    if (id === 'usdaon') s.usdaOff = !e.target.checked;
    if (id === 'ghtok') {
      const t = v.trim();
      if (t !== s.ghToken) { s.ghToken = t; s.gistId = ''; }
      root.querySelector('[data-act=gsync]').disabled = !t;
    }
    if (id === 'ikey') { s.icuKey = v.trim(); root.querySelector('[data-act=sync]').disabled = !s.icuKey; }
    if (id === 'iath') s.icuAthlete = v.trim() || '0';
    if (id === 'idays') s.icuDays = Math.min(365, num('idays') || 30);
    if (id === 'units') s.units = v;
    if (id === 'theme') { s.theme = v; applyTheme(); }
    if (id === 'weekstart') s.weekStart = +v;
    if (id === 'rest') s.restDefault = num('rest') || 90;
    if (id === 'sound') s.restSound = e.target.checked;
    save();
    if (['mp', 'mc', 'mf', 'kcal'].includes(id)) showMacros();
    if (id === 'autogoal') { if (!e.target.checked) s.calorieGoal = calorieGoal(); s.autoGoal = e.target.checked; }
    if (id === 'macromode') s.macroMode = v;
    if (['autogoal', 'macromode'].includes(id) && e.type === 'change') { save(); return rerender(); }
    if (['sex', 'age', 'height', 'activity', 'goal'].includes(id) && e.type === 'change') {
      const sug = suggestedCalories();
      if (sug) root.querySelector('#sugg').innerHTML = suggestText(sug);
      if (s.autoGoal) { save(); return rerender(); }
      showMacros();
    }
    if (id === 'units' && e.type === 'change') rerender();
  };

  root.onclick = async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'use') {
      s.calorieGoal = suggestedCalories();
      if (p.goal === 'recomp') s.macroPct = { ...RECOMP_MACROS };
      save(); rerender();
      toast(p.goal === 'recomp' ? 'Calorie goal and macros updated' : 'Calorie goal updated');
    }
    if (a === 'sync') {
      t.disabled = true;
      t.innerHTML = '<span class="spinner"></span> Syncing…';
      try { await syncIntervals({ days: s.icuDays }); } catch (err) { toast(err.message, 6000); }
      rerender();
    }
    if (a === 'gsync') {
      t.disabled = true;
      t.innerHTML = '<span class="spinner"></span> Syncing…';
      await flush();
      await syncNow();
      if (syncStatus.error) toast(syncStatus.error, 6000); else toast('Synced');
      rerender();
    }
    if (a === 'export') {
      await flush();
      const copy = JSON.parse(JSON.stringify(state));
      copy.settings.anthropicKey = '';
      copy.settings.icuKey = '';
      copy.settings.ghToken = '';
      const blob = new Blob([JSON.stringify(copy)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `fittrack-backup-${dayKey()}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup saved (API keys left out)');
    }
    if (a === 'reset') {
      if (await confirmSheet('Erase all data?', 'Workouts, food diary, weights and settings will be deleted from this device. Export a backup first if you want to keep them.', 'Erase everything')) {
        await replaceState({});
        location.reload();
      }
    }
  };

  root.querySelector('#importf').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !data.settings || !Array.isArray(data.workouts)) throw new Error('bad');
      if (!(await confirmSheet('Replace your data?', 'Everything on this device will be replaced by the backup. Your API keys are kept.', 'Replace'))) return;
      data.settings.anthropicKey = data.settings.anthropicKey || s.anthropicKey;
      data.settings.icuKey = data.settings.icuKey || s.icuKey;
      data.settings.ghToken = s.ghToken;
      data.settings.gistId = s.gistId;
      await replaceState(data);
      location.reload();
    } catch (err) {
      toast("That file isn't a FitTrack backup.");
    }
  };
}
