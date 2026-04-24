require('dotenv').config();
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

app.post('/api/favorites', (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  db.prepare('INSERT OR REPLACE INTO favorites (song_id, song_name, artist, album, cover_url) VALUES (?, ?, ?, ?, ?)')
    .run(song_id, song_name, artist, album, cover_url);
  res.json({ ok: true });
});

app.delete('/api/favorites/:songId', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE song_id = ?').run(req.params.songId);
  res.json({ ok: true });
});

// ========== 播放历史 API ==========
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = db.prepare('SELECT * FROM play_history ORDER BY played_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.post('/api/history', (req, res) => {
  const { song_id, song_name, artist, album, cover_url } = req.body;
  db.prepare('INSERT INTO play_history (song_id, song_name, artist, album, cover_url) VALUES (?, ?, ?, ?, ?)')
    .run(song_id, song_name, artist, album, cover_url);
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

  if (currentSong) {
    parts.push(`## 当前播放\n歌曲：${currentSong.name}，艺术家：${currentSong.artist}，专辑：${currentSong.album || '未知'}`);
  }

  parts.push(`## 回复格式
你必须以 JSON 格式回复，结构如下：
{
  "say": "你对用户说的话",
  "reason": "推荐理由（如果是推荐歌曲）",
  "play": [{"id": "网易云歌曲ID", "name": "歌曲名", "artist": "艺术家", "album": "专辑", "cover": "封面URL"}],
  "segue": "你想用语音说的内容（歌曲赏析、故事等，可以为空）"
}
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
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // 获取聊天历史
    const history = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 20').all().reverse();

    const messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));
    messages.push({ role: 'user', content: message });

    const systemPrompt = buildSystemPrompt(currentSong, history);

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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

    stream.on('end', () => {
      // 保存消息
      db.prepare('INSERT INTO chat_messages (role, content) VALUES (?, ?)').run('user', message);

      // 尝试解析结构化回复
      let parsed = null;
      try {
        parsed = JSON.parse(fullContent);
      } catch(e) {
        // 非 JSON 回复，当作纯文本
        parsed = { say: fullContent, reason: '', play: [], segue: '' };
      }

      // 提取歌曲卡片
      const songCards = parsed.play || [];

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
let schedulerStatus = {
  dailyPlaylist: { lastRun: null, status: 'idle' },
  moodCheck: { lastRun: null, status: 'idle' }
};

// 每日歌单推荐（每天 07:00）
cron.schedule('0 7 * * *', async () => {
  console.log('执行每日歌单推荐...');
  schedulerStatus.dailyPlaylist.status = 'running';
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const history = db.prepare('SELECT * FROM play_history ORDER BY played_at DESC LIMIT 50').all();

    const prompt = `根据以下信息，推荐今日歌单（10首歌），返回 JSON 格式：
[{"id": "网易云歌曲ID", "name": "歌名", "artist": "艺术家", "album": "专辑", "cover": "封面URL"}]

${configCache.taste ? '品味偏好：' + configCache.taste : ''}
最近听歌记录：${history.map(h => h.song_name + ' - ' + h.artist).join(', ')}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let songs = [];
    try { songs = JSON.parse(content); } catch(e) {}

    if (songs.length > 0) {
      // 创建每日歌单
      const result = db.prepare('INSERT INTO playlists (name, type) VALUES (?, ?)').run('今日推荐', 'daily');
      const playlistId = result.lastInsertRowid;
      const stmt = db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, song_name, artist, album, cover_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
      songs.forEach((s, i) => {
        stmt.run(playlistId, s.id, s.name, s.artist, s.album || '', s.cover || '', i);
      });
    }

    schedulerStatus.dailyPlaylist.lastRun = new Date().toISOString();
    schedulerStatus.dailyPlaylist.status = 'idle';
    console.log('每日歌单推荐完成');
  } catch (err) {
    console.error('每日歌单推荐失败:', err);
    schedulerStatus.dailyPlaylist.status = 'error';
  }
});

// 每小时情绪检查
cron.schedule('0 * * * *', async () => {
  console.log('执行情绪检查...');
  schedulerStatus.moodCheck.status = 'running';
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const hour = new Date().getHours();
    const recentChats = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 10').all();

    const prompt = `当前时间：${hour}:00
${configCache.moodrules ? '情绪规则：' + configCache.moodrules : ''}
最近聊天：${recentChats.map(c => c.content).join('\n')}

判断当前电台情绪，返回 JSON：
{"mood": "情绪标签", "genre": "推荐曲风", "message": "一句话描述"}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let moodData = {};
    try { moodData = JSON.parse(content); } catch(e) {}

    if (moodData.mood) {
      db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('current_mood', JSON.stringify(moodData));
    }

    schedulerStatus.moodCheck.lastRun = new Date().toISOString();
    schedulerStatus.moodCheck.status = 'idle';
    console.log('情绪检查完成:', moodData.mood);
  } catch (err) {
    console.error('情绪检查失败:', err);
    schedulerStatus.moodCheck.status = 'error';
  }
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

app.post('/api/scheduler/trigger/:task', async (req, res) => {
  // 手动触发（调试用）
  res.json({ ok: true, message: `任务 ${req.params.task} 已触发` });
});

app.listen(PORT, () => {
  console.log(`Claudio FM 服务已启动: http://localhost:${PORT}`);
});

module.exports = { app, db };
