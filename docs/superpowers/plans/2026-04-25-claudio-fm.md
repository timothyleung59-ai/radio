# Claudio FM 实施计划

> **致 AI 工作代理：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 技能来逐任务实施本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 构建一个沉浸式 AI 电台门户——Claudio FM，包含音乐播放器、AI DJ 聊天、动态视觉效果和定时任务系统。

**架构：** 单个 Node.js 服务（Express）同时承担静态文件服务、Claude API 代理和数据 API。前端使用纯 HTML/CSS/JS，模块化组织。SQLite 存储所有用户数据。

**技术栈：** Node.js + Express + better-sqlite3 + Anthropic SDK + 网易云音乐 API + Web Audio API + Canvas

---

## 文件结构总览

```
claudio/
├── server.js                    # Express 主服务
├── package.json
├── .env                         # ANTHROPIC_API_KEY=xxx
├── data/                        # SQLite 数据库目录（自动创建）
├── config/
│   ├── agent.md                 # Agent 核心人设提示词（空模板）
│   ├── taste.md                 # 音乐品味配置（空模板）
│   ├── routines.md              # 行为习惯配置（空模板）
│   ├── moodrules.md             # 情绪规则配置（空模板）
│   └── schedule.json            # Mock 日历数据
├── public/
│   ├── index.html               # 主页面
│   ├── css/
│   │   ├── main.css             # 全局样式、CSS 变量、主题、流体背景
│   │   ├── player.css           # 播放器区域
│   │   ├── chat.css             # 聊天窗口
│   │   ├── lyrics.css           # 歌词组件
│   │   └── voice.css            # DJ 语音模式
│   ├── js/
│   │   ├── app.js               # 主入口、模块初始化
│   │   ├── api.js               # 网易云 API + 服务端 API 封装
│   │   ├── player.js            # 播放器逻辑
│   │   ├── lyrics.js            # 歌词获取、解析、翻转
│   │   ├── chat.js              # 聊天 UI + Claude 交互
│   │   ├── visual.js            # 动态取色、流体背景、粒子、律动
│   │   ├── voice.js             # DJ 语音模式（TTS + 波形）
│   │   ├── storage.js           # 前端数据访问层
│   │   └── config.js            # 配置加载器
│   └── assets/
│       └── icons/               # SVG 图标
└── docs/
```

---

## Task 1：项目脚手架 + 服务端基础

**文件：**
- 创建：`package.json`
- 创建：`.env`
- 创建：`.gitignore`
- 创建：`server.js`
- 创建：`config/agent.md`
- 创建：`config/taste.md`
- 创建：`config/routines.md`
- 创建：`config/moodrules.md`
- 创建：`public/index.html`

- [ ] **步骤 1：初始化项目**

```bash
cd /Users/kaba/code/claudio
npm init -y
```

- [ ] **步骤 2：安装依赖**

```bash
npm install express better-sqlite3 dotenv cors
npm install --save-dev nodemon
```

- [ ] **步骤 3：创建 .env 文件**

```bash
cat > .env << 'EOF'
ANTHROPIC_API_KEY=your-api-key-here
NETEASE_API=http://192.168.5.103:3000
PORT=3001
EOF
```

- [ ] **步骤 4：创建 .gitignore**

```
node_modules/
data/
.env
.superpowers/
.DS_Store
```

- [ ] **步骤 5：创建配置文件模板**

`config/agent.md`:
```markdown
# Claudio Agent 提示词

在此定义 Claudio 的核心人设、身份、说话风格和行为准则。
```

`config/taste.md`:
```markdown
# 音乐品味

在此定义 Claudio 喜欢的音乐类型、年代偏好、风格倾向。
```

`config/routines.md`:
```markdown
# 行为习惯

在此定义不同时段的音乐模式、固定节目环节。
```

`config/moodrules.md`:
```markdown
# 情绪规则

在此定义情绪如何影响选歌和对话语调。
```

- [ ] **步骤 6：创建 server.js 基础框架**

```javascript
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 确保 data 目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Claudio FM 服务已启动: http://localhost:${PORT}`);
});
```

- [ ] **步骤 7：创建基础 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Claudio FM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Doto:wght@400;600&family=Space+Grotesk:wght@300;400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/main.css">
</head>
<body>
  <div id="app">
    <h1 style="color:#fff;text-align:center;margin-top:40vh;font-family:Doto">Claudio FM</h1>
  </div>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **步骤 8：更新 package.json scripts**

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

- [ ] **步骤 9：启动验证**

```bash
npm run dev
# 预期输出: Claudio FM 服务已启动: http://localhost:3001
# 浏览器打开 http://localhost:3001 应看到 "Claudio FM" 标题
curl http://localhost:3001/api/health
# 预期: {"status":"ok","timestamp":"..."}
```

- [ ] **步骤 10：提交**

```bash
git init
git add -A
git commit -m "feat: 项目脚手架 + Express 服务基础"
```

---

## Task 2：SQLite 数据库初始化

**文件：**
- 创建：`server.js` 中添加数据库初始化代码

- [ ] **步骤 1：在 server.js 中添加数据库初始化**

在 `server.js` 的 `const fs = require('fs');` 之后添加：

```javascript
const Database = require('better-sqlite3');
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
```

- [ ] **步骤 2：重启服务验证**

```bash
npm run dev
# 预期: 数据库初始化完成
ls data/claudio.db
# 预期: 文件存在
```

- [ ] **步骤 3：提交**

```bash
git add -A
git commit -m "feat: SQLite 数据库初始化，创建所有数据表"
```

---

## Task 3：服务端数据 API

**文件：**
- 修改：`server.js`

- [ ] **步骤 1：在 server.js 中添加收藏 API**

```javascript
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
```

- [ ] **步骤 2：添加播放历史 API**

```javascript
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
```

- [ ] **步骤 3：添加歌单 API**

```javascript
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
```

- [ ] **步骤 4：添加偏好和播放状态 API**

```javascript
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
```

- [ ] **步骤 5：添加聊天历史 API**

```javascript
// ========== 聊天历史 API ==========
app.get('/api/chat/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const rows = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.reverse());
});
```

- [ ] **步骤 6：测试所有 API**

```bash
# 收藏
curl -X POST http://localhost:3001/api/favorites \
  -H "Content-Type: application/json" \
  -d '{"song_id":"123","song_name":"测试歌曲","artist":"测试","album":"测试专辑","cover_url":"http://example.com/cover.jpg"}'
curl http://localhost:3001/api/favorites

# 历史
curl -X POST http://localhost:3001/api/history \
  -H "Content-Type: application/json" \
  -d '{"song_id":"123","song_name":"测试歌曲","artist":"测试","album":"测试专辑","cover_url":"http://example.com/cover.jpg"}'
curl http://localhost:3001/api/history

# 歌单
curl -X POST http://localhost:3001/api/playlists \
  -H "Content-Type: application/json" \
  -d '{"name":"我的歌单"}'
curl http://localhost:3001/api/playlists

# 偏好
curl http://localhost:3001/api/preferences
curl -X PUT http://localhost:3001/api/preferences \
  -H "Content-Type: application/json" \
  -d '{"theme":"dark","volume":"0.8"}'

# 播放状态
curl http://localhost:3001/api/playback-state
```

- [ ] **步骤 7：提交**

```bash
git add -A
git commit -m "feat: 完整的数据 API（收藏/历史/歌单/偏好/播放状态）"
```

---

## Task 4：网易云 API 封装 + 配置加载

**文件：**
- 创建：`public/js/api.js`
- 创建：`public/js/config.js`
- 修改：`server.js`（添加配置 API）

- [ ] **步骤 1：创建 api.js（网易云 API 封装）**

```javascript
// public/js/api.js
const NETEASE_API = 'http://192.168.5.103:3000';

export const netease = {
  async search(keywords, limit = 20) {
    const res = await fetch(`${NETEASE_API}/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=1&limit=${limit}`);
    const data = await res.json();
    if (!data.result?.songs) return [];
    return data.result.songs.map(s => ({
      id: s.id.toString(),
      name: s.name,
      artist: s.ar.map(a => a.name).join('/'),
      album: s.al.name,
      cover: s.al.picUrl,
      duration: Math.floor(s.dt / 1000)
    }));
  },

  async getSongUrl(id) {
    const res = await fetch(`${NETEASE_API}/song/url?id=${id}&br=320000`);
    const data = await res.json();
    return data.data?.[0]?.url || null;
  },

  async getLyrics(id) {
    const res = await fetch(`${NETEASE_API}/lyric?id=${id}`);
    const data = await res.json();
    return {
      lrc: data.lrc?.lyric || '',
      tlyric: data.tlyric?.lyric || ''
    };
  },

  async getPersonalized(limit = 10) {
    const res = await fetch(`${NETEASE_API}/personalized?limit=${limit}`);
    const data = await res.json();
    return data.result || [];
  },

  async getPlaylistDetail(id) {
    const res = await fetch(`${NETEASE_API}/playlist/detail?id=${id}`);
    const data = await res.json();
    const pl = data.playlist;
    if (!pl) return null;
    return {
      id: pl.id,
      name: pl.name,
      cover: pl.coverImgUrl,
      songs: pl.tracks.map(s => ({
        id: s.id.toString(),
        name: s.name,
        artist: s.ar.map(a => a.name).join('/'),
        album: s.al.name,
        cover: s.al.picUrl,
        duration: Math.floor(s.dt / 1000)
      }))
    };
  }
};

// 服务端 API 封装
export const server = {
  async get(url) {
    const res = await fetch(url);
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  },
  async put(url, body) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  }
};
```

- [ ] **步骤 2：创建 config.js**

```javascript
// public/js/config.js
let cachedConfig = null;

export async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/config');
  cachedConfig = await res.json();
  return cachedConfig;
}

export function invalidateConfigCache() {
  cachedConfig = null;
}
```

- [ ] **步骤 3：在 server.js 添加配置 API**

```javascript
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
```

- [ ] **步骤 4：测试**

```bash
curl http://localhost:3001/api/config
# 预期: JSON 包含 agent/taste/routines/moodrules 四个字段
```

- [ ] **步骤 5：提交**

```bash
git add -A
git commit -m "feat: 网易云 API 封装 + 配置加载 API"
```

---

## Task 5：HTML 主结构 + CSS 全局样式

**文件：**
- 修改：`public/index.html`
- 创建：`public/css/main.css`
- 创建：`public/css/player.css`
- 创建：`public/css/chat.css`

- [ ] **步骤 1：编写 main.css（全局样式 + 流体背景 + 主题）**

```css
/* public/css/main.css */
:root {
  --color-primary: #4a6cf7;
  --color-secondary: #9b59b6;
  --color-accent: #e74c3c;
  --bg-base: #0a0a10;
  --bg-card: #16161a;
  --text-primary: #ffffff;
  --text-secondary: rgba(255,255,255,0.7);
  --text-muted: rgba(255,255,255,0.4);
  --border-subtle: rgba(255,255,255,0.08);
  --radius-lg: 20px;
  --radius-md: 12px;
  --radius-sm: 8px;
}

[data-theme="light"] {
  --bg-base: #f5f5f5;
  --bg-card: #ffffff;
  --text-primary: #111111;
  --text-secondary: rgba(0,0,0,0.7);
  --text-muted: rgba(0,0,0,0.4);
  --border-subtle: rgba(0,0,0,0.08);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  font-family: 'Inter', -apple-system, sans-serif;
  background: var(--bg-base);
  color: var(--text-primary);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

#app {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  max-width: 440px;
  margin: 0 auto;
}

/* 流体背景 */
.fluid-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.fluid-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px) saturate(1.1);
  opacity: 0.6;
  mix-blend-mode: screen;
  will-change: transform;
}

.fluid-blob.primary {
  width: 60vmin; height: 60vmin;
  left: 50%; top: 50%;
  margin-left: -30vmin; margin-top: -30vmin;
  background: radial-gradient(circle, var(--color-primary) 0%, transparent 70%);
  animation: flow-a 26s ease-in-out infinite;
}

.fluid-blob.secondary {
  width: 55vmin; height: 55vmin;
  left: 50%; top: 50%;
  margin-left: -27.5vmin; margin-top: -27.5vmin;
  background: radial-gradient(circle, var(--color-secondary) 0%, transparent 70%);
  animation: flow-b 34s ease-in-out infinite;
}

.fluid-blob.accent {
  width: 35vmin; height: 35vmin;
  left: 50%; top: 50%;
  margin-left: -17.5vmin; margin-top: -17.5vmin;
  opacity: 0.4;
  background: radial-gradient(circle, var(--color-accent) 0%, transparent 70%);
  animation: flow-c 42s ease-in-out infinite;
}

@keyframes flow-a {
  0%   { transform: translate(-20vmin, -12vmin) scale(1); }
  50%  { transform: translate(18vmin, 16vmin) scale(1.1); }
  100% { transform: translate(-20vmin, -12vmin) scale(1); }
}
@keyframes flow-b {
  0%   { transform: translate(16vmin, 14vmin) scale(1.05); }
  50%  { transform: translate(-22vmin, -10vmin) scale(0.95); }
  100% { transform: translate(16vmin, 14vmin) scale(1.05); }
}
@keyframes flow-c {
  0%   { transform: translate(0, 0) scale(1); }
  33%  { transform: translate(-15vmin, 8vmin) scale(1.15); }
  66%  { transform: translate(12vmin, -6vmin) scale(0.9); }
  100% { transform: translate(0, 0) scale(1); }
}

/* 噪点纹理 */
.noise-overlay {
  position: fixed;
  inset: 0;
  z-index: -1;
  opacity: 0.04;
  pointer-events: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
}

/* 顶部栏 */
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  flex-shrink: 0;
}

.topbar-title {
  font-family: 'Doto', sans-serif;
  font-size: 18px;
  font-weight: 400;
  letter-spacing: 0.05em;
}

.topbar-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  background: rgba(255,255,255,0.05);
  color: var(--text-primary);
  display: grid; place-items: center;
  cursor: pointer;
  transition: background 0.15s;
}
.topbar-btn:hover { background: rgba(255,255,255,0.1); }

/* Toast 通知 */
.toast {
  position: fixed;
  top: 60px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.85);
  color: #fff;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  z-index: 9999;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.toast.show { opacity: 1; }
```

- [ ] **步骤 2：编写 player.css**

```css
/* public/css/player.css */
.player-section {
  flex-shrink: 0;
  padding: 0 20px;
}

/* 封面容器（3D 翻转） */
.cover-container {
  width: 100%;
  aspect-ratio: 1;
  perspective: 1000px;
  cursor: pointer;
  margin-bottom: 20px;
}

.cover-flipper {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.cover-flipper.flipped {
  transform: rotateY(180deg);
}

.cover-front, .cover-back {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.cover-front {
  background: var(--bg-card);
  box-shadow:
    0 20px 60px -15px rgba(0,0,0,0.5),
    0 0 0 1px var(--border-subtle);
}

.cover-front img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-back {
  transform: rotateY(180deg);
  background: var(--bg-card);
  padding: 20px;
  overflow-y: auto;
}

/* 律动光效 */
.cover-glow {
  position: absolute;
  inset: -4px;
  border-radius: calc(var(--radius-lg) + 4px);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: -1;
}
.cover-glow.active {
  opacity: 1;
  box-shadow: 0 0 30px 8px var(--color-primary);
}

/* 播放控制区 */
.player-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.song-title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
  flex: 1;
  margin-right: 12px;
}

.like-btn {
  width: 36px; height: 36px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 20px;
  transition: color 0.15s, transform 0.15s;
}
.like-btn:hover { transform: scale(1.1); }
.like-btn.liked { color: #e74c3c; }

.progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-time {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
}

.progress-track {
  flex: 1;
  height: 4px;
  background: rgba(255,255,255,0.15);
  border-radius: 999px;
  cursor: pointer;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: var(--text-primary);
  border-radius: 999px;
  width: 0%;
  transition: width 0.1s linear;
}

.control-buttons {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 24px;
}

.ctrl-btn {
  width: 40px; height: 40px;
  border: none;
  background: none;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 50%;
  display: grid; place-items: center;
  font-size: 18px;
  transition: background 0.15s, transform 0.1s;
}
.ctrl-btn:hover { background: rgba(255,255,255,0.1); }
.ctrl-btn:active { transform: scale(0.92); }
.ctrl-btn.active { color: var(--color-accent); }

.play-btn {
  width: 52px; height: 52px;
  background: var(--text-primary);
  color: var(--bg-base);
  font-size: 22px;
}
.play-btn:hover { background: var(--text-primary); transform: scale(1.04); }
```

- [ ] **步骤 3：编写 chat.css**

```css
/* public/css/chat.css */
.chat-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border-subtle);
  margin-top: 12px;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  flex-shrink: 0;
}

.chat-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border-subtle);
}
.chat-avatar img { width: 100%; height: 100%; object-fit: cover; }

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px 20px;
  scroll-behavior: smooth;
}

.chat-messages::-webkit-scrollbar { width: 0; }

.msg {
  margin-bottom: 16px;
  max-width: 85%;
}

.msg.assistant { align-self: flex-start; }
.msg.user { align-self: flex-end; margin-left: auto; }

.msg-bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.5;
}

.msg.assistant .msg-bubble {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-bottom-left-radius: 4px;
}

.msg.user .msg-bubble {
  background: var(--color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}

/* 歌曲卡片 */
.song-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255,255,255,0.05);
  border-radius: var(--radius-sm);
  margin-top: 8px;
  border: 1px solid var(--border-subtle);
  transition: opacity 0.2s;
}

.song-card.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.song-card-cover {
  width: 40px; height: 40px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.song-card-info {
  flex: 1;
  min-width: 0;
}

.song-card-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-card-artist {
  font-size: 11px;
  color: var(--text-muted);
}

.song-card-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.song-card-btn {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  background: none;
  color: var(--text-primary);
  cursor: pointer;
  display: grid; place-items: center;
  font-size: 12px;
  transition: background 0.15s;
}
.song-card-btn:hover { background: rgba(255,255,255,0.1); }

/* 语音消息 */
.voice-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255,255,255,0.05);
  border-radius: var(--radius-sm);
  margin-top: 8px;
  cursor: pointer;
}

.voice-wave {
  height: 24px;
  flex: 1;
}

.voice-duration {
  font-size: 11px;
  color: var(--text-muted);
}

/* 聊天输入 */
.chat-input-area {
  display: flex;
  gap: 8px;
  padding: 10px 20px 16px;
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  height: 40px;
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  background: rgba(255,255,255,0.05);
  color: var(--text-primary);
  padding: 0 16px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
}
.chat-input::placeholder { color: var(--text-muted); }
.chat-input:focus { border-color: var(--color-primary); }

.send-btn {
  width: 40px; height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  display: grid; place-items: center;
  font-size: 16px;
  transition: opacity 0.15s;
}
.send-btn:hover { opacity: 0.85; }
.send-btn:disabled { opacity: 0.3; cursor: default; }
```

- [ ] **步骤 4：编写完整 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Claudio FM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Doto:wght@400;600&family=Space+Grotesk:wght@300;400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/main.css">
  <link rel="stylesheet" href="css/player.css">
  <link rel="stylesheet" href="css/chat.css">
  <link rel="stylesheet" href="css/lyrics.css">
  <link rel="stylesheet" href="css/voice.css">
</head>
<body>
  <div class="fluid-bg">
    <div class="fluid-blob primary"></div>
    <div class="fluid-blob secondary"></div>
    <div class="fluid-blob accent"></div>
  </div>
  <div class="noise-overlay"></div>

  <div id="app">
    <!-- 顶部栏 -->
    <div class="topbar">
      <button class="topbar-btn" id="themeToggle" title="切换主题">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      </button>
      <span class="topbar-title">Claudio FM</span>
      <button class="topbar-btn" id="menuBtn" title="菜单">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>

    <!-- 播放器区域 -->
    <div class="player-section">
      <div class="cover-container" id="coverContainer">
        <div class="cover-flipper" id="coverFlipper">
          <div class="cover-front">
            <div class="cover-glow" id="coverGlow"></div>
            <img id="coverImg" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect fill='%23222' width='400' height='400'/%3E%3Ctext x='200' y='200' fill='%23555' font-size='16' text-anchor='middle' dominant-baseline='middle'%3EClaudio FM%3C/text%3E%3C/svg%3E" alt="专辑封面">
          </div>
          <div class="cover-back" id="lyricsPanel">
            <div class="lyrics-content" id="lyricsContent">
              <p style="color:var(--text-muted);text-align:center;margin-top:40%;">暂无歌词</p>
            </div>
          </div>
        </div>
      </div>

      <div class="player-controls">
        <div class="player-info">
          <div class="song-title" id="songTitle">未在播放</div>
          <button class="like-btn" id="likeBtn" title="收藏">♡</button>
        </div>
        <div class="progress-bar">
          <span class="progress-time" id="currentTime">0:00</span>
          <div class="progress-track" id="progressTrack">
            <div class="progress-fill" id="progressFill"></div>
          </div>
          <span class="progress-time" id="totalTime">0:00</span>
        </div>
        <div class="control-buttons">
          <button class="ctrl-btn" id="shuffleBtn" title="随机">⇆</button>
          <button class="ctrl-btn" id="prevBtn" title="上一曲">⏮</button>
          <button class="ctrl-btn play-btn" id="playBtn" title="播放">▶</button>
          <button class="ctrl-btn" id="nextBtn" title="下一曲">⏭</button>
          <button class="ctrl-btn" id="repeatBtn" title="循环">↻</button>
        </div>
      </div>
    </div>

    <!-- 聊天区域 -->
    <div class="chat-section">
      <div class="chat-header">
        <div class="chat-avatar" id="djAvatar" title="电台信息">
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle fill='%234a6cf7' cx='16' cy='16' r='16'/%3E%3Ctext x='16' y='20' fill='%23fff' font-size='14' text-anchor='middle'%3EC%3C/text%3E%3C/svg%3E" alt="Claudio">
        </div>
        <span style="font-size:13px;color:var(--text-muted)">Claudio FM</span>
        <div class="chat-avatar" id="userAvatar" title="我的信息">
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle fill='%239b59b6' cx='16' cy='16' r='16'/%3E%3Ctext x='16' y='20' fill='%23fff' font-size='14' text-anchor='middle'%3EY%3C/text%3E%3C/svg%3E" alt="You">
        </div>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-area">
        <input class="chat-input" id="chatInput" placeholder="和 Claudio 聊聊..." autocomplete="off">
        <button class="send-btn" id="sendBtn" title="发送">↑</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **步骤 5：创建空的 lyrics.css 和 voice.css**

```css
/* public/css/lyrics.css */
.lyrics-content {
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 2;
}
.lyrics-line { transition: color 0.3s, font-size 0.3s; }
.lyrics-line.active { color: var(--text-primary); font-size: 17px; font-weight: 500; }
.lyrics-line.past { color: var(--text-muted); }
```

```css
/* public/css/voice.css */
.voice-mode-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.9);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.voice-wave-canvas { width: 100%; height: 120px; }
.voice-text { margin-top: 30px; color: var(--text-primary); font-size: 16px; line-height: 1.8; text-align: center; max-width: 360px; }
.voice-close { position: absolute; top: 20px; right: 20px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border-subtle); background: none; color: #fff; cursor: pointer; font-size: 18px; }
```

- [ ] **步骤 6：创建空的 app.js 入口**

```javascript
// public/js/app.js
console.log('Claudio FM 加载中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};
```

- [ ] **步骤 7：浏览器验证**

打开 http://localhost:3001，应看到：
- 暗色背景 + 流体渐变动画
- 顶部栏（主题切换 + Claudio FM 标题）
- 封面区域
- 播放控制区
- 聊天区域（消息列表 + 输入框）

- [ ] **步骤 8：提交**

```bash
git add -A
git commit -m "feat: HTML 主结构 + 全局 CSS 样式（流体背景/播放器/聊天）"
```

---

## Task 6：播放器核心逻辑

**文件：**
- 创建：`public/js/player.js`
- 修改：`public/js/app.js`

- [ ] **步骤 1：创建 player.js**

```javascript
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

function toggleShuffle() {
  playMode = playMode === 'shuffle' ? 'off' : 'shuffle';
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

audio.addEventListener('timeupdate', updateProgress);
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
```

- [ ] **步骤 2：在 app.js 中引入 player**

```javascript
// public/js/app.js
import { restorePlayback } from './player.js';

console.log('Claudio FM 加载中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 恢复上次播放状态
restorePlayback();
```

- [ ] **步骤 3：浏览器验证**

- 点击播放按钮应有反应（虽然没歌曲）
- UI 显示正常，按钮可点击

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: 播放器核心逻辑（播放/暂停/上下曲/进度条/收藏/续播）"
```

---

## Task 7：主题切换 + 动态取色

**文件：**
- 创建：`public/js/visual.js`
- 修改：`public/js/app.js`

- [ ] **步骤 1：创建 visual.js（动态取色 + 主题切换 + 粒子 + 律动光效）**

```javascript
// public/js/visual.js
const $ = id => document.getElementById(id);

// ========== 主题切换 ==========
export function initTheme() {
  const toggle = $('themeToggle');
  const html = document.documentElement;

  // 从偏好加载
  fetch('/api/preferences').then(r => r.json()).then(prefs => {
    if (prefs.theme) html.dataset.theme = prefs.theme;
    updateThemeIcon();
  });

  toggle.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    html.dataset.theme = next;
    updateThemeIcon();
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next })
    });
  });

  function updateThemeIcon() {
    const isDark = html.dataset.theme === 'dark';
    toggle.innerHTML = isDark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>';
  }
}

// ========== 动态取色 ==========
export function extractColors(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // 简易取色：采样像素并聚类
      const pixels = [];
      for (let i = 0; i < data.length; i += 16) { // 每4个像素采样一次
        pixels.push([data[i], data[i+1], data[i+2]]);
      }

      // 简单 k-means (k=3)
      const colors = simpleKMeans(pixels, 3);
      const [primary, secondary, accent] = colors.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);

      document.documentElement.style.setProperty('--color-primary', primary);
      document.documentElement.style.setProperty('--color-secondary', secondary);
      document.documentElement.style.setProperty('--color-accent', accent);

      resolve({ primary, secondary, accent });
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function simpleKMeans(pixels, k) {
  // 随机初始化
  let centroids = [];
  for (let i = 0; i < k; i++) {
    centroids.push([...pixels[Math.floor(Math.random() * pixels.length)]]);
  }

  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array.from({length: k}, () => []);
    for (const p of pixels) {
      let minDist = Infinity, minIdx = 0;
      for (let i = 0; i < k; i++) {
        const d = (p[0]-centroids[i][0])**2 + (p[1]-centroids[i][1])**2 + (p[2]-centroids[i][2])**2;
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      clusters[minIdx].push(p);
    }
    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;
      centroids[i] = [
        Math.round(clusters[i].reduce((s,p) => s+p[0], 0) / clusters[i].length),
        Math.round(clusters[i].reduce((s,p) => s+p[1], 0) / clusters[i].length),
        Math.round(clusters[i].reduce((s,p) => s+p[2], 0) / clusters[i].length)
      ];
    }
  }

  // 按饱和度排序（饱和度高的放前面）
  centroids.sort((a, b) => {
    const satA = Math.max(a[0],a[1],a[2]) - Math.min(a[0],a[1],a[2]);
    const satB = Math.max(b[0],b[1],b[2]) - Math.min(b[0],b[1],b[2]);
    return satB - satA;
  });

  return centroids;
}

// ========== 封面翻转 ==========
export function initCoverFlip() {
  const container = $('coverContainer');
  const flipper = $('coverFlipper');
  let flipped = false;

  container.addEventListener('click', () => {
    flipped = !flipped;
    flipper.classList.toggle('flipped', flipped);
  });
}

// ========== 律动光效（简化版，无 Web Audio 时用定时脉动） ==========
export function initBeatGlow() {
  const glow = $('coverGlow');
  let active = false;
  let interval = null;

  window.addEventListener('songchange', () => {
    active = true;
    glow.classList.add('active');
    // 简化：用定时器模拟脉动
    if (interval) clearInterval(interval);
    interval = setInterval(() => {
      glow.style.opacity = 0.3 + Math.random() * 0.7;
    }, 500);
  });
}

// ========== 粒子特效 ==========
let particleCanvas, particleCtx;
const particles = [];

export function initParticles() {
  particleCanvas = document.createElement('canvas');
  particleCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;';
  document.body.appendChild(particleCanvas);
  particleCtx = particleCanvas.getContext('2d');

  function resize() {
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function animate() {
    particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      particleCtx.globalAlpha = p.life;
      particleCtx.fillStyle = p.color;
      particleCtx.beginPath();
      particleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      particleCtx.fill();
    }
    particleCtx.globalAlpha = 1;
    requestAnimationFrame(animate);
  }
  animate();
}

export function burstParticles(x, y, color = '#4a6cf7') {
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 3,
      life: 1,
      color
    });
  }
}

// ========== 初始化 ==========
export function initVisual() {
  initTheme();
  initCoverFlip();
  initBeatGlow();
  initParticles();
}
```

- [ ] **步骤 2：在 app.js 中初始化视觉系统**

```javascript
// public/js/app.js
import { restorePlayback } from './player.js';
import { initVisual, extractColors } from './visual.js';

console.log('Claudio FM 加载中...');

window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 初始化视觉系统
initVisual();

// 恢复播放状态
restorePlayback();

// 监听歌曲变化，更新取色
window.addEventListener('songchange', (e) => {
  const song = e.detail;
  if (song.cover) extractColors(song.cover);
});
```

- [ ] **步骤 3：浏览器验证**

- 右上角主题切换按钮可切换亮/暗模式
- 点击封面区域可翻转
- 页面有流体背景动画

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: 主题切换 + 动态取色 + 封面翻转 + 粒子特效 + 律动光效"
```

---

## Task 8：歌词系统

**文件：**
- 创建：`public/js/lyrics.js`
- 修改：`public/js/app.js`

- [ ] **步骤 1：创建 lyrics.js**

```javascript
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
```

- [ ] **步骤 2：在 app.js 中集成歌词更新**

在 `app.js` 末尾添加：

```javascript
import { updateLyrics } from './lyrics.js';

// 歌词同步更新（每 200ms 检查一次）
setInterval(() => {
  const audio = document.querySelector('audio');
  if (audio && !audio.paused) {
    updateLyrics(audio.currentTime);
  }
}, 200);
```

注：需要修改 player.js 中的 audio 为可导出，或通过事件机制。简化做法是在 player.js 的 `timeupdate` 事件中触发自定义事件。

在 player.js 的 `audio.addEventListener('timeupdate', updateProgress);` 之后添加：

```javascript
audio.addEventListener('timeupdate', () => {
  window.dispatchEvent(new CustomEvent('timeupdate', { detail: audio.currentTime }));
});
```

然后在 app.js 中：

```javascript
window.addEventListener('timeupdate', (e) => {
  updateLyrics(e.detail);
});
```

- [ ] **步骤 3：浏览器验证**

- 切换歌曲后，封面翻转面应显示歌词
- 播放时歌词逐行高亮并自动滚动

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: 歌词系统（LRC 解析 + 逐行高亮 + 自动滚动）"
```

---

## Task 9：Agent 集成 + Claude API 代理

**文件：**
- 修改：`server.js`（添加 Claude API 代理和分流引擎）
- 创建：`public/js/chat.js`

- [ ] **步骤 1：安装 Anthropic SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **步骤 2：在 server.js 中添加 Claude API 代理**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

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
  '播放': () => ({ action: 'play' }),
  '随机播放': () => ({ action: 'shuffle' }),
};

app.post('/api/dispatch', async (req, res) => {
  const { message, currentSong } = req.body;

  // 简单指令检测
  for (const [keyword, handler] of Object.entries(simpleCommands)) {
    if (message.includes(keyword)) {
      return res.json({ type: 'command', ...handler() });
    }
  }

  // 音乐搜索检测
  if (message.startsWith('搜索') || message.startsWith('播放') && message.length > 2) {
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
```

- [ ] **步骤 3：测试分流 API**

```bash
# 测试简单指令
curl -X POST http://localhost:3001/api/dispatch \
  -H "Content-Type: application/json" \
  -d '{"message":"下一首"}'
# 预期: {"type":"command","action":"next"}

# 测试音乐搜索
curl -X POST http://localhost:3001/api/dispatch \
  -H "Content-Type: application/json" \
  -d '{"message":"搜索周杰伦"}'
# 预期: {"type":"music_search","keyword":"周杰伦"}
```

注意：Claude API 调用需要有效的 ANTHROPIC_API_KEY，此时可以先测试简单指令和搜索分流。

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: Agent 集成 + Claude API 流式代理 + 消息分流引擎"
```

---

## Task 10：聊天 UI

**文件：**
- 创建：`public/js/chat.js`
- 修改：`public/js/app.js`

- [ ] **步骤 1：创建 chat.js**

```javascript
// public/js/chat.js
import { server } from './api.js';
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
              if (segue) html += renderVoiceMsg(segue);
              if (play && play.length > 0) {
                html += play.map(s => renderSongCard(s)).join('');
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
      const data = await res.json();
      if (data.type === 'command') {
        handleCommand(data);
      } else if (data.type === 'music_search') {
        await handleMusicSearch(data.keyword);
      }
    }
  } catch (err) {
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
    const { netease } = await import('./api.js');
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
```

- [ ] **步骤 2：在 app.js 中加载聊天历史**

```javascript
import { loadChatHistory } from './chat.js';

// 加载聊天历史
loadChatHistory();
```

- [ ] **步骤 3：浏览器验证**

- 输入框可以输入文字并发送
- 简单指令（如"下一首"）直接执行
- 搜索指令（如"搜索周杰伦"）显示歌曲列表
- 歌曲卡片的播放/添加按钮可点击

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: 聊天 UI（消息气泡 + 歌曲卡片 + 流式输出 + 历史加载）"
```

---

## Task 11：定时任务系统

**文件：**
- 修改：`server.js`

- [ ] **步骤 1：安装 node-cron**

```bash
npm install node-cron
```

- [ ] **步骤 2：在 server.js 添加定时任务**

```javascript
const cron = require('node-cron');

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
```

- [ ] **步骤 3：测试定时任务 API**

```bash
curl http://localhost:3001/api/scheduler/status
# 预期: {"dailyPlaylist":{"lastRun":null,"status":"idle"},"moodCheck":{"lastRun":null,"status":"idle"}}

curl http://localhost:3001/api/scheduler/mood
# 预期: null（尚未执行过）
```

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: 定时任务系统（每日歌单推荐 + 每小时情绪检查）"
```

---

## Task 12：Mock 模块（日历 + TTS）

**文件：**
- 创建：`config/schedule.json`
- 创建：`public/js/voice.js`
- 修改：`server.js`

- [ ] **步骤 1：创建 Mock 日历数据**

```json
[
  {"time": "08:00", "event": "晨跑", "mood": "energetic", "duration": 30},
  {"time": "10:00", "event": "专注工作", "mood": "focus", "duration": 120},
  {"time": "14:00", "event": "下午茶", "mood": "relax", "duration": 30},
  {"time": "18:00", "event": "下班通勤", "mood": "chill", "duration": 45},
  {"time": "22:00", "event": "睡前放松", "mood": "calm", "duration": 60}
]
```

- [ ] **步骤 2：在 server.js 添加日历 API**

```javascript
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
```

- [ ] **步骤 3：创建 voice.js（Mock TTS）**

```javascript
// public/js/voice.js
const synth = window.speechSynthesis;
let isSpeaking = false;

function speak(text) {
  if (!synth || isSpeaking) return;
  isSpeaking = true;

  // 降低背景音乐音量
  window.dispatchEvent(new CustomEvent('voiceStart'));

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onend = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
  };

  utterance.onerror = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
  };

  synth.speak(utterance);
}

function stop() {
  if (synth) synth.cancel();
  isSpeaking = false;
  window.dispatchEvent(new CustomEvent('voiceEnd'));
}

window.voice = { speak, stop, isSpeaking: () => isSpeaking };
```

- [ ] **步骤 4：在 player.js 中添加音频闪避**

在 player.js 的事件绑定部分添加：

```javascript
// DJ 语音音频闪避
window.addEventListener('voiceStart', () => {
  audio.volume = 0.2;
});

window.addEventListener('voiceEnd', () => {
  // 渐变恢复音量
  const target = parseFloat(document.querySelector('#volumeSlider')?.value || 0.8);
  let current = 0.2;
  const fade = setInterval(() => {
    current = Math.min(current + 0.05, target);
    audio.volume = current;
    if (current >= target) clearInterval(fade);
  }, 50);
});
```

- [ ] **步骤 5：测试**

```bash
curl http://localhost:3001/api/schedule
# 预期: 日程数据数组
```

- [ ] **步骤 6：提交**

```bash
git add -A
git commit -m "feat: Mock 日历模块 + Web Speech API TTS + 音频闪避"
```

---

## Task 13：头像弹出面板

**文件：**
- 修改：`public/js/chat.js` 或新建 `public/js/panels.js`
- 修改：`public/index.html`

- [ ] **步骤 1：在 index.html 底部（toast 之前）添加面板 HTML**

```html
<!-- DJ 信息面板 -->
<div class="panel-overlay" id="djPanel" style="display:none">
  <div class="panel-content">
    <div class="panel-header">
      <h3>Claudio FM</h3>
      <button class="panel-close" onclick="document.getElementById('djPanel').style.display='none'">✕</button>
    </div>
    <div class="panel-body">
      <div class="panel-section">
        <h4>电台简介</h4>
        <p id="stationInfo" style="color:var(--text-secondary);font-size:14px;line-height:1.6">
          Claudio 的个人 AI 电台，品味独到，只播好歌。
        </p>
      </div>
      <div class="panel-section">
        <h4>你的音乐品味画像</h4>
        <div id="tasteProfile" style="color:var(--text-secondary);font-size:14px;line-height:1.6">
          加载中...
        </div>
      </div>
    </div>
  </div>
</div>

<!-- 用户信息面板 -->
<div class="panel-overlay" id="userPanel" style="display:none">
  <div class="panel-content">
    <div class="panel-header">
      <h3>我的音乐</h3>
      <button class="panel-close" onclick="document.getElementById('userPanel').style.display='none'">✕</button>
    </div>
    <div class="panel-body">
      <div class="panel-section">
        <h4>喜欢的歌曲</h4>
        <div id="favoritesList" style="font-size:14px">加载中...</div>
      </div>
      <div class="panel-section">
        <h4>最近播放</h4>
        <div id="historyList" style="font-size:14px">加载中...</div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **步骤 2：添加面板 CSS**

在 `main.css` 末尾添加：

```css
/* 弹出面板 */
.panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.panel-content {
  width: 100%;
  max-width: 440px;
  max-height: 70vh;
  background: var(--bg-card);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  overflow-y: auto;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--bg-card);
}

.panel-header h3 { font-size: 16px; }

.panel-close {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.1);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
}

.panel-body { padding: 16px 20px; }

.panel-section { margin-bottom: 20px; }
.panel-section h4 { font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }

.panel-song {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.panel-song:last-child { border-bottom: none; }
.panel-song-cover { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; }
.panel-song-name { font-size: 13px; font-weight: 500; }
.panel-song-artist { font-size: 11px; color: var(--text-muted); }
```

- [ ] **步骤 3：添加面板逻辑**

在 `chat.js` 末尾或新建 `panels.js`：

```javascript
// 头像面板逻辑
const { server } = await import('./api.js');

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
```

- [ ] **步骤 4：浏览器验证**

- 点击 Claudio 头像弹出电台信息面板
- 点击用户头像弹出个人面板（收藏/历史）
- 点击遮罩或关闭按钮可关闭

- [ ] **步骤 5：提交**

```bash
git add -A
git commit -m "feat: 头像弹出面板（电台信息/品味画像/收藏/历史）"
```

---

## Task 14：最终集成 + 错误处理

**文件：**
- 修改：`public/js/app.js`
- 修改：`public/js/player.js`

- [ ] **步骤 1：完善 app.js 最终版本**

```javascript
// public/js/app.js
import { restorePlayback } from './player.js';
import { initVisual, extractColors } from './visual.js';
import { updateLyrics } from './lyrics.js';
import { loadChatHistory } from './chat.js';

console.log('Claudio FM 启动中...');

// Toast 工具
window.showToast = function(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
};

// 初始化
async function init() {
  try {
    initVisual();
    await restorePlayback();
    await loadChatHistory();
    console.log('Claudio FM 初始化完成');
  } catch (err) {
    console.error('初始化失败:', err);
    window.showToast('初始化失败，请刷新重试');
  }
}

init();

// 歌词同步
window.addEventListener('timeupdate', (e) => {
  updateLyrics(e.detail);
});

// 歌曲变化时取色
window.addEventListener('songchange', (e) => {
  const song = e.detail;
  if (song.cover) extractColors(song.cover);
});
```

- [ ] **步骤 2：在 player.js 添加错误处理**

在 `audio.addEventListener('ended', ...)` 之后添加：

```javascript
audio.addEventListener('error', () => {
  window.showToast('播放出错，自动跳到下一首');
  playNext();
});
```

- [ ] **步骤 3：完整浏览器测试流程**

1. 打开 http://localhost:3001
2. 搜索一首歌：输入"搜索周杰伦"并发送
3. 点击歌曲卡片的播放按钮
4. 验证：封面显示、进度条走动、歌词加载
5. 点击封面翻转查看歌词
6. 点击收藏按钮
7. 切换主题
8. 点击头像查看面板
9. 关闭浏览器重新打开，验证续播

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: 最终集成 + 错误处理 + 完整初始化流程"
```

---

## Task 15：DJ 语音沉浸模式

**文件：**
- 创建：`public/js/voice.js`（已部分完成，补充沉浸模式 UI）
- 修改：`public/index.html`

- [ ] **步骤 1：在 index.html 添加语音模式 overlay**

```html
<!-- DJ 语音沉浸模式 -->
<div class="voice-mode-overlay" id="voiceOverlay" style="display:none">
  <button class="voice-close" id="voiceClose">✕</button>
  <canvas class="voice-wave-canvas" id="voiceWaveCanvas" width="400" height="120"></canvas>
  <div class="voice-text" id="voiceText"></div>
</div>
```

- [ ] **步骤 2：完善 voice.js 添加沉浸模式**

```javascript
// public/js/voice.js
const synth = window.speechSynthesis;
let isSpeaking = false;
let waveAnimId = null;

const overlay = document.getElementById('voiceOverlay');
const waveCanvas = document.getElementById('voiceWaveCanvas');
const voiceText = document.getElementById('voiceText');
const voiceClose = document.getElementById('voiceClose');

const waveCtx = waveCanvas?.getContext('2d');

function drawVoiceWave() {
  if (!waveCtx) return;
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);

  const bars = 40;
  const barW = w / bars - 2;
  for (let i = 0; i < bars; i++) {
    const barH = isSpeaking
      ? 10 + Math.random() * (h - 20)
      : 4 + Math.sin(i * 0.3 + Date.now() * 0.003) * 4;
    const x = i * (barW + 2);
    waveCtx.fillStyle = isSpeaking
      ? `rgba(74, 108, 247, ${0.5 + Math.random() * 0.5})`
      : 'rgba(74, 108, 247, 0.3)';
    waveCtx.fillRect(x, (h - barH) / 2, barW, barH);
  }
  waveAnimId = requestAnimationFrame(drawVoiceWave);
}

function speak(text) {
  if (!synth || isSpeaking) return;
  isSpeaking = true;

  // 显示沉浸模式
  overlay.style.display = 'flex';
  voiceText.textContent = text;
  drawVoiceWave();

  // 降低背景音乐
  window.dispatchEvent(new CustomEvent('voiceStart'));

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.pitch = 1;

  utterance.onend = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
    setTimeout(() => {
      overlay.style.display = 'none';
      if (waveAnimId) cancelAnimationFrame(waveAnimId);
    }, 1000);
  };

  utterance.onerror = () => {
    isSpeaking = false;
    window.dispatchEvent(new CustomEvent('voiceEnd'));
    overlay.style.display = 'none';
  };

  synth.speak(utterance);
}

function stop() {
  if (synth) synth.cancel();
  isSpeaking = false;
  window.dispatchEvent(new CustomEvent('voiceEnd'));
  overlay.style.display = 'none';
}

voiceClose?.addEventListener('click', stop);

window.voice = { speak, stop, isSpeaking: () => isSpeaking };
```

- [ ] **步骤 3：浏览器验证**

- 聊天中点击语音播放按钮，弹出沉浸模式
- 显示实时波形 + 语音文字
- 背景音乐自动降低
- 关闭或语音结束后恢复

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "feat: DJ 语音沉浸模式（波形可视化 + 音频闪避）"
```

---

## 最终验证清单

- [ ] 服务启动正常（`npm start`）
- [ ] 移动端布局显示正常
- [ ] 搜索歌曲、播放歌曲正常
- [ ] 进度条可拖拽
- [ ] 收藏/取消收藏正常
- [ ] 歌词加载 + 翻转 + 逐行高亮
- [ ] 聊天发送消息、收到回复
- [ ] 歌曲卡片播放/添加按钮正常
- [ ] 无直链歌曲卡片置灰
- [ ] 主题切换正常
- [ ] 流体背景动画正常
- [ ] 粒子特效触发正常
- [ ] 头像面板弹出正常
- [ ] 数据库持久化正常（重启后数据不丢失）
- [ ] 跨会话续播正常
- [ ] 定时任务 API 正常
- [ ] DJ 语音沉浸模式正常
