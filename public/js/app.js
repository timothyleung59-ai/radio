// public/js/app.js
import { restorePlayback } from './player.js';
import { initVisual, extractColors } from './visual.js';
import { updateLyrics } from './lyrics.js';
import { loadChatHistory } from './chat.js';

console.log('Claudio FM 加载中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 初始化视觉系统
initVisual();

// 恢复上次播放状态
restorePlayback();

// 监听歌曲变化，更新取色
window.addEventListener('songchange', (e) => {
  const song = e.detail;
  if (song.cover) extractColors(song.cover);
});

// 歌词同步更新
window.addEventListener('timeupdate', (e) => {
  updateLyrics(e.detail);
});

// 加载聊天历史
loadChatHistory();
