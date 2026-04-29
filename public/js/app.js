// public/js/app.js — sidebar nav + now-playing as default
import { restorePlayback, getAudioElement } from './player.js';
import { initCoverFlip, initAudioVisualizer, initParticles } from './visual.js';
import { updateLyrics } from './lyrics.js';
import { loadChatHistory } from './chat.js';
import { server, netease } from './api.js';
import { loadFavorites, loadHistory, loadSearchResults } from './panels.js';
import './voice.js';
import './radio.js';

// 暴露 audio 给 radio.js 监听
window.__claudioAudio = getAudioElement();

console.log('Claudio FM 启动中...');

// PWA
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Toast
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// ========== 视图切换 ==========
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const historyStack = [];
let currentView = 'now-playing';

function switchView(name) {
  if (currentView === name) return;
  historyStack.push(currentView);
  currentView = name;
  views.forEach(v => v.classList.toggle('active', v.dataset.view === name));
  navItems.forEach(b => b.classList.toggle('active', b.dataset.view === name));

  if (name === 'favorites') loadFavorites();
  if (name === 'history') loadHistory();
  if (name === 'queue') renderQueueInline();
  if (name === 'config') loadConfigForm();
}

navItems.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

document.getElementById('navBack')?.addEventListener('click', () => {
  if (!historyStack.length) return;
  const prev = historyStack.pop();
  currentView = '';
  switchView(prev);
  historyStack.pop();
});

// 全局搜索
document.getElementById('globalSearch')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (!q) return;
    document.getElementById('searchInput').value = q;
    switchView('search');
    loadSearchResults(q);
  }
});
document.getElementById('searchInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q) loadSearchResults(q);
  }
});

// ========== Now-Playing 页面按钮 ==========
document.getElementById('npLikeBtn')?.addEventListener('click', () => {
  document.getElementById('likeBtn')?.click();
});
document.getElementById('npDjVoiceBtn')?.addEventListener('click', () => {
  const song = window.player?.getCurrentSong?.();
  const text = song
    ? `这首是${song.artist}的《${song.name}》，希望你喜欢。`
    : '欢迎来到 Claudio FM，点开侧栏的电台模式开始你的音乐之旅。';
  window.voice?.speak(text);
});
document.getElementById('npLearnBtn')?.addEventListener('click', async () => {
  const mode = window.radio?.getMode?.() || 'default';
  window.showToast?.(`正在学习「${mode}」模式...`);
  try {
    const r = await server.post(`/api/radio/modes/${mode}/learn`, {});
    if (r.ok) window.showToast?.(`✓ 已基于 ${r.samples} 条数据更新偏好`, 3000);
    else window.showToast?.(`暂不更新：${r.error}`, 3000);
  } catch { window.showToast?.('学习失败'); }
});
document.getElementById('npEditModeBtn')?.addEventListener('click', () => {
  const mode = window.radio?.getMode?.() || 'default';
  window.radio?.openModeEditor?.(mode);
});

// 底部播放条 DJ 语音按钮
document.getElementById('djVoiceBtn')?.addEventListener('click', () => {
  document.getElementById('npDjVoiceBtn')?.click();
});

// 顶栏 DJ 头像
async function openDjPanel() {
  document.getElementById('djPanel').style.display = 'flex';
  try {
    const prefs = await server.get('/api/preferences');
    const profile = prefs.taste_profile ? JSON.parse(prefs.taste_profile) : null;
    document.getElementById('tasteProfile').innerHTML = profile
      ? `<p>${profile.description || '品味画像生成中...'}</p>`
      : '<p style="color:var(--text-muted)">品味画像将在每天早上 7 点自动生成</p>';
  } catch { document.getElementById('tasteProfile').textContent = '加载失败'; }
}
document.getElementById('djAvatar')?.addEventListener('click', openDjPanel);
document.getElementById('djAvatarChat')?.addEventListener('click', openDjPanel);
document.getElementById('userAvatar')?.addEventListener('click', () => switchView('favorites'));

// ========== 队列内联 ==========
function renderQueueInline() {
  const list = document.getElementById('queueListInline');
  const queue = window.player?.getQueue?.() || [];
  const idx = window.player?.getQueueIndex?.() ?? -1;
  document.getElementById('queueViewCount').textContent = queue.length ? `(${queue.length} 首)` : '';
  if (queue.length === 0) {
    list.innerHTML = '<p class="empty-tip">队列为空。打开电台模式或从聊天/收藏添加歌曲。</p>';
    return;
  }
  list.innerHTML = queue.map((s, i) => `
    <div class="panel-song ${i === idx ? 'playing' : ''}" data-i="${i}" style="${i === idx ? 'background:var(--accent-soft)' : ''}">
      ${s.cover ? `<img class="panel-song-cover" src="${s.cover}" alt="" onerror="this.removeAttribute('src')">` : '<div class="panel-song-cover"></div>'}
      <div class="panel-song-info">
        <div class="panel-song-name" style="${i === idx ? 'color:var(--accent-bright)' : ''}">${s.name || '未知'}</div>
        <div class="panel-song-artist">${s.artist || ''}</div>
      </div>
      <button class="panel-song-play" data-i="${i}" title="播放">▶</button>
      <button class="panel-song-del" data-i="${i}" title="移除">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.panel-song-play').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    window.player?.playAt?.(parseInt(b.dataset.i));
  }));
  list.querySelectorAll('.panel-song-del').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    window.player?.removeAt?.(parseInt(b.dataset.i));
    renderQueueInline();
  }));
}
window.renderQueueInline = renderQueueInline;

// ========== 设置 ==========
async function loadConfigForm() {
  try {
    const cfg = await server.get('/api/env-config');
    document.getElementById('cfgBaseUrl').value = cfg.ANTHROPIC_BASE_URL || '';
    document.getElementById('cfgApiKey').value = cfg.ANTHROPIC_API_KEY || '';
    document.getElementById('cfgNeteaseApi').value = cfg.NETEASE_API || '';
    document.getElementById('cfgNeteaseCookie').value = cfg.NETEASE_COOKIE || '';
  } catch { window.showToast('加载配置失败'); }
}
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
  } catch { window.showToast('保存失败'); }
  btn.disabled = false;
  btn.textContent = '保存配置';
});

// 弹窗遮罩关闭
document.querySelectorAll('.panel-overlay').forEach(panel => {
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.style.display = 'none';
  });
});

// ========== 队列 / 当前歌曲 同步到 Now-Playing UI ==========
function syncQueueBadges() {
  const queue = window.player?.getQueue?.() || [];
  const el = document.getElementById('navQueueCount');
  if (el) {
    el.textContent = queue.length;
    el.style.display = queue.length ? '' : 'none';
  }
}
window.addEventListener('queuechange', syncQueueBadges);

function syncNowPlaying(song) {
  if (!song) return;
  const name = document.getElementById('npSongName');
  const artist = document.getElementById('npSongArtist');
  if (name) name.textContent = song.name || '未在播放';
  if (artist) artist.textContent = song.artist || '—';
}
window.addEventListener('songchange', e => syncNowPlaying(e.detail));

// ========== 初始化 ==========
async function init() {
  try {
    initCoverFlip();
    initParticles();
    initAudioVisualizer(getAudioElement());
    await restorePlayback();
    await loadChatHistory();
    syncQueueBadges();
    const song = window.player?.getCurrentSong?.();
    if (song) syncNowPlaying(song);
    console.log('Claudio FM 初始化完成');
  } catch (err) {
    console.error('初始化失败:', err);
    window.showToast('初始化失败，请刷新重试');
  }
}

init();

window.addEventListener('timeupdate', (e) => updateLyrics(e.detail));
