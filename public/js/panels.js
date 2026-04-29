// public/js/panels.js — inline list rendering for sidebar views
import { server, netease } from './api.js';

function favToSong(s) {
  return { id: s.song_id || s.id, name: s.song_name || s.name, artist: s.artist, album: s.album || '', cover: s.cover_url || s.cover || '' };
}

function renderSongRow(s, opts = {}) {
  const cover = s.cover_url || s.cover || '';
  const name = s.song_name || s.name || '未知歌曲';
  const artist = s.artist || '';
  const id = s.song_id || s.id || '';
  const time = opts.time || '';
  const showDel = opts.showDel ?? false;
  const safe = JSON.stringify(favToSong(s)).replace(/'/g, '&#39;');
  return `
    <div class="panel-song" data-id="${id}">
      ${cover && cover.startsWith('http')
        ? `<img class="panel-song-cover" src="${cover}" alt="" onerror="this.style.background='rgba(255,255,255,0.06)';this.removeAttribute('src')">`
        : '<div class="panel-song-cover"></div>'}
      <div class="panel-song-info">
        <div class="panel-song-name">${name}</div>
        <div class="panel-song-artist">${artist}</div>
      </div>
      ${time ? `<span class="panel-song-time">${time}</span>` : ''}
      <button class="panel-song-play" data-song='${safe}' title="播放">▶</button>
      <button class="panel-song-add" data-song='${safe}' title="加入队列">+</button>
      ${showDel ? `<button class="panel-song-del" data-id="${id}" title="取消收藏">✕</button>` : ''}
    </div>
  `;
}

function bindSongRowActions(scope, refresh) {
  scope.querySelectorAll('.panel-song-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const song = JSON.parse(btn.dataset.song);
      window.player?.addToQueue?.([song]);
      window.player?.playSong?.(song);
      window.showToast(`正在播放：${song.name}`);
    });
  });
  scope.querySelectorAll('.panel-song-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const song = JSON.parse(btn.dataset.song);
      window.player?.addToQueue?.([song]);
      window.showToast(`已加入队列：${song.name}`);
    });
  });
  scope.querySelectorAll('.panel-song-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await server.del(`/api/favorites/${btn.dataset.id}`);
      window.showToast('已取消收藏');
      if (refresh) refresh();
    });
  });
}

// ========== 我喜欢的（本地收藏 + 网易云「我喜欢的音乐」歌单） ==========
export async function loadFavorites() {
  const list = document.getElementById('favoritesList');
  const countEl = document.getElementById('favoritesCount');
  if (!list) return;
  list.innerHTML = '<p class="empty-tip">加载中...</p>';

  let html = '';

  // 本地收藏
  let localFavs = [];
  try { localFavs = await server.get('/api/favorites'); } catch {}

  // 网易云「我喜欢的音乐」（需要 cookie）
  let netLikes = null;
  let netError = null;
  try {
    netLikes = await netease.getMyLikes(300);
  } catch (e) {
    netError = e.message;
  }

  // 渲染网易云区块
  if (netLikes && netLikes.songs?.length > 0) {
    html += `
      <div style="display:flex;align-items:baseline;justify-content:space-between;padding:8px 12px;margin-top:4px">
        <h3 style="font-size:13px;font-weight:600;color:var(--accent-bright)">网易云 · ${netLikes.playlist_name || '我喜欢的音乐'}</h3>
        <button id="playAllNetLikes" class="btn-ghost" style="height:28px;padding:0 12px;font-size:12px">▶ 全部播放</button>
      </div>
    `;
    html += netLikes.songs.map(s => renderSongRow(s)).join('');
  } else if (netError) {
    html += `<p class="empty-tip" style="color:var(--accent-bright)">网易云收藏加载失败：${netError}<br><small style="color:var(--text-muted)">检查 .env 里的 NETEASE_COOKIE 是否还有效</small></p>`;
  }

  // 渲染本地收藏区块
  if (localFavs.length > 0) {
    html += `
      <div style="padding:16px 12px 6px;margin-top:12px;border-top:1px solid var(--border-subtle)">
        <h3 style="font-size:13px;font-weight:600;color:var(--text-muted);letter-spacing:1px">本地收藏 · ${localFavs.length} 首</h3>
      </div>
    `;
    html += localFavs.map(s => renderSongRow(s, { showDel: true })).join('');
  }

  if (!html) {
    list.innerHTML = '<p class="empty-tip">还没有收藏的歌曲。播放时点 ♡ 收藏，或登录网易云账号同步。</p>';
    if (countEl) countEl.textContent = '收藏的歌曲会显示在这里';
    return;
  }

  list.innerHTML = html;
  if (countEl) {
    const total = (netLikes?.songs?.length || 0) + localFavs.length;
    countEl.textContent = `共 ${total} 首歌曲${netLikes ? `（网易云 ${netLikes.songs.length} + 本地 ${localFavs.length}）` : ''}`;
  }
  bindSongRowActions(list, loadFavorites);

  // 「全部播放」按钮：把网易云 likes 全塞进队列
  document.getElementById('playAllNetLikes')?.addEventListener('click', () => {
    if (!netLikes?.songs?.length) return;
    window.player?.setQueue?.(netLikes.songs, 0);
    window.player?.playSong?.(netLikes.songs[0]);
    window.showToast(`已加入 ${netLikes.songs.length} 首到播放队列`);
  });
}

// ========== 最近播放 ==========
export async function loadHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  list.innerHTML = '<p class="empty-tip">加载中...</p>';
  try {
    const rows = await server.get('/api/history?limit=80');
    const seen = new Set();
    const unique = rows.filter(r => {
      if (seen.has(r.song_id)) return false;
      seen.add(r.song_id);
      return true;
    });
    if (unique.length === 0) {
      list.innerHTML = '<p class="empty-tip">还没有播放记录</p>';
      return;
    }
    list.innerHTML = unique.map(s => renderSongRow(s, { time: formatPlayedAt(s.played_at) })).join('');
    bindSongRowActions(list);
  } catch {
    list.innerHTML = '<p class="empty-tip">加载失败</p>';
  }
}

// ========== 搜索 ==========
export async function loadSearchResults(keyword) {
  const list = document.getElementById('searchResults');
  if (!list) return;
  list.innerHTML = '<p class="empty-tip">搜索中...</p>';
  try {
    const results = await netease.search(keyword, 30);
    if (!results || results.length === 0) {
      list.innerHTML = `<p class="empty-tip">没有找到关于「${keyword}」的结果</p>`;
      return;
    }
    list.innerHTML = results.map(s => renderSongRow(s)).join('');
    bindSongRowActions(list);
  } catch {
    list.innerHTML = '<p class="empty-tip">搜索失败，请检查网易云 API 是否运行</p>';
  }
}

// ========== 时间格式化 ==========
function formatPlayedAt(dateStr) {
  if (!dateStr) return '';
  const sh = { timeZone: 'Asia/Shanghai' };
  const opts = { ...sh, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  const dateStr_sh = d.toLocaleDateString('en-US', { ...sh, year: 'numeric', month: '2-digit', day: '2-digit' });
  const todayStr_sh = new Date().toLocaleDateString('en-US', { ...sh, year: 'numeric', month: '2-digit', day: '2-digit' });
  const isToday = dateStr_sh === todayStr_sh;
  const timeStr = d.toLocaleString('en-US', opts);
  const match = timeStr.match(/(\d{2}):(\d{2})/);
  const hh = match ? match[1] : '00';
  const mm = match ? match[2] : '00';
  if (isToday) return `${hh}:${mm}`;
  const dateMatch = timeStr.match(/(\d{2})\/(\d{2})\/\d{4}/);
  const month = dateMatch ? Number(dateMatch[1]) : '';
  const day = dateMatch ? Number(dateMatch[2]) : '';
  return `${month}/${day} ${hh}:${mm}`;
}
