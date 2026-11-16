// Keyvane 3D padlock: a glowing particle model drawn on a 2D canvas.
// mountLock(canvas) -> { open(): Promise, shake(), destroy() }

const A = [139, 92, 246], B = [34, 211, 238], N = 24;
let sprites = null;
function makeSprites() {
  if (sprites) return sprites;
  sprites = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const col = [0, 1, 2].map(k => Math.round(A[k] + (B[k] - A[k]) * t)).join(',');
    const s = document.createElement('canvas');
    s.width = s.height = 32;
    const q = s.getContext('2d');
    const g = q.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, `rgba(${col},.95)`);
    g.addColorStop(0.48, `rgba(${col},.26)`);
    g.addColorStop(1, `rgba(${col},0)`);
    q.fillStyle = g;
    q.fillRect(0, 0, 32, 32);
    sprites.push(s);
  }
  return sprites;
}

function buildLock() {
  const body = [], shackle = [];
  const add = (arr, x, y, z, h) => arr.push([x, y, z, h]);
  // body: surface grid of a box, with a keyhole cut from the front face
  const w = 1.7, h = 1.3, d = 0.62, cy = -0.3, st = 0.1;
  const hole = (x, y) => Math.hypot(x, y + 0.22) < 0.17 || (Math.abs(x) < 0.065 && y < -0.22 && y > -0.62);
  const xs = Math.round(w / st), ys = Math.round(h / st), zs = Math.round(d / st);
  for (let i = 0; i <= xs; i++) for (let j = 0; j <= ys; j++) {
    const x = -w / 2 + w * i / xs, y = cy - h / 2 + h * j / ys, hu = (y - cy) / h + 0.5;
    if (!hole(x, y)) add(body, x, y, d / 2, hu);
    add(body, x, y, -d / 2, hu);
  }
  for (let i = 0; i <= xs; i++) for (let k = 1; k < zs; k++) {
    const x = -w / 2 + w * i / xs, z = -d / 2 + d * k / zs;
    add(body, x, cy + h / 2, z, 1); add(body, x, cy - h / 2, z, 0);
  }
  for (let j = 1; j < ys; j++) for (let k = 1; k < zs; k++) {
    const y = cy - h / 2 + h * j / ys, z = -d / 2 + d * k / zs, hu = (y - cy) / h + 0.5;
    add(body, w / 2, y, z, hu); add(body, -w / 2, y, z, hu);
  }
  // shackle: half torus plus two legs, built around the right leg as hinge
  const R = 0.5, r = 0.1;
  for (let i = 0; i <= 30; i++) {
    const a = Math.PI * i / 30;
    for (let j = 0; j < 9; j++) {
      const b = j / 9 * Math.PI * 2, rr = R + r * Math.cos(b);
      add(shackle, rr * Math.cos(a), 0.62 + rr * Math.sin(a), r * Math.sin(b), 1);
    }
  }
  for (const lx of [R, -R]) for (let i = 0; i <= 4; i++) for (let j = 0; j < 9; j++) {
    const b = j / 9 * Math.PI * 2;
    add(shackle, lx + r * Math.cos(b), 0.62 - 0.27 * i / 4, r * Math.sin(b), 1);
  }
  return { body, shackle };
}

export function mountLock(canvas) {
  const g = canvas.getContext('2d');
  const spr = makeSprites();
  const { body, shackle } = buildLock();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 1, H = 1, raf = 0, alive = true;
  let openT = -1, shakeT = -1, burst = 0;
  const t0 = performance.now();
  const ring = Array.from({ length: 110 }, (_, i) => i / 110);

  function fit() {
    const R = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth || 160; H = canvas.clientHeight || 160;
    canvas.width = Math.round(W * R); canvas.height = Math.round(H * R);
    g.setTransform(R, 0, 0, R, 0, 0);
  }
  fit();
  const ro = new ResizeObserver(fit); ro.observe(canvas);

  function frame(now) {
    if (!alive) return;
    const t = reduce ? 1.8 : (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    let yaw = 0.55 + Math.sin(t * 0.5) * 0.55, pit = 0.16 + Math.sin(t * 0.6) * 0.06;
    let shx = 0;
    if (shakeT >= 0) { const s = (now - shakeT) / 1000; if (s < 0.5) shx = Math.sin(s * 40) * 0.12 * (1 - s / 0.5); else shakeT = -1; }
    let lift = 0, swing = 0, fade = 1;
    if (openT >= 0) {
      const o = Math.min(1, (now - openT) / 650), e = 1 - Math.pow(1 - o, 3);
      lift = 0.32 * e; swing = -1.1 * Math.max(0, (o - 0.35) / 0.65); burst = e;
      fade = 1 - Math.max(0, (o - 0.75) / 0.25) * 0.35;
    }
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
    const f = Math.min(W, H) * 1.05, ox = W / 2, oy = H / 2 + 6;
    const dr = (x, y, z, h, b) => {
      x += shx;
      const X = x * cy + z * sy, Z = -x * sy + z * cy, Y2 = y * cp - Z * sp, Z2 = y * sp + Z * cp, d = Z2 + 4;
      const s = f / d, px = ox + X * s, py = oy - Y2 * s, dp = Math.max(0, Math.min(1, (2.2 - Z2) / 4.4));
      const sz = (1.4 + 2.2 * dp) * (s / (f / 4)) * (b || 1);
      g.globalAlpha = Math.min(1, (0.22 + 0.78 * dp) * (b || 1) * fade);
      g.drawImage(spr[Math.round(Math.max(0, Math.min(1, h)) * (N - 1))], px - sz, py - sz, sz * 2, sz * 2);
    };
    for (const p of body) dr(p[0], p[1], p[2], p[3]);
    // shackle hinges on its right leg (x = 0.5): lift, then swing open around the y axis
    const cs = Math.cos(swing), ss = Math.sin(swing);
    for (const p of shackle) {
      const lx = p[0] - 0.5, lz = p[2];
      dr(0.5 + lx * cs - lz * ss, p[1] + lift, lx * ss + lz * cs, p[3]);
    }
    // orbit ring, which flares outward as the lock opens
    const rr = 1.45 + burst * 0.5, tx = 1.15, ctx = Math.cos(tx), stx = Math.sin(tx);
    for (const u of ring) {
      const a = u * Math.PI * 2 + t * 0.4, x = rr * Math.cos(a), z = rr * Math.sin(a);
      dr(x, -z * stx, z * ctx, 0.2 + 0.8 * u, (0.55 + 0.45 * Math.sin(a * 3 + t)) * (1 + burst * 0.6));
    }
    if (!reduce || openT >= 0 || shakeT >= 0) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    open() {
      openT = performance.now();
      if (reduce) return Promise.resolve();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
      return new Promise(r => setTimeout(r, 700));
    },
    shake() { shakeT = performance.now(); if (reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } },
    destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); }
  };
}
