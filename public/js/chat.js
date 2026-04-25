// public/js/chat.js
import { server, netease } from './api.js';
import { burstParticles } from './visual.js';

const $ = id => document.getElementById(id);
const chatMessages = $('chatMessages');
const chatInput = $('chatInput');
const sendBtn = $('sendBtn');

function formatTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function addMessage(role, content, extra = '') {
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  msg.innerHTML = `<div class="msg-bubble">${content}${extra}</div>`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msg;
}

function renderSongCard(song, disabled = false) {
  return `
    <div class="song-card ${disabled ? 'disabled' : ''}" data-song-id="${song.id}">
      <img class="song-card-cover" src="${song.cover || ''}" alt="${song.name}" onerror="this.style.display='none'">
      <div class="song-card-info">
        <div class="song-card-name">${song.name}</div>
        <div class="song-card-artist">${song.artist}${song.album ? ' — ' + song.album : ''}</div>
      </div>
      <div class="song-card-actions">
        <button class="song-card-btn play-song-btn" data-song='${JSON.stringify(song)}' title="播放">▶</button>
        <button class="song-card-btn add-song-btn" data-song='${JSON.stringify(song)}' title="添加到歌单">+</button>
      </div>
    </div>
  `;
}

function renderVoiceMsg(text) {
  return `
    <div class="voice-msg" onclick="window.voice && window.voice.speak(\`${text.replace(/`/g, '\\`')}\`)">
      <span style="font-size:14px">🎙</span>
      <canvas class="voice-wave" width="200" height="24"></canvas>
      <span class="voice-duration">点击播放语音</span>
    </div>
  `;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  sendBtn.disabled = true;

  // 显示用户消息
  addMessage('user', text);

  // 显示思考中动画
  const typingMsg = addMessage('assistant', '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>');

  // 获取当前歌曲信息
  const currentSong = window.player?.getCurrentSong?.() || null;

  try {
    const res = await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, currentSong })
    });

    // 检查是否是 SSE 流
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      // 流式响应
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantMsg = null;
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === 'text') {
            fullText += data.text;
            if (!assistantMsg) {
              typingMsg?.remove();
              assistantMsg = addMessage('assistant', '');
            }
            assistantMsg.querySelector('.msg-bubble').textContent = fullText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }

          if (data.type === 'done') {
            // 渲染最终结构化内容
            if (data.parsed) {
              const { say, reason, play, segue } = data.parsed;
              let html = '';
              if (say || reason) html += `<div>${[say, reason].filter(Boolean).join('\n\n')}</div>`;

              // AI推荐的歌曲需要通过网易云搜索获取真实数据
              let resolvedSongs = [];
              if (play && play.length > 0) {
                resolvedSongs = await Promise.all(play.map(async (s) => {
                  try {
                    const keyword = `${s.name} ${s.artist}`.trim();
                    const results = await netease.search(keyword, 3);
                    // 找最匹配的（优先同名）
                    const match = results.find(r => r.name === s.name) || results[0];
                    if (match) return { ...match, aiReason: s.reason || '' };
                    return s; // fallback: 用AI给的数据
                  } catch { return s; }
                }));
              }

              if (segue) html += renderVoiceMsg(segue);
              if (resolvedSongs.length > 0) {
                html += resolvedSongs.map(s => renderSongCard(s)).join('');
                // 自动加入队列并播放第一首
                window.player?.addToQueue?.(resolvedSongs);
                window.player?.playSong?.(resolvedSongs[0]);
              }
              if (assistantMsg) {
                assistantMsg.querySelector('.msg-bubble').innerHTML = html;
              }
            }

            // 绑定歌曲卡片按钮
            bindSongCardButtons();
          }

          if (data.type === 'error') {
            addMessage('assistant', `出错了: ${data.message}`);
          }
        }
      }
    } else {
      // 非流式响应（简单指令/搜索）
      typingMsg?.remove();
      const data = await res.json();
      if (data.type === 'command') {
        handleCommand(data);
      } else if (data.type === 'music_search') {
        await handleMusicSearch(data.keyword);
      }
    }
  } catch (err) {
    typingMsg?.remove();
    addMessage('assistant', `发送失败: ${err.message}`);
  }

  sendBtn.disabled = false;
}

function handleCommand(data) {
  const actions = {
    next: () => window.player?.playNext?.(),
    prev: () => window.player?.playPrev?.(),
    play: () => document.getElementById('playBtn')?.click(),
    pause: () => document.getElementById('playBtn')?.click(),
    shuffle: () => document.getElementById('shuffleBtn')?.click()
  };
  if (actions[data.action]) actions[data.action]();
  addMessage('assistant', `好的，${data.action === 'next' ? '下一首' : data.action === 'prev' ? '上一首' : data.action}！`);
}

async function handleMusicSearch(keyword) {
  addMessage('assistant', `正在搜索"${keyword}"...`);
  try {
    const songs = await netease.search(keyword, 5);
    if (songs.length === 0) {
      addMessage('assistant', '没找到相关歌曲');
      return;
    }

    // 为每首歌获取播放 URL
    const songsWithUrl = await Promise.all(songs.map(async s => {
      const url = await netease.getSongUrl(s.id);
      return { ...s, hasUrl: !!url };
    }));

    let html = `找到 ${songs.length} 首相关歌曲：`;
    html += songsWithUrl.map(s => renderSongCard(s, !s.hasUrl)).join('');

    // 移除"正在搜索"消息
    const lastMsg = chatMessages.lastElementChild;
    if (lastMsg?.textContent?.includes('正在搜索')) lastMsg.remove();

    addMessage('assistant', html);
    bindSongCardButtons();
  } catch (err) {
    addMessage('assistant', `搜索失败: ${err.message}`);
  }
}

function bindSongCardButtons() {
  document.querySelectorAll('.play-song-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const song = JSON.parse(btn.dataset.song);
      window.player?.playSong?.(song);
      burstParticles(e.clientX, e.clientY);
    });
  });

  document.querySelectorAll('.add-song-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const song = JSON.parse(btn.dataset.song);
      // 添加到"我喜欢"歌单（简化处理）
      await server.post('/api/favorites', {
        song_id: song.id,
        song_name: song.name,
        artist: song.artist,
        album: song.album || '',
        cover_url: song.cover || ''
      });
      window.showToast('已添加到收藏');
      burstParticles(e.clientX, e.clientY);
    });
  });
}

// 绑定发送事件
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 加载聊天历史
export async function loadChatHistory() {
  try {
    const history = await server.get('/api/chat/history?limit=50');
    for (const msg of history) {
      if (msg.role === 'user') {
        addMessage('user', msg.content);
      } else {
        let extra = '';
        if (msg.song_cards) {
          try {
            const cards = JSON.parse(msg.song_cards);
            if (cards.length > 0) {
              extra = cards.map(s => renderSongCard(s)).join('');
            }
          } catch(e) {}
        }
        addMessage('assistant', msg.content, extra);
      }
    }
    bindSongCardButtons();
  } catch (e) {
    console.error('加载聊天历史失败:', e);
  }
}
