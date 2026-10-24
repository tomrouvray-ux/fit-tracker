// Router and startup.

import { load, state, flush } from './store.js';
import { $, $$ } from './ui.js';
import { loadLibrary } from './exercises.js';
import { renderTrain, renderWorkout, runRest } from './train.js';
import { renderFood } from './food.js';
import { renderActivity, autoSync } from './garmin.js';
import { renderToday } from './today.js';
import { renderProgress } from './progress.js';
import { renderSettings } from './settings.js';

const ROUTES = {
  today: { title: 'Today', tab: 'today', render: renderToday },
  train: { title: 'Train', tab: 'train', render: renderTrain },
  workout: { title: 'Workout', tab: 'train', render: renderWorkout },
  food: { title: 'Food', tab: 'food', render: renderFood },
  activity: { title: 'Activity', tab: 'activity', render: renderActivity },
  progress: { title: 'Progress', tab: 'progress', render: renderProgress },
  settings: { title: 'Settings', tab: null, render: renderSettings },
};

let current = 'today';

export function go(name) {
  if (!ROUTES[name]) name = 'today';
  if (name === 'train' && state.activeWorkout && current !== 'workout') name = 'workout';
  current = name;
  try { sessionStorage.setItem('route', name); } catch (e) {}
  rerender();
  window.scrollTo(0, 0);
}

export function rerender() {
  const r = ROUTES[current];
  $('#title').textContent = r.title;
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === r.tab));
  const view = $('#view');
  view.onclick = null;
  view.oninput = null;
  view.onchange = null;
  r.render(view);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
export { applyTheme };

document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g && !e.defaultPrevented) {
    if (g.dataset.go === 'train' && current === 'workout') return;
    go(g.dataset.go);
  }
});

// Save before the page is hidden (iOS can kill backgrounded PWAs).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

async function start() {
  await load();
  applyTheme();
  loadLibrary().then(() => { if (current === 'workout' || current === 'train') rerender(); });
  let saved = null;
  try { saved = sessionStorage.getItem('route'); } catch (e) {}
  go(state.activeWorkout ? 'workout' : saved || 'today');
  runRest();
  autoSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
