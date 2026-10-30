import { handle, readRaw, send, HttpError } from './_lib.js';

const DEMO_CLIP = [
  [1, 'Hey, is this Dana? This is Alex, I\'m calling about the scheduling software your front desk is using.'],
  [2, 'Uh, yeah. Who is this again?'],
  [1, 'Alex from Brightline. I\'ll be quick, I noticed you still book jobs by phone and I help shops like yours cut that in half.'],
  [2, 'We\'re pretty happy with what we have. I\'m not really looking to switch.'],
  [1, 'Totally fair. Out of curiosity, how many calls a day go to voicemail?'],
  [2, 'Maybe ten? Fifteen on a bad day.'],
  [1, 'Those are ten jobs a day walking to someone else. Can I show you a ten minute demo Thursday?'],
  [2, 'Okay, fine. Thursday morning works.'],
];

export default handle(async (req, res) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const diarize = String(req.query?.diarize || '') === '1';

  if (!key || !region) {
    let t = 0;
    const phrases = DEMO_CLIP.map(([s, text]) => {
      const dur = text.split(' ').length * 380;
      const p = { speaker: s, startMs: t, endMs: t + dur, text };
      t += dur + 400;
      return p;
    });
    return send(res, 200, { demo: true, text: phrases.map((p) => p.text).join(' '), phrases: diarize ? phrases : [] });
  }

  const wav = await readRaw(req, 4_400_000);
  if (wav.length < 2000) throw new HttpError(400, 'Audio too short');

  const definition = { locales: ['en-US'] };
  if (diarize && process.env.AZURE_DIARIZATION !== '0') definition.diarization = { enabled: true, maxSpeakers: 2 };
  const fd = new FormData();
  fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  fd.append('definition', JSON.stringify(definition));

  const r = await fetch(`https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key },
    body: fd,
  });
  if (!r.ok) {
    console.error('Azure STT error', r.status, (await r.text()).slice(0, 500));
    throw new HttpError(502, 'Transcription failed. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.');
  }
  const j = await r.json();
  const phrases = (j.phrases || []).map((p) => ({
    speaker: Number(p.speaker) || 1,
    startMs: Number(p.offsetMilliseconds) || 0,
    endMs: (Number(p.offsetMilliseconds) || 0) + (Number(p.durationMilliseconds) || 0),
    text: String(p.text || '').trim(),
  })).filter((p) => p.text);
  const text = (j.combinedPhrases || []).map((c) => c.text).join(' ').trim() || phrases.map((p) => p.text).join(' ');
  send(res, 200, { text, phrases: diarize ? phrases : [] });
});
