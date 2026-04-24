// public/js/voice.js
const synth = window.speechSynthesis;
let isSpeaking = false;

function speak(text) {
  if (!synth || isSpeaking) return;
  isSpeaking = true;

  // 降低背景音乐音量
  window.dispatchEvent(new CustomEvent('voiceStart'));

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onend = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
  };

  utterance.onerror = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
  };

  synth.speak(utterance);
}

function stop() {
  if (synth) synth.cancel();
  isSpeaking = false;
  window.dispatchEvent(new CustomEvent('voiceEnd'));
}

window.voice = { speak, stop, isSpeaking: () => isSpeaking };
