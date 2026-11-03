// Sample conversation used when no speech-to-text key (or no Twilio key) is set.
export const DEMO_CLIP = [
  [1, 'Hey, is this Dana? This is Alex, I\'m calling about the scheduling software your front desk is using.'],
  [2, 'Uh, yeah. Who is this again?'],
  [1, 'Alex from Brightline. I\'ll be quick, I noticed you still book jobs by phone and I help shops like yours cut that in half.'],
  [2, 'We\'re pretty happy with what we have. I\'m not really looking to switch.'],
  [1, 'Totally fair. Out of curiosity, how many calls a day go to voicemail?'],
  [2, 'Maybe ten? Fifteen on a bad day.'],
  [1, 'Those are ten jobs a day walking to someone else. Can I show you a ten minute demo Thursday?'],
  [2, 'Okay, fine. Thursday morning works.'],
];

/** Timed phrases for the sample call: speaker 1 is the rep, speaker 2 the prospect. */
export function demoPhrases() {
  let t = 0;
  return DEMO_CLIP.map(([speaker, text]) => {
    const dur = text.split(' ').length * 380;
    const p = { speaker, startMs: t, endMs: t + dur, text };
    t += dur + 400;
    return p;
  });
}
