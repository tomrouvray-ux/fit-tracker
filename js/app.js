// Router and startup.

import { load, state, flush, setOnChange } from './store.js';
import { $, $$ } from './ui.js';
import { loadLibrary } from './exercises.js';
import { renderTrain, renderWorkout, runRest } from './train.js';
import { renderFood } from './food.js';
import { renderActivity, autoSync } from './garmin.js';
import { renderToday } from './today.js';
import { renderProgress } from './progress.js';
import { renderSettings } from './settings.js';
import { startSync, changed } from './sync.js';

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
  // Match the phone's status bar to the theme background.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name=theme-color]').setAttribute('content', bg);
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
  loadLibrary().then(() => { if (['workout', 'train', 'today'].includes(current)) rerender(); });
  let saved = null;
  try { saved = sessionStorage.getItem('route'); } catch (e) {}
  go(state.activeWorkout ? 'workout' : saved || 'today');
  runRest();
  autoSync();
  setOnChange(changed);
  // When another device's changes arrive, redraw unless something is being edited.
  startSync(() => {
    applyTheme();
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing && !document.querySelector('.sheet-bg')) rerender();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
    // When a new version takes over, reload once so the new files are used straight away.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || state.activeWorkout) return;
      reloaded = true;
      flush().then(() => location.reload());
    });
  }
}

start();
