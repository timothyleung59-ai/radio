// public/js/panels.js — 头像弹出面板逻辑
import { server } from './api.js';

function favToSong(s) {
  return { id: s.song_id, name: s.song_name, artist: s.artist, album: s.album || '', cover: s.cover_url || '' };
}

async function loadFavorites() {
  try {
    const favs = await server.get('/api/favorites');
    document.getElementById('favoritesList').innerHTML = favs.length === 0
      ? '<p style="color:var(--text-muted)">还没有收藏歌曲</p>'
      : favs.map(s => `
        <div class="panel-song">
          <img class="panel-song-cover" src="${s.cover_url || ''}" alt="" onerror="this.style.display='none'">
          <div class="panel-song-info">
            <div class="panel-song-name">${s.song_name}</div>
            <div class="panel-song-artist">${s.artist}</div>
          </div>
          <button class="panel-song-play" data-song='${JSON.stringify(favToSong(s))}' title="播放">▶</button>
          <button class="panel-song-add" data-song='${JSON.stringify(favToSong(s))}' title="加入队列">+</button>
          <button class="panel-song-del" data-id="${s.song_id}" title="取消收藏">✕</button>
        </div>
      `).join('');

    // 绑定按钮
    document.querySelectorAll('.panel-song-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const song = JSON.parse(btn.dataset.song);
        window.player?.playSong?.(song);
        window.player?.addToQueue?.([song]);
        window.showToast(`正在播放：${song.name}`);
      });
    });
    document.querySelectorAll('.panel-song-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const song = JSON.parse(btn.dataset.song);
        window.player?.addToQueue?.([song]);
        window.showToast(`已加入队列：${song.name}`);
      });
    });
    document.querySelectorAll('.panel-song-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await server.del(`/api/favorites/${btn.dataset.id}`);
        window.showToast('已取消收藏');
        loadFavorites();
      });
    });
  } catch (e) {
    document.getElementById('favoritesList').textContent = '加载失败';
  }
}

// DJ 头像 → 电台信息面板
document.getElementById('djAvatar').addEventListener('click', async () => {
  document.getElementById('djPanel').style.display = 'flex';

  try {
    const prefs = await server.get('/api/preferences');
    const profile = prefs.taste_profile ? JSON.parse(prefs.taste_profile) : null;
    document.getElementById('tasteProfile').innerHTML = profile
      ? `<p>${profile.description || '品味画像生成中...'}</p>`
      : '<p style="color:var(--text-muted)">品味画像将在每天早上 7 点自动生成</p>';
  } catch (e) {
    document.getElementById('tasteProfile').textContent = '加载失败';
  }
});

// 用户面板入口（header 按钮 + 消息头像）
function openUserPanel() {
  document.getElementById('userPanel').style.display = 'flex';
  loadFavorites();
}

document.getElementById('userAvatar').addEventListener('click', openUserPanel);

// 聊天消息中点击用户头像也打开面板
document.getElementById('chatMessages')?.addEventListener('click', (e) => {
  const avatar = e.target.closest('.msg.user .msg-avatar');
  if (avatar) openUserPanel();
});

// 点击遮罩关闭
document.querySelectorAll('.panel-overlay').forEach(panel => {
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.style.display = 'none';
  });
});
