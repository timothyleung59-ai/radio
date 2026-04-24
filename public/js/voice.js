// public/js/voice.js
const synth = window.speechSynthesis;
let isSpeaking = false;
let waveAnimId = null;

const overlay = document.getElementById('voiceOverlay');
const waveCanvas = document.getElementById('voiceWaveCanvas');
const voiceText = document.getElementById('voiceText');
const voiceClose = document.getElementById('voiceClose');

const waveCtx = waveCanvas?.getContext('2d');

function drawVoiceWave() {
  if (!waveCtx) return;
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);

  const bars = 40;
  const barW = w / bars - 2;
  for (let i = 0; i < bars; i++) {
    const barH = isSpeaking
      ? 10 + Math.random() * (h - 20)
      : 4 + Math.sin(i * 0.3 + Date.now() * 0.003) * 4;
    const x = i * (barW + 2);
    waveCtx.fillStyle = isSpeaking
      ? `rgba(74, 108, 247, ${0.5 + Math.random() * 0.5})`
      : 'rgba(74, 108, 247, 0.3)';
    waveCtx.fillRect(x, (h - barH) / 2, barW, barH);
  }
  waveAnimId = requestAnimationFrame(drawVoiceWave);
}

function speak(text) {
  if (!synth || isSpeaking) return;
  isSpeaking = true;

  // 显示沉浸模式
  overlay.style.display = 'flex';
  voiceText.textContent = text;
  drawVoiceWave();

  // 降低背景音乐
  window.dispatchEvent(new CustomEvent('voiceStart'));

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onend = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
    setTimeout(() => {
      overlay.style.display = 'none';
      if (waveAnimId) cancelAnimationFrame(waveAnimId);
    }, 1000);
  };

  utterance.onerror = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
    overlay.style.display = 'none';
  };

  synth.speak(utterance);
}

function stop() {
  if (synth) synth.cancel();
  isSpeaking = false;
  window.dispatchEvent(new CustomEvent('voiceEnd'));
  overlay.style.display = 'none';
}

voiceClose?.addEventListener('click', stop);

window.voice = { speak, stop, isSpeaking: () => isSpeaking };
