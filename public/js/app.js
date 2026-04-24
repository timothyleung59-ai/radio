// public/js/app.js
import { restorePlayback } from './player.js';

console.log('Claudio FM 加载中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 恢复上次播放状态
restorePlayback();
