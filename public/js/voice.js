// public/js/voice.js — 火山 TTS（首选）→ Web Speech（回退）
// 串词时不弹窗、不显示文字，只在专辑封面位置绘制波形

const synth = window.speechSynthesis;
let isSpeaking = false;
let waveAnimId = null;
let currentAudio = null;
let analyser = null;
let audioCtx = null;
let freqData = null;

const waveCanvas = document.getElementById('coverWaveCanvas');
const waveCtx = waveCanvas?.getContext('2d');
const coverFront = document.querySelector('.cover-front');

function resizeCanvas() {
  if (!waveCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = waveCanvas.getBoundingClientRect();
  waveCanvas.width = rect.width * dpr;
  waveCanvas.height = rect.height * dpr;
  waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 圆形脉动波形（嵌在封面位置）
function drawCoverWave() {
  if (!waveCtx || !waveCanvas) return;
  const w = waveCanvas.width / (window.devicePixelRatio || 1);
  const h = waveCanvas.height / (window.devicePixelRatio || 1);
  waveCtx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const baseR = Math.min(w, h) * 0.28;
  const t = Date.now() * 0.001;

  // 取真实音频频谱（如果可用）
  let levels = null;
  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData);
    levels = freqData;
  }

  // 多层环：每层取频谱不同段
  const rings = 3;
  for (let r = 0; r < rings; r++) {
    const segments = 64;
    waveCtx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const freqIdx = Math.floor((i / segments) * 30 + r * 8);
      const sample = levels ? levels[freqIdx] / 255 : 0;
      const noise = Math.sin(angle * 4 + t * (1.5 + r * 0.5)) * 0.5 + 0.5;
      const energy = isSpeaking ? Math.max(sample, noise * 0.4) : noise * 0.3;
      const radius = baseR + energy * 60 + r * 14;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    }
    const alpha = isSpeaking ? (0.55 - r * 0.16) : 0.15;
    waveCtx.strokeStyle = r === 0
      ? `rgba(236, 65, 65, ${alpha})`
      : `rgba(236, 65, 65, ${alpha * 0.7})`;
    waveCtx.lineWidth = 2 - r * 0.4;
    waveCtx.stroke();
  }

  // 中心圆点
  waveCtx.beginPath();
  const pulse = isSpeaking ? 8 + Math.random() * 6 : 6;
  waveCtx.arc(cx, cy, pulse, 0, Math.PI * 2);
  waveCtx.fillStyle = `rgba(236, 65, 65, ${isSpeaking ? 0.85 : 0.4})`;
  waveCtx.fill();

  waveAnimId = requestAnimationFrame(drawCoverWave);
}

// 每次 TTS 播放都重建 source → gain → analyser → destination 链路
// （createMediaElementSource 一个 Audio 元素只能创一次，所以每次新 Audio 都要新链路）
const TTS_GAIN = 1.8; // 客户端额外增益；叠加服务端 VOLC_VOLUME 后约 3-3.6 倍
let currentChain = null;

function setupAudioAnalyser(audioEl) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // iOS/Safari 等场景：用户首次交互前 ctx 是 suspended，强制 resume
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    // 上一条 TTS 的链路如果还在，先断开
    if (currentChain) {
      try {
        currentChain.source.disconnect();
        currentChain.gain.disconnect();
        currentChain.analyser.disconnect();
      } catch {}
    }

    const source = audioCtx.createMediaElementSource(audioEl);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = TTS_GAIN;
    const newAnalyser = audioCtx.createAnalyser();
    newAnalyser.fftSize = 128;

    source.connect(gainNode);
    gainNode.connect(newAnalyser);
    newAnalyser.connect(audioCtx.destination);

    analyser = newAnalyser;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    currentChain = { source, gain: gainNode, analyser: newAnalyser };
  } catch (e) {
    console.warn('音频链路初始化失败:', e);
  }
}

function startSpeaking() {
  isSpeaking = true;
  resizeCanvas();
  coverFront?.classList.add('speaking');
  if (!waveAnimId) drawCoverWave();
  window.dispatchEvent(new CustomEvent('voiceStart'));
}

function endSpeaking() {
  isSpeaking = false;
  coverFront?.classList.remove('speaking');
  window.dispatchEvent(new CustomEvent('voiceEnd'));
  // 留一会儿淡出动画再停
  setTimeout(() => {
    if (!isSpeaking && waveAnimId) {
      cancelAnimationFrame(waveAnimId);
      waveAnimId = null;
    }
  }, 800);
}

// ===== Web Speech 回退 =====
function fallbackWebSpeech(text) {
  if (!synth) {
    endSpeaking();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.onend = () => endSpeaking();
  utterance.onerror = () => endSpeaking();
  synth.speak(utterance);
}

// ===== 主入口 =====
async function speak(text) {
  if (!text || isSpeaking) return;
  startSpeaking();
  console.info('[voice] speak() 启动，text 长度', text.length);

  let res;
  try {
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text })
    });
  } catch (e) {
    console.warn('[voice] /api/tts 网络异常 → 回退浏览器语音:', e);
    fallbackWebSpeech(text);
    return;
  }

  if (res.status === 503) {
    console.warn('[voice] /api/tts 返回 503（火山未配置）→ 回退浏览器语音');
    fallbackWebSpeech(text);
    return;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[voice] /api/tts 返回 ${res.status} → 回退浏览器语音。body:`, body.slice(0, 200));
    fallbackWebSpeech(text);
    return;
  }

  const ctype = res.headers.get('content-type') || '';
  console.info('[voice] /api/tts 200，content-type =', ctype, '尝试火山 TTS 播放');

  const blob = await res.blob();
  if (blob.size < 200) {
    console.warn('[voice] TTS 返回 blob 太小（', blob.size, 'B），可能是错误响应 → 回退浏览器语音');
    fallbackWebSpeech(text);
    return;
  }
  const url = URL.createObjectURL(blob);
  currentAudio = new Audio(url);
  // 不再连 Web Audio 链路（GainNode 会让 audioCtx 处于 suspended 时静音）
  // 直接用 HTML5 Audio 播放，音量靠服务端的 VOLC_VOLUME=2.0 + 默认 1.0
  currentAudio.volume = 1.0;

  currentAudio.onended = () => {
    URL.revokeObjectURL(url);
    currentAudio = null;
    endSpeaking();
  };
  currentAudio.onerror = (e) => {
    console.warn('[voice] currentAudio onerror:', e);
    URL.revokeObjectURL(url);
    currentAudio = null;
    endSpeaking();
  };

  try {
    await currentAudio.play();
    console.info('[voice] 火山 TTS 已开始播放（', blob.size, 'B mp3）');
  } catch (e) {
    // 自动播放策略阻塞 — 不回退 Web Speech（同样会被阻），直接结束
    console.warn('[voice] play() 被阻塞（多半是浏览器 autoplay policy）:', e);
    URL.revokeObjectURL(url);
    currentAudio = null;
    endSpeaking();
    window.showToast?.('TTS 被浏览器拦截，请先点一下页面再试');
  }
}

function stop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (synth) synth.cancel();
  endSpeaking();
}

// 直接播放预合成好的音频 Blob URL（由 radio.js 预取串词时调用）
async function speakUrl(url) {
  if (!url || isSpeaking) return;
  startSpeaking();
  try {
    currentAudio = new Audio(url);
    currentAudio.volume = 1.0;
    currentAudio.onended = () => {
      try { URL.revokeObjectURL(url); } catch {}
      currentAudio = null;
      endSpeaking();
    };
    currentAudio.onerror = (e) => {
      try { URL.revokeObjectURL(url); } catch {}
      currentAudio = null;
      console.warn('[voice] 预加载 TTS 播放出错:', e);
      endSpeaking();
    };
    await currentAudio.play();
    console.info('[voice] 预加载 TTS 已开始播放');
  } catch (e) {
    try { URL.revokeObjectURL(url); } catch {}
    console.warn('[voice] 预加载 TTS play() 被阻塞:', e);
    endSpeaking();
  }
}

window.voice = { speak, speakUrl, stop, isSpeaking: () => isSpeaking };

// 让旧的全屏 overlay 永远不出现
const overlay = document.getElementById('voiceOverlay');
if (overlay) overlay.style.display = 'none';

window.addEventListener('resize', resizeCanvas);
