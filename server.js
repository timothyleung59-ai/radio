require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 确保 data 目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 初始化 SQLite 数据库
const dbPath = path.join(dataDir, 'claudio.db');
const db = new Database(dbPath);

// 启用 WAL 模式提升性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 创建数据表
db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    song_id TEXT PRIMARY KEY,
    song_name TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT,
    song_name TEXT,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlist_songs (
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT,
    song_name TEXT,
    artist TEXT,
    album TEXT,
    cover_url TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (playlist_id, song_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    song_cards TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playback_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    current_song_id TEXT,
    current_song_name TEXT,
    current_song_artist TEXT,
    current_song_album TEXT,
    current_song_cover TEXT,
    progress_seconds REAL DEFAULT 0,
    queue_song_ids TEXT,
    queue_index INTEGER DEFAULT 0,
    play_mode TEXT DEFAULT 'off',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 插入默认偏好
const upsertPref = db.prepare('INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)');
upsertPref.run('theme', 'dark');
upsertPref.run('volume', '0.8');

// 插入默认播放状态
db.prepare('INSERT OR IGNORE INTO playback_state (id) VALUES (1)').run();

console.log('数据库初始化完成');

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== 收藏 API ==========
app.get('/api/favorites', (req, res) => {
  const rows = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
  res.json(rows);
});

// 同步收藏到网易云「我喜欢的音乐」（需要 cookie）
// like=true → 加入；like=false → 移除
async function syncNeteaseLike(songId, like) {
  if (!NETEASE_COOKIE) return { ok: false, error: 'no_cookie' };
  if (!songId) return { ok: false, error: 'no_song_id' };
  try {
    const url = neteaseUrl('/like', { id: songId, like: String(like), timestamp: Date.now() });
    const r = await fetch(url);
    const data = await r.json();
    if (data.code === 200) return { ok: true };
    return { ok: false, error: data.message || `code=${data.code}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

app.post('/api/favorites', async (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  db.prepare('INSERT OR REPLACE INTO favorites (song_id, song_name, artist, album, cover_url) VALUES (?, ?, ?, ?, ?)')
    .run(song_id, song_name, artist, album, cover_url);
  // 同步到网易云（失败也不阻塞本地收藏）
  const sync = await syncNeteaseLike(song_id, true);
  res.json({ ok: true, netease: sync });
});

app.delete('/api/favorites/:songId', async (req, res) => {
  const songId = req.params.songId;
  db.prepare('DELETE FROM favorites WHERE song_id = ?').run(songId);
  const sync = await syncNeteaseLike(songId, false);
  res.json({ ok: true, netease: sync });
});

// ========== 播放历史 API ==========
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = db.prepare('SELECT * FROM play_history ORDER BY played_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

// 兼容旧表：尝试加 mode 列（已存在则忽略）
try { db.exec('ALTER TABLE play_history ADD COLUMN mode TEXT'); } catch {}

app.post('/api/history', (req, res) => {
  const { song_id, song_name, artist, album, cover_url, mode } = req.body;
  db.prepare('INSERT INTO play_history (song_id, song_name, artist, album, cover_url, mode) VALUES (?, ?, ?, ?, ?, ?)')
    .run(song_id, song_name, artist, album, cover_url, mode || null);
  res.json({ ok: true });
});

// ========== 歌单 API ==========
app.get('/api/playlists', (req, res) => {
  const rows = db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/playlists', (req, res) => {
  const { name, type } = req.body;
  const result = db.prepare('INSERT INTO playlists (name, type) VALUES (?, ?)').run(name, type || 'user');
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get('/api/playlists/:id', (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: '歌单不存在' });
  const songs = db.prepare('SELECT * FROM playlist_songs WHERE playlist_id = ? ORDER BY sort_order').all(req.params.id);
  res.json({ ...playlist, songs });
});

app.post('/api/playlists/:id/songs', (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM playlist_songs WHERE playlist_id = ?').get(req.params.id);
  const order = (maxOrder?.m || 0) + 1;
  db.prepare('INSERT OR REPLACE INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, song_id, song_name, artist, album, cover_url, order);
  res.json({ ok: true });
});

app.delete('/api/playlists/:id/songs/:songId', (req, res) => {
  db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?')
    .run(req.params.id, req.params.songId);
  res.json({ ok: true });
});

// ========== 偏好 API ==========
app.get('/api/preferences', (req, res) => {
  const rows = db.prepare('SELECT * FROM preferences').all();
  const prefs = {};
  rows.forEach(r => prefs[r.key] = r.value);
  res.json(prefs);
});

app.put('/api/preferences', (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)');
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) {
      stmt.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  });
  tx(req.body);
  res.json({ ok: true });
});

// ========== 播放状态 API ==========
app.get('/api/playback-state', (req, res) => {
  const state = db.prepare('SELECT * FROM playback_state WHERE id = 1').get();
  res.json(state);
});

app.put('/api/playback-state', (req, res) => {
  const { current_song_id, current_song_name, current_song_artist, current_song_album, current_song_cover, progress_seconds, queue_song_ids, queue_index, play_mode } = req.body;
  db.prepare(`UPDATE playback_state SET
    current_song_id=?, current_song_name=?, current_song_artist=?, current_song_album=?, current_song_cover=?,
    progress_seconds=?, queue_song_ids=?, queue_index=?, play_mode=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=1`)
    .run(current_song_id, current_song_name, current_song_artist, current_song_album, current_song_cover,
      progress_seconds, JSON.stringify(queue_song_ids), queue_index, play_mode);
  res.json({ ok: true });
});

// ========== 聊天历史 API ==========
app.get('/api/chat/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const rows = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.reverse());
});

// 清空聊天历史
app.delete('/api/chat/history', (req, res) => {
  const result = db.prepare('DELETE FROM chat_messages').run();
  res.json({ ok: true, deleted: result.changes });
});

// ========== 配置 API ==========
const configDir = path.join(__dirname, 'config');

app.get('/api/config', (req, res) => {
  const files = ['agent.md', 'taste.md', 'routines.md', 'moodrules.md'];
  const config = {};
  for (const f of files) {
    const fp = path.join(configDir, f);
    config[f.replace('.md', '')] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  }
  res.json(config);
});

app.post('/api/config/:filename', (req, res) => {
  const allowed = ['agent.md', 'taste.md', 'routines.md', 'moodrules.md'];
  if (!allowed.includes(req.params.filename)) return res.status(400).json({ error: '不允许的文件' });
  fs.writeFileSync(path.join(configDir, req.params.filename), req.body.content || '');
  res.json({ ok: true });
});

// ========== 电台模式 MD 文件系统 ==========
// 每个模式一个 MD，用户可在 UI 编辑；AI 会作为 prompt context；后台 cron 自动追加学习
const modesDir = path.join(configDir, 'modes');
if (!fs.existsSync(modesDir)) fs.mkdirSync(modesDir, { recursive: true });

const MODE_MD_DEFAULTS = {
  default: `# 默认模式（习惯学习）

## 用户偏好（手动编辑）
- 我倾向于：
- 不太喜欢：

## 听歌场景习惯
- 工作日早晨：
- 工作日下午：
- 工作日晚间：
- 周末白天：
- 周末晚上：

<!-- AI 学习区（AI 自动追加，不要手动改）-->
<!-- AUTO-LEARN-START -->
（暂无学习数据）
<!-- AUTO-LEARN-END -->
`,
  work: `# 工作模式

## 我希望工作时听到
- 风格倾向：lo-fi / 氛围电子 / 纯器乐 / 爵士钢琴
- 节奏偏好：BPM 70-110，平稳
- 避开：高情绪人声、说唱、躁动节拍

## 我喜欢的工作背景音艺术家
- Nujabes
- Tycho
- 桑田佳祐（instrumental）
- （在这里加你自己的）

## 我不喜欢工作时听的
-

<!-- AUTO-LEARN-START -->
（暂无学习数据）
<!-- AUTO-LEARN-END -->
`,
  workout: `# 运动模式

## 我希望运动时听到
- 风格倾向：EDM / 嘻哈 / 摇滚 / Future Bass
- 节奏偏好：BPM 120-160，鼓点厚重
- 副歌带感、激励性强

## 我喜欢的运动歌单艺术家
- Imagine Dragons
- Eminem
- Calvin Harris
-

## 我不喜欢运动时听的
-

<!-- AUTO-LEARN-START -->
（暂无学习数据）
<!-- AUTO-LEARN-END -->
`,
  drive: `# 驾驶模式

## 我希望驾驶时听到
- 风格倾向：经典摇滚 / City Pop / 80s synthwave / 副歌跟唱型 Anthem
- 中速节奏，主旋律突出

## 我喜欢的开车歌单艺术家
- 五月天
- Coldplay
- Bon Jovi
-

## 我不喜欢开车时听的
-

<!-- AUTO-LEARN-START -->
（暂无学习数据）
<!-- AUTO-LEARN-END -->
`,
  relax: `# 休息模式

## 我希望休息时听到
- 风格倾向：indie folk / bossa nova / city pop 慢拍 / 轻爵士
- BPM 60-95，柔和

## 我喜欢的放松艺术家
- 陈绮贞
- 蔡健雅
- Norah Jones
-

## 我不喜欢休息时听的
-

<!-- AUTO-LEARN-START -->
（暂无学习数据）
<!-- AUTO-LEARN-END -->
`,
  sleep: `# 睡前模式

## 我希望睡前听到
- 风格倾向：Ambient / newage / 古典钢琴 / 白噪音流
- BPM ≤ 70，结构平稳，无刺激高频

## 我喜欢的助眠艺术家
- Yiruma
- 久石让
- Ludovico Einaudi
-

## 我不喜欢睡前听的
- 强人声、节奏剧烈

<!-- AUTO-LEARN-START -->
（暂无学习数据）
<!-- AUTO-LEARN-END -->
`
};

const ALLOWED_MODE_KEYS = Object.keys(MODE_MD_DEFAULTS);

function modeFile(key) {
  return path.join(modesDir, `${key}.md`);
}

function ensureModeMd(key) {
  const fp = modeFile(key);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, MODE_MD_DEFAULTS[key] || `# ${key}\n`, 'utf-8');
  }
  return fp;
}

function readModeMd(key) {
  const fp = ensureModeMd(key);
  return fs.readFileSync(fp, 'utf-8');
}

// 启动时确保所有模式 MD 都存在
ALLOWED_MODE_KEYS.forEach(ensureModeMd);

app.get('/api/radio/modes/:key/md', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED_MODE_KEYS.includes(key)) return res.status(400).json({ error: '未知模式' });
  res.json({ key, content: readModeMd(key) });
});

app.put('/api/radio/modes/:key/md', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED_MODE_KEYS.includes(key)) return res.status(400).json({ error: '未知模式' });
  const content = req.body?.content;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content 必须是字符串' });
  fs.writeFileSync(modeFile(key), content, 'utf-8');
  res.json({ ok: true });
});

// ========== 环境变量配置 API ==========
const envPath = path.join(__dirname, '.env');
const MASK = '***已设置***';

app.get('/api/env-config', (req, res) => {
  res.json({
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? MASK : '',
    NETEASE_API: process.env.NETEASE_API || '',
    NETEASE_COOKIE: process.env.NETEASE_COOKIE ? MASK : ''
  });
});

app.put('/api/env-config', (req, res) => {
  const { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, NETEASE_API, NETEASE_COOKIE } = req.body;

  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  const updates = { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, NETEASE_API, NETEASE_COOKIE };
  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined || val === MASK) continue; // 跳过未修改的敏感字段
    process.env[key] = val;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${val}`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, line);
    } else {
      envContent += (envContent.endsWith('\n') ? '' : '\n') + line + '\n';
    }
  }

  fs.writeFileSync(envPath, envContent);
  res.json({ ok: true });
});

// ========== TTS 代理（火山引擎 V1 + V3 双向流式 / 小米 MiMo） ==========
// 自动路由：voice 带 _bigtts → V3 WebSocket；否则 → V1 HTTP
const { ttsBigtts } = require('./tts-bigtts');

async function ttsViaVolcBigtts(text) {
  const apiKey = process.env.VOLC_API_KEY;                      // 新版控制台
  const appid = process.env.VOLC_APPID;                         // 旧版控制台
  const token = process.env.VOLC_ACCESS_TOKEN;                  // 旧版控制台
  const voiceType = process.env.VOLC_VOICE_TYPE;
  const resourceId = process.env.VOLC_RESOURCE_ID || 'seed-tts-2.0';
  const model = process.env.VOLC_MODEL || undefined;            // 可选: seed-tts-1.1 / seed-tts-2.0-expressive ...

  if (!apiKey && !(appid && token)) {
    return { status: 503, error: 'TTS 未配置：请在 .env 设置 VOLC_API_KEY，或同时设置 VOLC_APPID 和 VOLC_ACCESS_TOKEN' };
  }
  try {
    return await ttsBigtts({
      text,
      apiKey,
      appid, accessToken: token,
      resourceId, voiceType, model,
      // 文档：speech_rate/loudness_rate 取值 [-50,100]，0 表示正常
      speed:  parseFloat(process.env.VOLC_SPEED  || '0'),
      volume: parseFloat(process.env.VOLC_VOLUME || '0'),
      debug: process.env.VOLC_DEBUG === '1',
    });
  } catch (e) {
    return { status: 502, error: '大模型 TTS 失败: ' + e.message };
  }
}

async function ttsViaVolc(text) {
  const appid = process.env.VOLC_APPID;
  const token = process.env.VOLC_ACCESS_TOKEN;
  const cluster = process.env.VOLC_CLUSTER || 'volcano_tts';
  const voiceType = process.env.VOLC_VOICE_TYPE || 'BV001_streaming';
  if (!appid || !token) return { status: 503, error: 'TTS 未配置，请在 .env 设置 VOLC_APPID 和 VOLC_ACCESS_TOKEN' };

  // 仅当显式声明 V3 时才走 WebSocket；默认走 V1 HTTP（1.0 _bigtts 音色 V1 直接支持）
  if (process.env.VOLC_USE_V3 === '1') {
    return await ttsViaVolcBigtts(text);
  }

  const reqid = require('crypto').randomUUID();
  const r = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer;${token}` // 火山要求格式
    },
    body: Buffer.from(JSON.stringify({
      app: { appid, token, cluster },
      user: { uid: 'claudio_fm_user' },
      audio: {
        voice_type: voiceType,
        encoding: 'mp3',
        speed_ratio: parseFloat(process.env.VOLC_SPEED || '1.0'),
        volume_ratio: parseFloat(process.env.VOLC_VOLUME || '1.0'),
        pitch_ratio: parseFloat(process.env.VOLC_PITCH || '1.0')
      },
      request: { reqid, text, operation: 'query' }
    }), 'utf-8')
  });
  const data = await r.json();
  if (data.code !== 3000 || !data.data) {
    return { status: 502, error: data.message || '火山 TTS 错误', detail: data };
  }
  return { contentType: 'audio/mpeg', buffer: Buffer.from(data.data, 'base64') };
}

async function ttsViaMimo(text, style) {
  const apiKey  = process.env.MIMO_API_KEY;
  const baseUrl = (process.env.MIMO_TTS_BASE_URL || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '');
  const model   = process.env.MIMO_TTS_MODEL  || 'mimo-v2.5-tts';
  const voice   = process.env.MIMO_TTS_VOICE  || 'mimo_default';
  const format  = (process.env.MIMO_TTS_FORMAT || 'wav').toLowerCase();
  if (!apiKey) return { status: 503, error: 'TTS 未配置，请在 .env 设置 MIMO_API_KEY' };

  const messages = [];
  if (style) messages.push({ role: 'user', content: style });
  messages.push({ role: 'assistant', content: text });

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model, messages,
      audio: { format: format === 'pcm16' ? 'pcm16' : 'wav', voice }
    })
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    return { status: 502, error: `MiMo TTS 返回 ${r.status}`, detail: errBody };
  }
  const data = await r.json();
  const b64 = data?.choices?.[0]?.message?.audio?.data;
  if (!b64) return { status: 502, error: 'MiMo TTS 未返回音频', detail: data };
  const contentType = format === 'pcm16' ? 'application/octet-stream' : 'audio/wav';
  return { contentType, buffer: Buffer.from(b64, 'base64') };
}

app.post('/api/tts', async (req, res) => {
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'text 不能为空' });
  if (text.length > 1024) return res.status(413).json({ error: 'text 过长（最多 1024 字符）' });

  const provider = (process.env.TTS_PROVIDER || 'volc').toLowerCase();
  const style = (req.body?.style ?? process.env.MIMO_TTS_STYLE ?? '').toString().trim();

  try {
    let result;
    if (provider === 'mimo') {
      result = await ttsViaMimo(text, style);
    } else {
      // 默认走火山；如果火山未配置且 MIMO 已配置，自动 fallback 到 MiMo
      result = await ttsViaVolc(text);
      if (result.status === 503 && process.env.MIMO_API_KEY) {
        console.log('[tts] 火山未配置，自动 fallback 到 MiMo');
        result = await ttsViaMimo(text, style);
      }
    }
    if (result.error) {
      console.error('[tts] 失败:', result.error, result.detail || '');
      return res.status(result.status || 500).json({ error: result.error, detail: result.detail });
    }
    res.set('Content-Type', result.contentType);
    res.set('Content-Length', result.buffer.length);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.buffer);
  } catch (e) {
    console.error('TTS 调用异常:', e);
    res.status(500).json({ error: 'TTS 调用异常: ' + e.message });
  }
});

// ========== 网易云 API 代理（避免浏览器 CORS） ==========
const NETEASE_API = process.env.NETEASE_API || 'http://192.168.5.103:3000';
const NETEASE_COOKIE = process.env.NETEASE_COOKIE || '';

// 构建带 cookie 的请求 URL
function neteaseUrl(path, params = {}) {
  const url = new URL(path, NETEASE_API);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  if (NETEASE_COOKIE) url.searchParams.set('cookie', NETEASE_COOKIE);
  return url.toString();
}

// 服务端解析歌曲：AI 返回的歌名 → 网易云真实数据
async function resolveSong(song) {
  try {
    const keyword = `${song.name || ''} ${song.artist || ''}`.trim();
    if (!keyword) return song;
    const r = await fetch(neteaseUrl('/cloudsearch', { keywords: keyword, type: 1, limit: 3 }));
    const data = await r.json();
    const results = data?.result?.songs || [];
    const match = results.find(r => r.name === song.name) || results[0];
    if (!match) return song;
    const cover = match.al?.picUrl || '';
    return { id: String(match.id), name: match.name, artist: (match.ar || []).map(a => a.name).join('/'), album: match.al?.name || '', cover, reason: song.reason || '' };
  } catch { return song; }
}

app.get('/api/netease/search', async (req, res) => {
  try {
    const { keywords, limit = 20 } = req.query;
    const r = await fetch(neteaseUrl('/cloudsearch', { keywords, type: 1, limit }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/song/url', async (req, res) => {
  try {
    const { id, br = 320000 } = req.query;
    const r = await fetch(neteaseUrl('/song/url', { id, br }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/lyric', async (req, res) => {
  try {
    const r = await fetch(neteaseUrl('/lyric', { id: req.query.id }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/personalized', async (req, res) => {
  try {
    const r = await fetch(neteaseUrl('/personalized', { limit: req.query.limit || 10 }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/netease/playlist/detail', async (req, res) => {
  try {
    const r = await fetch(neteaseUrl('/playlist/detail', { id: req.query.id }));
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 当前登录用户信息（用 .env 里的 NETEASE_COOKIE 鉴权）
app.get('/api/netease/login-status', async (req, res) => {
  try {
    if (!NETEASE_COOKIE) return res.json({ logged_in: false });
    const r = await fetch(neteaseUrl('/login/status'));
    const data = await r.json();
    const profile = data.data?.profile;
    if (!profile) return res.json({ logged_in: false });
    res.json({
      logged_in: true,
      user_id: profile.userId,
      nickname: profile.nickname,
      avatar: profile.avatarUrl,
      vip_type: data.data?.account?.vipType || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== AI 电台：基于上下文持续推下一首 ==========

// 模式 → 选歌风格 + DJ 说话风格
const RADIO_MODES = {
  default: {
    label: '默认（习惯学习）',
    style: '根据下方"听歌习惯"切片自然延续，匹配用户当前时段品味。',
    patterTone: '像私人电台老朋友：自然、慵懒、有温度，可以提到时段（"这个晚上"）和心情；语速适中。'
  },
  work: {
    label: '工作模式',
    style: '专注/沉浸：lo-fi、轻氛围电子、纯器乐、爵士钢琴、neo-soul instrumental。避开高情绪人声、说唱、躁动节拍。BPM 70-110。',
    patterTone: '低声专业、克制：像深夜书房电台 DJ，几乎是耳语，不打断思路；句子简短，不煽情；多用专注/聚焦/节奏类词。'
  },
  workout: {
    label: '运动模式',
    style: '高能量爆发：EDM、嘻哈、摇滚、Future Bass、电子 K-Pop。BPM 120-160，鼓点厚重，副歌带感。',
    patterTone: '热血高能、嗨喊：像健身房教练 + 体育解说混合体，激励性强，"准备好了吗""加大马力"，多用感叹号语气；语速偏快。'
  },
  drive: {
    label: '驾驶模式',
    style: '公路片质感：经典摇滚、流行 Rock、City Pop、80s synthwave、副歌容易跟唱的 Anthem。中速节奏，主旋律突出。',
    patterTone: '老派 FM 公路电台：松弛、稳健、有点磁性，可以提到风、夜路、引擎；像 90s 香港夜场 DJ。'
  },
  relax: {
    label: '休息模式',
    style: '放松治愈：indie folk、bossa nova、citypop 慢拍、轻爵士、温柔人声。BPM 60-95，柔和不刺激。',
    patterTone: '温柔治愈、轻松随意：像周末午后咖啡馆电台主持，语速慢，常提到放松、午后、阳光、咖啡。'
  },
  sleep: {
    label: '睡前模式',
    style: 'Ambient、newage、古典钢琴、白噪音流、轻柔大提琴、睡眠音乐。BPM ≤ 70，无刺激高频，结构平稳。',
    patterTone: '极轻柔耳语：像 ASMR 主播，句子非常短，多用"放松""沉入""闭上眼"，语气几乎贴近呼吸；不能激动。串场词控制在 25 字以内。'
  }
};

// 时段判断
function getTimeBucket(d = new Date()) {
  const h = d.getHours();
  if (h >= 6 && h < 10) return '早晨';
  if (h >= 10 && h < 12) return '上午';
  if (h >= 12 && h < 14) return '午餐时间';
  if (h >= 14 && h < 18) return '下午';
  if (h >= 18 && h < 20) return '晚饭时间';
  if (h >= 20 && h < 23) return '晚间';
  return '深夜';
}
function isWorkday(d = new Date()) {
  // 简化：周一到周五算工作日（不考虑节假日）
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

// 拉同时段听歌习惯切片：返回最常听的歌/艺术家
function buildHabitSnapshot() {
  const now = new Date();
  const bucket = getTimeBucket(now);
  const workday = isWorkday(now);

  // 拉所有历史，client 端筛同时段（SQLite 没好的方式直接 group by hour）
  const all = db.prepare("SELECT song_name, artist, played_at FROM play_history ORDER BY id DESC LIMIT 1000").all();
  const sameBucket = [];
  const sameBucketSameDay = [];
  for (const r of all) {
    if (!r.played_at) continue;
    const d = new Date(r.played_at.endsWith('Z') ? r.played_at : r.played_at + 'Z');
    const b = getTimeBucket(d);
    const w = isWorkday(d);
    if (b === bucket) {
      sameBucket.push(r);
      if (w === workday) sameBucketSameDay.push(r);
    }
  }

  // 优先按"同日类型 + 同时段"，不够再放宽到"任意日 + 同时段"
  const pool = sameBucketSameDay.length >= 5 ? sameBucketSameDay : sameBucket;

  // 按艺术家计数 top 5
  const artistCount = {};
  for (const r of pool) {
    artistCount[r.artist] = (artistCount[r.artist] || 0) + 1;
  }
  const topArtists = Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);

  return {
    timeBucket: bucket,
    weekdayType: workday ? '工作日' : '休息日',
    sample: pool.slice(0, 8).map(r => `《${r.song_name}》${r.artist}`),
    topArtists,
    sampleSize: pool.length
  };
}

app.get('/api/radio/habit-snapshot', (req, res) => {
  res.json(buildHabitSnapshot());
});

app.get('/api/radio/modes', (req, res) => {
  res.json(Object.entries(RADIO_MODES).map(([key, m]) => ({ key, label: m.label })));
});

app.post('/api/radio/next', async (req, res) => {
  try {
    const recentPlayed = req.body?.recent || [];
    const currentSong = req.body?.currentSong || null;
    const seedTags = (req.body?.tags || []).slice(0, 5);
    const modeKey = req.body?.mode && RADIO_MODES[req.body.mode] ? req.body.mode : 'default';
    const mode = RADIO_MODES[modeKey];

    // 从聊天历史拉最近 6 条做上下文
    const recentChat = db.prepare('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 6').all().reverse();
    // 从喜欢的歌（本地）拉一些样本
    const localFavs = db.prepare('SELECT song_name, artist FROM favorites ORDER BY RANDOM() LIMIT 8').all();
    // 当前心情（按优先级链解析：用户输入 > 聊天上下文 > 播放行为）
    let curMood = null;
    try { curMood = await resolveMood(); } catch {}

    // 习惯切片（默认模式重点用，其他模式作辅助）
    const habit = buildHabitSnapshot();

    const ctx = [];
    ctx.push(`【当前模式】${mode.label}`);
    ctx.push(`【选歌风格】${mode.style}`);
    ctx.push(`【DJ 说话语调】${mode.patterTone}`);
    ctx.push(`【现在时间】${habit.weekdayType} · ${habit.timeBucket}`);
    if (currentSong) ctx.push(`【当前播放】《${currentSong.name}》— ${currentSong.artist}`);
    if (recentPlayed.length) ctx.push(`【刚听过的（不要重复）】${recentPlayed.slice(0, 6).map(s => `《${s.name}》${s.artist}`).join('; ')}`);

    if (modeKey === 'default') {
      if (habit.sample.length > 0) {
        ctx.push(`【你这个时段（${habit.weekdayType} ${habit.timeBucket}）的听歌习惯】基于 ${habit.sampleSize} 条历史:\n${habit.sample.join('; ')}\n常听艺术家: ${habit.topArtists.join('、') || '无'}`);
      } else {
        ctx.push(`【提示】这个时段还没足够的听歌历史，先按"喜欢的歌曲"风格推荐，逐步学习。`);
      }
    }

    // 模式专属偏好 MD（用户编辑 + AI 自动学习）
    try {
      const modeMd = readModeMd(modeKey);
      if (modeMd?.trim()) ctx.push(`【模式偏好（来自 modes/${modeKey}.md）】\n${modeMd}`);
    } catch {}

    if (localFavs.length) ctx.push(`【喜欢歌曲样本】${localFavs.map(s => `《${s.song_name}》${s.artist}`).join('; ')}`);
    if (seedTags.length) ctx.push(`【种子标签】${seedTags.join('、')}`);
    if (curMood?.mood) ctx.push(`【当前电台情绪】${curMood.mood} (${curMood.genre || ''})`);
    if (recentChat.length) ctx.push(`【最近聊天】\n${recentChat.map(c => `${c.role === 'user' ? '听众' : 'DJ'}: ${c.content.slice(0, 80)}`).join('\n')}`);
    if (configCache.taste) ctx.push(`【长期品味】\n${configCache.taste}`);

    const sysPrompt = `你是 Claudio FM 的 AI 电台 DJ。基于下方上下文为听众挑选下一首歌，并给一段串场词。

【硬规则 - 必须遵守】
- 严格输出 JSON，不要任何解释/markdown 包裹
- 只挑 1 首歌
- 不能与"刚听过的"重复
- 选歌必须严格符合【选歌风格】定义的风格基调
- 串场词必须严格符合【DJ 说话语调】的语气、风格、用词
- 串场词要像电台主持人在话筒前真说话，不是写稿；不要书面语
- 优先选用网易云上能找到的歌

【输出 schema】
{"song":{"name":"歌名","artist":"歌手"},"reason":"为何选这首（一句话内）","intro":"DJ 串场词（30-60字，严格按 DJ 说话语调写）"}`;

    const userPrompt = ctx.join('\n\n');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: sysPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    // 兼容多种 SDK 返回：Claude 标准、DeepSeek-Anthropic、reasoning blocks
    const blocks = response.content || [];
    let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    if (!text) {
      // 兜底：拼接所有有 text 字段的 block
      text = blocks.map(b => b.text || b.input || '').filter(Boolean).join('').trim();
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (!parsed?.song?.name) {
      console.warn('radio/next: AI 返回无法解析。raw blocks:', JSON.stringify(blocks).slice(0, 500));
      return res.status(502).json({ error: 'AI 返回格式异常', raw: text.slice(0, 300), blocks: blocks.length });
    }

    // 网易云搜索补全真实数据
    const resolved = await resolveSong(parsed.song);
    if (!resolved?.id) return res.status(404).json({ error: '网易云未找到这首歌', song: parsed.song });

    res.json({
      song: { id: resolved.id, name: resolved.name, artist: resolved.artist, album: resolved.album, cover: resolved.cover },
      reason: parsed.reason || '',
      intro: parsed.intro || `下面为你播放${resolved.artist}的《${resolved.name}》，请欣赏。`
    });
  } catch (e) {
    console.error('radio/next 失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== AI 给当前歌写一段 DJ 串词（当前歌已在播，不挑新歌）==========
app.post('/api/dj/intro', async (req, res) => {
  try {
    const song = req.body?.song;
    if (!song?.name) return res.status(400).json({ error: 'song 必填' });
    const modeKey = req.body?.mode && RADIO_MODES[req.body.mode] ? req.body.mode : 'default';
    const mode = RADIO_MODES[modeKey];

    let curMood = null;
    try { curMood = await resolveMood(); } catch {}
    const habit = buildHabitSnapshot();

    const ctx = [];
    ctx.push(`【当前模式】${mode.label}`);
    ctx.push(`【DJ 说话语调】${mode.patterTone}`);
    ctx.push(`【现在时间】${habit.weekdayType} · ${habit.timeBucket}`);
    ctx.push(`【这首歌】《${song.name}》— ${song.artist || '未知'}${song.album ? ` · ${song.album}` : ''}`);
    if (curMood?.mood) ctx.push(`【当前电台情绪】${curMood.mood} (${curMood.genre || ''})`);
    if (configCache.taste) ctx.push(`【长期品味】\n${configCache.taste}`);

    const sysPrompt = `你是 Claudio FM 的 AI 电台 DJ。听众点了"让 DJ 介绍这首"，请你用一段串场词介绍当前正在播放的这首歌。

【硬规则】
- 严格输出 JSON：{"intro":"..."}，不要任何解释/markdown 包裹
- 串场词 30-80 字，像电台主持人在话筒前真说话，不是写稿
- 严格按【DJ 说话语调】的语气、用词、节奏
- 可以聊歌手背景、歌曲故事、风格特征、当下听感，让听众更懂这首歌
- 不要出现"现在为您播放""敬请收听"这种生硬主持腔
- 不要复读歌名歌手三遍以上`;

    const userPrompt = ctx.join('\n\n');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: sysPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    const blocks = response.content || [];
    let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    if (!text) text = blocks.map(b => b.text || '').filter(Boolean).join('').trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    const intro = parsed?.intro?.trim();
    if (!intro) {
      // 兜底
      return res.json({ intro: `这首是${song.artist || ''}的《${song.name}》，希望你喜欢。` });
    }
    res.json({ intro });
  } catch (e) {
    console.error('dj/intro 失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== 电台情绪 (current_mood) ==========
// 优先级链：用户主动输入 > 跟 DJ 聊天上下文 > 最近一小时播放行为
// 存储格式：{ mood, genre, message, source: 'user'|'chat'|'playback', set_at: ISO, user_input?: string }
// TTL：user 4h，chat 30min，playback 30min（过期则降级到下一优先级）

const MOOD_TTL = { user: 4 * 3600 * 1000, chat: 30 * 60 * 1000, playback: 30 * 60 * 1000 };

function readStoredMood() {
  const row = db.prepare("SELECT value FROM preferences WHERE key = 'current_mood'").get();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function writeMood(data) {
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)')
    .run('current_mood', JSON.stringify(data));
}

function isMoodFresh(stored) {
  if (!stored?.set_at || !stored?.source) return false;
  const age = Date.now() - new Date(stored.set_at).getTime();
  const ttl = MOOD_TTL[stored.source] ?? MOOD_TTL.playback;
  return age < ttl;
}

async function callMoodAI(systemPrompt, userPrompt) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    const blocks = response.content || [];
    let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    if (!text) text = blocks.map(b => b.text || '').filter(Boolean).join('').trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (!parsed?.mood) return null;
    return { mood: String(parsed.mood).slice(0, 20), genre: parsed.genre || '', message: parsed.message || '' };
  } catch (e) {
    console.warn('mood AI 调用失败:', e.message);
    return null;
  }
}

const MOOD_SYSTEM_BASE = `你是 Claudio FM 的电台情绪判断器。
基于下方上下文判断用户当下的情绪状态，输出严格 JSON：
{"mood":"情绪标签（2-6字）","genre":"推荐曲风（一句话）","message":"一句话描述用户现在的状态（10-25字）"}
不要任何解释，不要 markdown 包裹。
情绪标签举例：放松、专注、焦虑、低落、兴奋、疲惫、思乡、想冲、平静、忧郁。`;

async function inferMoodFromUser(input) {
  if (!input?.trim()) return null;
  const ctx = [];
  ctx.push(`【用户主动输入】${input.trim()}`);
  if (configCache.moodrules) ctx.push(`【情绪规则参考】\n${configCache.moodrules}`);
  if (configCache.taste) ctx.push(`【长期品味参考】\n${configCache.taste}`);
  return await callMoodAI(MOOD_SYSTEM_BASE, ctx.join('\n\n'));
}

async function inferMoodFromChat() {
  // 最近 30 分钟的聊天
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const chats = db.prepare(`SELECT role, content, created_at FROM chat_messages WHERE created_at > ? ORDER BY id DESC LIMIT 12`).all(cutoff).reverse();
  if (chats.length < 2) return null;
  const dialog = chats.map(c => `${c.role === 'user' ? '听众' : 'DJ'}: ${c.content.slice(0, 120)}`).join('\n');
  const ctx = [`【最近半小时跟 DJ 的对话】\n${dialog}`];
  if (configCache.moodrules) ctx.push(`【情绪规则参考】\n${configCache.moodrules}`);
  return await callMoodAI(MOOD_SYSTEM_BASE + '\n聚焦于从对话内容推断当前情绪。', ctx.join('\n\n'));
}

async function inferMoodFromPlayback() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const plays = db.prepare(`SELECT song_name, artist, played_at FROM play_history WHERE played_at > ? ORDER BY id ASC LIMIT 60`).all(cutoff);
  if (plays.length < 2) return null;
  // 简易跳过判断：上一首跟下一首间隔 < 45s 视为跳过
  let skipped = 0;
  let totalSpan = 0;
  for (let i = 1; i < plays.length; i++) {
    const prev = new Date(plays[i-1].played_at.endsWith('Z') ? plays[i-1].played_at : plays[i-1].played_at + 'Z').getTime();
    const cur  = new Date(plays[i].played_at.endsWith('Z')  ? plays[i].played_at  : plays[i].played_at + 'Z').getTime();
    const gap = (cur - prev) / 1000;
    if (gap > 0 && gap < 45) skipped++;
    if (gap > 0) totalSpan += gap;
  }
  const artistCount = {};
  for (const r of plays) artistCount[r.artist] = (artistCount[r.artist] || 0) + 1;
  const topArtists = Object.entries(artistCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([a,c])=>`${a}×${c}`);
  const skipRate = plays.length > 1 ? (skipped / (plays.length - 1)) : 0;

  const ctx = [
    `【最近一小时播放行为】`,
    `- 总曲目数: ${plays.length}`,
    `- 估算跳过率: ${(skipRate*100).toFixed(0)}%（${skipped} 次连续切歌 < 45s）`,
    `- 听过的艺人 top: ${topArtists.join('、') || '无'}`,
    `- 歌曲列表：${plays.slice(-12).map(p => `《${p.song_name}》${p.artist}`).join('; ')}`
  ];
  if (configCache.taste) ctx.push(`【长期品味参考】\n${configCache.taste}`);
  return await callMoodAI(MOOD_SYSTEM_BASE + '\n聚焦于从播放行为推断当前情绪：跳过率高=不耐烦/找不到合心意；连续同艺人=沉浸；跨度大=随意听。', ctx.join('\n\n'));
}

// 主入口：按优先级链解析当前情绪。stored 新鲜 → 直接返回；否则尝试自动推断
async function resolveMood({ forceRefresh = false } = {}) {
  const stored = readStoredMood();
  if (!forceRefresh && stored && isMoodFresh(stored)) return stored;

  // 自动推断：先聊天，后播放
  let inferred = await inferMoodFromChat();
  let source = 'chat';
  if (!inferred) {
    inferred = await inferMoodFromPlayback();
    source = 'playback';
  }
  if (!inferred) {
    // 都失败：保留上一个旧值（带过期标记），或返回 null
    if (stored) return { ...stored, stale: true };
    return null;
  }
  const data = { ...inferred, source, set_at: new Date().toISOString() };
  writeMood(data);
  return data;
}

// 用户主动输入设置情绪
app.post('/api/mood', async (req, res) => {
  try {
    const input = (req.body?.input || '').toString().trim();
    if (!input) return res.status(400).json({ error: 'input 不能为空' });
    if (input.length > 500) return res.status(413).json({ error: 'input 过长' });
    const inferred = await inferMoodFromUser(input);
    if (!inferred) return res.status(502).json({ error: 'AI 解析失败' });
    const data = { ...inferred, source: 'user', set_at: new Date().toISOString(), user_input: input };
    writeMood(data);
    res.json(data);
  } catch (e) {
    console.error('POST /api/mood 失败:', e);
    res.status(500).json({ error: e.message });
  }
});

// 强制重新推断（跳过 user 设定，用于"AI 重判一次"按钮）
app.post('/api/mood/refresh', async (req, res) => {
  try {
    const data = await resolveMood({ forceRefresh: true });
    res.json(data || { error: '推断失败：无对话或播放数据' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清除用户设定，回退到自动推断
app.delete('/api/mood', async (req, res) => {
  const stored = readStoredMood();
  if (stored?.source === 'user') db.prepare("DELETE FROM preferences WHERE key = 'current_mood'").run();
  const data = await resolveMood();
  res.json(data || null);
});

// 读取当前情绪（按优先级链解析）
app.get('/api/mood', async (req, res) => {
  try {
    const data = await resolveMood();
    res.json(data || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 网易云"我喜欢"的歌曲 ID 列表（轻量端点，仅返回 id 数组用于判断收藏状态）
app.get('/api/netease/likelist', async (req, res) => {
  try {
    if (!NETEASE_COOKIE) return res.status(401).json({ error: '未配置 NETEASE_COOKIE' });
    // 1) 拿 uid
    const stat = await fetch(neteaseUrl('/login/status')).then(r => r.json());
    const uid = stat.data?.profile?.userId;
    if (!uid) return res.status(401).json({ error: 'Cookie 无效或已过期' });
    // 2) 拉 likelist（返回的 ids 是数字，前端做 String 比较时要 toString）
    const r = await fetch(neteaseUrl('/likelist', { uid })).then(r => r.json());
    const ids = (r.ids || []).map(String);
    res.json({ uid, ids, count: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 我喜欢的音乐（自动从用户第一个歌单拉取，最多 300 首）
app.get('/api/netease/me/likes', async (req, res) => {
  try {
    if (!NETEASE_COOKIE) return res.status(401).json({ error: '未配置 NETEASE_COOKIE' });
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);

    // 1) 拿 uid
    const stat = await fetch(neteaseUrl('/login/status')).then(r => r.json());
    const uid = stat.data?.profile?.userId;
    if (!uid) return res.status(401).json({ error: 'Cookie 无效或已过期' });

    // 2) 拿用户的歌单列表，第一个总是「我喜欢的音乐」
    const playlists = await fetch(neteaseUrl('/user/playlist', { uid, limit: 1 })).then(r => r.json());
    const myLike = playlists.playlist?.[0];
    if (!myLike) return res.status(404).json({ error: '未找到「我喜欢的音乐」歌单' });

    // 3) 拉这个歌单的全部 track
    const detail = await fetch(neteaseUrl('/playlist/track/all', { id: myLike.id, limit, offset: 0 })).then(r => r.json());
    const songs = (detail.songs || []).map(s => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar || []).map(a => a.name).join('/'),
      album: s.al?.name || '',
      cover: s.al?.picUrl || '',
      duration: Math.floor((s.dt || 0) / 1000)
    }));

    res.json({
      playlist_id: myLike.id,
      playlist_name: myLike.name,
      total: detail.songs?.length || 0,
      songs
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Mock 日历 API ==========
app.get('/api/schedule', (req, res) => {
  const fp = path.join(configDir, 'schedule.json');
  if (!fs.existsSync(fp)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
});

app.post('/api/schedule', (req, res) => {
  const fp = path.join(configDir, 'schedule.json');
  fs.writeFileSync(fp, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ========== 配置文件热加载 ==========
let configCache = {};

function loadConfigFiles() {
  const files = ['agent.md', 'taste.md', 'routines.md', 'moodrules.md'];
  for (const f of files) {
    const fp = path.join(configDir, f);
    configCache[f.replace('.md', '')] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  }
}
loadConfigFiles();

// 文件监听热重载
fs.watch(configDir, (event, filename) => {
  if (filename && filename.endsWith('.md')) {
    loadConfigFiles();
    console.log(`配置文件 ${filename} 已重新加载`);
  }
});

function buildSystemPrompt(currentSong, chatHistory) {
  const parts = [];
  if (configCache.agent) parts.push(configCache.agent);
  if (configCache.taste) parts.push(`## 音乐品味\n${configCache.taste}`);
  if (configCache.routines) parts.push(`## 行为习惯\n${configCache.routines}`);
  if (configCache.moodrules) parts.push(`## 情绪规则\n${configCache.moodrules}`);

  const now = new Date();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 周${weekDays[now.getDay()]} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  parts.push(`## 当前时间\n${timeStr}`);

  if (currentSong) {
    parts.push(`## 当前播放\n歌曲：${currentSong.name}，艺术家：${currentSong.artist}，专辑：${currentSong.album || '未知'}`);
  }

  parts.push(`## 回复格式
你必须以 JSON 格式回复，结构如下：
{
  "say": "你对用户说的话",
  "reason": "推荐理由（如果是推荐歌曲）",
  "play": [{"id": "网易云歌曲ID", "name": "歌曲名", "artist": "艺术家", "album": "专辑", "cover": "封面URL"}],
  "segue": "你想用语音说的内容（歌曲赏析、故事等，可以为空）",
  "memory": [{"file": "taste|routines|moodrules", "add": "要追加的一句话"}]
}

## memory 字段规则
- 当你从对话中发现用户的**新偏好、新习惯、新情绪模式**，且这些信息在上方 system prompt 中**没有出现过**，才放入 memory
- 已有的习惯和偏好不要重复写入，只写新的
- file 取值：
  - "taste"：音乐偏好（喜欢的曲风、歌手、歌曲）
  - "routines"：作息习惯（起床时间、工作时段、睡前习惯）
  - "moodrules"：情绪与场景规则（什么心情听什么、特定场景、特定时间段的音乐需求）
- 如果没有新发现，memory 返回空数组 []
- memory 不是每条必返，只有确实有新信息时才返回
只返回 JSON，不要包裹在 markdown 代码块中。`);

  return parts.join('\n\n');
}

// ========== 消息分流 ==========
const simpleCommands = {
  '下一首': () => ({ action: 'next' }),
  '上一首': () => ({ action: 'prev' }),
  '暂停': () => ({ action: 'pause' }),
  '随机播放': () => ({ action: 'shuffle' }),
};

const exactCommands = {
  '播放': () => ({ action: 'play' }),
};

app.post('/api/dispatch', async (req, res) => {
  const { message, currentSong } = req.body;

  // 精确指令检测
  if (exactCommands[message]) {
    return res.json({ type: 'command', ...exactCommands[message]() });
  }

  // 包含式指令检测
  for (const [keyword, handler] of Object.entries(simpleCommands)) {
    if (message.includes(keyword)) {
      return res.json({ type: 'command', ...handler() });
    }
  }

  // 音乐搜索检测
  if (message.startsWith('搜索') || (message.startsWith('播放') && message.length > 2)) {
    const keyword = message.replace(/^(搜索|播放)/, '').trim();
    if (keyword) {
      return res.json({ type: 'music_search', keyword });
    }
  }

  // 默认走 Claude
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });

    // 获取聊天历史
    const history = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 20').all().reverse();

    const messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));
    messages.push({ role: 'user', content: message });

    const systemPrompt = buildSystemPrompt(currentSong, history);

    const stream = await anthropic.messages.stream({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullContent = '';
    stream.on('text', (text) => {
      fullContent += text;
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('end', async () => {
      // 保存消息
      db.prepare('INSERT INTO chat_messages (role, content) VALUES (?, ?)').run('user', message);

      // 尝试解析结构化回复
      let parsed = null;
      try {
        parsed = JSON.parse(fullContent);
      } catch(e) {
        // 非 JSON 回复，当作纯文本
        parsed = { say: fullContent, reason: '', play: [], segue: '', memory: [] };
      }

      // 处理 memory 写入
      if (Array.isArray(parsed.memory) && parsed.memory.length > 0) {
        console.log(`[memory] AI 返回记忆:`, JSON.stringify(parsed.memory));
        const allowed = { taste: 'taste.md', routines: 'routines.md', moodrules: 'moodrules.md' };
        for (const m of parsed.memory) {
          if (m.file && m.add && allowed[m.file]) {
            const fp = path.join(__dirname, 'config', allowed[m.file]);
            fs.appendFileSync(fp, `\n- ${m.add.trim()}`, 'utf-8');
            console.log(`[memory] 写入 ${allowed[m.file]}: ${m.add.trim()}`);
          }
        }
        loadConfigFiles();
      }

      // 提取歌曲卡片，并通过网易云搜索补全真实数据
      const rawSongs = parsed.play || [];
      const songCards = rawSongs.length > 0
        ? await Promise.all(rawSongs.map(s => resolveSong(s)))
        : [];

      db.prepare('INSERT INTO chat_messages (role, content, song_cards) VALUES (?, ?, ?)')
        .run('assistant', fullContent, JSON.stringify(songCards));

      res.write(`data: ${JSON.stringify({ type: 'done', parsed, songCards })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('Claude API 错误:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('Claude API 错误:', err);
    res.status(500).json({ type: 'error', message: err.message });
  }
});

// ========== 定时任务 ==========
// 状态持久化到 preferences 表，重启不丢
function loadSchedulerStatus() {
  try {
    const row = db.prepare("SELECT value FROM preferences WHERE key='scheduler_status'").get();
    return row ? JSON.parse(row.value) : null;
  } catch { return null; }
}
function saveSchedulerStatus() {
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)')
    .run('scheduler_status', JSON.stringify(schedulerStatus));
}

let schedulerStatus = loadSchedulerStatus() || {
  dailyPlaylist: { lastRun: null, status: 'idle' },
  moodCheck: { lastRun: null, status: 'idle' },
  modeLearn: { lastRun: null, status: 'idle', perMode: {} },
  tasteProfile: { lastRun: null, status: 'idle' }
};
// 兼容老状态对象：补齐缺失字段
schedulerStatus.modeLearn ||= { lastRun: null, status: 'idle', perMode: {} };
schedulerStatus.tasteProfile ||= { lastRun: null, status: 'idle' };
// 启动时把 'running' 复位（防进程崩溃后卡死）
for (const k of Object.keys(schedulerStatus)) {
  if (schedulerStatus[k]?.status === 'running') schedulerStatus[k].status = 'idle';
}

function markStart(taskKey) {
  schedulerStatus[taskKey].status = 'running';
  saveSchedulerStatus();
}
function markDone(taskKey) {
  schedulerStatus[taskKey].lastRun = new Date().toISOString();
  schedulerStatus[taskKey].status = 'idle';
  saveSchedulerStatus();
}
function markError(taskKey, err) {
  schedulerStatus[taskKey].status = 'error';
  schedulerStatus[taskKey].lastError = err?.message || String(err);
  saveSchedulerStatus();
}

// === 任务 1：每日歌单推荐（每日 07:00） ===
async function runDailyPlaylist() {
  if (schedulerStatus.dailyPlaylist.status === 'running') return { ok: false, error: 'already running' };
  console.log('[task] daily-playlist start');
  markStart('dailyPlaylist');
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('未配置 AI Key');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
    const history = db.prepare('SELECT * FROM play_history ORDER BY played_at DESC LIMIT 50').all();

    const prompt = `根据以下信息，推荐今日歌单（10首歌），严格输出 JSON 数组（无 markdown 包裹）：
[{"id":"网易云歌曲ID（可空字符串，会自动搜）","name":"歌名","artist":"艺术家","album":"专辑","cover":"封面URL（可空）"}]

${configCache.taste ? '品味偏好：' + configCache.taste : ''}
最近听歌记录：${history.map(h => h.song_name + ' - ' + h.artist).join(', ')}`;

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 1536,
      messages: [{ role: 'user', content: prompt }]
    });
    const blocks = response.content || [];
    let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    if (!text) text = blocks.map(b => b.text || '').filter(Boolean).join('').trim();
    let songs = [];
    try { songs = JSON.parse(text); } catch {
      const m = text.match(/\[[\s\S]*\]/);
      if (m) try { songs = JSON.parse(m[0]); } catch {}
    }
    if (!Array.isArray(songs) || songs.length === 0) throw new Error('AI 返回无法解析');

    const result = db.prepare('INSERT INTO playlists (name, type) VALUES (?, ?)').run('今日推荐', 'daily');
    const playlistId = result.lastInsertRowid;
    // INSERT OR IGNORE 避免 song_id 为空 / 重复时撞 UNIQUE 索引
    const stmt = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
    songs.forEach((s, i) => {
      // 如果 AI 没给 id，用 sort_order 占位，保证唯一
      const sid = s.id ? String(s.id) : `_ai_${i}`;
      stmt.run(playlistId, sid, s.name, s.artist, s.album || '', s.cover || '', i);
    });

    markDone('dailyPlaylist');
    console.log(`[task] daily-playlist 完成（${songs.length} 首）`);
    return { ok: true, count: songs.length };
  } catch (err) {
    console.error('[task] daily-playlist 失败:', err.message);
    markError('dailyPlaylist', err);
    return { ok: false, error: err.message };
  }
}

// === 任务 2：每小时情绪检查 ===
async function runMoodCheck() {
  if (schedulerStatus.moodCheck.status === 'running') return { ok: false, error: 'already running' };
  console.log('[task] mood-check start');
  markStart('moodCheck');
  try {
    const data = await resolveMood();
    markDone('moodCheck');
    console.log(`[task] mood-check 完成: ${data?.mood || '(无)'} [source=${data?.source || 'none'}]`);
    return { ok: true, mood: data };
  } catch (err) {
    console.error('[task] mood-check 失败:', err.message);
    markError('moodCheck', err);
    return { ok: false, error: err.message };
  }
}

// === 任务 4：品味画像生成（每日 07:00 同时跑） ===
async function runTasteProfile() {
  if (schedulerStatus.tasteProfile.status === 'running') return { ok: false, error: 'already running' };
  console.log('[task] taste-profile start');
  markStart('tasteProfile');
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('未配置 AI Key');
    // 输入源：过去 3 天播放 + 最新 10 首收藏 + taste.md
    const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const history = db.prepare('SELECT song_name, artist FROM play_history WHERE played_at > ? ORDER BY played_at DESC LIMIT 200').all(cutoff);
    const favs = db.prepare('SELECT song_name, artist FROM favorites ORDER BY added_at DESC LIMIT 10').all();

    const artistCount = {};
    for (const r of history) artistCount[r.artist] = (artistCount[r.artist] || 0) + 1;
    const topArtists = Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, c]) => `${a}(${c})`);

    const ctx = [];
    if (configCache.taste) ctx.push(`【手动写的长期品味（taste.md）】\n${configCache.taste}`);
    ctx.push(`【过去 3 天播放总数】${history.length} 首`);
    if (topArtists.length) ctx.push(`【高频艺人（近 3 天）】${topArtists.join(', ')}`);
    if (history.length) ctx.push(`【近 3 天歌曲样本】${history.slice(0, 20).map(h => `《${h.song_name}》${h.artist}`).join('；')}`);
    if (favs.length) ctx.push(`【最新 10 首收藏】${favs.map(f => `《${f.song_name}》${f.artist}`).join('；')}`);

    if (history.length === 0 && favs.length === 0 && !configCache.taste) {
      throw new Error('数据不足：过去 3 天没播放，没收藏，且 taste.md 也是空');
    }

    const sysPrompt = `你是一个深度音乐品味分析师。基于下方多源材料，给用户写一段 120-200 字的品味画像。
- 用第二人称（"你"）
- 具体到艺人、流派、年代、情感倾向、典型场景
- 不要笼统话（如"你喜欢音乐"）
- 严格输出 JSON：{"description":"画像文本"}
- 不要 markdown / 不要解释`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: sysPrompt,
      messages: [{ role: 'user', content: ctx.join('\n\n') }]
    });
    const blocks = response.content || [];
    let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    if (!text) text = blocks.map(b => b.text || '').filter(Boolean).join('').trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    const description = parsed?.description?.trim() || text;
    if (!description) throw new Error('AI 返回为空');

    const profileData = {
      description,
      generated_at: new Date().toISOString(),
      based_on: { history_count: history.length, fav_count: favs.length }
    };
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('taste_profile', JSON.stringify(profileData));
    markDone('tasteProfile');
    console.log(`[task] taste-profile 完成（${description.length} 字，基于 ${history.length} 历史 + ${favs.length} 收藏）`);
    return { ok: true, description };
  } catch (err) {
    console.error('[task] taste-profile 失败:', err.message);
    markError('tasteProfile', err);
    return { ok: false, error: err.message };
  }
}

// ========== 模式 MD 自动学习 ==========
// 把 play_history 里每个模式过去 14 天的播放数据 → AI 总结 → 更新 MD 的 AUTO-LEARN 区块
async function autoLearnModeFromHistory(modeKey) {
  if (!ALLOWED_MODE_KEYS.includes(modeKey)) return { ok: false, error: '未知模式' };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: '未配置 AI Key' };

  // 这个模式过去 14 天的播放
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  let rows = db.prepare(`SELECT song_name, artist, played_at FROM play_history WHERE mode = ? AND played_at > ? ORDER BY played_at DESC LIMIT 200`).all(modeKey, cutoff);

  // 为 default 模式做兜底：如果严格匹配数据不足，把 mode IS NULL 的旧历史也算进来
  // （历史数据 mode 字段是后加的，存量记录都是 null）
  if (modeKey === 'default' && rows.length < 3) {
    rows = db.prepare(`SELECT song_name, artist, played_at FROM play_history WHERE (mode = ? OR mode IS NULL) AND played_at > ? ORDER BY played_at DESC LIMIT 200`).all(modeKey, cutoff);
  }

  if (rows.length < 3) return { ok: false, error: `数据不足（${rows.length} 条），暂不更新` };

  // 时段分布
  const buckets = {};
  const artistCount = {};
  for (const r of rows) {
    const d = new Date(r.played_at.endsWith('Z') ? r.played_at : r.played_at + 'Z');
    const b = getTimeBucket(d);
    const w = isWorkday(d) ? '工作日' : '休息日';
    const key = `${w} ${b}`;
    buckets[key] = (buckets[key] || 0) + 1;
    artistCount[r.artist] = (artistCount[r.artist] || 0) + 1;
  }
  const topArtists = Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topBuckets = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const summary = [
    `# ${modeKey} 模式 · 过去 14 天数据`,
    `播放总数：${rows.length}`,
    `常用时段：${topBuckets.map(([k, n]) => `${k}(${n})`).join(', ')}`,
    `常听艺术家：${topArtists.map(([a, n]) => `${a}(${n})`).join(', ')}`,
    `代表歌曲：${rows.slice(0, 12).map(r => `《${r.song_name}》${r.artist}`).join('；')}`
  ].join('\n');

  // 让 AI 提炼 4-8 条具体的偏好规律
  const sysPrompt = `你帮用户提炼 "${modeKey}" 模式下的听歌偏好规律。基于下面的统计数据，输出 4-8 条精准、可操作的规律（每条 1-2 行）。
- 用第二人称（"你"）
- 每条尽量具体（艺术家、时段、风格）
- 不要笼统话（如"你喜欢音乐"）
- 直接列点输出，不要 JSON、不要解释`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: sysPrompt,
      messages: [{ role: 'user', content: summary }]
    });
    const blocks = response.content || [];
    let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
    if (!text) text = blocks.map(b => b.text || '').filter(Boolean).join('').trim();
    if (!text) return { ok: false, error: 'AI 返回为空' };

    // 写入 AUTO-LEARN 区块
    const fp = ensureModeMd(modeKey);
    const md = fs.readFileSync(fp, 'utf-8');
    const ts = new Date().toLocaleString('zh-CN');
    const learned = `更新于 ${ts}（基于 ${rows.length} 条播放数据）\n\n${text}`;
    const newMd = md.replace(
      /<!-- AUTO-LEARN-START -->[\s\S]*?<!-- AUTO-LEARN-END -->/,
      `<!-- AUTO-LEARN-START -->\n${learned}\n<!-- AUTO-LEARN-END -->`
    );
    fs.writeFileSync(fp, newMd, 'utf-8');
    console.log(`[mode-learn] ${modeKey} 已更新（基于 ${rows.length} 条记录）`);
    return { ok: true, samples: rows.length, learned: text };
  } catch (e) {
    console.warn(`[mode-learn] ${modeKey} 失败:`, e.message);
    return { ok: false, error: e.message };
  }
}

// 按时段+工作日推断 play_history 旧记录的归属模式
// 规则跟 RADIO_MODES 的语义对齐；不破坏已有 mode，仅作 NULL 行的一次性回填
function inferModeFromTime(d) {
  const bucket = getTimeBucket(d);
  const workday = isWorkday(d);
  if (bucket === '深夜') return 'sleep';                   // 23:00-06:00
  if (workday) {
    if (bucket === '早晨' || bucket === '上午' || bucket === '下午') return 'work';
    if (bucket === '晚饭时间' || bucket === '晚间') return 'relax';
    return 'default'; // 工作日午餐时间
  } else {
    if (bucket === '早晨') return 'relax';
    if (bucket === '上午' || bucket === '下午') return 'drive';
    if (bucket === '晚饭时间' || bucket === '晚间') return 'relax';
    return 'default'; // 周末午餐时间
  }
}

// 一次性回填工具：把 mode IS NULL 的旧 play_history 按时段推断写入 mode 字段
app.post('/api/admin/backfill-mode', (req, res) => {
  try {
    const rows = db.prepare("SELECT id, played_at FROM play_history WHERE mode IS NULL").all();
    if (rows.length === 0) return res.json({ ok: true, updated: 0, breakdown: {}, message: '没有 mode IS NULL 的记录' });

    const stmt = db.prepare('UPDATE play_history SET mode = ? WHERE id = ?');
    const breakdown = {};
    const tx = db.transaction((rs) => {
      for (const r of rs) {
        if (!r.played_at) continue;
        const d = new Date(r.played_at.endsWith('Z') ? r.played_at : r.played_at + 'Z');
        const m = inferModeFromTime(d);
        stmt.run(m, r.id);
        breakdown[m] = (breakdown[m] || 0) + 1;
      }
    });
    tx(rows);

    // 持久记录最近一次回填结果，方便 UI 展示
    const result = { lastRun: new Date().toISOString(), updated: rows.length, breakdown };
    db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)')
      .run('backfill_mode_last', JSON.stringify(result));

    console.log(`[backfill-mode] 回填 ${rows.length} 条:`, breakdown);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('backfill-mode 失败:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 把本地 favorites 里有、但网易云 likelist 里没有的歌一次性同步到网易云
app.post('/api/admin/sync-favorites-to-netease', async (req, res) => {
  try {
    if (!NETEASE_COOKIE) return res.status(401).json({ error: '未配置 NETEASE_COOKIE' });
    const localFavs = db.prepare('SELECT song_id, song_name, artist FROM favorites').all();
    if (localFavs.length === 0) return res.json({ ok: true, total: 0, synced: 0, skipped: 0, failed: 0, message: '本地没有收藏' });

    const stat = await fetch(neteaseUrl('/login/status')).then(r => r.json());
    const uid = stat.data?.profile?.userId;
    if (!uid) return res.status(401).json({ error: '网易云 Cookie 无效或已过期' });
    const lik = await fetch(neteaseUrl('/likelist', { uid })).then(r => r.json());
    const netIds = new Set((lik.ids || []).map(String));

    let synced = 0, skipped = 0, failed = 0;
    const failures = [];
    for (const f of localFavs) {
      const sid = String(f.song_id);
      if (netIds.has(sid)) { skipped++; continue; }
      const result = await syncNeteaseLike(sid, true);
      if (result.ok) synced++;
      else { failed++; failures.push({ id: sid, name: f.song_name, error: result.error }); }
    }
    res.json({ ok: true, total: localFavs.length, synced, skipped, failed, failures });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/backfill-mode/last', (req, res) => {
  const row = db.prepare("SELECT value FROM preferences WHERE key = 'backfill_mode_last'").get();
  if (!row) return res.json(null);
  try { res.json(JSON.parse(row.value)); } catch { res.json(null); }
});

// === 任务 3：所有模式偏好学习（凌晨 3 点） ===
async function runModeLearn() {
  if (schedulerStatus.modeLearn.status === 'running') return { ok: false, error: 'already running' };
  console.log('[task] mode-learn start');
  markStart('modeLearn');
  schedulerStatus.modeLearn.perMode = schedulerStatus.modeLearn.perMode || {};
  try {
    const results = {};
    for (const k of ALLOWED_MODE_KEYS) {
      const r = await autoLearnModeFromHistory(k);
      results[k] = r;
      schedulerStatus.modeLearn.perMode[k] = {
        ok: r.ok, samples: r.samples, error: r.error,
        lastRun: new Date().toISOString()
      };
      saveSchedulerStatus();
    }
    markDone('modeLearn');
    console.log('[task] mode-learn 完成');
    return { ok: true, results };
  } catch (err) {
    console.error('[task] mode-learn 失败:', err.message);
    markError('modeLearn', err);
    return { ok: false, error: err.message };
  }
}

// === Cron 注册 ===
cron.schedule('0 7 * * *', runDailyPlaylist);  // 每日 07:00 - 每日歌单
cron.schedule('0 7 * * *', runTasteProfile);   // 每日 07:00 - 品味画像
cron.schedule('0 * * * *', runMoodCheck);      // 每小时整点 - 情绪检查
cron.schedule('0 3 * * *', runModeLearn);      // 凌晨 03:00 - 模式偏好学习

// === 任务注册表（trigger 端点用） ===
const TASK_REGISTRY = {
  'daily-playlist': runDailyPlaylist,
  'mood': runMoodCheck,
  'mode-learn': runModeLearn,
  'taste-profile': runTasteProfile
};

// === 启动 catch-up：服务启动后 5 秒，把过期的任务补跑一次 ===
function shouldCatchup(lastRun, maxAgeMs) {
  if (!lastRun) return true;
  const age = Date.now() - new Date(lastRun).getTime();
  return age > maxAgeMs;
}
setTimeout(() => {
  console.log('[catchup] 检查启动后是否需要补跑过期任务...');
  if (shouldCatchup(schedulerStatus.moodCheck.lastRun, 60 * 60 * 1000)) {
    console.log('[catchup] mood'); runMoodCheck().catch(() => {});
  }
  if (shouldCatchup(schedulerStatus.dailyPlaylist.lastRun, 24 * 60 * 60 * 1000)) {
    console.log('[catchup] daily-playlist'); runDailyPlaylist().catch(() => {});
  }
  if (shouldCatchup(schedulerStatus.tasteProfile.lastRun, 24 * 60 * 60 * 1000)) {
    console.log('[catchup] taste-profile'); runTasteProfile().catch(() => {});
  }
  if (shouldCatchup(schedulerStatus.modeLearn.lastRun, 24 * 60 * 60 * 1000)) {
    console.log('[catchup] mode-learn'); runModeLearn().catch(() => {});
  }
}, 5000);

// 手动触发某个模式的学习（保留旧端点）
app.post('/api/radio/modes/:key/learn', async (req, res) => {
  const r = await autoLearnModeFromHistory(req.params.key);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// ========== 定时任务 API ==========
app.get('/api/scheduler/status', (req, res) => {
  res.json(schedulerStatus);
});

app.get('/api/scheduler/daily-playlist', (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE type = 'daily' ORDER BY created_at DESC LIMIT 1").get();
  if (!playlist) return res.json(null);
  const songs = db.prepare('SELECT * FROM playlist_songs WHERE playlist_id = ? ORDER BY sort_order').all(playlist.id);
  res.json({ ...playlist, songs });
});

app.get('/api/scheduler/mood', (req, res) => {
  const mood = db.prepare("SELECT value FROM preferences WHERE key = 'current_mood'").get();
  res.json(mood ? JSON.parse(mood.value) : null);
});

app.get('/api/scheduler/taste-profile', (req, res) => {
  const row = db.prepare("SELECT value FROM preferences WHERE key = 'taste_profile'").get();
  if (!row) return res.json(null);
  try { res.json(JSON.parse(row.value)); } catch { res.json({ description: row.value }); }
});

// 真正触发任务（不再是空壳）
// 立即返回，任务在后台异步跑；客户端通过 /api/scheduler/status 轮询
app.post('/api/scheduler/trigger/:task', async (req, res) => {
  const fn = TASK_REGISTRY[req.params.task];
  if (!fn) return res.status(404).json({ error: `未知任务: ${req.params.task}`, available: Object.keys(TASK_REGISTRY) });
  fn().catch(e => console.error(`[trigger] ${req.params.task} 异常:`, e));
  res.json({ ok: true, task: req.params.task, message: '已在后台触发，状态变化看 /api/scheduler/status' });
});

const https = require('https');

const certDir = path.join(__dirname, 'certs');
const hasCerts = fs.existsSync(path.join(certDir, 'cert.pem'));

if (hasCerts) {
  const server = https.createServer({
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    key: fs.readFileSync(path.join(certDir, 'key.pem'))
  }, app);
  server.listen(PORT, () => {
    console.log(`Claudio FM 服务已启动: https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Claudio FM 服务已启动: http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
