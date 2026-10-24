// Settings: goals, units, API keys, backup.

import { state, save, flush, replaceState, latestWeight, dayKey } from './store.js';
import { esc, toast, confirmSheet, fmtDate, fmtTime, fmtInt } from './ui.js';
import { syncIntervals } from './garmin.js';
import { applyTheme, rerender } from './app.js';

const ACTIVITY = [[1.2, 'Desk job, little exercise'], [1.375, 'Light: 1–3 sessions a week'], [1.55, 'Moderate: 3–5 sessions a week'], [1.725, 'Very active: 6–7 sessions a week'], [1.9, 'Athlete: twice a day']];
const GOALS = [[-750, 'Lose fast (−0.75 kg/week)'], [-500, 'Lose (−0.5 kg/week)'], [-250, 'Lose slowly'], [0, 'Maintain'], [250, 'Gain slowly'], [500, 'Gain']];
const MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (most accurate)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']];

function suggestedCalories() {
  const p = state.settings.profile;
  const lw = latestWeight();
  if (!lw || !p.heightCm || !p.age) return null;
  const bmr = 10 * lw.kg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'female' ? -161 : 5);
  return Math.round((bmr * p.activity + (p.goal || 0)) / 10) * 10;
}

export function renderSettings(root) {
  const s = state.settings;
  const p = s.profile;
  const sug = suggestedCalories();
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  root.innerHTML = `
    <div class="section-title">Daily goals</div>
    <div class="card">
      <label class="field"><span>Calorie goal (kcal)</span><input type="number" inputmode="numeric" id="kcal" value="${s.calorieGoal}"></label>
      <div class="small muted" style="margin:-4px 0 6px">Macro split (% of calories)</div>
      <div class="grid3">
        <label class="field" style="margin:0"><span>Protein</span><input type="number" inputmode="numeric" id="mp" value="${s.macroPct.p}"></label>
        <label class="field" style="margin:0"><span>Carbs</span><input type="number" inputmode="numeric" id="mc" value="${s.macroPct.c}"></label>
        <label class="field" style="margin:0"><span>Fat</span><input type="number" inputmode="numeric" id="mf" value="${s.macroPct.f}"></label>
      </div>
      <p class="small muted" id="macrog"></p>
      <label class="field"><span>Water goal (ml)</span><input type="number" inputmode="numeric" id="water" value="${s.waterGoal}"></label>
      <label class="check"><input type="checkbox" id="addex" ${s.addExerciseCalories ? 'checked' : ''}> Add Garmin exercise calories to my daily budget</label>
    </div>

    <details class="card"><summary>Work out my calorie goal</summary>
      <div class="grid2">
        <label class="field"><span>Sex</span>${sel('sex', [['male', 'Male'], ['female', 'Female']], p.sex)}</label>
        <label class="field"><span>Age</span><input type="number" inputmode="numeric" id="age" value="${p.age || ''}"></label>
      </div>
      <label class="field"><span>Height (cm)</span><input type="number" inputmode="numeric" id="height" value="${p.heightCm || ''}"></label>
      <label class="field"><span>Activity</span>${sel('activity', ACTIVITY, p.activity)}</label>
      <label class="field"><span>Goal</span>${sel('goal', GOALS, p.goal)}</label>
      <p id="sugg">${sug ? `Suggested: <b>${fmtInt(sug)} kcal</b> (Mifflin–St Jeor, using your latest weight). <button class="btn sm" data-act="use">Use this</button>` : '<span class="small muted">Log your weight on the Today tab to get a suggestion.</span>'}</p>
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

    <div class="section-title">Your data</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Everything is stored in this browser on this device. Export a backup now and then, and import it to move to another device.</p>
      <div class="btn-row">
        <button class="btn" data-act="export">Export backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" id="importf" hidden></label>
      </div>
      <button class="btn danger block" style="margin-top:10px" data-act="reset">Erase all data</button>
    </div>
    <p class="small muted" style="text-align:center">Exercise library: free-exercise-db (public domain). Food data: McCance and Widdowson's CoFID (Open Government Licence v3.0), Open Food Facts (ODbL) and USDA FoodData Central (public domain).</p>`;

  const num = id => parseFloat(root.querySelector('#' + id).value);
  const showMacros = () => {
    const sum = s.macroPct.p + s.macroPct.c + s.macroPct.f;
    root.querySelector('#macrog').textContent = sum !== 100
      ? `These add up to ${sum}%. Make them total 100%.`
      : `That's ${Math.round(s.calorieGoal * s.macroPct.p / 400)} g protein, ${Math.round(s.calorieGoal * s.macroPct.c / 400)} g carbs, ${Math.round(s.calorieGoal * s.macroPct.f / 900)} g fat.`;
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
    if (id === 'goal') p.goal = +v;
    if (id === 'akey') s.anthropicKey = v.trim();
    if (id === 'model') s.aiModel = v;
    if (id === 'region') s.foodRegion = v;
    if (id === 'ukey') s.usdaKey = v.trim();
    if (id === 'usdaon') s.usdaOff = !e.target.checked;
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
    if (['sex', 'age', 'height', 'activity', 'goal'].includes(id) && e.type === 'change') {
      const sug = suggestedCalories();
      if (sug) root.querySelector('#sugg').innerHTML = `Suggested: <b>${fmtInt(sug)} kcal</b> (Mifflin–St Jeor, using your latest weight). <button class="btn sm" data-act="use">Use this</button>`;
    }
    if (id === 'units' && e.type === 'change') rerender();
  };

  root.onclick = async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'use') { s.calorieGoal = suggestedCalories(); save(); rerender(); toast('Calorie goal updated'); }
    if (a === 'sync') {
      t.disabled = true;
      t.innerHTML = '<span class="spinner"></span> Syncing…';
      try { await syncIntervals({ days: s.icuDays }); } catch (err) { toast(err.message, 6000); }
      rerender();
    }
    if (a === 'export') {
      await flush();
      const copy = JSON.parse(JSON.stringify(state));
      copy.settings.anthropicKey = '';
      copy.settings.icuKey = '';
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
      await replaceState(data);
      location.reload();
    } catch (err) {
      toast("That file isn't a FitTrack backup.");
    }
  };
}
