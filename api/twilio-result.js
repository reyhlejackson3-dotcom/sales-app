// What happened on a call? The browser asks while the call is live and again after it ends.
// Reads straight from Twilio, so the app needs no database for this.
// Counts as "answered" when the prospect's phone was picked up (a voicemail greeting counts, a ring-out does not).
import { handle, readJson, send, HttpError } from './_lib.js';
import { twilioLive, requireAccess, twilioApi, cleanIdentity } from './_twilio.js';

const DONE = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];
const SID = /^CA[0-9a-f]{32}$/;

export default handle(async (req, res) => {
  if (!twilioLive()) return send(res, 200, { demo: true });
  requireAccess(req);
  const b = await readJson(req);
  if (!SID.test(String(b.callSid || ''))) throw new HttpError(400, 'Bad call id.');
  const identity = cleanIdentity(b.identity);

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
    for (const sid of [b.callSid, child?.sid].filter(Boolean)) {
      const r = await twilioApi('Recordings.json', { query: { CallSid: sid, PageSize: 3 } });
      const rec = (r.recordings || [])[0];
      if (rec) { recording = { sid: rec.sid, status: rec.status, durationSec: Number(rec.duration) || 0 }; break; }
    }
  }
  send(res, 200, { state, answered, durationSec, childStatus: child?.status || null, recording });
});
