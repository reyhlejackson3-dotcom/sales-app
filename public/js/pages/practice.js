import { h, svg, toast, fmtTime } from '../ui.js';
import { MODES, SALES_TYPES, CATEGORIES, modeInfo, typeLabel } from '../constants.js';
import { avatar } from '../avatars.js';
import { renderResult } from '../result.js';
import { Mic, concat, downsample, encodeWav } from '../audio.js';
import { post, postBinary } from '../api.js';
import * as db from '../db.js';

const words = (s) => (String(s).match(/\S+/g) || []).length;

export async function mount(view) {
  const profile = await db.getProfile();
  let mode = 'medium', salesType = 'cold_call', category = CATEGORIES.includes(profile.category) ? profile.category : CATEGORIES[0];

  // call state
  const S = { phase: 'idle', sub: '', history: [], mic: null, rate: 48000, startAt: 0, timer: null, audio: null, rec: null, srFinal: '', srInterim: '', words: 0, speechSec: 0, dbWeighted: 0, repSpoken: 0, repTurns: 0, liveBubble: null,
    vad: { floor: 0.004, calib: 0, hits: 0, speaking: false, pre: [], chunks: [], voicedSec: 0, silence: 0, dbSum: 0, dbN: 0 }, ended: null };
  let alive = true;

  const page = h('section', { class: 'page practice-page' });

  /* ----- setup ----- */
  const modeRow = h('div', { class: 'modes' });
  const modeDesc = h('p', { class: 'mode-desc muted' });
  const typeBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => { picker.hidden = !picker.hidden; } });
  const picker = h('div', { class: 'picker card', hidden: true });
  const startBtn = h('button', { class: 'btn big', type: 'button', onclick: startCall }, 'Start call');

  function drawSetup() {
    modeRow.replaceChildren(...MODES.map((m) => h('button', { class: 'mode-orb' + (mode === m.id ? ' on' : ''), type: 'button', 'aria-pressed': String(mode === m.id), onclick: () => { mode = m.id; drawSetup(); } },
      h('span', { class: 'mode-face' }, avatar(m.id)), h('span', { class: 'mode-name' }, m.label))));
    const m = modeInfo(mode);
    modeDesc.textContent = `${m.name}: ${m.blurb}`;
    typeBtn.textContent = `${typeLabel(salesType)} · ${category}`;
    picker.replaceChildren(
      h('div', { class: 'chips-row' }, SALES_TYPES.map((t) => h('button', { class: 'chip' + (salesType === t.id ? ' on' : ''), type: 'button', onclick: () => { salesType = t.id; drawSetup(); } }, t.label))),
      h('div', { class: 'chips-row' }, CATEGORIES.map((c) => h('button', { class: 'chip' + (category === c ? ' on' : ''), type: 'button', onclick: () => { category = c; drawSetup(); } }, c))));
  }

  /* ----- conversation box ----- */
  const faceBox = h('div', { class: 'face' });
  const nameEl = h('div', { class: 'convo-name' });
  const wpmEl = h('span', {}, '–'), timeEl = h('span', {}, '0:00'), meterFill = h('i', {});
  const stateEl = h('div', { class: 'convo-state' });
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const typed = h('input', { class: 'typed', placeholder: 'Or type your reply and press Enter', maxlength: 400, disabled: true,
    onkeydown: (e) => { if (e.key === 'Enter' && typed.value.trim()) { const t = typed.value.trim(); typed.value = ''; onRepText(t, null); } } });
  const endBtn = h('button', { class: 'btn ghost danger', type: 'button', onclick: () => finish('ended') }, 'End call');
  const foot = h('div', { class: 'convo-foot' });
  const convo = h('div', { class: 'card convo' },
    h('div', { class: 'convo-head' },
      h('div', { class: 'who' }, faceBox, nameEl),
      h('div', { class: 'live' },
        h('div', { class: 'live-stat' }, wpmEl, h('small', {}, 'words/min')),
        h('div', { class: 'live-stat' }, timeEl, h('small', {}, 'time')),
        h('div', { class: 'meter', title: 'Your volume' }, meterFill))),
    stateEl, msgs, foot);

  function setSub(sub) { S.sub = sub; stateEl.textContent = { listening: 'Your turn. Speak when you\'re ready.', thinking: 'Thinking…', speaking: 'Speaking…', '': '' }[sub] ?? ''; stateEl.dataset.sub = sub; typed.disabled = !(S.phase === 'live' && sub === 'listening'); }
  function addMsg(role, text) {
    if (S.liveBubble) { S.liveBubble.remove(); S.liveBubble = null; }
    msgs.append(h('div', { class: `msg ${role}` }, h('span', {}, text)));
    msgs.scrollTop = msgs.scrollHeight;
  }
  function showLive(text) {
    if (!text) { S.liveBubble?.remove(); S.liveBubble = null; return; }
    if (!S.liveBubble) { S.liveBubble = h('div', { class: 'msg rep live' }, h('span', {})); msgs.append(S.liveBubble); }
    S.liveBubble.firstChild.textContent = text; msgs.scrollTop = msgs.scrollHeight;
  }

  function drawIdleFoot() {
    const m = modeInfo(mode);
    faceBox.replaceChildren(avatar(mode)); nameEl.textContent = m.name;
    msgs.replaceChildren(h('p', { class: 'convo-empty' }, 'The prospect answers first. Speak when it\'s your turn, or type. When the call ends this box becomes your score.'));
    foot.replaceChildren(startBtn);
    stateEl.textContent = ''; wpmEl.textContent = '–'; timeEl.textContent = '0:00'; meterFill.style.width = '0%';
  }
  function drawLiveFoot() { foot.replaceChildren(typed, endBtn); }

  /* ----- voice activity detection ----- */
  function onChunk(f32, rate) {
    S.rate = rate;
    let sum = 0; for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
    const rms = Math.sqrt(sum / f32.length);
    meterFill.style.width = `${Math.min(100, rms * 600)}%`;
    const v = S.vad;
    if (S.phase !== 'live' || S.sub !== 'listening') { v.pre.length = 0; v.speaking = false; v.hits = 0; return; }
    if (v.calib < 8) { v.floor = (v.floor * v.calib + rms) / (v.calib + 1); v.calib++; return; }
    const thr = Math.max(0.012, v.floor * 3.2), voiced = rms > thr, dur = f32.length / rate;
    if (!v.speaking) {
      v.pre.push(f32); if (v.pre.length > 8) v.pre.shift();
      if (voiced) v.hits++; else { v.hits = 0; v.floor = v.floor * 0.98 + rms * 0.02; }
      if (v.hits >= 3) { v.speaking = true; v.chunks = [...v.pre]; v.voicedSec = 3 * dur; v.silence = 0; v.dbSum = 0; v.dbN = 0; v.t0 = performance.now(); }
    } else {
      v.chunks.push(f32);
      if (voiced) { v.silence = 0; v.voicedSec += dur; v.dbSum += 20 * Math.log10(rms); v.dbN++; } else v.silence += dur;
      const liveWords = words(`${S.srFinal} ${S.srInterim}`);
      if (liveWords && v.voicedSec > 1) wpmEl.textContent = String(Math.min(400, Math.round(((S.words + liveWords) / ((S.speechSec + v.voicedSec) / 60)))));
      if (v.silence >= 1.1 || v.voicedSec > 45) endUtterance();
    }
  }

  async function endUtterance() {
    const v = S.vad; v.speaking = false; v.hits = 0;
    if (v.voicedSec < 0.45) { v.chunks = []; return; }
    setSub('thinking');
    const audio = concat(v.chunks); v.chunks = []; v.pre.length = 0;
    const liveText = `${S.srFinal} ${S.srInterim}`.replace(/\s+/g, ' ').trim();
    S.srFinal = ''; S.srInterim = '';
    const info = { voicedSec: v.voicedSec, avgDb: v.dbN ? v.dbSum / v.dbN : null };
    let text = '';
    try {
      const wav = encodeWav(downsample(audio, S.rate, 16000), 16000);
      const r = await postBinary('/api/transcribe', wav);
      text = r.demo ? liveText : (r.text || '').trim();
    } catch (e) { text = liveText; }
    if (!text) { toast('Didn\'t catch that. Try again or type it.'); setSub('listening'); return; }
    onRepText(text, info);
  }

  /* ----- turns ----- */
  async function onRepText(text, info) {
    if (S.phase !== 'live' || S.sub === 'thinking' && !info) return;
    setSub('thinking');
    addMsg('rep', text);
    S.history.push({ role: 'rep', text }); S.repTurns++;
    if (info) { S.words += words(text); S.speechSec += info.voicedSec; if (info.avgDb != null) S.dbWeighted += info.avgDb * info.voicedSec; wpmEl.textContent = String(Math.min(400, Math.round(S.words / (S.speechSec / 60)) || 0) || '–'); }
    await prospectTurn();
  }

  async function prospectTurn() {
    try {
      const r = await post('/api/chat', { mode, sales_type: salesType, category, sells: profile.sells || '', history: S.history });
      if (!alive || S.phase !== 'live') return;
      S.history.push({ role: 'prospect', text: r.reply });
      addMsg('prospect', r.reply);
      setSub('speaking');
      await speak(r.reply);
      if (!alive || S.phase !== 'live') return;
      if (r.end) { S.ended = r.end; finish(r.end); return; }
      S.srFinal = ''; S.srInterim = ''; S.vad.pre.length = 0; S.vad.hits = 0;
      setSub('listening');
    } catch (e) {
      toast(e.message || 'The prospect lost the line.');
      if (S.phase === 'live') setSub('listening');
    }
  }

  async function speak(text) {
    try {
      const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, mode }) });
      if ((res.headers.get('content-type') || '').includes('audio')) {
        const url = URL.createObjectURL(await res.blob());
        await new Promise((resolve) => { const a = new Audio(url); S.audio = a; a.onended = a.onerror = () => { URL.revokeObjectURL(url); resolve(); }; a.play().catch(resolve); });
        return;
      }
    } catch { /* fall through to the browser voice */ }
    if ('speechSynthesis' in window) {
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.onend = u.onerror = resolve; speechSynthesis.speak(u);
        setTimeout(resolve, 9000);
      });
    }
  }

  /* ----- live captions (browser speech recognition, preview only) ----- */
  function startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
      rec.onresult = (e) => {
        if (S.sub !== 'listening') return;
        let fin = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
        if (fin) S.srFinal += ' ' + fin;
        S.srInterim = interim;
        if (S.vad.speaking) showLive(`${S.srFinal} ${S.srInterim}`.trim());
      };
      rec.onend = () => { if (alive && S.phase === 'live') { try { rec.start(); } catch { /* already running */ } } };
      rec.onerror = () => {};
      rec.start(); S.rec = rec;
    } catch { S.rec = null; }
  }

  /* ----- start / finish ----- */
  async function startCall() {
    if (S.phase !== 'idle') return;
    S.phase = 'starting'; startBtn.disabled = true; startBtn.textContent = 'Connecting…';
    Object.assign(S, { history: [], words: 0, speechSec: 0, dbWeighted: 0, repTurns: 0, ended: null, srFinal: '', srInterim: '' });
    Object.assign(S.vad, { floor: 0.004, calib: 0, hits: 0, speaking: false, pre: [], chunks: [] });
    msgs.replaceChildren(); faceBox.replaceChildren(avatar(mode)); nameEl.textContent = modeInfo(mode).name;
    try { S.mic = new Mic(); await S.mic.start(onChunk); }
    catch { S.mic = null; toast('Microphone is blocked, so type your replies instead.'); }
    if (!alive) { S.mic?.stop(); return; }
    S.phase = 'live'; S.startAt = Date.now(); drawLiveFoot();
    S.timer = setInterval(() => { timeEl.textContent = fmtTime((Date.now() - S.startAt) / 1000); }, 500);
    if (S.mic) startRecognition();
    setSub('thinking');
    await prospectTurn();
  }

  function cleanup() {
    clearInterval(S.timer); S.timer = null;
    try { S.rec && (S.rec.onend = null, S.rec.abort()); } catch { /* ignore */ }
    S.rec = null;
    S.mic?.stop(); S.mic = null;
    if (S.audio) { S.audio.pause(); S.audio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async function finish(reason) {
    if (S.phase !== 'live') return;
    S.phase = 'scoring'; cleanup(); setSub('');
    const hungup = reason === 'hangup';
    stateEl.textContent = '';
    if (S.repTurns < 2) {
      msgs.append(h('p', { class: 'convo-empty' }, 'That call was too short to score. Say a bit more next time.'));
      foot.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: reset }, 'Try again'));
      S.phase = 'done'; return;
    }
    foot.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spin' }), hungup ? 'They hung up. Scoring your call…' : 'Scoring your call…'));
    const metrics = { wpm: S.speechSec > 3 ? Math.round(S.words / (S.speechSec / 60)) : null, avg_db: S.speechSec ? Math.round((S.dbWeighted / S.speechSec) * 10) / 10 : null, speaking_sec: Math.round(S.speechSec), words: S.words };
    try {
      const g = await post('/api/score', { kind: 'call', mode, sales_type: salesType, category, sells: profile.sells || '', transcript: S.history, metrics });
      const saved = await db.addSession({
        kind: 'call', title: `Practice · ${modeInfo(mode).label} · ${typeLabel(salesType)}`, sales_type: salesType, category, mode,
        overall: g.overall, scores: g.scores, feedback: g.feedback, outcome: g.outcome, metrics: g.metrics, transcript: g.transcript, duration_sec: Math.round((Date.now() - S.startAt) / 1000),
      });
      if (!alive) return;
      msgs.replaceChildren(renderResult(saved)); msgs.scrollTop = 0; convo.classList.add('scored');
      foot.replaceChildren(h('a', { class: 'btn ghost', href: '#/profile' }, 'View profile'), h('button', { class: 'btn', type: 'button', onclick: reset }, 'Practice again'));
      S.phase = 'done';
    } catch (e) {
      foot.replaceChildren(h('span', { class: 'err' }, e.message || 'Scoring failed.'), h('button', { class: 'btn', type: 'button', onclick: reset }, 'Start over'));
      S.phase = 'done';
    }
  }

  function reset() { S.phase = 'idle'; convo.classList.remove('scored'); startBtn.disabled = false; startBtn.textContent = 'Start call'; drawIdleFoot(); }

  /* ----- assemble ----- */
  drawSetup(); drawIdleFoot();
  page.append(
    modeRow, modeDesc,
    h('div', { class: 'type-row' }, typeBtn), picker,
    convo);
  view.append(page);

  return {
    unmount() { alive = false; cleanup(); },
    confirmLeave() { return !(S.phase === 'live' || S.phase === 'starting') || confirm('Leave and discard this call?'); },
  };
}
