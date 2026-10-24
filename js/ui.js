// Small DOM helpers shared by the views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const r0 = n => Math.round(n || 0);
export const r1 = n => Math.round((n || 0) * 10) / 10;
export const fmtInt = n => r0(n).toLocaleString();

export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(d).toLocaleDateString(undefined, opts);
}

export function fmtTime(d) {
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Bottom sheet. render(body, close) fills the body; returns { el, close }.
export function sheet(title, render, { onClose } = {}) {
  const root = $('#sheet-root');
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="btn ghost" data-close>Close</button></div>
    <div class="sheet-body"></div></div>`;
  root.appendChild(bg);
  const body = bg.querySelector('.sheet-body');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bg.remove();
    onClose && onClose();
  };
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.closest('[data-close]')) close();
  });
  render(body, close);
  return { el: body, close };
}

export function confirmSheet(title, message, okLabel = 'Delete') {
  return new Promise(resolve => {
    let answered = false;
    sheet(title, (body, close) => {
      body.innerHTML = `<p>${esc(message)}</p><div class="btn-row"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(okLabel)}</button></div>`;
      body.querySelector('[data-no]').onclick = () => { answered = true; resolve(false); close(); };
      body.querySelector('[data-yes]').onclick = () => { answered = true; resolve(true); close(); };
    }, { onClose: () => { if (!answered) resolve(false); } });
  });
}

// Calorie ring as SVG
export function ring(frac, label, sub, color = 'var(--accent)') {
  const R = 48, C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, frac));
  const over = frac > 1;
  return `<svg class="ring" viewBox="0 0 112 112" role="img" aria-label="${esc(label)} ${esc(sub)}">
    <circle cx="56" cy="56" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
    ${f > 0 ? `<circle cx="56" cy="56" r="${R}" fill="none" stroke="${over ? 'var(--danger)' : color}" stroke-width="10"
      stroke-linecap="round" stroke-dasharray="${C * f} ${C}" transform="rotate(-90 56 56)"/>` : ''}
    <text x="56" y="54" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">${esc(label)}</text>
    <text x="56" y="72" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(sub)}</text>
  </svg>`;
}

export function bar(frac, color = 'var(--accent)') {
  const f = Math.max(0, Math.min(1, frac || 0));
  return `<div class="bar"><i style="width:${f * 100}%;background:${frac > 1.05 ? 'var(--danger)' : color}"></i></div>`;
}

// Resize an image file to a JPEG data URL (keeps API payloads small).
export function resizeImage(file, max = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
