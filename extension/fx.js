// Keyvane background: a slow drifting starfield with depth, drawn behind the popup.
export function startFx(canvas) {
  const g = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 1, H = 1, raf = 0;
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, p: Math.random() * Math.PI * 2 }));
  function fit() {
    const R = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    canvas.width = Math.round(W * R); canvas.height = Math.round(H * R);
    g.setTransform(R, 0, 0, R, 0, 0);
  }
  fit();
  addEventListener('resize', fit);
  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      const y = ((s.y + t * 0.006 * s.z) % 1) * H, x = s.x * W + Math.sin(t * 0.2 + s.p) * 6 * s.z;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.6 + s.z) + s.p));
      const r = 0.5 + s.z * 1.1;
      g.globalAlpha = (0.15 + 0.6 * s.z) * tw;
      g.fillStyle = s.z > 0.75 ? '#a5f3fc' : s.z > 0.5 ? '#c4b5fd' : '#e2e8f0';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } });
  raf = requestAnimationFrame(frame);
}
