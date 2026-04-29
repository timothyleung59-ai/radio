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

function setupAudioAnalyser(audioEl) {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    const source = audioCtx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  } catch (e) {
    console.warn('音频分析器初始化失败:', e);
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

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (res.status === 503) {
      fallbackWebSpeech(text);
      return;
    }
    if (!res.ok) {
      console.warn('TTS 服务错误，回退到浏览器语音');
      fallbackWebSpeech(text);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    setupAudioAnalyser(currentAudio);
    currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      endSpeaking();
    };
    currentAudio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      console.warn('TTS 音频播放失败，回退');
      fallbackWebSpeech(text);
    };
    await currentAudio.play();
  } catch (e) {
    console.warn('TTS 异常，回退:', e);
    fallbackWebSpeech(text);
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

window.voice = { speak, stop, isSpeaking: () => isSpeaking };

// 让旧的全屏 overlay 永远不出现
const overlay = document.getElementById('voiceOverlay');
if (overlay) overlay.style.display = 'none';

window.addEventListener('resize', resizeCanvas);
