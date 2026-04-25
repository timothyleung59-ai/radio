// public/js/player.js
import { netease, server } from './api.js';

const audio = new Audio();
audio.preload = 'auto';

let currentSong = null;
let queue = [];
let queueIndex = 0;
let playMode = 'off'; // off / all / one / shuffle
let isLiked = false;

const $ = id => document.getElementById(id);

// DOM 引用
const playBtn = $('playBtn');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const shuffleBtn = $('shuffleBtn');
const repeatBtn = $('repeatBtn');
const likeBtn = $('likeBtn');
const songTitle = $('songTitle');
const coverImg = $('coverImg');
const currentTimeEl = $('currentTime');
const totalTimeEl = $('totalTime');
const progressTrack = $('progressTrack');
const progressFill = $('progressFill');
const volumeSlider = $('volumeSlider');
const volumeIcon = $('volumeIcon');

// 音量控制
let savedVolume = 0.8;
audio.volume = parseFloat(volumeSlider?.value || 0.8);

volumeSlider?.addEventListener('input', () => {
  audio.volume = parseFloat(volumeSlider.value);
  savedVolume = audio.volume;
  volumeIcon.textContent = audio.volume === 0 ? '🔇' : audio.volume < 0.4 ? '🔉' : '🔊';
});

volumeIcon?.addEventListener('click', () => {
  if (audio.volume > 0) {
    savedVolume = audio.volume;
    audio.volume = 0;
    volumeSlider.value = 0;
    volumeIcon.textContent = '🔇';
  } else {
    audio.volume = savedVolume || 0.8;
    volumeSlider.value = audio.volume;
    volumeIcon.textContent = audio.volume < 0.4 ? '🔉' : '🔊';
  }
});

// 播放列表面板
const queueBtn = $('queueBtn');
const queuePanel = $('queuePanel');
const queueList = $('queueList');
const queueCount = $('queueCount');
const queuePanelCount = $('queuePanelCount');

function updateQueueCount() {
  const n = queue.length;
  queueCount.textContent = n;
  queueCount.dataset.count = n;
}

function renderQueuePanel() {
  queuePanelCount.textContent = `(${queue.length}首)`;
  if (queue.length === 0) {
    queueList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0">播放列表为空</p>';
    return;
  }
  queueList.innerHTML = queue.map((s, i) => `
    <div class="queue-item ${i === queueIndex ? 'playing' : ''}" data-index="${i}">
      <img class="queue-item-cover" src="${s.cover || ''}" alt="" onerror="this.style.display='none'">
      <div class="queue-item-info">
        <div class="queue-item-name">${s.name || '未知歌曲'}</div>
        <div class="queue-item-artist">${s.artist || ''}</div>
      </div>
      <button class="queue-item-remove" data-index="${i}" title="移除">✕</button>
    </div>
  `).join('');

  // 点击播放
  queueList.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.queue-item-remove')) return;
      const idx = parseInt(el.dataset.index);
      queueIndex = idx;
      playSong(queue[idx]);
      renderQueuePanel();
    });
  });

  // 移除
  queueList.querySelectorAll('.queue-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      queue.splice(idx, 1);
      if (queueIndex >= queue.length) queueIndex = Math.max(0, queue.length - 1);
      else if (idx < queueIndex) queueIndex--;
      updateQueueCount();
      renderQueuePanel();
      savePlaybackState();
    });
  });

  // 滚动到当前播放
  const current = queueList.querySelector('.queue-item.playing');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

queueBtn?.addEventListener('click', () => {
  renderQueuePanel();
  queuePanel.style.display = 'flex';
});

queuePanel?.addEventListener('click', (e) => {
  if (e.target === queuePanel) queuePanel.style.display = 'none';
});

function formatTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function updatePlayButton() {
  playBtn.textContent = audio.paused ? '▶' : '⏸';
}

function updateProgress() {
  const cur = audio.currentTime || 0;
  const dur = audio.duration || 0;
  currentTimeEl.textContent = formatTime(cur);
  totalTimeEl.textContent = formatTime(dur);
  progressFill.style.width = dur ? `${(cur/dur)*100}%` : '0%';
}

async function checkLiked() {
  if (!currentSong) return;
  const favs = await server.get('/api/favorites');
  isLiked = favs.some(f => f.song_id === currentSong.id);
  likeBtn.textContent = isLiked ? '♥' : '♡';
  likeBtn.classList.toggle('liked', isLiked);
  if (miniLikeBtn) miniLikeBtn.textContent = isLiked ? '♥' : '♡';
}

export async function playSong(song) {
  if (!song || !song.id) return;

  const url = await netease.getSongUrl(song.id);
  if (!url) {
    window.showToast('暂无音源');
    return;
  }

  currentSong = song;
  audio.src = url;
  audio.play().catch(() => {});

  songTitle.textContent = `${song.name} — ${song.artist}`;
  if (song.cover) coverImg.src = song.cover;

  updatePlayButton();
  checkLiked();
  syncMiniPlayer();
  setPlayerCollapsed(true);

  // 记录播放历史
  server.post('/api/history', {
    song_id: song.id,
    song_name: song.name,
    artist: song.artist,
    album: song.album || '',
    cover_url: song.cover || ''
  });

  // 保存播放状态
  savePlaybackState();

  // 触发自定义事件（供 visual.js 监听）
  window.dispatchEvent(new CustomEvent('songchange', { detail: song }));
}

export function setQueue(songs, startIndex = 0) {
  queue = songs;
  queueIndex = startIndex;
  updateQueueCount();
  savePlaybackState();
}

export function addToQueue(songs) {
  queue.push(...songs);
  updateQueueCount();
  savePlaybackState();
}

export function playNext() {
  if (queue.length === 0) return;
  if (playMode === 'shuffle') {
    queueIndex = Math.floor(Math.random() * queue.length);
  } else {
    queueIndex = (queueIndex + 1) % queue.length;
  }
  playSong(queue[queueIndex]);
}

export function playPrev() {
  if (queue.length === 0) return;
  queueIndex = (queueIndex - 1 + queue.length) % queue.length;
  playSong(queue[queueIndex]);
}

function togglePlay() {
  if (!currentSong && queue.length > 0) {
    playSong(queue[0]);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  updatePlayButton();
}

function shuffleQueue() {
  // Fisher-Yates shuffle
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  queueIndex = 0;
}

function toggleShuffle() {
  playMode = playMode === 'shuffle' ? 'off' : 'shuffle';
  if (playMode === 'shuffle') shuffleQueue();
  shuffleBtn.classList.toggle('active', playMode === 'shuffle');
  window.showToast(playMode === 'shuffle' ? '随机播放已开启' : '随机播放已关闭');
}

function updateRepeatIcon() {
  repeatBtn.innerHTML = playMode === 'one' ? '↻<sup style="font-size:10px;margin-left:-2px">1</sup>' : '↻';
  repeatBtn.classList.toggle('active', playMode !== 'off');
}

function toggleRepeat() {
  const modes = ['off', 'all', 'one'];
  const idx = (modes.indexOf(playMode) + 1) % modes.length;
  playMode = modes[idx];
  updateRepeatIcon();
  const labels = { off: '关闭循环', all: '列表循环', one: '单曲循环' };
  window.showToast(labels[playMode]);
  audio.loop = playMode === 'one';
}

async function toggleLike() {
  if (!currentSong) return;
  if (isLiked) {
    await server.del(`/api/favorites/${currentSong.id}`);
    window.showToast('已取消收藏');
  } else {
    await server.post('/api/favorites', {
      song_id: currentSong.id,
      song_name: currentSong.name,
      artist: currentSong.artist,
      album: currentSong.album || '',
      cover_url: currentSong.cover || ''
    });
    window.showToast('已收藏');
  }
  checkLiked();
}

function seekFromEvent(e) {
  const rect = progressTrack.getBoundingClientRect();
  const cx = e.clientX ?? e.touches?.[0]?.clientX;
  if (cx == null) return;
  const p = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  audio.currentTime = p * (audio.duration || 0);
}

let saveTimer = null;
async function savePlaybackState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await server.put('/api/playback-state', {
      current_song_id: currentSong?.id || null,
      current_song_name: currentSong?.name || null,
      current_song_artist: currentSong?.artist || null,
      current_song_album: currentSong?.album || null,
      current_song_cover: currentSong?.cover || null,
      progress_seconds: audio.currentTime || 0,
      queue_song_ids: queue, // 保存完整歌曲对象
      queue_index: queueIndex,
      play_mode: playMode
    });
  }, 500); // 防抖 500ms
}

// 事件绑定
playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);
shuffleBtn.addEventListener('click', toggleShuffle);
repeatBtn.addEventListener('click', toggleRepeat);
likeBtn.addEventListener('click', toggleLike);

progressTrack.addEventListener('pointerdown', e => {
  progressTrack.setPointerCapture(e.pointerId);
  seekFromEvent(e);
});
progressTrack.addEventListener('pointermove', e => {
  if (e.buttons) seekFromEvent(e);
});

audio.addEventListener('timeupdate', () => {
  updateProgress();
  syncMiniProgress();
  window.dispatchEvent(new CustomEvent('timeupdate', { detail: audio.currentTime }));
});
audio.addEventListener('ended', () => {
  if (playMode === 'one') {
    audio.currentTime = 0;
    audio.play();
  } else {
    playNext();
  }
});
audio.addEventListener('play', () => { updatePlayButton(); syncMiniPlayer(); });
audio.addEventListener('pause', () => { updatePlayButton(); syncMiniPlayer(); });
audio.addEventListener('error', () => {
  window.showToast('播放出错，自动跳到下一首');
  playNext();
});

// DJ 语音音频闪避
window.addEventListener('voiceStart', () => {
  audio.volume = 0.2;
});

window.addEventListener('voiceEnd', () => {
  // 渐变恢复音量
  const target = savedVolume;
  let current = 0.2;
  const fade = setInterval(() => {
    current = Math.min(current + 0.05, target);
    audio.volume = current;
    if (current >= target) clearInterval(fade);
  }, 50);
});

// ========== 播放器展开/收起 ==========
const playerSection = $('playerSection');
const miniPlayer = $('miniPlayer');
const playerCollapse = $('playerCollapse');
const miniPlayBtn = $('miniPlayBtn');
const miniNextBtn = $('miniNextBtn');
const miniLikeBtn = $('miniLikeBtn');
const miniCover = $('miniCover');
const miniTitle = $('miniTitle');
const miniProgressFill = $('miniProgressFill');
const playerToggle = $('playerToggle');

let playerCollapsed = false;

function setPlayerCollapsed(collapsed) {
  playerCollapsed = collapsed;
  playerSection.classList.toggle('collapsed', collapsed);
  miniPlayer.classList.toggle('show', collapsed);
  playerToggle?.classList.toggle('flipped', !collapsed);
}

playerCollapse?.addEventListener('click', () => setPlayerCollapsed(true));
playerToggle?.addEventListener('click', () => setPlayerCollapsed(!playerCollapsed));
miniPlayer?.addEventListener('click', (e) => {
  if (e.target.closest('.mini-ctrl')) return;
  setPlayerCollapsed(false);
});

miniPlayBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});
miniNextBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  playNext();
});

miniLikeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleLike();
});

// 同步迷你播放器状态
function syncMiniPlayer() {
  if (!currentSong) return;
  miniCover.src = currentSong.cover || miniCover.src;
  miniTitle.textContent = `${currentSong.name} — ${currentSong.artist}`;
  miniPlayBtn.textContent = audio.paused ? '▶' : '⏸';
}

function syncMiniProgress() {
  const dur = audio.duration || 0;
  miniProgressFill.style.width = dur ? `${(audio.currentTime / dur) * 100}%` : '0%';
}

// 恢复播放状态
export async function restorePlayback() {
  const state = await server.get('/api/playback-state');
  if (!state || !state.current_song_id) return;

  playMode = state.play_mode || 'off';
  shuffleBtn.classList.toggle('active', playMode === 'shuffle');
  updateRepeatIcon();

  currentSong = {
    id: state.current_song_id,
    name: state.current_song_name,
    artist: state.current_song_artist,
    album: state.current_song_album,
    cover: state.current_song_cover
  };

  songTitle.textContent = `${state.current_song_name} — ${state.current_song_artist}`;
  if (state.current_song_cover) coverImg.src = state.current_song_cover;

  // 恢复完整队列
  if (state.queue_song_ids) {
    try {
      const parsed = JSON.parse(state.queue_song_ids);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 兼容：如果是字符串数组（旧格式），只恢复ID
        if (typeof parsed[0] === 'string') {
          queue = parsed.map(id => ({ id, name: '', artist: '', album: '', cover: '' }));
        } else {
          queue = parsed;
        }
        queueIndex = state.queue_index || 0;
      }
    } catch(e) {}
  }
  updateQueueCount();
}

// 导出给全局使用
window.player = { playSong, setQueue, addToQueue, playNext, playPrev, getCurrentSong: () => currentSong };
