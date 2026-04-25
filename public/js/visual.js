// public/js/visual.js
const $ = id => document.getElementById(id);

// ========== 主题切换 ==========
export function initTheme() {
  const toggle = $('themeToggle');
  const html = document.documentElement;

  // 从偏好加载
  fetch('/api/preferences').then(r => r.json()).then(prefs => {
    if (prefs.theme) html.dataset.theme = prefs.theme;
    updateThemeIcon();
  });

  toggle.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    html.dataset.theme = next;
    updateThemeIcon();
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next })
    });
  });

  function updateThemeIcon() {
    const isDark = html.dataset.theme === 'dark';
    toggle.innerHTML = isDark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>';
  }
}

// ========== 动态取色 ==========
export function extractColors(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // 简易取色：采样像素并聚类
      const pixels = [];
      for (let i = 0; i < data.length; i += 16) { // 每4个像素采样一次
        pixels.push([data[i], data[i+1], data[i+2]]);
      }

      // 简单 k-means (k=3)
      const colors = simpleKMeans(pixels, 3);
      const [primary, secondary, accent] = colors.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);

      document.documentElement.style.setProperty('--color-primary', primary);
      document.documentElement.style.setProperty('--color-secondary', secondary);
      document.documentElement.style.setProperty('--color-accent', accent);

      // 右光球用主色的互补色
      document.documentElement.style.setProperty('--blob-secondary', complementaryColor(primary));

      resolve({ primary, secondary, accent });
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function simpleKMeans(pixels, k) {
  // 随机初始化
  let centroids = [];
  for (let i = 0; i < k; i++) {
    centroids.push([...pixels[Math.floor(Math.random() * pixels.length)]]);
  }

  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array.from({length: k}, () => []);
    for (const p of pixels) {
      let minDist = Infinity, minIdx = 0;
      for (let i = 0; i < k; i++) {
        const d = (p[0]-centroids[i][0])**2 + (p[1]-centroids[i][1])**2 + (p[2]-centroids[i][2])**2;
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      clusters[minIdx].push(p);
    }
    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      centroids[i] = [
        Math.round(clusters[i].reduce((s,p) => s+p[0], 0) / clusters[i].length),
        Math.round(clusters[i].reduce((s,p) => s+p[1], 0) / clusters[i].length),
        Math.round(clusters[i].reduce((s,p) => s+p[2], 0) / clusters[i].length)
      ];
    }
  }

  // 按饱和度排序（饱和度高的放前面）
  centroids.sort((a, b) => {
    const satA = Math.max(a[0],a[1],a[2]) - Math.min(a[0],a[1],a[2]);
    const satB = Math.max(b[0],b[1],b[2]) - Math.min(b[0],b[1],b[2]);
    return satB - satA;
  });

  return centroids;
}

// 互补色：rgb字符串 → 旋转色相180°
function complementaryColor(rgbStr) {
  const m = rgbStr.match(/(\d+)/g);
  if (!m) return rgbStr;
  let [r, g, b] = m.map(Number);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return rgbStr; // 灰色无互补
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  h = (h + 0.5) % 1; // 旋转180°
  const s2 = Math.min(s, 0.7); // 降饱和，防刺眼
  const l2 = Math.min(l + 0.08, 0.6); // 稍提亮
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q2 = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p2 = 2 * l2 - q2;
  const rr = Math.round(hue2rgb(p2, q2, h + 1/3) * 255);
  const gg = Math.round(hue2rgb(p2, q2, h) * 255);
  const bb = Math.round(hue2rgb(p2, q2, h - 1/3) * 255);
  return `rgb(${rr},${gg},${bb})`;
}

// ========== 封面翻转 ==========
export function initCoverFlip() {
  const container = $('coverContainer');
  const flipper = $('coverFlipper');
  let flipped = false;

  container.addEventListener('click', () => {
    flipped = !flipped;
    flipper.classList.toggle('flipped', flipped);
    container.classList.toggle('flipped', flipped);
  });
}

// ========== Web Audio 音频可视化（光球律动） ==========
export function initAudioVisualizer(audioElement) {
  const blobs = [
    document.querySelector('.fluid-blob.primary'),
    document.querySelector('.fluid-blob.secondary')
  ];
  const glow = $('coverGlow');

  // ---- 频谱 canvas ----
  const specCanvas = document.createElement('canvas');
  specCanvas.className = 'spectrum-canvas';
  specCanvas.style.cssText = 'position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:440px;max-width:100%;height:80px;z-index:1;pointer-events:none;';
  document.body.appendChild(specCanvas);
  const specCtx = specCanvas.getContext('2d');
  const BAR_COUNT = 64;
  let specBars = new Float32Array(BAR_COUNT); // 平滑后的频谱高度

  function resizeSpec() {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.min(window.innerWidth, 440);
    specCanvas.width = cw * dpr;
    specCanvas.height = 80 * dpr;
    specCtx.scale(dpr, dpr);
  }
  resizeSpec();
  window.addEventListener('resize', resizeSpec);

  let audioCtx = null;
  let analyser = null;
  let source = null;
  let freqData = null;
  let isPlaying = false;

  let bass = 0, mid = 0;

  function setupAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source = audioCtx.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  function getBandAvg(start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += freqData[i];
    return sum / (end - start) / 255;
  }

  // 绘制频谱
  function drawSpectrum(t) {
    const w = Math.min(window.innerWidth, 440);
    const h = 80;
    specCtx.clearRect(0, 0, w, h);

    const barW = w / BAR_COUNT;
    const gap = 1.5;

    for (let i = 0; i < BAR_COUNT; i++) {
      const freqIdx = Math.floor(Math.pow(i / BAR_COUNT, 1.6) * (freqData ? freqData.length * 0.8 : 1));
      const raw = (isPlaying && freqData) ? freqData[freqIdx] / 255 : 0;

      const idle = isPlaying ? 0 : 0.06 + 0.04 * Math.sin(t * 0.002 + i * 0.3);

      const target = Math.max(raw, idle);
      specBars[i] += (target - specBars[i]) * (target > specBars[i] ? 0.35 : 0.12);

      const barH = specBars[i] * h * 0.9;
      if (barH < 1) continue;

      const x = i * barW + gap / 2;
      const bw = barW - gap;

      // 淡灰渐变：底部透明 → 顶部半透明白
      const grad = specCtx.createLinearGradient(0, h, 0, h - barH);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      grad.addColorStop(1, 'rgba(255,255,255,0.18)');

      specCtx.fillStyle = grad;
      specCtx.fillRect(x, h - barH, bw, barH);
    }
  }

  const ATTACK = 0.4;
  const RELEASE = 0.15;

  // 主循环 —— 永远不停，idle时也有呼吸漂动
  function tick() {
    const t = Date.now();

    // 采音频（仅播放时）
    if (isPlaying && analyser) {
      analyser.getByteFrequencyData(freqData);
      const rawBass = getBandAvg(1, 8);
      const rawMid = getBandAvg(8, 50);
      bass += (rawBass - bass) * (rawBass > bass ? ATTACK : RELEASE);
      mid += (rawMid - mid) * (rawMid > mid ? ATTACK : RELEASE);
    } else {
      // 播停了慢慢回落
      bass *= 0.96;
      mid *= 0.96;
    }

    // 基础呼吸漂动（永远存在）
    const idleDrift = 2;   // idle漂动幅度 vmin
    const beatDrift = 3;   // 音频加成幅度

    // 左小球 — 低频 + 呼吸
    if (blobs[0]) {
      const drift = idleDrift + bass * beatDrift;
      const bx = Math.sin(t * 0.0003) * drift;
      const by = Math.cos(t * 0.0004) * drift;
      const scale = 1 + 0.05 * Math.sin(t * 0.0008) + bass * 0.4;
      const op = 0.6 + 0.1 * Math.sin(t * 0.0006) + bass * 0.35;
      blobs[0].style.transform = `translate(${bx}vmin, ${by}vmin) scale(${scale})`;
      blobs[0].style.opacity = op;
    }

    // 右大球 — 中频+低频 + 呼吸
    if (blobs[1]) {
      const energy = bass * 0.4 + mid * 0.6;
      const drift = idleDrift + energy * beatDrift;
      const sx = Math.cos(t * 0.00025) * drift;
      const sy = Math.sin(t * 0.0003) * drift;
      const scale = 1 + 0.04 * Math.cos(t * 0.0007) + energy * 0.35;
      const op = 0.55 + 0.1 * Math.cos(t * 0.0005) + energy * 0.4;
      blobs[1].style.transform = `translate(${sx}vmin, ${sy}vmin) scale(${scale})`;
      blobs[1].style.opacity = op;
    }

    // 封面律动光效
    if (glow) {
      const energy = bass * 0.6 + mid * 0.4;
      const pulse = 0.3 + 0.05 * Math.sin(t * 0.001) + energy * 0.65;
      glow.style.opacity = pulse;
      if (isPlaying) {
        glow.style.boxShadow = `0 0 ${30 + bass * 40}px ${8 + bass * 12}px var(--color-primary)`;
      }
    }

    // 底部频谱
    drawSpectrum(t);

    requestAnimationFrame(tick);
  }

  // 立即启动，永远跑
  requestAnimationFrame(tick);

  window.addEventListener('songchange', () => {
    setupAudio();
    isPlaying = true;
    if (glow) glow.classList.add('active');
  });

  audioElement.addEventListener('play', () => {
    setupAudio();
    isPlaying = true;
  });

  audioElement.addEventListener('pause', () => { isPlaying = false; });
  audioElement.addEventListener('ended', () => { isPlaying = false; });
}

// ========== 粒子特效 ==========
let particleCanvas, particleCtx;
const particles = [];

export function initParticles() {
  particleCanvas = document.createElement('canvas');
  particleCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;';
  document.body.appendChild(particleCanvas);
  particleCtx = particleCanvas.getContext('2d');

  function resize() {
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function animate() {
    particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      particleCtx.globalAlpha = p.life;
      particleCtx.fillStyle = p.color;
      particleCtx.beginPath();
      particleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      particleCtx.fill();
    }
    particleCtx.globalAlpha = 1;
    requestAnimationFrame(animate);
  }
  animate();
}

export function burstParticles(x, y, color = '#4a6cf7') {
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 3,
      life: 1,
      color
    });
  }
}

// ========== 边缘海浪光效 ==========
function initBorderGlow() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function wave(seed, t, pos) {
    return Math.sin(pos * 0.008 + t * 0.4 + seed) * 0.35
         + Math.sin(pos * 0.015 - t * 0.25 + seed * 2.7) * 0.25
         + Math.sin(pos * 0.003 + t * 0.15 + seed * 0.5) * 0.4;
  }

  function draw() {
    const W = window.innerWidth, H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    const appEl = document.getElementById('app');
    if (!appEl) { requestAnimationFrame(draw); return; }
    const r = appEl.getBoundingClientRect();
    const R = 24; // border-radius
    const t = performance.now() * 0.001;
    const amp = 10; // 波浪幅度

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    // 沿圆角矩形路径走一圈，每条边加波浪偏移（法线方向）
    // 顶部边（从右到左）
    for (let x = r.right - R; x >= r.left + R; x -= 3) {
      const wv = wave(0, t, x) * amp;
      ctx.lineTo(x, r.top + wv);
    }

    // 左上角（圆弧）
    for (let a = Math.PI * 1.5; a >= Math.PI; a -= 0.06) {
      const cx = r.left + R, cy = r.top + R;
      const wv = wave(1, t, a * 100) * amp * 0.6;
      ctx.lineTo(cx + Math.cos(a) * (R + wv), cy + Math.sin(a) * (R + wv));
    }

    // 左边（从上到下）
    for (let y = r.top + R; y <= r.bottom - R; y += 3) {
      const wv = wave(2, t, y) * amp;
      ctx.lineTo(r.left + wv, y);
    }

    // 左下角
    for (let a = Math.PI; a >= Math.PI * 0.5; a -= 0.06) {
      const cx = r.left + R, cy = r.bottom - R;
      const wv = wave(3, t, a * 100) * amp * 0.6;
      ctx.lineTo(cx + Math.cos(a) * (R + wv), cy + Math.sin(a) * (R + wv));
    }

    // 底部（从左到右）
    for (let x = r.left + R; x <= r.right - R; x += 3) {
      const wv = wave(4, t, x) * amp;
      ctx.lineTo(x, r.bottom + wv);
    }

    // 右下角
    for (let a = Math.PI * 0.5; a >= 0; a -= 0.06) {
      const cx = r.right - R, cy = r.bottom - R;
      const wv = wave(5, t, a * 100) * amp * 0.6;
      ctx.lineTo(cx + Math.cos(a) * (R + wv), cy + Math.sin(a) * (R + wv));
    }

    // 右边（从下到上）
    for (let y = r.bottom - R; y >= r.top + R; y -= 3) {
      const wv = wave(6, t, y) * amp;
      ctx.lineTo(r.right + wv, y);
    }

    // 右上角
    for (let a = 0; a <= Math.PI * 0.5; a += 0.06) {
      const cx = r.right - R, cy = r.top + R;
      const wv = wave(7, t, a * 100) * amp * 0.6;
      ctx.lineTo(cx + Math.cos(a) * (R + wv), cy + Math.sin(a) * (R + wv));
    }

    ctx.closePath();

    // 多层叠加：宽线+高模糊 → 窄线+低模糊，营造柔和光晕
    const layers = [
      { w: 80, blur: 40, alpha: 0.08 },
      { w: 55, blur: 25, alpha: 0.15 },
      { w: 35, blur: 12, alpha: 0.25 },
      { w: 18, blur: 5,  alpha: 0.35 },
    ];
    for (const l of layers) {
      ctx.lineWidth = l.w;
      ctx.filter = `blur(${l.blur}px)`;
      ctx.strokeStyle = `rgba(170, 130, 255, ${l.alpha})`;
      ctx.stroke();
    }
    ctx.filter = 'none';
    ctx.restore();

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

// ========== 初始化 ==========
export function initVisual() {
  initTheme();
  initCoverFlip();
  initBorderGlow();
  initParticles();
}
