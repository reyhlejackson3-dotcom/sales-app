// Everything the browser phone needs from Twilio, in one function (Vercel's free plan allows 12 functions per project).
//   action: token       short-lived token so this browser can place calls
//   action: result      what happened on a call (ringing, connected, ended, answered, recording)
//   action: search      find numbers to buy in an area code
//   action: buy         buy a calling number for this user (about $1.15 a month)
//   action: release     give the user's number back
//   action: transcribe  turn a finished call recording into timed phrases, rep and prospect kept apart
// With accounts on (SUPABASE_*), the user comes from their login and limits are counted on the server.
// Without them, the old shared APP_ACCESS_CODE gate applies.
import { handle, readJson, send, HttpError } from './_lib.js';
import { demoPhrases } from './_demo.js';
import { twilioLive, requireAccess, accessToken, cleanIdentity, twilioApi, toE164, baseUrl, NUMBER_TAG, releaseNumber } from './_twilio.js';
import { requireAccount, updateAccount, planOf, PLANS, leftOf, useKeys } from './_auth.js';

const DONE = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
const CALL = /^CA[0-9a-f]{32}$/;
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


const paidCalling = (acc) => PLANS[planOf(acc)].dials > 0;
const needPaid = () => new HttpError(402, 'Calling is part of the paid plans. Pick a plan to get your number and start calling.');

/** Did this user place that call? (The browser leg is "client:<their id>"; the recording may sit on either leg.) */
async function ownsCall(callSid, identity) {
  const c = await twilioApi(`Calls/${callSid}.json`);
  if (c.from === `client:${identity}`) return c;
  if (c.parent_call_sid) { const p = await twilioApi(`Calls/${c.parent_call_sid}.json`); if (p.from === `client:${identity}`) return p; }
  throw new HttpError(404, 'Twilio could not find that item.');
}

export default handle(async (req, res) => {
  const b = await readJson(req);
  const action = String(b.action || '');

  if (!twilioLive()) return demo(action, b, res);

  const acc = await requireAccount(req); // null = accounts not switched on yet
  if (!acc) requireAccess(req);
  const identity = acc ? acc.id : cleanIdentity(b.identity);

  if (action === 'token') {
    if (acc) {
      if (!paidCalling(acc)) throw needPaid();
      if (!acc.number) throw new HttpError(409, 'Get your calling number first.');
      if ((await leftOf(acc, 'dials')) < 1) throw new HttpError(402, 'You have used all your answered calls this month. Upgrade your plan for more.');
    }
    return send(res, 200, { token: accessToken(identity, 3600), identity, ttl: 3600 });
  }

  if (action === 'result') {
    if (!CALL.test(String(b.callSid || ''))) throw new HttpError(400, 'Bad call id.');
    const parent = await twilioApi(`Calls/${b.callSid}.json`);
    if (parent.from !== `client:${identity}`) throw new HttpError(404, 'Twilio could not find that item.');
    const kids = await twilioApi('Calls.json', { query: { ParentCallSid: b.callSid, PageSize: 5 } });
    const child = (kids.calls || [])[0] || null;
    const childDone = child ? DONE.includes(child.status) : false;
    const answered = child ? (child.status === 'in-progress' || (child.status === 'completed' && Number(child.duration) > 0)) : false;
    const ended = DONE.includes(parent.status) && (!child || childDone);
    const state = ended ? 'ended' : answered ? 'connected' : child ? 'ringing' : 'starting';
    const durationSec = child && child.duration != null ? Number(child.duration) || 0 : 0;
    let recording = null;
    if (ended && answered) {
      if (acc) await useKeys(acc, 'dials', [b.callSid]); // counted once per call, on the server
      for (const sid of [b.callSid, child?.sid].filter(Boolean)) {
        const r = await twilioApi('Recordings.json', { query: { CallSid: sid, PageSize: 3 } });
        const rec = (r.recordings || [])[0];
        if (rec) { recording = { sid: rec.sid, status: rec.status, durationSec: Number(rec.duration) || 0 }; break; }
      }
    }
    return send(res, 200, { state, answered, durationSec, childStatus: child?.status || null, recording });
  }

  if (action === 'search') {
    if (acc && !paidCalling(acc)) throw needPaid();
    const area = String(b.areaCode || '');
    if (!/^[2-9]\d{2}$/.test(area)) throw new HttpError(400, 'Enter a 3-digit US area code, like 303.');
    toE164(`${area}2220000`); // reuses the blocked-area-code check
    const r = await twilioApi('AvailablePhoneNumbers/US/Local.json', { query: { AreaCode: area, VoiceEnabled: 'true', PageSize: 5 } });
    const numbers = (r.available_phone_numbers || []).map((n) => ({ number: n.phone_number, label: n.friendly_name, locality: n.locality || '', region: n.region || '' }));
    return send(res, 200, { numbers });
  }

  if (action === 'buy') {
    if (acc && !paidCalling(acc)) throw needPaid();
    if (acc?.number) throw new HttpError(409, 'You already have a calling number. Give it up in Settings to pick a new one.');
    const number = toE164(b.number);
    const max = Math.max(1, Number(process.env.MAX_NUMBERS) || 25);
    const owned = await twilioApi('IncomingPhoneNumbers.json', { query: { PageSize: 1000 } });
    if ((owned.incoming_phone_numbers || []).length >= max) throw new HttpError(409, 'The number limit has been reached. Ask the app owner to raise MAX_NUMBERS.');
    const made = await twilioApi('IncomingPhoneNumbers.json', {
      method: 'POST',
      form: { PhoneNumber: number, FriendlyName: `${NUMBER_TAG}${identity}`, VoiceUrl: `${baseUrl(req)}/api/twilio-voice?mode=inbound`, VoiceMethod: 'POST' },
    });
    if (acc) await updateAccount(acc.id, { number: made.phone_number, number_sid: made.sid });
    return send(res, 200, { sid: made.sid, number: made.phone_number });
  }

  if (action === 'release') {
    const sid = acc ? acc.number_sid : String(b.sid || '');
    if (acc && !acc.number) return send(res, 200, { released: true });
    if (sid) {
      if (!/^PN[0-9a-f]{32}$/.test(sid)) throw new HttpError(400, 'Bad number id.');
      await releaseNumber(sid);
    }
    if (acc) await updateAccount(acc.id, { number: null, number_sid: null });
    return send(res, 200, { released: true });
  }

  if (action === 'transcribe') {
    const key = process.env.AZURE_SPEECH_KEY; const region = process.env.AZURE_SPEECH_REGION;
    if (!twilioLive() || String(b.recordingSid || '').startsWith('demo')) {
      const phrases = demoPhrases();
      return send(res, 200, { demo: true, phrases, volume: null, durationSec: Math.round(phrases.at(-1).endMs / 1000) });
    }
    if (!REC.test(String(b.recordingSid || ''))) throw new HttpError(400, 'Bad recording id.');
    if (!key || !region) throw new HttpError(503, 'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to transcribe real calls.');

    const meta = await twilioApi(`Recordings/${b.recordingSid}.json`);
    if (acc) await ownsCall(meta.call_sid, identity);
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
    return send(res, 200, { phrases, volume: db ? { stepSec: 0.5, db } : null, durationSec: Number(meta.duration) || 0, dual });
  }

  throw new HttpError(400, 'Unknown action.');
});

/** No Twilio keys: simulate everything so the app can be tried for free. */
function demo(action, b, res) {
  if (action === 'token') return send(res, 200, { demo: true });
  if (action === 'result') return send(res, 200, { demo: true });
  if (action === 'search') {
    const area = /^[2-9]\d{2}$/.test(String(b.areaCode)) ? String(b.areaCode) : '303';
    return send(res, 200, { demo: true, numbers: [11, 27, 42].map((n) => ({ number: `+1${area}55501${n}`, label: `(${area}) 555-01${n}`, locality: 'Sample', region: 'CO' })) });
  }
  if (action === 'buy') return send(res, 200, { demo: true, sid: 'PNdemo', number: String(b.number || '') });
  if (action === 'release') return send(res, 200, { demo: true, released: true });
  if (action === 'transcribe') { const phrases = demoPhrases(); return send(res, 200, { demo: true, phrases, volume: null, durationSec: Math.round(phrases.at(-1).endMs / 1000) }); }
  throw new HttpError(400, 'Unknown action.');
}
