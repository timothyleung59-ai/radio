// public/js/panels.js — 头像弹出面板逻辑
import { server } from './api.js';

// DJ 头像 → 电台信息面板
document.getElementById('djAvatar').addEventListener('click', async () => {
  document.getElementById('djPanel').style.display = 'flex';

  // 加载品味画像
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

// 用户头像 → 个人面板
document.getElementById('userAvatar').addEventListener('click', async () => {
  document.getElementById('userPanel').style.display = 'flex';

  // 加载收藏列表
  try {
    const favs = await server.get('/api/favorites');
    document.getElementById('favoritesList').innerHTML = favs.length === 0
      ? '<p style="color:var(--text-muted)">还没有收藏歌曲</p>'
      : favs.map(s => `
        <div class="panel-song">
          <img class="panel-song-cover" src="${s.cover_url || ''}" alt="" onerror="this.style.display='none'">
          <div><div class="panel-song-name">${s.song_name}</div><div class="panel-song-artist">${s.artist}</div></div>
        </div>
      `).join('');

    const history = await server.get('/api/history?limit=20');
    document.getElementById('historyList').innerHTML = history.length === 0
      ? '<p style="color:var(--text-muted)">还没有播放记录</p>'
      : history.slice(0, 10).map(s => `
        <div class="panel-song">
          <img class="panel-song-cover" src="${s.cover_url || ''}" alt="" onerror="this.style.display='none'">
          <div><div class="panel-song-name">${s.song_name}</div><div class="panel-song-artist">${s.artist}</div></div>
        </div>
      `).join('');
  } catch (e) {
    document.getElementById('favoritesList').textContent = '加载失败';
  }
});

// 点击遮罩关闭
document.querySelectorAll('.panel-overlay').forEach(panel => {
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.style.display = 'none';
  });
});
