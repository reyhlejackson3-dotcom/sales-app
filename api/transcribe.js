import { handle, readRaw, send, HttpError } from './_lib.js';
import { demoPhrases } from './_demo.js';


export default handle(async (req, res) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const diarize = String(req.query?.diarize || '') === '1';

  if (!key || !region) {
    const phrases = demoPhrases();
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
