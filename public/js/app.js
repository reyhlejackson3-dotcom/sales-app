import { initStars, transition } from './fx.js';
import { initDock, setActive } from './dock.js';

const ROUTES = {
  profile: () => import('./pages/profile.js'),
  score: () => import('./pages/score.js'),
  practice: () => import('./pages/practice.js'),
};
const view = document.getElementById('view');
const dock = document.getElementById('dock');

let current = null, busy = false, queued = null, shown = null;
const fromHash = () => { const m = location.hash.match(/^#\/(\w+)/); return m && ROUTES[m[1]] ? m[1] : 'profile'; };

async function mountRoute(name) {
  const mod = await ROUTES[name]();
  current?.unmount?.();
  view.replaceChildren();
  window.scrollTo(0, 0);
  const inst = await mod.mount(view);
  current = { name, ...(inst || {}) };
  shown = name;
  document.body.dataset.route = name;
  setActive(dock, name);
}

async function go(name, { intro = false } = {}) {
  if (busy) { queued = name; return; }
  if (!intro && name === shown) return;
  if (current?.confirmLeave && !current.confirmLeave()) { history.replaceState(null, '', `#/${shown}`); return; }
  busy = true;
  if (location.hash !== `#/${name}`) history.pushState(null, '', `#/${name}`);
  try { await transition(view, () => mountRoute(name), { intro }); }
  catch (e) { console.error(e); view.style.opacity = '1'; }
  busy = false;
  if (queued && queued !== shown) { const q = queued; queued = null; go(q); } else queued = null;
}

initStars(document.getElementById('stars'));
initDock(dock, (route) => go(route));
addEventListener('hashchange', () => { const r = fromHash(); if (r !== shown) go(r); });
addEventListener('popstate', () => { const r = fromHash(); if (r !== shown) go(r); });
go(fromHash(), { intro: true });
