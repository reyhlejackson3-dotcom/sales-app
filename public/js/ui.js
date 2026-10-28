// Small DOM helpers. Everything dynamic goes through textContent, never innerHTML, so model output and user input can't inject markup.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Build SVG from a trusted, static (or numeric-only) template string. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

export function toast(msg, ms = 3200) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

export function banner(id, text) {
  const box = document.getElementById('banners');
  let el = box.querySelector(`[data-id="${id}"]`);
  if (!text) el?.remove();
  else {
    if (!el) { el = h('div', { class: 'banner', dataset: { id } }); box.append(el); }
    el.textContent = text;
  }
  // Push page content down by the banners' real height so they never cover the title.
  requestAnimationFrame(() => document.documentElement.style.setProperty('--banner-h', box.children.length ? `${box.offsetHeight + 14}px` : '0px'));
}

export function modal(content, { wide = false, onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => {
    document.removeEventListener('keydown', onKey);
    back.classList.remove('in');
    setTimeout(() => back.remove(), 220);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('button', { class: 'modal-x', 'aria-label': 'Close', onclick: close }, svg('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>')),
    content);
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('in'));
  return close;
}

export const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const tone = (s) => (s >= 80 ? 'hi' : s >= 60 ? 'mid' : s >= 40 ? 'low' : 'bad');

export function ring(score, size = 120, stroke = 9) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  return svg(`<svg class="ring ${tone(n)}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(c * n / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`);
}
