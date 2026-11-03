// Turns a finished call recording into timed phrases, with the rep and the prospect kept apart.
// Twilio records the rep on one audio channel and the prospect on the other, so there is no guessing who is talking.
import { handle, readJson, send, HttpError } from './_lib.js';
import { demoPhrases } from './_demo.js';
import { twilioLive, requireAccess, twilioApi } from './_twilio.js';

const REC = /^RE[0-9a-f]{32}$/;
const MAX_BYTES = 80_000_000;

/** Minimal WAV reader: where the audio data starts and how it is laid out. */
function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let p = 12; let fmt = null; let data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    let size = buf.readUInt32LE(p + 4);
    const start = p + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(start), ch: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    else if (id === 'data') { if (size === 0 || start + size > buf.length) size = buf.length - start; data = { start, size }; break; }
    p = start + size + (size & 1);
  }
  return fmt && data ? { ...fmt, ...data } : null;
}

/** Loudness (dBFS) of one channel every stepSec, same shape the grader already uses for uploaded clips. */
function channelDb(buf, w, channel, stepSec = 0.5) {
  if (!w || w.tag !== 1 || w.bits !== 16 || channel >= w.ch) return null;
  const frame = w.ch * 2; const frames = Math.floor(w.size / frame); const win = Math.max(1, Math.floor(w.rate * stepSec));
  const out = [];
  for (let i = 0; i < frames; i += win) {
    let s = 0; const end = Math.min(frames, i + win);
    for (let j = i; j < end; j++) { const v = buf.readInt16LE(w.start + j * frame + channel * 2) / 32768; s += v * v; }
    const rms = Math.sqrt(s / (end - i));
    out.push(rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -100);
  }
  return out;
}

export default handle(async (req, res) => {
  const b = await readJson(req);
  const key = process.env.AZURE_SPEECH_KEY; const region = process.env.AZURE_SPEECH_REGION;
  if (!twilioLive() || String(b.recordingSid || '').startsWith('demo')) {
    const phrases = demoPhrases();
    return send(res, 200, { demo: true, phrases, volume: null, durationSec: Math.round(phrases.at(-1).endMs / 1000) });
  }
  requireAccess(req);
  if (!REC.test(String(b.recordingSid || ''))) throw new HttpError(400, 'Bad recording id.');
  if (!key || !region) throw new HttpError(503, 'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to transcribe real calls.');

  const meta = await twilioApi(`Recordings/${b.recordingSid}.json`);
  if (meta.status !== 'completed') throw new HttpError(409, 'The recording is still being processed.');
  const maxMin = Math.min(60, Math.max(1, Number(process.env.MAX_GRADE_MINUTES) || 20));
  if ((Number(meta.duration) || 0) > maxMin * 60) throw new HttpError(413, `Calls longer than ${maxMin} minutes are not graded.`);

  const media = await twilioApi(`Recordings/${b.recordingSid}.wav`, { raw: true });
  const wav = Buffer.from(await media.arrayBuffer());
  if (wav.length > MAX_BYTES) throw new HttpError(413, 'That recording is too large to grade.');
  if (wav.length < 2000) throw new HttpError(400, 'Audio too short');

  const repChannel = process.env.REP_CHANNEL === '1' ? 1 : 0; // flip if the first real test shows rep and prospect swapped
  const info = parseWav(wav);
  const dual = !info || info.ch >= 2;
  const definition = { locales: ['en-US'], ...(dual ? { channels: [0, 1] } : {}) };
  const fd = new FormData();
  fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'call.wav');
  fd.append('definition', JSON.stringify(definition));
  const azure = process.env.AZURE_SPEECH_BASE || `https://${encodeURIComponent(region)}.api.cognitive.microsoft.com`; // override is for tests only
  const r = await fetch(`${azure}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: fd,
  });
  if (!r.ok) {
    console.error('Azure STT error', r.status, (await r.text()).slice(0, 500));
    throw new HttpError(502, 'Transcription failed. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.');
  }
  const j = await r.json();
  const phrases = (j.phrases || []).map((p) => ({
    speaker: dual ? (Number(p.channel) === repChannel ? 1 : 2) : 1, // 1 = rep, 2 = prospect
    startMs: Number(p.offsetMilliseconds) || 0,
    endMs: (Number(p.offsetMilliseconds) || 0) + (Number(p.durationMilliseconds) || 0),
    text: String(p.text || '').trim(),
  })).filter((p) => p.text).sort((a, c) => a.startMs - c.startMs).slice(0, 400);

  const db = channelDb(wav, info, repChannel);
  send(res, 200, { phrases, volume: db ? { stepSec: 0.5, db } : null, durationSec: Number(meta.duration) || 0, dual });
});
