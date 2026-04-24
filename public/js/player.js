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

function toggleRepeat() {
  const modes = ['off', 'all', 'one'];
  const idx = (modes.indexOf(playMode) + 1) % modes.length;
  playMode = modes[idx];
  repeatBtn.classList.toggle('active', playMode !== 'off');
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

async function savePlaybackState() {
  await server.put('/api/playback-state', {
    current_song_id: currentSong?.id || null,
    current_song_name: currentSong?.name || null,
    current_song_artist: currentSong?.artist || null,
    current_song_album: currentSong?.album || null,
    current_song_cover: currentSong?.cover || null,
    progress_seconds: audio.currentTime || 0,
    queue_song_ids: queue.map(s => s.id),
    queue_index: queueIndex,
    play_mode: playMode
  });
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
audio.addEventListener('play', updatePlayButton);
audio.addEventListener('pause', updatePlayButton);
audio.addEventListener('error', () => {
  window.showToast('播放出错，自动跳到下一首');
  playNext();
});

// 恢复播放状态
export async function restorePlayback() {
  const state = await server.get('/api/playback-state');
  if (!state || !state.current_song_id) return;

  playMode = state.play_mode || 'off';
  shuffleBtn.classList.toggle('active', playMode === 'shuffle');
  repeatBtn.classList.toggle('active', playMode !== 'off');

  songTitle.textContent = `${state.current_song_name} — ${state.current_song_artist}`;
  if (state.current_song_cover) coverImg.src = state.current_song_cover;

  // 预加载队列
  if (state.queue_song_ids) {
    try {
      const ids = JSON.parse(state.queue_song_ids);
      // 队列中的歌曲信息从历史/收藏恢复（简化处理：仅恢复当前歌曲）
    } catch(e) {}
  }
}

// 导出给全局使用
window.player = { playSong, setQueue, playNext, playPrev, getCurrentSong: () => currentSong };
