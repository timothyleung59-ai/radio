// public/js/app.js
import { restorePlayback, getAudioElement } from './player.js';
import { initVisual, initAudioVisualizer, extractColors } from './visual.js';
import { updateLyrics } from './lyrics.js';
import { loadChatHistory } from './chat.js';
import { server } from './api.js';
import './panels.js';
import './voice.js';

console.log('Claudio FM 启动中...');

// 注册 Service Worker（PWA）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

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
      const song = window.player?.getCurrentSong?.();
      const text = song
        ? `现在为你播放的是${song.artist}的${song.name}，好好享受这首歌吧。`
        : '欢迎来到 Claudio FM，我是你的 AI DJ。点一首歌开始你的音乐之旅吧。';
      window.voice?.speak(text);
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
      const panel = document.getElementById('configPanel');
      panel.style.display = 'flex';
      try {
        const cfg = await server.get('/api/env-config');
        document.getElementById('cfgBaseUrl').value = cfg.ANTHROPIC_BASE_URL || '';
        document.getElementById('cfgApiKey').value = cfg.ANTHROPIC_API_KEY || '';
        document.getElementById('cfgNeteaseApi').value = cfg.NETEASE_API || '';
        document.getElementById('cfgNeteaseCookie').value = cfg.NETEASE_COOKIE || '';
      } catch { window.showToast('加载配置失败'); }
    }
  });
});

// 配置面板保存
document.getElementById('cfgSaveBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('cfgSaveBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    await server.put('/api/env-config', {
      ANTHROPIC_BASE_URL: document.getElementById('cfgBaseUrl').value.trim(),
      ANTHROPIC_API_KEY: document.getElementById('cfgApiKey').value.trim() || undefined,
      NETEASE_API: document.getElementById('cfgNeteaseApi').value.trim(),
      NETEASE_COOKIE: document.getElementById('cfgNeteaseCookie').value.trim() || undefined
    });
    window.showToast('配置已保存，重启服务后生效');
    document.getElementById('configPanel').style.display = 'none';
  } catch { window.showToast('保存失败'); }
  btn.disabled = false;
  btn.textContent = '保存并重启';
});

// 点击遮罩关闭配置面板
document.getElementById('configPanel')?.addEventListener('click', (e) => {
  if (e.target.id === 'configPanel') e.target.style.display = 'none';
});

// 初始化
async function init() {
  try {
    initVisual();
    initAudioVisualizer(getAudioElement());
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
