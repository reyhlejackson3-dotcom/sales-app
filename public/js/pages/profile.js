import { h, svg, modal, toast, fmtDate, ring, tone } from '../ui.js';
import { CATEGORIES, SALES_TYPES, typeLabel, modeInfo } from '../constants.js';
import { renderResult } from '../result.js';
import { lineChart } from '../chart.js';
import * as db from '../db.js';

const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

export async function mount(view) {
  let profile = await db.getProfile();
  let sessions = await db.listSessions();
  let filter = 'all';

  const page = h('section', { class: 'page profile-page' });
  view.append(page);

  function stats() {
    const top = sessions.length ? Math.max(...sessions.map((s) => s.overall)) : null;
    const avg = sessions.length ? Math.round(sessions.reduce((a, s) => a + s.overall, 0) / sessions.length) : null;
    return { top, avg, count: sessions.length };
  }

  function avatarEl() {
    if (profile.avatar) return h('img', { src: profile.avatar, alt: '' });
    return h('span', {}, (profile.display_name || '?').trim().charAt(0).toUpperCase());
  }

  function draw() {
    const st = stats();
    page.replaceChildren();

    const gear = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', onclick: openSettings }, svg(GEAR));
    const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value == null ? '–' : String(value)), h('div', { class: 'stat-l' }, label));
    const bar = h('div', { class: 'card p-bar' },
      h('div', { class: 'avatar' }, avatarEl()),
      h('div', { class: 'p-id' },
        h('div', { class: 'p-name' }, profile.display_name || 'Your name'),
        h('div', { class: 'p-line' }, [profile.company, profile.sells && `sells ${profile.sells}`].filter(Boolean).join(' · ') || 'Add what you sell in settings'),
        profile.bio ? h('div', { class: 'p-bio' }, profile.bio) : null,
        profile.category ? h('span', { class: 'tag' }, profile.category) : null),
      h('div', { class: 'stats' }, stat('Top score', st.top), stat('Average', st.avg), stat('Scored', st.count)),
      h('a', { class: 'btn', href: '#/score' }, 'Score a call'),
      gear);

    /* chart */
    const types = SALES_TYPES.filter((t) => sessions.some((s) => s.sales_type === t.id));
    const chips = [{ id: 'all', label: 'All' }, ...types].map((t) => h('button', { class: 'chip' + (filter === t.id ? ' on' : ''), type: 'button', onclick: () => { filter = t.id; draw(); } }, t.label));
    const pts = sessions.filter((s) => filter === 'all' || s.sales_type === filter).map((s) => ({ score: s.overall, at: s.created_at, title: s.title }));
    const chart = h('div', { class: 'card chart-card' },
      sessions.length > 1 ? h('div', { class: 'chips-row end' }, chips) : null,
      lineChart(pts));

    /* history grid: + tile first, newest after */
    const tiles = [h('a', { class: 'tile plus', href: '#/score', 'aria-label': 'Score a new clip' }, svg(PLUS), h('span', {}, 'Score a clip'))];
    for (const s of [...sessions].reverse()) {
      tiles.push(h('button', { class: 'tile clip', type: 'button', onclick: () => openSession(s) },
        h('div', { class: 'tile-ring' }, ring(s.overall, 78, 7), h('span', { class: `tile-num ${tone(s.overall)}` }, String(s.overall))),
        h('div', { class: 'tile-title' }, s.title),
        h('div', { class: 'tile-meta' }, `${typeLabel(s.sales_type)} · ${fmtDate(s.created_at)}`),
        h('span', { class: 'kind' }, s.kind === 'call' ? 'Practice' : 'Clip')));
    }
    const grid = h('div', { class: 'grid' }, tiles);
    page.append(bar, chart, grid);
  }

  function openSession(s) {
    const body = h('div', { class: 'detail' },
      h('h2', {}, s.title),
      h('p', { class: 'muted' }, `${s.kind === 'call' ? `Practice call${s.mode ? ` (${modeInfo(s.mode)?.label})` : ''}` : 'Uploaded clip'} · ${new Date(s.created_at).toLocaleString()}`),
      renderResult(s));
    if (s.transcript?.length) {
      body.append(h('details', { class: 'transcript' }, h('summary', {}, 'Transcript'),
        s.transcript.map((t) => h('p', {}, h('strong', {}, `${t.who}: `), t.text))));
    }
    let close;
    body.append(h('div', { class: 'detail-actions' },
      h('button', { class: 'btn ghost danger', type: 'button', onclick: async () => {
        if (!confirm('Delete this scored session? This can\'t be undone.')) return;
        await db.deleteSession(s.id); sessions = sessions.filter((x) => x.id !== s.id); close(); draw(); toast('Deleted');
      } }, 'Delete')));
    close = modal(body, { wide: true });
  }

  function openSettings() {
    const f = {
      name: h('input', { value: profile.display_name || '', maxlength: 60 }),
      company: h('input', { value: profile.company || '', maxlength: 80 }),
      sells: h('input', { value: profile.sells || '', maxlength: 120, placeholder: 'What do you sell?' }),
      category: h('select', {}, h('option', { value: '' }, 'Choose a category'), CATEGORIES.map((c) => h('option', { value: c, selected: c === profile.category }, c))),
      bio: h('textarea', { rows: 3, maxlength: 240, placeholder: 'A line about you' }, profile.bio || ''),
    };
    let avatarData = profile.avatar || null;
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', onchange: async (e) => {
      const img = e.target.files[0]; if (!img) return;
      avatarData = await shrink(img, 256); preview.replaceChildren(h('img', { src: avatarData, alt: '' }));
    } });
    const preview = h('div', { class: 'avatar sm' }, avatarEl());
    const lab = (t, el) => h('label', { class: 'field' }, h('span', {}, t), el);
    let close;
    const form = h('form', { class: 'settings', onsubmit: async (e) => {
      e.preventDefault();
      profile = await db.updateProfile({ display_name: f.name.value.trim() || 'Claudio', company: f.company.value.trim(), sells: f.sells.value.trim(), category: f.category.value || null, bio: f.bio.value.trim(), avatar: avatarData });
      close(); draw(); toast('Saved');
    } },
      h('h2', {}, 'Settings'),
      h('div', { class: 'row' }, preview, h('label', { class: 'btn ghost' }, 'Change photo', file)),
      lab('Name', f.name), lab('Company', f.company), lab('What you sell', f.sells), lab('Category', f.category), lab('Bio', f.bio),
      h('div', { class: 'detail-actions' },
        h('button', { class: 'btn ghost danger', type: 'button', onclick: async () => {
          if (!confirm('Delete ALL scored sessions on this test account?')) return;
          await db.deleteAllSessions(); sessions = []; close(); draw(); toast('Test data cleared');
        } }, 'Clear test data'),
        h('button', { class: 'btn', type: 'submit' }, 'Save changes')));
    close = modal(form);
  }

  draw();
}

async function shrink(file, size) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
