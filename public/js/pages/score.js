import { h, svg, toast, fmtTime } from '../ui.js';
import { SALES_TYPES, CATEGORIES, typeLabel } from '../constants.js';
import { CONFIG } from '../config.js';
import { renderResult } from '../result.js';
import { decodeFile, downsample, encodeWav, volumeWindows } from '../audio.js';
import { post, postBinary } from '../api.js';
import * as db from '../db.js';

const UP = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>';

export async function mount(view) {
  const profile = await db.getProfile();
  let file = null, objectUrl = null, salesType = 'cold_call', category = CATEGORIES.includes(profile.category) ? profile.category : CATEGORIES[0], working = false;

  const page = h('section', { class: 'page score-page' });
  const title = h('h1', { class: 'display fx', 'data-fx': 'white' }, 'Score my calls');

  /* phone (upload) */
  const input = h('input', { type: 'file', accept: 'video/*,audio/*,.mp4,.mov,.m4a,.mp3,.wav,.webm', class: 'sr-only', onchange: (e) => pick(e.target.files[0]) });
  const screen = h('div', { class: 'phone-screen' });
  const phone = h('div', { class: 'phone' }, h('div', { class: 'phone-notch' }), screen);
  const phoneWrap = h('div', { class: 'phone-wrap fx', 'data-fx': 'mint' }, phone);

  function drop() {
    screen.replaceChildren(h('button', { class: 'drop', type: 'button', onclick: () => input.click() },
      svg(UP), h('strong', {}, 'Drag to upload clip here'), h('span', {}, 'Video or audio, up to 2 minutes is scored'), h('small', {}, 'Horizontal videos resize the phone')));
    phone.classList.remove('landscape');
  }
  screen.addEventListener('dragover', (e) => { e.preventDefault(); screen.classList.add('over'); });
  screen.addEventListener('dragleave', () => screen.classList.remove('over'));
  screen.addEventListener('drop', (e) => { e.preventDefault(); screen.classList.remove('over'); pick(e.dataTransfer.files[0]); });

  function pick(f) {
    if (!f || working) return;
    if (!/^(video|audio)\//.test(f.type) && !/\.(mp4|mov|m4a|mp3|wav|webm)$/i.test(f.name)) { toast('Pick a video or audio file.'); return; }
    if (f.size > CONFIG.MAX_FILE_MB * 1024 * 1024) { toast(`That file is over ${CONFIG.MAX_FILE_MB} MB.`); return; }
    file = f;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(f);
    if (f.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(f.name)) {
      const v = h('video', { src: objectUrl, controls: true, playsinline: true, preload: 'metadata' });
      v.addEventListener('loadedmetadata', () => phone.classList.toggle('landscape', v.videoWidth > v.videoHeight));
      screen.replaceChildren(v);
    } else {
      screen.replaceChildren(h('div', { class: 'audio-prev' }, svg('<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12h2.5M8 8v8M12 4v16M16 9v6M20.5 12H19"/></svg>'), h('audio', { src: objectUrl, controls: true })));
      phone.classList.remove('landscape');
    }
    nameInput.value ||= f.name.replace(/\.[^.]+$/, '').slice(0, 60);
    scoreBtn.disabled = false;
    fileNote.textContent = f.name;
  }

  /* setup */
  const nameInput = h('input', { placeholder: 'Name this clip', maxlength: 60 });
  const fileNote = h('p', { class: 'muted small' }, 'No file chosen yet');
  const typeRow = h('div', { class: 'chips-row' });
  const catSel = h('select', { onchange: (e) => { category = e.target.value; } }, CATEGORIES.map((c) => h('option', { value: c, selected: c === category }, c)));
  function drawTypes() {
    typeRow.replaceChildren(...SALES_TYPES.map((t) => h('button', { class: 'chip' + (salesType === t.id ? ' on' : ''), type: 'button', title: t.blurb, onclick: () => { salesType = t.id; drawTypes(); } }, t.label)));
  }
  drawTypes();
  const status = h('div', { class: 'status', hidden: true });
  const scoreBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: run }, 'Score this clip');
  const setup = h('div', { class: 'card setup fx', 'data-fx': 'purple' },
    h('h2', {}, 'What kind of call is it?'),
    h('p', { class: 'muted small' }, 'This decides which categories it gets scored on.'),
    typeRow,
    h('label', { class: 'field' }, h('span', {}, 'Category'), catSel),
    h('label', { class: 'field' }, h('span', {}, 'Clip name'), nameInput),
    fileNote,
    h('div', { class: 'row' }, scoreBtn, h('button', { class: 'btn ghost', type: 'button', onclick: () => input.click() }, 'Choose file')),
    status);
  const resultSlot = h('div', { class: 'result-slot' });

  function step(msg) { status.hidden = false; status.replaceChildren(h('span', { class: 'spin' }), msg); }

  async function run() {
    if (!file || working) return;
    working = true; scoreBtn.disabled = true; resultSlot.replaceChildren();
    try {
      step('Reading the audio…');
      const dec = await decodeFile(file, CONFIG.MAX_CLIP_SECONDS).catch(() => { throw new Error('Could not read audio from that file. Try an .mp4, .mov, .m4a, .mp3 or .wav.'); });
      if (dec.samples.length < dec.rate * 3) throw new Error('That clip is too short. Use at least a few seconds of conversation.');
      const volume = { stepSec: 0.5, db: volumeWindows(dec.samples, dec.rate, 0.5) };
      const wav = encodeWav(downsample(dec.samples, dec.rate, 16000), 16000);

      step('Transcribing who said what…');
      const tr = await postBinary('/api/transcribe?diarize=1', wav);
      if (!tr.phrases?.length) throw new Error('No speech was detected in that clip.');

      step('Grading your call…');
      const graded = await post('/api/score', { kind: 'clip', sales_type: salesType, category, sells: profile.sells || '', phrases: tr.phrases, volume, durationSec: Math.round(Math.min(dec.duration, CONFIG.MAX_CLIP_SECONDS)) });
      if (dec.trimmed) graded.metrics = { ...graded.metrics, trimmed: true };

      const saved = await db.addSession({
        kind: 'clip', title: nameInput.value.trim() || 'Untitled clip', sales_type: salesType, category, mode: null,
        overall: graded.overall, scores: graded.scores, feedback: graded.feedback, outcome: graded.outcome,
        metrics: graded.metrics, transcript: graded.transcript, duration_sec: Math.round(Math.min(dec.duration, CONFIG.MAX_CLIP_SECONDS)),
      });
      status.hidden = true;
      const done = h('div', { class: 'row-between done-bar' },
        h('p', { class: 'muted' }, `Saved to your profile${dec.trimmed ? ` · scored the first ${fmtTime(CONFIG.MAX_CLIP_SECONDS)}` : ''}`),
        h('a', { class: 'btn ghost', href: '#/profile' }, 'View profile'));
      resultSlot.replaceChildren(renderResult(saved), done);
      resultSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      status.hidden = false;
      status.replaceChildren(h('span', { class: 'err' }, e.message || 'Something went wrong.'));
    } finally { working = false; scoreBtn.disabled = !file; }
  }

  drop();
  page.append(title, h('div', { class: 'score-grid' }, phoneWrap, h('div', { class: 'score-right' }, setup, resultSlot)), input);
  view.append(page);
  return { unmount() { if (objectUrl) URL.revokeObjectURL(objectUrl); } };
}
