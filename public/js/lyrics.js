// public/js/lyrics.js
import { netease } from './api.js';

const $ = id => document.getElementById(id);

let lyricsLines = [];
let currentLineIndex = -1;

function parseLRC(lrc) {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result = [];
  for (const line of lines) {
    const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (match) {
      const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 100;
      const text = match[4].trim();
      if (text) result.push({ time, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

export async function loadLyrics(songId) {
  const container = $('lyricsContent');
  container.innerHTML = '<p style="color:var(--text-muted);text-align:center;margin-top:40%;">加载歌词中...</p>';

  try {
    const { lrc } = await netease.getLyrics(songId);
    lyricsLines = parseLRC(lrc);

    if (lyricsLines.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;margin-top:40%;">暂无歌词</p>';
      return;
    }

    container.innerHTML = '';
    // 顶部留白
    const spacer = document.createElement('div');
    spacer.style.height = '40%';
    container.appendChild(spacer);

    for (const line of lyricsLines) {
      const el = document.createElement('div');
      el.className = 'lyrics-line';
      el.textContent = line.text;
      el.dataset.time = line.time;
      container.appendChild(el);
    }

    // 底部留白
    const spacerBottom = document.createElement('div');
    spacerBottom.style.height = '60%';
    container.appendChild(spacerBottom);

  } catch (e) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;margin-top:40%;">歌词加载失败</p>';
  }
}

export function updateLyrics(currentTime) {
  if (lyricsLines.length === 0) return;

  let newIndex = -1;
  for (let i = lyricsLines.length - 1; i >= 0; i--) {
    if (currentTime >= lyricsLines[i].time) {
      newIndex = i;
      break;
    }
  }

  if (newIndex === currentLineIndex) return;
  currentLineIndex = newIndex;

  const container = $('lyricsContent');
  const lines = container.querySelectorAll('.lyrics-line');

  lines.forEach((el, i) => {
    el.classList.remove('active', 'past');
    if (i === newIndex) {
      el.classList.add('active');
      // 滚动到当前行
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (i < newIndex) {
      el.classList.add('past');
    }
  });
}

export function clearLyrics() {
  lyricsLines = [];
  currentLineIndex = -1;
  const container = $('lyricsContent');
  container.innerHTML = '<p style="color:var(--text-muted);text-align:center;margin-top:40%;">暂无歌词</p>';
}

// 监听歌曲变化自动加载歌词
window.addEventListener('songchange', (e) => {
  const song = e.detail;
  if (song?.id) loadLyrics(song.id);
  else clearLyrics();
});
