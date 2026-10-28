import { h, ring, tone } from './ui.js';
import { typeLabel, modeInfo } from './constants.js';

const RESULT_WORD = { positive: 'Positive outcome', neutral: 'Neutral outcome', negative: 'Negative outcome' };

function volumeWord(db) {
  if (db == null) return null;
  if (db < -38) return 'Very quiet';
  if (db > -10) return 'Very loud';
  return 'Good level';
}

/** The scoring box: overall score, category tiles (hover/tap to expand the "why"), and the improvement feedback. */
export function renderResult(s) {
  const root = h('div', { class: 'result' });
  const scores = s.scores || [];
  const fb = s.feedback || {};

  /* overall */
  const meta = [typeLabel(s.sales_type), s.mode ? modeInfo(s.mode)?.label : null].filter(Boolean).join(' · ');
  const overall = h('div', { class: 'card overall fx', 'data-fx': 'mint' },
    h('div', { class: 'overall-ring' }, ring(s.overall, 132, 10), h('div', { class: 'overall-num' }, String(s.overall))),
    h('div', { class: 'overall-text' },
      h('div', { class: 'muted' }, 'Out of 100'),
      meta ? h('div', { class: 'overall-meta' }, meta) : null,
      s.outcome?.result ? h('div', { class: `pill ${s.outcome.result}` }, RESULT_WORD[s.outcome.result]) : null));

  /* categories */
  const cats = h('div', { class: 'card cats fx', 'data-fx': 'purple' });
  const closeAll = () => { cats.classList.remove('has-open'); cats.querySelectorAll('.cat.open').forEach((c) => c.classList.remove('open')); };
  const open = (tile) => { closeAll(); tile.classList.add('open'); cats.classList.add('has-open'); };
  for (const c of scores) {
    const tile = h('button', { class: `cat ${tone(c.score)}`, type: 'button', 'aria-expanded': 'false' },
      h('span', { class: 'cat-top' }, h('span', { class: 'cat-label' }, c.label), h('span', { class: 'cat-score' }, String(c.score))),
      h('span', { class: 'cat-bar' }, h('i', { style: { width: `${c.score}%` } })),
      h('span', { class: 'cat-why' },
        h('strong', {}, `${c.label}: ${c.score}/100`),
        h('span', {}, c.why || 'No detail was returned for this category.'),
        h('em', {}, 'Click anywhere else to close')));
    tile.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(tile); });
    tile.addEventListener('click', (e) => { e.stopPropagation(); if (!tile.classList.contains('open')) open(tile); tile.setAttribute('aria-expanded', 'true'); });
    cats.append(tile);
  }
  // Close when you click anywhere that isn't the open tile. Self-removes once this result leaves the page.
  const onDoc = (e) => {
    if (!root.isConnected) { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); return; }
    if (!e.target.closest?.('.cat.open')) closeAll();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeAll(); };
  document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey);

  /* feedback */
  const sections = [];
  if (fb.rebuttals?.length) {
    sections.push(h('section', {},
      h('h3', {}, 'What to say next'),
      fb.rebuttals.map((r) => h('div', { class: 'rebut' },
        r.heard ? h('p', { class: 'heard' }, `They said: "${r.heard}"`) : null,
        r.why_it_missed ? h('p', {}, r.why_it_missed) : null,
        h('p', { class: 'say' }, h('span', {}, 'Try: '), `"${r.try_saying}"`)))));
  }
  if (fb.speaking || s.metrics?.wpm) {
    const m = s.metrics || {};
    const chips = [];
    if (m.wpm) chips.push(h('span', { class: 'chip-stat' }, `${m.wpm} words/min`));
    if (m.avg_db != null) chips.push(h('span', { class: 'chip-stat' }, `${volumeWord(m.avg_db)} (${m.avg_db} dB)`));
    sections.push(h('section', {}, h('h3', {}, 'Speaking'), chips.length ? h('div', { class: 'chips-row' }, chips) : null, fb.speaking ? h('p', {}, fb.speaking) : null));
  }
  if (fb.approach) sections.push(h('section', {}, h('h3', {}, 'Approach'), h('p', {}, fb.approach)));
  if (fb.close) sections.push(h('section', {}, h('h3', {}, 'Close'), h('p', {}, fb.close)));
  if (fb.general) sections.push(h('section', {}, h('h3', {}, 'Anything else'), h('p', {}, fb.general)));
  const feedback = h('div', { class: 'card feedback fx' },
    h('h2', {}, 'How to improve'),
    s.outcome?.summary ? h('p', { class: 'muted' }, s.outcome.summary) : null,
    sections.length ? sections : h('p', {}, 'Nothing to fix here. That one was clean.'));

  root.append(h('div', { class: 'result-top' }, overall, cats), feedback);
  return root;
}
