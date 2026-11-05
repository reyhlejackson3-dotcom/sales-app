// Twilio webhooks live in this ONE function (Vercel's free plan allows only 12 functions per project):
//   /api/twilio-voice                 browser starts a call: dial the prospect, record both sides on separate channels
//   /api/twilio-voice?mode=announce   runs on the prospect's side after they answer: plays the recording notice
//   /api/twilio-voice?mode=inbound    someone called one of our users' numbers back: polite "outgoing only" message
// Only requests signed by Twilio are accepted.
import { twilioLive, readForm, validTwilioSignature, toE164, sendXml, xml, baseUrl, disclosureText } from './_twilio.js';
import { authLive, accountById, planOf, PLANS, leftOf } from './_auth.js';

export default async function handler(req, res) {
  let mode = '';
  try {
    mode = new URL(req.url, 'http://x').searchParams.get('mode') || '';
    if (!twilioLive()) { res.status(503).send('Twilio is not configured'); return; }
    const p = await readForm(req);
    if (!validTwilioSignature(req, p)) { res.status(403).send('Bad signature'); return; }

    if (mode === 'announce') {
      const notice = disclosureText();
      sendXml(res, notice ? `<Say>${xml(notice)}</Say>` : '');
      return;
    }
    if (mode === 'inbound') {
      sendXml(res, '<Say>Thanks for calling back. This number is used for outgoing calls only. Please visit the company website to get in touch.</Say><Hangup/>');
      return;
    }

    if (!String(p.From || '').startsWith('client:')) { sendXml(res, '<Reject/>'); return; }
    let to; let callerId;
    try { to = toE164(p.To); } catch { sendXml(res, '<Say>That number cannot be dialed.</Say><Hangup/>'); return; }
    if (authLive()) {
      // With accounts on, the caller ID always comes from the user's own account, never from the browser.
      const acc = await accountById(String(p.From).slice('client:'.length));
      if (!acc || !PLANS[planOf(acc)].dials) { sendXml(res, '<Say>Calling is not part of your plan.</Say><Hangup/>'); return; }
      if ((await leftOf(acc, 'dials')) < 1) { sendXml(res, '<Say>You have used all your calls for this month.</Say><Hangup/>'); return; }
      try { callerId = toE164(acc.number); } catch { sendXml(res, '<Say>Your calling number is not set up yet.</Say><Hangup/>'); return; }
    } else {
      try { callerId = toE164(p.CallerId); } catch { sendXml(res, '<Say>Your calling number is not set up yet.</Say><Hangup/>'); return; }
    }

    const maxMin = Math.min(120, Math.max(1, Number(process.env.MAX_CALL_MINUTES) || 30));
    const notice = disclosureText();
    // answerOnBridge: the rep hears ringing until a person actually picks up. Dual-channel recording: rep and prospect on separate tracks.
    sendXml(res,
      `<Dial callerId="${xml(callerId)}" answerOnBridge="true" record="record-from-answer-dual" timeLimit="${maxMin * 60}">` +
      `<Number${notice ? ` url="${xml(baseUrl(req))}/api/twilio-voice?mode=announce"` : ''}>${xml(to)}</Number></Dial>`);
  } catch (e) {
    console.error('twilio-voice', e);
    sendXml(res, mode === 'announce' ? '' : mode === 'inbound' ? '<Hangup/>' : '<Say>Something went wrong.</Say><Hangup/>');
  }
}
