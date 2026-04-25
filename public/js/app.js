// public/js/app.js
import { restorePlayback } from './player.js';
import { initVisual, extractColors } from './visual.js';
import { updateLyrics } from './lyrics.js';
import { loadChatHistory } from './chat.js';
import { server } from './api.js';
import './panels.js';

console.log('Claudio FM 启动中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 菜单按钮
const menuBtn = document.getElementById('menuBtn');
const topbarMenu = document.getElementById('topbarMenu');

menuBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  topbarMenu.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!topbarMenu?.contains(e.target)) topbarMenu?.classList.remove('show');
});

topbarMenu?.querySelectorAll('.topbar-menu-item').forEach(btn => {
  btn.addEventListener('click', async () => {
    topbarMenu.classList.remove('show');
    const action = btn.dataset.action;

    if (action === 'voice') {
      document.getElementById('voiceOverlay').style.display = 'flex';
      window.dispatchEvent(new Event('voiceStart'));
    }

    if (action === 'daily') {
      try {
        const playlist = await server.get('/api/scheduler/daily-playlist');
        if (playlist?.songs?.length) {
          window.player?.setQueue(playlist.songs, 0);
          window.player?.playSong(playlist.songs[0]);
          window.showToast(`今日推荐：${playlist.songs.length} 首歌`);
        } else {
          window.showToast('今日推荐歌单尚未生成');
        }
      } catch { window.showToast('获取今日推荐失败'); }
    }

    if (action === 'mood') {
      try {
        const mood = await server.get('/api/scheduler/mood');
        if (mood?.mood) {
          window.showToast(`电台情绪：${mood.mood} — ${mood.message || ''}`);
        } else {
          window.showToast('情绪尚未检测，等待整点刷新');
        }
      } catch { window.showToast('获取情绪失败'); }
    }

    if (action === 'config') {
      window.showToast('配置面板开发中');
    }
  });
});

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
