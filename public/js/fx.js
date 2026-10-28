// Background starfield + the page transition: the old page falls apart into dots and tiny stars, then the new page forms from them.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = {
  mint: ['#9ff5cf', '#2fd3b2', '#f6f6fb'],
  purple: ['#8b6cff', '#b49bff', '#f6f6fb'],
  white: ['#f6f6fb', '#cfd2ea', '#9ff5cf'],
  mix: ['#9ff5cf', '#2fd3b2', '#8b6cff', '#b49bff', '#f6f6fb'],
};
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/* ---------- starfield ---------- */
export function initStars(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [], W = 0, H = 0, last = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(300, Math.round((W * H) / 6000));
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: Math.random() < 0.06 ? rand(2.2, 3.6) : rand(0.4, 1.2),
      a: rand(0.25, 0.9), sp: rand(0.4, 1.6), ph: Math.random() * 6.28,
    }));
  }
  function draw(t) {
    if (t - last > 33) {
      last = t;
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        const a = s.a * (0.65 + 0.35 * Math.sin(t / 1000 * s.sp + s.ph));
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
        if (s.r > 2) { ctx.strokeStyle = `rgba(190,200,255,${(a * 0.35).toFixed(3)})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 3, 0, 6.283); ctx.stroke(); }
      }
    }
    if (!REDUCED) requestAnimationFrame(draw);
  }
  resize(); addEventListener('resize', resize);
  requestAnimationFrame(draw);
  if (REDUCED) draw(0);
}

/* ---------- transition ---------- */
const fxCanvas = () => document.getElementById('fx');
const MAX = () => (innerWidth < 700 ? 900 : 2200);

/** Turn every visible .fx element into a cloud of target points. Containers contribute their outline, leaves their area. */
function collect(root) {
  const W = innerWidth, H = innerHeight, out = [];
  for (const el of root.querySelectorAll('.fx')) {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, W), y1 = Math.min(r.bottom, H);
    const w = x1 - x0, h = y1 - y0;
    if (w < 8 || h < 8) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const pal = COLORS[el.dataset.fx] || COLORS.mix;
    const container = !!el.querySelector('.fx');
    const n = container ? Math.round((w + h) * 2 / 34) : Math.min(240, Math.round((w * h) / 1300));
    for (let i = 0; i < n; i++) {
      let x, y;
      if (container) {
        const p = Math.random() * (w + h) * 2;
        if (p < w) { x = x0 + p; y = y0; } else if (p < w + h) { x = x1; y = y0 + (p - w); } else if (p < 2 * w + h) { x = x1 - (p - w - h); y = y1; } else { x = x0; y = y1 - (p - 2 * w - h); }
      } else { x = rand(x0, x1); y = rand(y0, y1); }
      out.push({ x, y, c: pick(pal) });
    }
  }
  const cap = MAX();
  if (out.length > cap) { for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; } out.length = cap; }
  return out;
}

function makeParticle(x, y, c) {
  const star = Math.random() < 0.45;
  return { x, y, c, star, s: star ? rand(1.1, 2.4) : rand(0.8, 2.1), ph: Math.random() * 6.28, vx: 0, vy: 0, delay: 0, ex: 0, ey: 0, sx: 0, sy: 0, tx: 0, ty: 0, swirl: 0, dur: 1, aDelay: 0 };
}

function drawParticle(ctx, p, alpha, t, starAmt) {
  if (alpha <= 0.01) return;
  const tw = 0.75 + 0.25 * Math.sin(t / 90 + p.ph);
  ctx.globalAlpha = Math.min(1, alpha * tw);
  ctx.fillStyle = p.c;
  if (p.star && starAmt > 0.15) {
    const r = p.s * 2.6 * (0.4 + 0.6 * starAmt), k = r * 0.26;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + k, p.y - k); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x + k, p.y + k);
    ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - k, p.y + k); ctx.lineTo(p.x - r, p.y); ctx.lineTo(p.x - k, p.y - k);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill();
  }
}

/**
 * Run the transition. `mountNext` renders the new page into `view` (it runs while the old page is crumbling).
 * intro=true skips the crumble and only assembles (used on first load).
 */
export async function transition(view, mountNext, { intro = false } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (REDUCED) {
    view.style.transition = 'opacity .15s'; view.style.opacity = '0';
    await wait(150); await mountNext();
    view.style.opacity = '1'; await wait(180); view.style.transition = '';
    return;
  }

  const canvas = fxCanvas();
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let ps = [];
  if (!intro) {
    ps = collect(view).map((q) => makeParticle(q.x, q.y, q.c));
    view.style.transition = 'opacity .2s ease'; view.style.opacity = '0';
  } else view.style.opacity = '0';

  // Crumble parameters: sweep left to right, then fall with a little spread.
  for (const p of ps) {
    p.delay = (p.x / W) * 260 + rand(0, 160);
    const a = rand(-2.6, -0.5) + (Math.random() < 0.5 ? 0 : 3.14);
    const sp = rand(30, 230);
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - rand(0, 60);
  }

  let mounted = false, failed = null;
  const mountP = Promise.resolve().then(mountNext).then(() => { mounted = true; }, (e) => { failed = e; mounted = true; });

  const EXPLODE = intro ? 0 : 820;
  let phase = intro ? 'drift' : 'explode';
  const t0 = performance.now();
  let tPhase = t0, last = t0, targets = null, revealed = false, assembleEnd = 0;

  await new Promise((resolve) => {
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      if (phase === 'explode' || phase === 'drift') {
        const since = t - tPhase;
        for (const p of ps) {
          const live = phase === 'drift' || since > p.delay;
          if (live) {
            const damp = Math.pow(phase === 'drift' ? 0.2 : 0.55, dt);
            p.vy += (phase === 'drift' ? 0 : 520) * dt;
            p.vx *= damp; p.vy *= damp;
            p.x += p.vx * dt; p.y += p.vy * dt;
            if (phase === 'drift') { p.x += Math.sin(t / 700 + p.ph) * 0.15; p.y += Math.cos(t / 800 + p.ph) * 0.15; }
          }
          drawParticle(ctx, p, 0.95, t, 1);
        }
        if (phase === 'explode' && since > EXPLODE) { phase = 'drift'; tPhase = t; }
        if (phase === 'drift' && mounted) {
          if (failed) { cleanup(); resolve(); return; }
          // Build targets from the freshly mounted (still invisible) page, then send every particle home.
          targets = collect(view);
          const total = Math.min(MAX(), Math.max(ps.length, targets.length, 260));
          while (ps.length < total) ps.push(makeParticle(rand(0, W), intro ? rand(-80, H) : rand(0, H), pick(COLORS.mix)));
          for (let i = targets.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [targets[i], targets[j]] = [targets[j], targets[i]]; }
          let maxEnd = 0;
          ps.forEach((p, i) => {
            const tg = targets.length ? targets[i % targets.length] : { x: rand(0, W), y: rand(0, H), c: p.c };
            p.sx = p.x; p.sy = p.y; p.tx = tg.x; p.ty = tg.y; p.c = Math.random() < 0.7 ? tg.c : p.c;
            p.delay = (tg.y / H) * 300 + rand(0, 140); p.dur = rand(650, 950); p.swirl = rand(-70, 70);
            maxEnd = Math.max(maxEnd, p.delay + p.dur);
          });
          assembleEnd = maxEnd + 220;
          phase = 'assemble'; tPhase = t;
        }
      } else if (phase === 'assemble') {
        const since = t - tPhase;
        if (!revealed && since > 460) { revealed = true; view.style.transition = 'opacity .6s ease'; view.style.opacity = '1'; }
        for (const p of ps) {
          const k = (since - p.delay) / p.dur;
          const e = ease(k);
          const dx = p.tx - p.sx, dy = p.ty - p.sy, len = Math.hypot(dx, dy) || 1;
          const bend = p.swirl * (1 - e) * Math.sin(Math.PI * Math.min(1, Math.max(0, k)));
          p.x = p.sx + dx * e + (-dy / len) * bend;
          p.y = p.sy + dy * e + (dx / len) * bend;
          const fade = k < 0.78 ? 1 : 1 - (k - 0.78) / 0.22;
          drawParticle(ctx, p, k < 0 ? 0.95 : fade, t, 1 - e);
          if (k < 0) drawParticle(ctx, p, 0, t, 1);
        }
        if (since > assembleEnd) { cleanup(); resolve(); return; }
      }
      ctx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(frame);
    }
    function cleanup() { ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    requestAnimationFrame(frame);
  });

  await mountP;
  view.style.opacity = '1';
  setTimeout(() => { view.style.transition = ''; }, 700);
  if (failed) throw failed;
}
