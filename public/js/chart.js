import { h, svg, fmtDate } from './ui.js';

/** Score history line chart. points: [{score, at, title}] oldest first. */
export function lineChart(points) {
  const W = 640, H = 220, L = 34, R = 14, T = 14, B = 26;
  const wrap = h('div', { class: 'chart-wrap' });
  if (!points.length) { wrap.append(h('p', { class: 'muted chart-empty' }, 'Score your first clip or practice call and your progress shows up here.')); return wrap; }
  const x = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const grid = [0, 25, 50, 75, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".16"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" fill="currentColor" fill-opacity=".75" font-size="11">${v}</text>`).join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle class="pt dot" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="5"/>`).join('');
  const first = fmtDate(points[0].at), last = fmtDate(points[points.length - 1].at);
  const el = svg(`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Score history">
    ${grid}<path d="${line}" fill="none" stroke="#5b3fd6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${L}" y="${H - 6}" fill="currentColor" fill-opacity=".75" font-size="11">${first}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" fill="currentColor" fill-opacity=".75" font-size="11">${points.length > 1 ? last : ''}</text></svg>`);
  const tip = h('div', { class: 'chart-tip' });
  el.querySelectorAll('.pt').forEach((c) => {
    const show = () => {
      const p = points[+c.dataset.i];
      tip.replaceChildren(h('strong', {}, `${p.score}/100`), h('span', {}, `${p.title} · ${fmtDate(p.at)}`));
      tip.style.left = `${(x(+c.dataset.i) / W) * 100}%`; tip.style.top = `${(y(p.score) / H) * 100}%`; tip.classList.add('on');
    };
    c.addEventListener('pointerenter', show); c.addEventListener('focus', show); c.addEventListener('click', show);
    c.addEventListener('pointerleave', () => tip.classList.remove('on'));
  });
  wrap.append(el, tip);
  return wrap;
}
