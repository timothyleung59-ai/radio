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

// ========== 封面翻转 ==========
export function initCoverFlip() {
  const container = $('coverContainer');
  const flipper = $('coverFlipper');
  let flipped = false;

  container.addEventListener('click', () => {
    flipped = !flipped;
    flipper.classList.toggle('flipped', flipped);
  });
}

// ========== 律动光效（简化版，无 Web Audio 时用定时脉动） ==========
export function initBeatGlow() {
  const glow = $('coverGlow');
  let active = false;
  let interval = null;

  window.addEventListener('songchange', () => {
    active = true;
    glow.classList.add('active');
    // 简化：用定时器模拟脉动
    if (interval) clearInterval(interval);
    interval = setInterval(() => {
      glow.style.opacity = 0.3 + Math.random() * 0.7;
    }, 500);
  });
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

// ========== 初始化 ==========
export function initVisual() {
  initTheme();
  initCoverFlip();
  initBeatGlow();
  initParticles();
}
