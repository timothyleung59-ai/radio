// public/js/radio.js — sidebar-driven mode picker + continuous radio + DJ subtitle
import { server } from './api.js';

const MODE_ICONS = {
  default: '🧠',
  work: '💼',
  workout: '🏃',
  drive: '🚗',
  relax: '☕',
  sleep: '🌙'
};

let radioOn = false;
let currentMode = localStorage.getItem('claudio_radio_mode') || 'default';
let busy = false;
let recentPlayed = [];
let modesList = [];

const modeListEl = document.getElementById('modeList');
const toggleSwitch = document.getElementById('radioToggleSwitch');
const topbarMode = document.getElementById('topbarCurrentMode');
const npModePill = document.getElementById('npModePill');
const habitMini = document.getElementById('habitMini');

function getModeLabel(key) {
  return modesList.find(m => m.key === key)?.label || key;
}

function renderUi() {
  if (toggleSwitch) toggleSwitch.checked = radioOn;
  if (modeListEl) {
    modeListEl.querySelectorAll('.mode-item').forEach(el => {
      el.classList.toggle('active', el.dataset.key === currentMode);
    });
  }
  // 顶栏当前模式
  if (topbarMode) {
    if (radioOn) {
      topbarMode.textContent = `📻 ${getModeLabel(currentMode)}`;
      topbarMode.classList.add('show');
    } else {
      topbarMode.classList.remove('show');
    }
  }
  // 正在播放页 mode pill
  if (npModePill) {
    npModePill.textContent = radioOn
      ? `📻 ${getModeLabel(currentMode)}`
      : `电台模式：关闭`;
    npModePill.style.opacity = radioOn ? '1' : '0.5';
  }
}

function setRadio(on, modeKey = null, opts = {}) {
  const explicitModeChange = modeKey && (!radioOn || modeKey !== currentMode);
  // 模式变了 / 关电台 → 之前预取的下一首不再合用，作废（含飞行中）
  if (!on || explicitModeChange) invalidatePrefetch();
  // 显式切到新模式 → 清空播放列表，让新模式从干净状态起步
  // （关电台 / 页面重启恢复都不清，避免误删用户手动构建的队列）
  if (explicitModeChange) window.player?.setQueue?.([], 0);
  radioOn = on;
  if (modeKey) {
    currentMode = modeKey;
    localStorage.setItem('claudio_radio_mode', modeKey);
  }
  localStorage.setItem('claudio_radio_on', on ? '1' : '0');
  renderUi();
  if (on) {
    window.showToast?.(`📻 电台开启 · ${getModeLabel(currentMode)}`);
    if (explicitModeChange || opts.forcePick) {
      pickAndPlay();
    } else {
      const cur = window.player?.getCurrentSong?.();
      const audio = window.__claudioAudio;
      if (!cur || (audio && audio.paused)) {
        pickAndPlay();
      }
    }
  } else {
    window.showToast?.('电台模式已关闭');
  }
}

// 当前模式 key（供 player.js 写 history 使用）
window.getCurrentRadioMode = () => (radioOn ? currentMode : null);

// ========== 模式 MD 编辑器 ==========
const modeEditPanel = document.getElementById('modeEditPanel');
const modeEditTextarea = document.getElementById('modeEditTextarea');
const modeEditTitle = document.getElementById('modeEditTitle');
const modeEditSaveBtn = document.getElementById('modeEditSaveBtn');
const modeEditLearnBtn = document.getElementById('modeEditLearnBtn');
const modeEditStatus = document.getElementById('modeEditStatus');
let editingModeKey = null;

async function openModeEditor(key) {
  editingModeKey = key;
  modeEditTitle.textContent = `编辑「${getModeLabel(key)}」偏好`;
  modeEditStatus.textContent = '加载中…';
  modeEditPanel.style.display = 'flex';
  try {
    const data = await server.get(`/api/radio/modes/${key}/md`);
    modeEditTextarea.value = data.content || '';
    modeEditStatus.textContent = '';
  } catch (e) {
    modeEditStatus.textContent = '加载失败';
  }
}

modeEditSaveBtn?.addEventListener('click', async () => {
  if (!editingModeKey) return;
  modeEditStatus.textContent = '保存中…';
  try {
    await server.put(`/api/radio/modes/${editingModeKey}/md`, { content: modeEditTextarea.value });
    modeEditStatus.textContent = `✓ 已保存 · ${new Date().toLocaleTimeString('zh-CN')}`;
    window.showToast?.('偏好已保存，AI 会用新偏好推下一首');
  } catch {
    modeEditStatus.textContent = '保存失败';
  }
});

modeEditLearnBtn?.addEventListener('click', async () => {
  if (!editingModeKey) return;
  modeEditLearnBtn.disabled = true;
  modeEditStatus.textContent = '学习中…（10-20 秒）';
  try {
    const r = await server.post(`/api/radio/modes/${editingModeKey}/learn`, {});
    if (r.ok) {
      modeEditStatus.textContent = `✓ 已基于 ${r.samples} 条数据学习并更新 AUTO-LEARN 区块`;
      // 重新加载 textarea
      const data = await server.get(`/api/radio/modes/${editingModeKey}/md`);
      modeEditTextarea.value = data.content || '';
    } else {
      modeEditStatus.textContent = `跳过：${r.error}`;
    }
  } catch (e) {
    modeEditStatus.textContent = '学习失败：' + e.message;
  }
  modeEditLearnBtn.disabled = false;
});

modeEditPanel?.addEventListener('click', (e) => {
  if (e.target === modeEditPanel) modeEditPanel.style.display = 'none';
});

// ========== 加载模式列表 ==========
async function loadModes() {
  try {
    modesList = await server.get('/api/radio/modes');
  } catch {
    modesList = [
      { key: 'default', label: '默认（习惯学习）' },
      { key: 'work', label: '工作模式' },
      { key: 'workout', label: '运动模式' },
      { key: 'drive', label: '驾驶模式' },
      { key: 'relax', label: '休息模式' },
      { key: 'sleep', label: '睡前模式' }
    ];
  }
  if (!modeListEl) return;
  modeListEl.innerHTML = modesList.map(m => `
    <button class="mode-item ${m.key === currentMode ? 'active' : ''}" data-key="${m.key}">
      <span class="mode-item-icon">${MODE_ICONS[m.key] || '🎵'}</span>
      <span class="mode-item-label">${m.label}</span>
      <button class="mode-item-edit" data-key="${m.key}" title="编辑这个模式的偏好">✎</button>
    </button>
  `).join('');
  modeListEl.querySelectorAll('.mode-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // 点 ✎ 不触发模式切换
      if (e.target.classList.contains('mode-item-edit')) {
        e.stopPropagation();
        openModeEditor(e.target.dataset.key);
        return;
      }
      const key = el.dataset.key;
      if (radioOn && key === currentMode) {
        setRadio(false);
      } else {
        setRadio(true, key);
      }
    });
  });
  renderUi();
}

// 顶栏开关
toggleSwitch?.addEventListener('change', () => setRadio(toggleSwitch.checked));

// ========== 习惯快照 ==========
async function refreshHabit() {
  if (!habitMini) return;
  try {
    const h = await server.get('/api/radio/habit-snapshot');
    habitMini.innerHTML = `
      <div style="font-size:10px;color:var(--text-muted);line-height:1.6">
        <div style="color:var(--accent-bright);font-weight:500">${h.weekdayType} · ${h.timeBucket}</div>
        <div>历史 ${h.sampleSize} 条</div>
        ${h.topArtists?.length ? `<div style="margin-top:2px;color:var(--text-secondary)">${h.topArtists.slice(0,2).join(' · ')}</div>` : ''}
      </div>
    `;
  } catch {
    habitMini.innerHTML = '<span style="font-size:10px;color:var(--text-muted)">习惯快照加载失败</span>';
  }
}

// ========== 跟踪最近播过的 + 启动预取 ==========
window.addEventListener('songchange', (e) => {
  const s = e.detail;
  if (!s) return;
  recentPlayed = [s, ...recentPlayed.filter(x => x.id !== s.id)].slice(0, 10);
  // 新歌开始播放 → 任何"基于上一首上下文"的预取（已完成或飞行中）已过期，作废
  // 然后立即重启预取，下一首在用户随时可能跳歌之前就准备好
  if (radioOn) {
    invalidatePrefetch();
    prefetchNext();
  }
});

// ========== 预取下一首（含 TTS 串词音频）==========
// 一旦当前歌开始播放，就在后台把"下一首 + TTS 串词"都做好，
// 这样不论用户听完还是中途跳，切歌瞬间都没有等待。
let prefetched = null;     // { song, intro, ttsUrl, mode }
let prefetching = false;
let prefetchGen = 0;       // 代次：失效飞行中的过期预取请求

function clearPrefetch() {
  if (prefetched?.ttsUrl) {
    try { URL.revokeObjectURL(prefetched.ttsUrl); } catch {}
  }
  prefetched = null;
}

// 让所有"基于过去状态"的预取（已完成或飞行中）作废
function invalidatePrefetch() {
  prefetchGen++;
  prefetching = false;
  clearPrefetch();
}

// 拉下一首歌 + 预合成 TTS（独立逻辑，pickAndPlay 和 prefetch 共用）
async function fetchNextAndTts(opts = {}) {
  const currentSong = window.player?.getCurrentSong?.() || null;
  const data = await server.post('/api/radio/next', {
    mode: currentMode,
    currentSong,
    recent: recentPlayed.map(s => ({ name: s.name, artist: s.artist, id: s.id }))
  });
  if (data.error || !data.song) return { error: data.error || 'no song' };

  let ttsUrl = null;
  if (data.intro && !opts.skipTts) {
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.intro })
      });
      if (r.ok) {
        const blob = await r.blob();
        ttsUrl = URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn('[radio] 预合成 TTS 失败，回退到现合成:', e);
    }
  }
  return { song: data.song, intro: data.intro, ttsUrl };
}

async function prefetchNext() {
  if (prefetching || prefetched || busy || !radioOn) return;
  prefetching = true;
  const myGen = ++prefetchGen;
  const startMode = currentMode;
  try {
    const result = await fetchNextAndTts();
    // 飞行期间被 invalidatePrefetch 作废 / 模式变了 / 关了电台 → 丢弃结果
    if (myGen !== prefetchGen || currentMode !== startMode || !radioOn || result.error) {
      if (result?.ttsUrl) URL.revokeObjectURL(result.ttsUrl);
      if (result?.error) console.warn('[radio] prefetch failed:', result.error);
      return;
    }
    prefetched = { ...result, mode: startMode };
    console.log('[radio] 预取完成:', result.song.name, result.ttsUrl ? '(TTS 已就绪)' : '(无 TTS)');
  } catch (e) {
    console.warn('[radio] prefetch 异常:', e);
  } finally {
    // 仅当本次请求仍是最新代次才把 prefetching 复位
    // （如果中途被 invalidate 了，prefetching 已被它置 false，新请求可能已发起）
    if (myGen === prefetchGen) prefetching = false;
  }
}

// ========== 拉下一首 ==========
async function pickAndPlay(opts = {}) {
  if (busy) return;
  busy = true;

  let next = null;
  let usedPrefetch = false;
  const loadingToast = setTimeout(() => {
    if (!usedPrefetch) window.showToast?.('🎵 AI 正在为你挑歌...');
  }, 600);

  try {
    // 优先使用预取结果（仅当模式没变）
    if (prefetched && prefetched.mode === currentMode) {
      next = prefetched;
      prefetched = null;
      usedPrefetch = true;
    } else {
      // 预取过期/没就绪 → 作废飞行中的旧请求，走现拉
      invalidatePrefetch();
      next = await fetchNextAndTts({ skipTts: opts.skipIntro });
    }
    clearTimeout(loadingToast);

    if (next.error) {
      console.warn('radio/next 失败:', next.error);
      window.showToast?.('AI 推荐失败，电台模式暂停');
      setRadio(false);
      return;
    }

    const { song, intro, ttsUrl } = next;
    // 用 addToQueue 追加（不破坏用户手动加进来的队列内容）。
    // 索引正确性由 player.js 的 playSong 内同步逻辑保证。
    window.player?.addToQueue?.([song]);

    // 切模式时 skipIntro=true 立即播放（更快），歌曲间过渡才念串词
    if (intro && window.voice && !opts.skipIntro) {
      // 串词一开始播就把"下一首"的封面/歌名/歌手提前显示
      window.player?.previewSong?.(song);
      const playNow = () => {
        window.removeEventListener('voiceEnd', playNow);
        window.player?.playSong?.(song);
      };
      window.addEventListener('voiceEnd', playNow, { once: true });
      // 有预合成的音频 URL 就直接播；否则现合成
      if (ttsUrl) {
        window.voice.speakUrl(ttsUrl);
      } else {
        window.voice.speak(intro);
      }
      setTimeout(() => {
        if (window.player?.getCurrentSong?.()?.id !== song.id) {
          window.removeEventListener('voiceEnd', playNow);
          window.player?.playSong?.(song);
        }
      }, 15000);
    } else {
      // 跳过串词时，如果还残留了预取的 TTS blob，回收
      if (ttsUrl) try { URL.revokeObjectURL(ttsUrl); } catch {}
      window.player?.playSong?.(song);
    }
  } catch (e) {
    clearTimeout(loadingToast);
    console.warn('电台模式异常:', e);
    window.showToast?.('AI 推荐失败');
  } finally {
    setTimeout(() => { busy = false; }, 1500);
  }
}

function attachAudioListener() {
  const audio = window.__claudioAudio || document.querySelector('audio');
  if (!audio) {
    setTimeout(attachAudioListener, 500);
    return;
  }
  audio.addEventListener('ended', () => {
    if (!radioOn) return;
    // 给 player.js 自身的 ended 处理一点时间（它会消费队列里的下一首）
    // 之后如果队列空了 + 还没新歌开始 → 由电台模式拉下一首
    setTimeout(() => {
      const queue = window.player?.getQueue?.() || [];
      // 队列空 + 当前歌仍是刚结束的那首（说明 player.js 没接上下一首） → 我们接管
      if (queue.length === 0 && audio.paused) {
        pickAndPlay({ skipIntro: false });
      }
    }, 800);
  });
}

attachAudioListener();
loadModes().then(refreshHabit);
setInterval(refreshHabit, 30 * 60 * 1000); // 每 30 分钟刷新习惯快照

// 恢复上次状态
if (localStorage.getItem('claudio_radio_on') === '1') {
  setTimeout(() => setRadio(true), 500);
}

// ========== 暴露 ==========
window.radio = {
  setRadio,
  pickAndPlay,
  isOn: () => radioOn,
  getMode: () => currentMode,
  openModeEditor
};
