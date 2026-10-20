// Élő láng a képernyő alján: additív keverésű lángrészecskék + felszálló szikrák.
(() => {
  const canvas = document.getElementById("fire-canvas");
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ctx = canvas.getContext("2d");

  // Előre legyártott, életkor szerint színezett sprite-ok (sárga -> narancs -> vörös -> füst)
  const STAGES = 24;
  const SPRITE = 64;
  const sprites = [];
  for (let i = 0; i < STAGES; i++) {
    const t = i / (STAGES - 1);
    const r = Math.round(255);
    const g = Math.round(210 - 170 * t);
    const b = Math.round(70 - 70 * t);
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const sctx = c.getContext("2d");
    const grad = sctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.45)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, SPRITE, SPRITE);
    sprites.push(c);
  }

  let w = 0;
  let h = 0;
  const flames = [];
  const sparks = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  function spawnFlame() {
    // A közép felé sűrűbb a láng, a szélek felé ritkul
    const x = w * (0.5 + (Math.random() + Math.random() + Math.random() - 1.5) * 0.7);
    flames.push({
      x,
      y: h + 10,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(1.4 + Math.random() * 2.4),
      size: 70 + Math.random() * 90,
      life: 0,
      max: 55 + Math.random() * 45,
      wob: Math.random() * Math.PI * 2,
    });
  }

  function spawnSpark() {
    sparks.push({
      x: w * (0.15 + Math.random() * 0.7),
      y: h - Math.random() * h * 0.12,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -(0.8 + Math.random() * 2.2),
      size: 1 + Math.random() * 2,
      life: 0,
      max: 120 + Math.random() * 160,
      wob: Math.random() * Math.PI * 2,
    });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 16.667, 3); // 60 fps-hez normalizált lépés
    last = now;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    const flameRate = Math.min(w / 14, 70) * dt;
    for (let i = 0; i < flameRate; i++) if (flames.length < 420) spawnFlame();
    if (Math.random() < 0.55 * dt && sparks.length < 90) spawnSpark();

    for (let i = flames.length - 1; i >= 0; i--) {
      const p = flames[i];
      p.life += dt;
      if (p.life >= p.max) {
        flames.splice(i, 1);
        continue;
      }
      const t = p.life / p.max;
      p.wob += 0.08 * dt;
      p.x += (p.vx + Math.sin(p.wob) * 0.7) * dt;
      p.y += p.vy * dt;
      const size = p.size * (1 - t * 0.75);
      ctx.globalAlpha = Math.min(1, (1 - t) * 0.9) * 0.55;
      ctx.drawImage(sprites[Math.min(STAGES - 1, (t * STAGES) | 0)], p.x - size / 2, p.y - size / 2, size, size);
    }

    ctx.fillStyle = "#ffb347";
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life += dt;
      if (s.life >= s.max || s.y < -10) {
        sparks.splice(i, 1);
        continue;
      }
      const t = s.life / s.max;
      s.wob += 0.06 * dt;
      s.x += (s.vx + Math.sin(s.wob) * 0.9) * dt;
      s.y += s.vy * dt;
      ctx.globalAlpha = (1 - t) * (0.6 + 0.4 * Math.sin(s.life * 0.4));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
