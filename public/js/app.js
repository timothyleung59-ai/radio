// public/js/app.js
import { restorePlayback } from './player.js';
import { initVisual, extractColors } from './visual.js';
import { updateLyrics } from './lyrics.js';
import { loadChatHistory } from './chat.js';
import './panels.js';

console.log('Claudio FM 启动中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 初始化
async function init() {
  try {
    initVisual();
    await restorePlayback();
    await loadChatHistory();
    console.log('Claudio FM 初始化完成');
  } catch (err) {
    console.error('初始化失败:', err);
    window.showToast('初始化失败，请刷新重试');
  }
}

init();

// 歌词同步
window.addEventListener('timeupdate', (e) => {
  updateLyrics(e.detail);
});

// 歌曲变化时取色
window.addEventListener('songchange', (e) => {
  const song = e.detail;
  if (song.cover) extractColors(song.cover);
});
