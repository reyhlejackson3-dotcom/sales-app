// Gives one browser a short-lived Twilio token so it can place calls. Without Twilio keys it answers { demo: true } and the app simulates calls.
import { handle, readJson, send } from './_lib.js';
import { twilioLive, requireAccess, accessToken, cleanIdentity } from './_twilio.js';

export default handle(async (req, res) => {
  if (!twilioLive()) return send(res, 200, { demo: true });
  requireAccess(req);
  const b = await readJson(req);
  const identity = cleanIdentity(b.identity);
  send(res, 200, { token: accessToken(identity, 3600), identity, ttl: 3600 });
});
