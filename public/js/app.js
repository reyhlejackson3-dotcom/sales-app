import { initDock, setActive } from './dock.js';

const ROUTES = {
  profile: () => import('./pages/profile.js'),
  score: () => import('./pages/score.js'),
  practice: () => import('./pages/practice.js'),
};
const view = document.getElementById('view');
const dock = document.getElementById('dock');

let current = null, shown = null, token = 0;
const fromHash = () => { const m = location.hash.match(/^#\/(\w+)/); return m && ROUTES[m[1]] ? m[1] : 'profile'; };

async function go(name) {
  if (name === shown) return;
  if (current?.confirmLeave && !current.confirmLeave()) { history.replaceState(null, '', `#/${shown}`); return; }
  const mine = ++token;
  const mod = await ROUTES[name]();
  if (mine !== token) return; // a newer navigation won
  current?.unmount?.();
  view.replaceChildren();
  window.scrollTo(0, 0);
  const inst = await mod.mount(view);
  if (mine !== token) { inst?.unmount?.(); return; }
  current = { name, ...(inst || {}) };
  shown = name;
  document.body.dataset.route = name;
  setActive(dock, name);
  if (location.hash !== `#/${name}`) history.pushState(null, '', `#/${name}`);
}

initDock(dock, (route) => go(route));
addEventListener('hashchange', () => go(fromHash()));
addEventListener('popstate', () => go(fromHash()));
go(fromHash());
