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

console.log('Aidio FM 启动中...');

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
document.getElementById('npDjVoiceBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const song = window.player?.getCurrentSong?.();
  if (!song) {
    window.voice?.speak('欢迎来到 Aidio FM，点开侧栏的电台模式开始你的音乐之旅。');
    return;
  }
  // 防连点
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  const old = btn.textContent;
  btn.textContent = '🎙 AI 思考中...';
  try {
    const mode = window.radio?.getMode?.() || 'default';
    const r = await server.post('/api/dj/intro', { song, mode });
    const intro = r?.intro || `这首是${song.artist}的《${song.name}》，希望你喜欢。`;
    window.voice?.speak(intro);
  } catch {
    // 兜底走固定文案
    window.voice?.speak(`这首是${song.artist}的《${song.name}》，希望你喜欢。`);
  } finally {
    btn.textContent = old;
    btn.dataset.busy = '';
  }
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

// 顶栏 DJ 头像 → AI 总控台
const SCHED_TASKS = [
  { key: 'tasteProfile',  task: 'taste-profile',  label: '🎨 品味画像生成',   desc: '每日 07:00 / 启动后补跑：用近30天播放+收藏+品味md+聊天 → AI 写品味画像' },
  { key: 'moodCheck',     task: 'mood',           label: '🎭 情绪检查',        desc: '每小时整点：按"用户输入>聊天>播放"链推断当前电台情绪' },
  { key: 'modeLearn',     task: 'mode-learn',     label: '🧠 模式偏好学习',    desc: '每日 03:00：用过去14天每个模式的播放数据 → AI 写到 modes/<key>.md 的 AUTO-LEARN 区块' },
  { key: 'dailyPlaylist', task: 'daily-playlist', label: '📻 每日歌单推荐',    desc: '每日 07:00：用品味+最近播放 → AI 推荐 10 首入"今日推荐"歌单' }
];

function fmtRelTime(iso) {
  if (!iso) return '<span style="color:var(--text-muted)">从未运行</span>';
  const d = new Date(iso);
  const ago = Date.now() - d.getTime();
  const min = Math.floor(ago / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  return `${days} 天前`;
}

async function renderSchedulerTasks() {
  const wrap = document.getElementById('schedulerTasksList');
  if (!wrap) return;
  let status = {};
  try { status = await server.get('/api/scheduler/status'); } catch {}
  wrap.innerHTML = SCHED_TASKS.map(t => {
    const s = status[t.key] || {};
    const statusBadge = s.status === 'running'
      ? '<span style="background:rgba(255,193,7,0.15);color:#ffd54f;padding:2px 8px;border-radius:10px;font-size:11px">运行中</span>'
      : s.status === 'error'
      ? `<span style="background:rgba(244,67,54,0.15);color:#ef9a9a;padding:2px 8px;border-radius:10px;font-size:11px" title="${(s.lastError||'').replace(/"/g,'&quot;')}">出错</span>`
      : '<span style="background:rgba(76,175,80,0.15);color:#a5d6a7;padding:2px 8px;border-radius:10px;font-size:11px">空闲</span>';
    const perMode = t.key === 'modeLearn' && s.perMode
      ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">各模式：${
          Object.entries(s.perMode).map(([k,v]) => `${k}:${v.ok?`✓${v.samples}`:'✗'}`).join(' · ')
        }</div>`
      : '';
    return `
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="font-weight:600;font-size:14px">${t.label}</div>
          ${statusBadge}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;line-height:1.5">${t.desc}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span style="font-size:11px;color:var(--text-muted)">上次：${fmtRelTime(s.lastRun)}</span>
          <button class="btn-ghost task-trigger-btn" data-task="${t.task}" data-key="${t.key}" style="height:26px;padding:0 12px;font-size:12px">立即跑一次</button>
        </div>
        ${perMode}
        ${s.status === 'error' && s.lastError ? `<div style="font-size:11px;color:#ef9a9a;margin-top:6px;background:rgba(244,67,54,0.08);padding:6px 8px;border-radius:6px">${s.lastError}</div>` : ''}
      </div>
    `;
  }).join('');
  wrap.querySelectorAll('.task-trigger-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '已触发，跑后台...';
      try {
        await server.post(`/api/scheduler/trigger/${btn.dataset.task}`, {});
        // 1.5s 后刷新；任务可能已开始变 running
        setTimeout(renderSchedulerTasks, 1500);
        // 再次延后刷新看完成态
        setTimeout(renderSchedulerTasks, 8000);
        setTimeout(() => { renderSchedulerTasks(); loadTasteProfile(); }, 18000);
      } catch (e) {
        btn.textContent = '失败：' + e.message;
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = '立即跑一次'; }, 18500);
      }
    });
  });
}

async function loadTasteProfile() {
  const box = document.getElementById('tasteProfile');
  const meta = document.getElementById('tasteProfileMeta');
  if (!box) return;
  try {
    const profile = await server.get('/api/scheduler/taste-profile');
    if (profile?.description) {
      box.innerHTML = profile.description.replace(/\n/g, '<br>');
      const ts = profile.generated_at ? new Date(profile.generated_at).toLocaleString('zh-CN', { hour12: false }) : '?';
      const based = profile.based_on || {};
      meta.textContent = `生成于 ${ts}（基于 ${based.history_count || 0} 条历史 + ${based.fav_count || 0} 条收藏）`;
    } else {
      box.innerHTML = '<p style="color:var(--text-muted);margin:0">还没有品味画像。在下方"AI 后台任务"里点 🎨 品味画像生成 → 立即跑一次。</p>';
      meta.textContent = '';
    }
  } catch {
    box.textContent = '加载失败';
    meta.textContent = '';
  }
}

function renderBreakdown(b) {
  if (!b || Object.keys(b).length === 0) return '';
  return Object.entries(b).map(([k, v]) => `${k}:${v}`).join(' · ');
}

async function loadBackfillStatus() {
  const info = document.getElementById('backfillLastInfo');
  if (!info) return;
  try {
    const last = await server.get('/api/admin/backfill-mode/last');
    if (last?.lastRun) {
      info.textContent = `上次：${fmtRelTime(last.lastRun)} · 共回填 ${last.updated} 条 · ${renderBreakdown(last.breakdown)}`;
    } else {
      info.textContent = '从未跑过';
    }
  } catch { info.textContent = '加载失败'; }
}

document.getElementById('backfillBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const result = document.getElementById('backfillResult');
  btn.disabled = true;
  btn.textContent = '回填中...';
  result.style.display = 'block';
  result.style.color = 'var(--text-muted)';
  result.textContent = '正在按时段推断...';
  try {
    const r = await server.post('/api/admin/backfill-mode', {});
    if (r.ok) {
      result.style.color = '#a5d6a7';
      if (r.updated === 0) {
        result.textContent = '✓ ' + (r.message || '没有需要回填的记录');
      } else {
        result.textContent = `✓ 已回填 ${r.updated} 条 → ${renderBreakdown(r.breakdown)}。建议接着跑"🧠 模式偏好学习 → 立即跑一次"`;
      }
      loadBackfillStatus();
    } else {
      result.style.color = '#ef9a9a';
      result.textContent = '失败：' + (r.error || '未知');
    }
  } catch (err) {
    result.style.color = '#ef9a9a';
    result.textContent = '失败：' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '立即回填';
  }
});

async function openDjPanel() {
  document.getElementById('djPanel').style.display = 'flex';
  loadTasteProfile();
  renderSchedulerTasks();
  loadBackfillStatus();
}
document.getElementById('djAvatar')?.addEventListener('click', openDjPanel);
document.getElementById('djAvatarChat')?.addEventListener('click', openDjPanel);
document.getElementById('userAvatar')?.addEventListener('click', () => switchView('favorites'));

// ========== 电台情绪 ==========
const SOURCE_LABEL = { user: '你设定', chat: '聊天推断', playback: '播放推断' };

function renderTopbarMood(data) {
  const pill = document.getElementById('topbarMood');
  const labelEl = document.getElementById('topbarMoodLabel');
  const sourceEl = document.getElementById('topbarMoodSource');
  if (!pill || !labelEl || !sourceEl) return;
  if (!data?.mood) {
    labelEl.textContent = '情绪：未判断';
    sourceEl.textContent = '';
    pill.classList.remove('is-user');
    return;
  }
  labelEl.textContent = data.mood;
  sourceEl.textContent = SOURCE_LABEL[data.source] || '';
  pill.classList.toggle('is-user', data.source === 'user');
}

function fillMoodPanel(data) {
  const sourceEl = document.getElementById('moodSourceText');
  const labelEl = document.getElementById('moodCurrentLabel');
  const messageEl = document.getElementById('moodCurrentMessage');
  const extraEl = document.getElementById('moodCurrentExtra');
  if (!data?.mood) {
    sourceEl.textContent = '暂无判断（缺少聊天 / 播放数据）';
    labelEl.textContent = '—';
    messageEl.textContent = '在下面写一句话告诉 AI 你的情绪。';
    extraEl.textContent = '';
    return;
  }
  sourceEl.textContent = (SOURCE_LABEL[data.source] || data.source || '未知') + (data.stale ? '（已过期）' : '');
  labelEl.textContent = data.mood;
  messageEl.textContent = data.message || '';
  const parts = [];
  if (data.genre) parts.push(`推荐曲风：${data.genre}`);
  if (data.user_input) parts.push(`你的原话："${data.user_input}"`);
  if (data.set_at) {
    try {
      const d = new Date(data.set_at);
      parts.push(`判定时间：${d.toLocaleString('zh-CN', { hour12: false })}`);
    } catch {}
  }
  extraEl.textContent = parts.join(' · ');
}

let currentMood = null;
async function refreshMood() {
  try {
    currentMood = await server.get('/api/mood');
  } catch { currentMood = null; }
  renderTopbarMood(currentMood);
  if (document.getElementById('moodPanel').style.display !== 'none') fillMoodPanel(currentMood);
}

document.getElementById('topbarMood')?.addEventListener('click', () => {
  document.getElementById('moodPanel').style.display = 'flex';
  fillMoodPanel(currentMood);
  document.getElementById('moodInput').value = currentMood?.user_input || '';
  document.getElementById('moodStatus').textContent = '';
});

document.getElementById('moodPanel')?.addEventListener('click', (e) => {
  if (e.target.id === 'moodPanel') document.getElementById('moodPanel').style.display = 'none';
});

document.getElementById('moodSubmitBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('moodInput').value.trim();
  if (!input) {
    document.getElementById('moodStatus').textContent = '请先写点什么';
    return;
  }
  const status = document.getElementById('moodStatus');
  status.textContent = 'AI 解析中...';
  try {
    const data = await server.post('/api/mood', { input });
    if (data.error) {
      status.textContent = '失败：' + data.error;
      return;
    }
    currentMood = data;
    renderTopbarMood(data);
    fillMoodPanel(data);
    status.textContent = `✓ 已应用 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  } catch (e) {
    status.textContent = '失败：' + e.message;
  }
});

document.getElementById('moodRefreshBtn')?.addEventListener('click', async () => {
  const status = document.getElementById('moodStatus');
  status.textContent = 'AI 重新判断中...';
  try {
    const data = await server.post('/api/mood/refresh', {});
    if (data?.error) {
      status.textContent = '失败：' + data.error;
      return;
    }
    currentMood = data;
    renderTopbarMood(data);
    fillMoodPanel(data);
    status.textContent = `✓ 已更新（来源 ${SOURCE_LABEL[data.source] || data.source}）`;
  } catch (e) {
    status.textContent = '失败：' + e.message;
  }
});

document.getElementById('moodClearBtn')?.addEventListener('click', async () => {
  const status = document.getElementById('moodStatus');
  status.textContent = '清除中...';
  try {
    const data = await server.del('/api/mood');
    currentMood = data;
    renderTopbarMood(data);
    fillMoodPanel(data);
    document.getElementById('moodInput').value = '';
    status.textContent = '✓ 已清除你的设定';
  } catch (e) {
    status.textContent = '失败：' + e.message;
  }
});

// 启动时拉一次，之后每 10 分钟刷一次
refreshMood();
setInterval(refreshMood, 10 * 60 * 1000);

// ========== 队列内联 ==========
function renderQueueInline() {
  const list = document.getElementById('queueListInline');
  const queue = window.player?.getQueue?.() || [];
  const idx = window.player?.getQueueIndex?.() ?? -1;
  document.getElementById('queueViewCount').textContent = queue.length ? `(${queue.length} 首)` : '';
  if (queue.length === 0) {
    list.innerHTML = '<p class="empty-tip">播放列表为空。打开电台模式或从聊天/收藏添加歌曲。</p>';
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
// 串词期间提前显示下一首的歌名/歌手（垫音仍是当前歌，不会停）
window.addEventListener('songpreview', e => syncNowPlaying(e.detail));

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
    console.log('Aidio FM 初始化完成');
  } catch (err) {
    console.error('初始化失败:', err);
    window.showToast('初始化失败，请刷新重试');
  }
}

init();

window.addEventListener('timeupdate', (e) => updateLyrics(e.detail));
