// Audio utilities: decode an uploaded clip to 16 kHz mono WAV, measure loudness, and capture the microphone.

export function downsample(f32, inRate, outRate = 16000) {
  if (inRate === outRate) return f32;
  const ratio = inRate / outRate;
  const n = Math.floor(f32.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += f32[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

export function encodeWav(f32, rate = 16000) {
  const buf = new ArrayBuffer(44 + f32.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

export function concat(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Loudness curve in dBFS, one value per stepSec. */
export function volumeWindows(f32, rate, stepSec = 0.5) {
  const size = Math.max(1, Math.floor(rate * stepSec));
  const out = [];
  for (let i = 0; i < f32.length; i += size) {
    let s = 0; const end = Math.min(f32.length, i + size);
    for (let j = i; j < end; j++) s += f32[j] * f32[j];
    const rms = Math.sqrt(s / (end - i));
    out.push(rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -100);
  }
  return out;
}

/** Decode any audio/video file the browser understands into mono samples (trimmed to maxSec). */
export async function decodeFile(file, maxSec) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const data = await file.arrayBuffer();
    const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); p?.then?.(res, rej); });
    const rate = buf.sampleRate;
    const total = buf.length;
    const keep = Math.min(total, Math.floor(maxSec * rate));
    const mono = new Float32Array(keep);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < keep; i++) mono[i] += ch[i] / buf.numberOfChannels;
    }
    return { samples: mono, rate, duration: total / rate, trimmed: total > keep };
  } finally { ctx.close?.(); }
}

export class Mic {
  async start(onChunk) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'cap');
    this.node.port.onmessage = (e) => onChunk(e.data, this.ctx.sampleRate);
    const mute = this.ctx.createGain(); mute.gain.value = 0; // keeps the graph alive without playing the mic back
    src.connect(this.node); this.node.connect(mute); mute.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  stop() {
    try { this.node?.disconnect(); } catch { /* already gone */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
    this.stream = this.ctx = this.node = null;
  }
}
