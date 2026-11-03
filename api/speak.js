import { handle, readJson, send, HttpError, str } from './_lib.js';

export default handle(async (req, res) => {
  const b = await readJson(req, 10_000);
  const text = str(b.text, 400).trim();
  if (!text) throw new HttpError(400, 'No text');
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return send(res, 200, { demo: true });

  const mode = ['easy', 'medium', 'hard', 'extreme'].includes(b.mode) ? b.mode : 'medium';
  const voice = process.env[`ELEVENLABS_VOICE_${mode.toUpperCase()}`] || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }),
  });
  if (!r.ok) {
    console.error('ElevenLabs error', r.status, (await r.text()).slice(0, 300));
    // Let the browser fall back to its built-in voice instead of breaking the call.
    return send(res, 200, { demo: true, error: 'voice_unavailable' });
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(Buffer.from(await r.arrayBuffer()));
});
