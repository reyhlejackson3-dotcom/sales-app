import { handle, readJson, send, callClaude, extractJson, str, clamp, HttpError } from './_lib.js';
import { RUBRICS, scoringSystem } from './_prompts.js';

const words = (s) => (String(s).match(/\S+/g) || []).length;
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Per-speaker pace and loudness from timed phrases + a loudness curve (dBFS every stepSec). */
function speakerMetrics(phrases, volume) {
  const step = Number(volume?.stepSec) || 0.5;
  const db = Array.isArray(volume?.db) ? volume.db : [];
  const by = {};
  for (const p of phrases) {
    const k = `Speaker ${p.speaker}`;
    const m = (by[k] ||= { words: 0, ms: 0, dbSum: 0, dbN: 0 });
    m.words += words(p.text);
    m.ms += Math.max(0, p.endMs - p.startMs);
    for (let i = Math.floor(p.startMs / 1000 / step); i <= Math.floor(p.endMs / 1000 / step); i++) {
      const v = db[i];
      if (typeof v === 'number' && v > -55) { m.dbSum += v; m.dbN++; }
    }
  }
  const out = {};
  for (const [k, m] of Object.entries(by)) {
    out[k] = {
      words: m.words,
      speaking_sec: Math.round(m.ms / 1000),
      wpm: m.ms > 3000 ? Math.round(m.words / (m.ms / 60000)) : null,
      avg_db: m.dbN ? Math.round((m.dbSum / m.dbN) * 10) / 10 : null,
    };
  }
  return out;
}

function demoResult(salesType, kind) {
  const rubric = RUBRICS[salesType] || RUBRICS.cold_call;
  const base = [78, 66, 58, 84, 72, 64];
  return {
    outcome: { result: 'positive', summary: 'The prospect agreed to a demo on Thursday.' },
    categories: rubric.map((c, i) => ({
      key: c.key, score: base[i % base.length],
      why: `Demo mode: this is sample text. With your Anthropic key set, this explains exactly why "${c.label}" earned this score, based on your actual call.`,
    })),
    feedback: {
      rebuttals: [{
        heard: 'We\'re pretty happy with what we have.',
        why_it_missed: 'Sample feedback. The reply accepted the objection instead of exploring it.',
        try_saying: 'That makes sense. What would have to be true for you to want a second option?',
      }],
      speaking: 'Demo mode: your pace and volume numbers will show up here.',
      approach: 'Demo mode: feedback on your first four seconds will show up here.',
      close: 'Demo mode: feedback on how you closed will show up here.',
      general: null,
    },
    seller: kind === 'clip' ? 'Speaker 1' : null,
  };
}

export default handle(async (req, res) => {
  const b = await readJson(req, 400_000);
  const kind = b.kind === 'call' ? 'call' : 'clip';
  const salesType = RUBRICS[b.sales_type] ? b.sales_type : 'cold_call';
  const mode = ['easy', 'medium', 'hard', 'extreme'].includes(b.mode) ? b.mode : 'medium';
  const rubric = RUBRICS[salesType];

  // Build a normalized transcript and metrics.
  let lines = []; let metricsBySpeaker = {}; let transcript = [];
  if (kind === 'clip') {
    const phrases = (Array.isArray(b.phrases) ? b.phrases : []).slice(0, 400).map((p) => ({
      speaker: Number(p.speaker) || 1, startMs: Number(p.startMs) || 0, endMs: Number(p.endMs) || 0, text: str(p.text, 600),
    })).filter((p) => p.text);
    if (phrases.length < 2) throw new HttpError(400, 'Not enough speech was detected in that clip to score it.');
    metricsBySpeaker = speakerMetrics(phrases, b.volume);
    lines = phrases.map((p) => `[${mmss(p.startMs)}] Speaker ${p.speaker}: ${p.text}`);
    transcript = phrases.map((p) => ({ who: `Speaker ${p.speaker}`, text: p.text }));
  } else {
    const t = (Array.isArray(b.transcript) ? b.transcript : []).slice(0, 80).map((m) => ({
      role: m.role === 'rep' ? 'rep' : 'prospect', text: str(m.text, 600),
    })).filter((m) => m.text);
    if (t.filter((m) => m.role === 'rep').length < 2) throw new HttpError(400, 'That call was too short to score. Say a bit more and try again.');
    lines = t.map((m) => `${m.role === 'rep' ? 'Rep' : 'Prospect'}: ${m.text}`);
    transcript = t.map((m) => ({ who: m.role === 'rep' ? 'Rep' : 'Prospect', text: m.text }));
    const mm = b.metrics || {};
    metricsBySpeaker = { Rep: { wpm: Number(mm.wpm) || null, avg_db: Number(mm.avg_db) || null, speaking_sec: Number(mm.speaking_sec) || null, words: Number(mm.words) || null } };
  }

  let parsed; let demo = false;
  if (!process.env.ANTHROPIC_API_KEY) {
    demo = true;
    parsed = demoResult(salesType, kind);
  } else {
    const metricsText = Object.entries(metricsBySpeaker)
      .map(([k, m]) => `${k}: ${m.wpm ?? 'n/a'} wpm, avg level ${m.avg_db ?? 'n/a'} dBFS, ${m.speaking_sec ?? 'n/a'}s speaking`).join('\n');
    const user = `${kind === 'call' ? `Difficulty: ${mode}. ` : ''}Sales type: ${salesType}. Seller sells: ${str(b.sells, 160) || 'unspecified'}.\n\nMeasured delivery:\n${metricsText || 'n/a'}\n\n<transcript>\n${lines.join('\n').slice(0, 14000)}\n</transcript>`;
    const text = await callClaude({ system: scoringSystem({ salesType, mode, kind }), messages: [{ role: 'user', content: user }], maxTokens: 1800 });
    parsed = extractJson(text);
  }

  // Never trust model output shape: rebuild everything from known keys.
  const got = new Map((Array.isArray(parsed.categories) ? parsed.categories : []).map((c) => [c.key, c]));
  const scores = rubric.map((c) => ({ key: c.key, label: c.label, score: clamp(got.get(c.key)?.score, 0, 100), why: str(got.get(c.key)?.why, 700) }));
  const overall = Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length);
  const f = parsed.feedback || {};
  const feedback = {
    rebuttals: (Array.isArray(f.rebuttals) ? f.rebuttals : []).slice(0, 4).map((r) => ({ heard: str(r.heard, 300), why_it_missed: str(r.why_it_missed, 500), try_saying: str(r.try_saying, 500) })).filter((r) => r.try_saying),
    speaking: str(f.speaking, 700), approach: str(f.approach, 700), close: str(f.close, 700),
    general: typeof f.general === 'string' && f.general.trim() ? str(f.general, 700) : null,
  };
  const result = ['positive', 'neutral', 'negative'].includes(parsed.outcome?.result) ? parsed.outcome.result : 'neutral';
  const outcome = { result, summary: str(parsed.outcome?.summary, 300) };

  let metrics = null;
  if (kind === 'clip') {
    const seller = metricsBySpeaker[parsed.seller_speaker || parsed.seller] ? (parsed.seller_speaker || parsed.seller) : Object.keys(metricsBySpeaker)[0];
    metrics = { ...(metricsBySpeaker[seller] || {}), seller_speaker: seller };
    transcript = transcript.map((t) => ({ who: t.who === seller ? 'Rep' : 'Prospect', text: t.text }));
  } else {
    metrics = metricsBySpeaker.Rep;
  }

  send(res, 200, { overall, scores, feedback, outcome, metrics, transcript, demo });
});
