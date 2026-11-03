// Gives each user their own calling number: search by area code, buy, release.
// Every number costs about $1.15 a month, so buying is capped (MAX_NUMBERS) and release only touches numbers this app bought.
import { handle, readJson, send, HttpError } from './_lib.js';
import { twilioLive, requireAccess, twilioApi, toE164, cleanIdentity, baseUrl } from './_twilio.js';

const TAG = 'convertd-';

export default handle(async (req, res) => {
  const b = await readJson(req);
  const action = String(b.action || '');

  if (!twilioLive()) { // demo: fake numbers in the reserved 555-01xx range
    if (action === 'search') {
      const area = /^[2-9]\d{2}$/.test(String(b.areaCode)) ? String(b.areaCode) : '303';
      return send(res, 200, { demo: true, numbers: [11, 27, 42].map((n) => ({ number: `+1${area}55501${n}`, label: `(${area}) 555-01${n}`, locality: 'Sample', region: 'CO' })) });
    }
    if (action === 'buy') return send(res, 200, { demo: true, sid: 'PNdemo', number: String(b.number || '') });
    if (action === 'release') return send(res, 200, { demo: true, released: true });
    throw new HttpError(400, 'Unknown action.');
  }
  requireAccess(req);

  if (action === 'search') {
    const area = String(b.areaCode || '');
    if (!/^[2-9]\d{2}$/.test(area)) throw new HttpError(400, 'Enter a 3-digit US area code, like 303.');
    toE164(`${area}2220000`); // reuses the blocked-area-code check
    const r = await twilioApi('AvailablePhoneNumbers/US/Local.json', { query: { AreaCode: area, VoiceEnabled: 'true', PageSize: 5 } });
    const numbers = (r.available_phone_numbers || []).map((n) => ({ number: n.phone_number, label: n.friendly_name, locality: n.locality || '', region: n.region || '' }));
    return send(res, 200, { numbers });
  }

  if (action === 'buy') {
    const number = toE164(b.number);
    const identity = cleanIdentity(b.identity);
    const max = Math.max(1, Number(process.env.MAX_NUMBERS) || 25);
    const owned = await twilioApi('IncomingPhoneNumbers.json', { query: { PageSize: 1000 } });
    if ((owned.incoming_phone_numbers || []).length >= max) throw new HttpError(409, 'The number limit has been reached. Ask the app owner to raise MAX_NUMBERS.');
    const made = await twilioApi('IncomingPhoneNumbers.json', {
      method: 'POST',
      form: { PhoneNumber: number, FriendlyName: `${TAG}${identity}`, VoiceUrl: `${baseUrl(req)}/api/twilio-voice?mode=inbound`, VoiceMethod: 'POST' },
    });
    return send(res, 200, { sid: made.sid, number: made.phone_number });
  }

  if (action === 'release') {
    const sid = String(b.sid || '');
    if (!/^PN[0-9a-f]{32}$/.test(sid)) throw new HttpError(400, 'Bad number id.');
    const n = await twilioApi(`IncomingPhoneNumbers/${sid}.json`);
    if (!String(n.friendly_name || '').startsWith(TAG)) throw new HttpError(403, 'That number was not bought by this app.');
    await twilioApi(`IncomingPhoneNumbers/${sid}.json`, { method: 'DELETE' });
    return send(res, 200, { released: true });
  }
  throw new HttpError(400, 'Unknown action.');
});
