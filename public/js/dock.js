import { h, svg } from './ui.js';

const ICONS = {
  score: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h2.5M8 8v8M12 4v16M16 9v6M20.5 12H19"/></svg>',
  profile: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/></svg>',
  practice: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/></svg>',
};
export const ITEMS = [
  { route: 'score', short: 'Score', full: 'Score my calls' },
  { route: 'profile', short: 'Profile', full: 'Profile' },
  { route: 'practice', short: 'Practice', full: 'Run a test call' },
];
const touch = () => matchMedia('(hover: none)').matches;

export function initDock(nav, onGo) {
  for (const it of ITEMS) {
    const a = h('a', { class: 'dock-item', href: `#/${it.route}`, 'data-route': it.route, 'aria-label': it.full },
      h('span', { class: 'dock-orb' },
        svg(ICONS[it.route]),
        h('span', { class: 'short' }, it.short),
        h('span', { class: 'full' }, it.full)));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.classList.contains('active')) return;
      if (touch()) {
        // Phones have no hover: the circle expands on tap, then the page transition starts.
        a.classList.add('pop');
        setTimeout(() => { onGo(it.route); setTimeout(() => a.classList.remove('pop'), 600); }, 260);
      } else onGo(it.route);
    });
    nav.append(a);
  }
}
export function setActive(nav, route) {
  nav.querySelectorAll('.dock-item').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
}
