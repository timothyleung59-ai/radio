# 歌单 + 灵感页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现歌单功能 + 灵感页（替代搜索页），按 spec `docs/superpowers/specs/2026-05-03-playlist-and-inspiration-design.md` 落地。

**Architecture:** Server 加 8 个 RESTful 端点 + DB 加 2 张表；Client 在 `Index.ets` 加新 @State 字段 + UI 区块 + 状态机；复用已有的 `/api/dj/playlist-intros`（playlist 串词）和 `/api/radio/next` 的 `adhocStyle` 字段（临时电台）。

**Tech Stack:** Node.js + Express + better-sqlite3 (server)；HarmonyOS NEXT ArkTS + ArkUI（client）；fetch via existing api.ets 包装。

---

## 文件清单

**新建**：
- `server.js` 内嵌迁移块（DB schema 加表）
- 灵感页 chips 拼 adhocStyle helper（client，inline 在 Index.ets）

**修改**：
- `server.js` — 加 8 个 playlist 路由 + 1 个 schema 迁移块
- `Claudio/entry/src/main/ets/services/api.ets` — 加 PlaylistRow / PlaylistDetailRow 类型 + 8 个 fetch 函数
- `Claudio/entry/src/main/ets/types.ets` — 加 PlaylistSong 等类型
- `Claudio/entry/src/main/ets/pages/Index.ets` — 主要改动
  - 加 @State 字段（adhocChips / adhocStyleActive / activePlaylist*）
  - 灵感页 UI 改造（chips + 状态切换）
  - 搜索结果 / 历史 / 收藏 三处加 [+加入歌单] 按钮 + picker dialog
  - 资料页加"我的歌单"区
  - 歌单详情页（subview）+ 操作菜单
  - 歌单播放状态机
  - getNext 调用都带上 adhocStyle / playlist context

**不动**：
- `lib/prompt-builder.js`
- `Claudio/entry/src/main/ets/services/player.ets`

---

## 阶段总览

| 阶段 | 任务数 | 预估 |
|---|---|---|
| A. Server playlist CRUD + 部署验证 | 10 | 3-4h |
| B. Client API + 类型 | 3 | 1h |
| C. "+加入歌单" 按钮 + picker | 4 | 2-3h |
| D. 资料页歌单管理 | 3 | 3-4h |
| E. 歌单播放状态机 | 5 | 2-3h |
| F. 灵感页改造 + adhocStyle 贯穿 | 4 | 3-4h |
| G. 端到端验收 | 3 | 1-2h |
| **总计** | **32** | **15-21h** |

---

# Phase A: Server playlist CRUD

## Task A1: DB schema 迁移

**Files:**
- Modify: `server.js`（在 db init 块加新表）

- [ ] **Step 1: 找到现有 schema init 区**

`grep -n 'CREATE TABLE.*play_history' server.js` 应返回 line ~68。schema init 是从 db.exec(``) 块开始的多行。

- [ ] **Step 2: 在已有 schema 块尾部加 user_playlists 和 user_playlist_songs 两表 + 索引**

在 `CREATE INDEX IF NOT EXISTS idx_ph_user_score_played` 之后插入：

```sql
  CREATE TABLE IF NOT EXISTS user_playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('default','work','workout','drive','relax','sleep')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_playlists_user ON user_playlists(user_id);

  CREATE TABLE IF NOT EXISTS user_playlist_songs (
    playlist_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    song_name TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    cover_url TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, position),
    FOREIGN KEY (playlist_id) REFERENCES user_playlists(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_songs_id ON user_playlist_songs(playlist_id);
```

- [ ] **Step 3: 本地启动验证 schema 创建成功**

```bash
cd C:/Users/xiaotim/Documents/Claude/Projects/radio
node -e "require('./server.js')" &
sleep 2
sqlite3 data/claudio.db ".schema user_playlists"
sqlite3 data/claudio.db ".schema user_playlist_songs"
pkill -f "node.*server.js"
```

Expected: 两个 schema 都列出，无 error。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(playlist): DB schema for user_playlists + user_playlist_songs"
```

---

## Task A2: GET /api/playlists（列表）

**Files:**
- Modify: `server.js`（在 `/api/dj/playlist-intros` 路由之后加）

- [ ] **Step 1: 找插入位置**

`grep -n "/api/dj/playlist-intros" server.js`，在该路由 `}); ` 之后插入新代码块。

- [ ] **Step 2: 加路由代码**

```javascript
// ========== Playlist CRUD ==========
// 列出当前用户所有歌单（含 song count）
app.get('/api/playlists', (req, res) => {
  const uid = userIdOf(req);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.mode, p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM user_playlist_songs WHERE playlist_id = p.id) AS song_count
    FROM user_playlists p
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC
  `).all(uid);
  res.json({ playlists: rows });
});
```

- [ ] **Step 3: curl 测试**

```bash
node --check server.js && echo OK
# 启动 server (本地或部署后)
curl -s http://127.0.0.1:3001/api/playlists | python3 -m json.tool
```

Expected: `{"playlists": []}` 或者已有歌单数组。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(playlist): GET /api/playlists"
```

---

## Task A3: POST /api/playlists（新建）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 在 GET /api/playlists 后插入 POST 路由**

```javascript
// 新建歌单 { name?, mode } → 返回 { id, name, mode }
// 名字为空时自动生成 "我的{mode label}歌单 #{N}"
app.post('/api/playlists', (req, res) => {
  const uid = userIdOf(req);
  const mode = req.body?.mode;
  if (!mode || !RADIO_MODES[mode]) {
    return res.status(400).json({ error: 'mode 必填且必须是 6 个 RADIO_MODES 之一' });
  }
  let name = (req.body?.name || '').toString().trim().slice(0, 50);
  if (!name) {
    const cnt = db.prepare(
      'SELECT COUNT(*) AS n FROM user_playlists WHERE user_id=? AND mode=?'
    ).get(uid, mode).n;
    name = `我的${RADIO_MODES[mode].label}歌单 #${cnt + 1}`;
  }
  const r = db.prepare(
    'INSERT INTO user_playlists (user_id, name, mode) VALUES (?, ?, ?)'
  ).run(uid, name, mode);
  res.json({ id: r.lastInsertRowid, name, mode });
});
```

- [ ] **Step 2: curl 测试创建**

```bash
curl -s -X POST http://127.0.0.1:3001/api/playlists \
  -H "Content-Type: application/json" \
  -d '{"mode":"relax"}' | python3 -m json.tool
```

Expected: `{"id": 1, "name": "我的休息模式歌单 #1", "mode": "relax"}`（注意 label 实际是"休息模式"——见 RADIO_MODES.relax.label）

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(playlist): POST /api/playlists with auto-naming"
```

---

## Task A4: GET /api/playlists/:id（详情）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 在 POST /api/playlists 后插入**

```javascript
// 单个歌单详情 + 全部歌曲（按 position 升序）
app.get('/api/playlists/:id', (req, res) => {
  const uid = userIdOf(req);
  const id = parseInt(req.params.id, 10);
  const p = db.prepare(
    'SELECT id, name, mode, created_at, updated_at FROM user_playlists WHERE id=? AND user_id=?'
  ).get(id, uid);
  if (!p) return res.status(404).json({ error: '歌单不存在或无权限' });
  const songs = db.prepare(`
    SELECT position, song_id, song_name, artist, album, cover_url, added_at
    FROM user_playlist_songs WHERE playlist_id=? ORDER BY position ASC
  `).all(id);
  res.json({ playlist: p, songs });
});
```

- [ ] **Step 2: curl 测试**

```bash
curl -s http://127.0.0.1:3001/api/playlists/1 | python3 -m json.tool
```

Expected: `{"playlist": {...}, "songs": []}` for newly-created.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(playlist): GET /api/playlists/:id detail"
```

---

## Task A5: PATCH /api/playlists/:id（改名 / 改 mode）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 加路由**

```javascript
// 改名 / 改 mode { name?, mode? }
app.patch('/api/playlists/:id', (req, res) => {
  const uid = userIdOf(req);
  const id = parseInt(req.params.id, 10);
  const exists = db.prepare(
    'SELECT id FROM user_playlists WHERE id=? AND user_id=?'
  ).get(id, uid);
  if (!exists) return res.status(404).json({ error: '歌单不存在或无权限' });

  const updates = [];
  const args = [];
  if (typeof req.body?.name === 'string') {
    const name = req.body.name.trim().slice(0, 50);
    if (!name) return res.status(400).json({ error: 'name 不能为空字符串' });
    updates.push('name = ?'); args.push(name);
  }
  if (typeof req.body?.mode === 'string') {
    if (!RADIO_MODES[req.body.mode]) return res.status(400).json({ error: 'mode 非法' });
    updates.push('mode = ?'); args.push(req.body.mode);
  }
  if (updates.length === 0) return res.status(400).json({ error: '至少一个字段' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(id);
  db.prepare(`UPDATE user_playlists SET ${updates.join(', ')} WHERE id=?`).run(...args);
  res.json({ ok: true });
});
```

- [ ] **Step 2: curl 测试改名 + 改 mode**

```bash
curl -s -X PATCH http://127.0.0.1:3001/api/playlists/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"我的睡前神曲"}' | python3 -m json.tool
curl -s http://127.0.0.1:3001/api/playlists/1 | python3 -c "import json,sys; print(json.load(sys.stdin)['playlist']['name'])"
```

Expected: 第二行打出 `我的睡前神曲`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(playlist): PATCH /api/playlists/:id rename and re-mode"
```

---

## Task A6: DELETE /api/playlists/:id

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 加路由（CASCADE 自动删 songs）**

```javascript
app.delete('/api/playlists/:id', (req, res) => {
  const uid = userIdOf(req);
  const id = parseInt(req.params.id, 10);
  const r = db.prepare(
    'DELETE FROM user_playlists WHERE id=? AND user_id=?'
  ).run(id, uid);
  if (r.changes === 0) return res.status(404).json({ error: '歌单不存在或无权限' });
  res.json({ ok: true });
});
```

- [ ] **Step 2: 测试删除 + 验证 CASCADE**

```bash
# 创建一个有歌的歌单测试 CASCADE，先把后面 A7 的 add-song 写完再回来测
# 这一步 commit 即可
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(playlist): DELETE /api/playlists/:id with cascade"
```

---

## Task A7: POST /api/playlists/:id/songs（加歌）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 加路由（同 song_id 跳过）**

```javascript
// 加歌 { song: { id, name, artist, album?, cover? } } → { ok, position?, skipped? }
// dedup: 同 song_id 已经在歌单 → 返 200 + skipped:true
app.post('/api/playlists/:id/songs', (req, res) => {
  const uid = userIdOf(req);
  const id = parseInt(req.params.id, 10);
  const song = req.body?.song;
  if (!song?.id || !song?.name) return res.status(400).json({ error: 'song.id 和 song.name 必填' });

  const exists = db.prepare(
    'SELECT id FROM user_playlists WHERE id=? AND user_id=?'
  ).get(id, uid);
  if (!exists) return res.status(404).json({ error: '歌单不存在或无权限' });

  const dup = db.prepare(
    'SELECT position FROM user_playlist_songs WHERE playlist_id=? AND song_id=?'
  ).get(id, String(song.id));
  if (dup) return res.json({ ok: true, skipped: true, position: dup.position });

  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS m FROM user_playlist_songs WHERE playlist_id=?'
  ).get(id).m;
  const newPos = maxPos + 1;
  db.prepare(`
    INSERT INTO user_playlist_songs (playlist_id, position, song_id, song_name, artist, album, cover_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, newPos, String(song.id), song.name, song.artist || '', song.album || '', song.cover || '');
  db.prepare('UPDATE user_playlists SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  res.json({ ok: true, position: newPos });
});
```

- [ ] **Step 2: curl 加歌测试**

```bash
curl -s -X POST http://127.0.0.1:3001/api/playlists/1/songs \
  -H "Content-Type: application/json" \
  -d '{"song":{"id":"3986017","name":"Viva La Vida","artist":"Coldplay"}}' | python3 -m json.tool
# 再加同一首测 dedup
curl -s -X POST http://127.0.0.1:3001/api/playlists/1/songs \
  -H "Content-Type: application/json" \
  -d '{"song":{"id":"3986017","name":"Viva La Vida","artist":"Coldplay"}}' | python3 -m json.tool
```

Expected: 第一次返回 `{"ok": true, "position": 0}`，第二次 `{"ok": true, "skipped": true, "position": 0}`

- [ ] **Step 3: 测 CASCADE（删歌单 → song 也没了）**

```bash
curl -s -X DELETE http://127.0.0.1:3001/api/playlists/1
sqlite3 data/claudio.db "SELECT COUNT(*) FROM user_playlist_songs WHERE playlist_id=1;"
```

Expected: 0

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(playlist): POST /api/playlists/:id/songs with dedup"
```

---

## Task A8: DELETE /api/playlists/:id/songs/:position（删歌）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 加路由（删后 position 上移）**

```javascript
// 删第 N 位歌曲，后面歌曲 position - 1
app.delete('/api/playlists/:id/songs/:position', (req, res) => {
  const uid = userIdOf(req);
  const id = parseInt(req.params.id, 10);
  const pos = parseInt(req.params.position, 10);

  const exists = db.prepare(
    'SELECT id FROM user_playlists WHERE id=? AND user_id=?'
  ).get(id, uid);
  if (!exists) return res.status(404).json({ error: '歌单不存在或无权限' });

  const tx = db.transaction(() => {
    const r = db.prepare(
      'DELETE FROM user_playlist_songs WHERE playlist_id=? AND position=?'
    ).run(id, pos);
    if (r.changes === 0) return false;
    db.prepare(
      'UPDATE user_playlist_songs SET position = position - 1 WHERE playlist_id=? AND position > ?'
    ).run(id, pos);
    db.prepare('UPDATE user_playlists SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    return true;
  });
  if (!tx()) return res.status(404).json({ error: 'position 不存在' });
  res.json({ ok: true });
});
```

- [ ] **Step 2: 测试**

```bash
# 先创建歌单加 3 首
curl -s -X POST http://127.0.0.1:3001/api/playlists -H "Content-Type: application/json" -d '{"mode":"relax"}'
curl -s -X POST http://127.0.0.1:3001/api/playlists/2/songs -H "Content-Type: application/json" -d '{"song":{"id":"a","name":"A","artist":"X"}}'
curl -s -X POST http://127.0.0.1:3001/api/playlists/2/songs -H "Content-Type: application/json" -d '{"song":{"id":"b","name":"B","artist":"Y"}}'
curl -s -X POST http://127.0.0.1:3001/api/playlists/2/songs -H "Content-Type: application/json" -d '{"song":{"id":"c","name":"C","artist":"Z"}}'
# 删中间那首（position=1，"B"）
curl -s -X DELETE http://127.0.0.1:3001/api/playlists/2/songs/1
# 验证：A 还在 position=0，C 应该移到 position=1
curl -s http://127.0.0.1:3001/api/playlists/2 | python3 -m json.tool
```

Expected: `songs: [{position:0,song_name:"A"...}, {position:1,song_name:"C"...}]`（B 删掉，C 上移）

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(playlist): DELETE /api/playlists/:id/songs/:position with reindex"
```

---

## Task A9: PATCH /api/playlists/:id/reorder（拖动排序）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 加路由**

```javascript
// 重排 { songIds: ['id1','id2',...] }，长度必须 = 现有 song count，
// 元素必须就是当前所有 song_id 的一个排列
app.patch('/api/playlists/:id/reorder', (req, res) => {
  const uid = userIdOf(req);
  const id = parseInt(req.params.id, 10);
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds.map(String) : null;
  if (!songIds) return res.status(400).json({ error: 'songIds 必填且为字符串数组' });

  const exists = db.prepare(
    'SELECT id FROM user_playlists WHERE id=? AND user_id=?'
  ).get(id, uid);
  if (!exists) return res.status(404).json({ error: '歌单不存在或无权限' });

  const current = db.prepare(
    'SELECT song_id FROM user_playlist_songs WHERE playlist_id=?'
  ).all(id).map(r => r.song_id);
  if (current.length !== songIds.length || !current.every(x => songIds.includes(x))) {
    return res.status(400).json({ error: 'songIds 必须刚好是当前歌单所有 song_id 的一个排列' });
  }

  const tx = db.transaction(() => {
    // 用临时负数 position 避免 PRIMARY KEY 冲突
    db.prepare('UPDATE user_playlist_songs SET position = -position - 1 WHERE playlist_id=?').run(id);
    const stmt = db.prepare(
      'UPDATE user_playlist_songs SET position = ? WHERE playlist_id=? AND song_id=?'
    );
    songIds.forEach((sid, i) => stmt.run(i, id, sid));
    db.prepare('UPDATE user_playlists SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  });
  tx();
  res.json({ ok: true });
});
```

- [ ] **Step 2: 测试重排**

```bash
# 接 A8 之后的歌单 2 (A position=0, C position=1)，反着重排
curl -s -X PATCH http://127.0.0.1:3001/api/playlists/2/reorder \
  -H "Content-Type: application/json" -d '{"songIds":["c","a"]}'
curl -s http://127.0.0.1:3001/api/playlists/2 | python3 -m json.tool
```

Expected: `songs: [{position:0,song_id:"c"...}, {position:1,song_id:"a"...}]`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(playlist): PATCH /api/playlists/:id/reorder"
```

---

## Task A10: 部署 + 端到端 curl 测全部

- [ ] **Step 1: scp + rebuild**

```bash
cd C:/Users/xiaotim/Documents/Claude/Projects/radio
scp -o BatchMode=yes server.js root@124.222.32.27:/root/claudio/
ssh -o BatchMode=yes root@124.222.32.27 "cd /root/claudio && docker-compose up -d --build claudio 2>&1 | tail -3 && sleep 6 && docker-compose ps"
```

Expected: `claudio-fm Up X seconds (healthy)`

- [ ] **Step 2: 跑完整 CRUD 流程**

```bash
ssh -o BatchMode=yes root@124.222.32.27 'echo "=== 1. list (空) ==="
curl -s http://127.0.0.1:8081/api/playlists
echo ""
echo "=== 2. 创建一个 ==="
PID=$(curl -s -X POST http://127.0.0.1:8081/api/playlists -H "Content-Type: application/json" -d "{\"mode\":\"relax\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)[\"id\"])")
echo "Created id=$PID"
echo "=== 3. 加 3 首 ==="
curl -s -X POST http://127.0.0.1:8081/api/playlists/$PID/songs -H "Content-Type: application/json" -d "{\"song\":{\"id\":\"3986017\",\"name\":\"Viva La Vida\",\"artist\":\"Coldplay\"}}" > /dev/null
curl -s -X POST http://127.0.0.1:8081/api/playlists/$PID/songs -H "Content-Type: application/json" -d "{\"song\":{\"id\":\"460043703\",\"name\":\"Perfect\",\"artist\":\"Ed Sheeran\"}}" > /dev/null
curl -s -X POST http://127.0.0.1:8081/api/playlists/$PID/songs -H "Content-Type: application/json" -d "{\"song\":{\"id\":\"21157332\",\"name\":\"One Day\",\"artist\":\"Matisyahu\"}}" > /dev/null
echo "=== 4. detail ==="
curl -s http://127.0.0.1:8081/api/playlists/$PID | python3 -m json.tool
echo "=== 5. reorder 反过来 ==="
curl -s -X PATCH http://127.0.0.1:8081/api/playlists/$PID/reorder -H "Content-Type: application/json" -d "{\"songIds\":[\"21157332\",\"460043703\",\"3986017\"]}"
echo ""
echo "=== 6. delete position=1 (中间) ==="
curl -s -X DELETE http://127.0.0.1:8081/api/playlists/$PID/songs/1
echo ""
echo "=== 7. 列表 ==="
curl -s http://127.0.0.1:8081/api/playlists | python3 -m json.tool
echo "=== 8. 删歌单 ==="
curl -s -X DELETE http://127.0.0.1:8081/api/playlists/$PID
echo "=== done ==="'
```

Expected: 每步都返回合理 JSON，最后列表确认歌单已删。

- [ ] **Step 3: push 到 origin**

```bash
git push origin main
```

---

# Phase B: Client API + 类型

## Task B1: types.ets 加 Playlist 相关类型

**Files:**
- Modify: `Claudio/entry/src/main/ets/types.ets`

- [ ] **Step 1: 在 types.ets 末尾加**

```ts
// 歌单（资料页列表用）
export interface Playlist {
  id: number;
  name: string;
  mode: string;            // 'default' | 'work' | ...
  song_count: number;
  created_at: string;
  updated_at: string;
}

// 歌单内的单首歌（详情页用）
export interface PlaylistSong {
  position: number;
  song_id: string;
  song_name: string;
  artist: string;
  album: string;
  cover_url: string;
  added_at: string;
}

// 歌单详情（playlist + songs）
export interface PlaylistDetail {
  playlist: { id: number; name: string; mode: string; created_at: string; updated_at: string };
  songs: PlaylistSong[];
}
```

- [ ] **Step 2: Commit**

```bash
git add Claudio/entry/src/main/ets/types.ets
git commit -m "feat(client): playlist types"
```

---

## Task B2: api.ets 加 8 个 playlist 函数

**Files:**
- Modify: `Claudio/entry/src/main/ets/services/api.ets`

- [ ] **Step 1: 在 expandDjIntro 后追加（约 line 245 附近）**

```ts
import { Playlist, PlaylistDetail, PlaylistSong, Song } from '../types';

interface PlaylistsListResp { playlists: Playlist[] }
interface PlaylistCreateBody { name?: string; mode: string }
interface PlaylistCreateResp { id: number; name: string; mode: string }
interface PlaylistPatchBody { name?: string; mode?: string }
interface AddSongBody { song: Song }
interface AddSongResp { ok: boolean; skipped?: boolean; position?: number }

export async function listPlaylists(): Promise<Playlist[]> {
  const r = await request<PlaylistsListResp>(http.RequestMethod.GET, '/api/playlists');
  return r.playlists ?? [];
}

export async function getPlaylist(id: number): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(http.RequestMethod.GET, `/api/playlists/${id}`);
}

export async function createPlaylist(mode: string, name?: string): Promise<PlaylistCreateResp> {
  const body: PlaylistCreateBody = { mode };
  if (name && name.length > 0) body.name = name;
  return request<PlaylistCreateResp>(http.RequestMethod.POST, '/api/playlists', body);
}

export async function patchPlaylist(id: number, patch: PlaylistPatchBody): Promise<Object> {
  return request<Object>(http.RequestMethod.PATCH, `/api/playlists/${id}`, patch);
}

export async function deletePlaylist(id: number): Promise<Object> {
  return request<Object>(http.RequestMethod.DELETE, `/api/playlists/${id}`);
}

export async function addSongToPlaylist(playlistId: number, song: Song): Promise<AddSongResp> {
  const body: AddSongBody = { song };
  return request<AddSongResp>(http.RequestMethod.POST, `/api/playlists/${playlistId}/songs`, body);
}

export async function removeSongFromPlaylist(playlistId: number, position: number): Promise<Object> {
  return request<Object>(http.RequestMethod.DELETE, `/api/playlists/${playlistId}/songs/${position}`);
}

interface ReorderBody { songIds: string[] }
export async function reorderPlaylist(playlistId: number, songIds: string[]): Promise<Object> {
  const body: ReorderBody = { songIds };
  return request<Object>(http.RequestMethod.PATCH, `/api/playlists/${playlistId}/reorder`, body);
}
```

- [ ] **Step 2: DJ playlist intros 函数（如果还没就加）**

```ts
interface PlaylistIntrosBody { songs: Song[]; mode?: string; length?: string }
interface PlaylistIntrosResp { intros: string[]; fallback?: boolean }

export async function getPlaylistIntros(songs: Song[], mode: string, length: string = 'short'): Promise<PlaylistIntrosResp> {
  const body: PlaylistIntrosBody = { songs, mode, length };
  return request<PlaylistIntrosResp>(http.RequestMethod.POST, '/api/dj/playlist-intros', body);
}
```

- [ ] **Step 3: Commit**

```bash
git add Claudio/entry/src/main/ets/services/api.ets
git commit -m "feat(client): playlist API + getPlaylistIntros"
```

---

## Task B3: 编译通过验证

- [ ] **Step 1: DevEco Studio Build → Make Module 'entry'**

期望：编译通过，0 error 0 warning。

- [ ] **Step 2: 出错时排查**

常见错误：
- `Song` 类型未导入 → 在 api.ets 顶部 `import { ... Song } from '../types';`
- `request` 未定义 → 在 api.ets 现有内部 helper

- [ ] **Step 3: Commit（如有 fix）**

---

# Phase C: "+加入歌单" 按钮 + picker

## Task C1: 灵感页（搜索结果）每行加 "+加入歌单" 按钮

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 找搜索结果渲染**

`grep -n "searchResults\|Search Result" Index.ets` 找到搜索结果列表的 ForEach 块。

- [ ] **Step 2: 每行 Row 末尾加 "+" 图标按钮**

在搜索结果 row 里、原 [▶ 播放] 按钮旁加：

```ts
Image($r('app.media.ic_add'))
  .width(20).height(20).fillColor(TK_FG_2)
  .margin({ left: 8 })
  .onClick((): void => {
    this.openAddToPlaylistPicker(song);
  })
```

`song` 是 ForEach 当前项。`openAddToPlaylistPicker` 在 Task C4 里实现。

如果没有 `app.media.ic_add` 资源，用 Text('＋') 暂代。

- [ ] **Step 3: Commit**

```bash
git add Claudio/entry/src/main/ets/pages/Index.ets
git commit -m "feat(client): + button on search results"
```

---

## Task C2: 历史列表每行加 "+加入歌单" 按钮

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 找历史列表行渲染**

`grep -n "historyToSong\|历史 row" Index.ets` 找到。

- [ ] **Step 2: 同 C1 加按钮，onClick 调 `openAddToPlaylistPicker(this.historyToSong(h))`**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): + button on history rows"
```

---

## Task C3: 收藏列表每行加 "+加入歌单" 按钮

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 找收藏列表行渲染**

`grep -n "favRowToSong\|收藏 row" Index.ets`。

- [ ] **Step 2: 同 C1 加按钮，onClick 调 `openAddToPlaylistPicker(this.favRowToSong(f))`**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): + button on favorites rows"
```

---

## Task C4: 加入歌单 picker dialog

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加 @State 字段（class 顶部）**

```ts
@State addToPlaylistDialogOpen: boolean = false;
@State addToPlaylistTargetSong: Song | null = null;
@State addToPlaylistList: Playlist[] = [];

// 新建歌单子对话框
@State newPlaylistDialogOpen: boolean = false;
@State newPlaylistName: string = '';
@State newPlaylistMode: string = 'default';
```

- [ ] **Step 2: 加打开 picker 方法**

```ts
async openAddToPlaylistPicker(song: Song): Promise<void> {
  this.addToPlaylistTargetSong = song;
  try {
    this.addToPlaylistList = await listPlaylists();
  } catch (e) { this.addToPlaylistList = []; }
  this.addToPlaylistDialogOpen = true;
}
```

- [ ] **Step 3: 加 picker UI Builder（用 @Builder 装饰器，或 if 块嵌入主页面）**

简化版：用 if 在主 Stack 里渲染遮罩 + 卡片：

```ts
if (this.addToPlaylistDialogOpen) {
  Stack() {
    // 半透明背景
    Column().width('100%').height('100%').backgroundColor('#000000C0')
      .onClick((): void => { this.addToPlaylistDialogOpen = false; })
    // 卡片
    Column() {
      Text('加入歌单').fontSize(18).fontWeight(600).margin({ bottom: 16 })
      // 现有歌单列表
      if (this.addToPlaylistList.length > 0) {
        List() {
          ForEach(this.addToPlaylistList, (p: Playlist) => {
            ListItem() {
              Row() {
                Text(p.name).layoutWeight(1).fontSize(15)
                Text(this.modeLabel(p.mode)).fontSize(12).fontColor('#888').margin({ right: 8 })
                Text(p.song_count.toString() + ' 首').fontSize(12).fontColor('#888')
              }.padding(12).width('100%')
            }.onClick((): void => { this.addSongToExistingPlaylist(p.id); })
          }, (p: Playlist): string => p.id.toString())
        }.height(240).width('100%')
        Divider()
      }
      Row() {
        Text('➕ 新建歌单').fontSize(15).fontColor('#1E90FF')
      }.padding(12).width('100%')
        .onClick((): void => {
          this.addToPlaylistDialogOpen = false;
          this.newPlaylistDialogOpen = true;
        })
    }.width('80%').backgroundColor('#FFFFFF').borderRadius(12).padding(16)
  }.width('100%').height('100%').zIndex(99)
}

// 新建歌单子对话框（类似结构，含 name TextInput + 6 个 mode chip + 取消/创建）
if (this.newPlaylistDialogOpen) {
  // ... 详见下面 Step 4
}
```

- [ ] **Step 4: 新建歌单对话框 + 加歌方法**

```ts
@Builder NewPlaylistDialog() {
  Stack() {
    Column().width('100%').height('100%').backgroundColor('#000000C0')
      .onClick((): void => { this.newPlaylistDialogOpen = false; })
    Column() {
      Text('新建歌单').fontSize(18).fontWeight(600).margin({ bottom: 16 })
      TextInput({ placeholder: '名字（留空自动命名）', text: this.newPlaylistName })
        .onChange((v: string): void => { this.newPlaylistName = v; })
      Text('模式').fontSize(13).fontColor('#888').margin({ top: 16, bottom: 8 })
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(['default','work','workout','drive','relax','sleep'], (m: string) => {
          Text(this.modeLabel(m))
            .padding({ left: 12, right: 12, top: 6, bottom: 6 }).margin(4)
            .borderRadius(16)
            .backgroundColor(this.newPlaylistMode === m ? '#1E90FF' : '#EEEEEE')
            .fontColor(this.newPlaylistMode === m ? '#FFFFFF' : '#333333')
            .onClick((): void => { this.newPlaylistMode = m; })
        }, (m: string): string => m)
      }
      Row() {
        Button('取消').layoutWeight(1).margin({ right: 8 })
          .onClick((): void => { this.newPlaylistDialogOpen = false; })
        Button('创建').layoutWeight(1)
          .onClick((): void => { this.createNewPlaylistAndAdd(); })
      }.margin({ top: 24 })
    }.width('80%').backgroundColor('#FFFFFF').borderRadius(12).padding(16)
  }.width('100%').height('100%').zIndex(100)
}

// modeLabel: 把 key 翻译成中文 label（复用 RADIO_MODES 同步——不能直接读 server 的，
// 客户端有 modes API，已经在 fetchModes 里拉过）。简化方式：硬编码同步 map。
private modeLabel(m: string): string {
  if (m === 'default') return '默认';
  if (m === 'work') return '工作';
  if (m === 'workout') return '运动';
  if (m === 'drive') return '驾驶';
  if (m === 'relax') return '休息';
  if (m === 'sleep') return '睡前';
  return m;
}

async addSongToExistingPlaylist(playlistId: number): Promise<void> {
  if (!this.addToPlaylistTargetSong) return;
  try {
    const r = await addSongToPlaylist(playlistId, this.addToPlaylistTargetSong);
    if (r.skipped) {
      promptAction.showToast({ message: '已存在，跳过', duration: 1500 });
    } else {
      const p = this.addToPlaylistList.find((x: Playlist): boolean => x.id === playlistId);
      promptAction.showToast({ message: '已加入 ' + (p ? p.name : ''), duration: 1500 });
    }
  } catch (e) {
    promptAction.showToast({ message: '加入失败：' + (e as Error).message, duration: 2000 });
  }
  this.addToPlaylistDialogOpen = false;
  this.addToPlaylistTargetSong = null;
}

async createNewPlaylistAndAdd(): Promise<void> {
  if (!this.addToPlaylistTargetSong) return;
  try {
    const created = await createPlaylist(this.newPlaylistMode, this.newPlaylistName.trim() || undefined);
    await addSongToPlaylist(created.id, this.addToPlaylistTargetSong);
    promptAction.showToast({ message: '已创建 ' + created.name + ' 并加入', duration: 1500 });
  } catch (e) {
    promptAction.showToast({ message: '创建失败：' + (e as Error).message, duration: 2000 });
  }
  this.newPlaylistDialogOpen = false;
  this.newPlaylistName = '';
  this.newPlaylistMode = 'default';
  this.addToPlaylistTargetSong = null;
}
```

把 `NewPlaylistDialog()` 在主 Stack 里 if 渲染：`if (this.newPlaylistDialogOpen) this.NewPlaylistDialog();`

- [ ] **Step 5: 真机测**

DevEco Studio Run → app 打开 → 灵感页搜歌 → 点 [+] → 应该弹出 picker（空列表 + "新建歌单"）→ 点新建 → 填名字、选模式 → 创建 → toast 显示 → 资料页（Phase D 之后）能看到新歌单。

现在还没 Phase D，可以先 curl 验证：

```bash
ssh root@124.222.32.27 "curl -s http://127.0.0.1:8081/api/playlists | python3 -m json.tool"
```

应该看到刚创建的歌单 + 1 首歌。

- [ ] **Step 6: Commit**

```bash
git add Claudio/entry/src/main/ets/pages/Index.ets
git commit -m "feat(client): add-to-playlist picker + new-playlist dialog"
```

---

# Phase D: 资料页歌单管理

## Task D1: 资料页"我的歌单"区

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加 @State + 拉数据方法**

```ts
@State myPlaylists: Playlist[] = [];

async refreshMyPlaylists(): Promise<void> {
  try { this.myPlaylists = await listPlaylists(); }
  catch (e) { this.myPlaylists = []; }
}
```

在 `afterAuthed()` 里加 `this.refreshMyPlaylists();`

- [ ] **Step 2: 找资料页（profile tab，currentTab === 4 或类似）渲染**

`grep -n "currentTab === 4\|profile tab\|资料 tab" Index.ets` 找到。

- [ ] **Step 3: 在合适位置加"我的歌单"区**

```ts
// 我的歌单区
Column() {
  Row() {
    Text('我的歌单').fontSize(16).fontWeight(600).layoutWeight(1)
    Text(this.myPlaylists.length.toString() + ' 个').fontSize(12).fontColor('#888')
  }.margin({ top: 16, bottom: 8 })
  if (this.myPlaylists.length === 0) {
    Text('还没有歌单。去灵感页搜歌时点 + 创建吧。')
      .fontSize(13).fontColor('#888').padding(16)
  } else {
    ForEach(this.myPlaylists, (p: Playlist) => {
      Row() {
        Column() {
          Text(p.name).fontSize(15).fontWeight(500)
          Row() {
            Text(this.modeLabel(p.mode)).fontSize(12).fontColor('#888').margin({ right: 8 })
            Text(p.song_count.toString() + ' 首').fontSize(12).fontColor('#888')
          }.margin({ top: 4 })
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        // 播放按钮
        Button('▶').width(40).height(40).onClick((): void => { this.startPlaylistPlayback(p.id); })
        // 操作菜单按钮
        Text('···').fontSize(20).margin({ left: 8 })
          .onClick((): void => { this.openPlaylistActionMenu(p.id); })
      }.padding(12).borderRadius(8).backgroundColor('#F5F5F5').margin({ top: 8 })
    }, (p: Playlist): string => p.id.toString())
  }
}.padding({ left: 16, right: 16 })
```

`startPlaylistPlayback` 在 Phase E 实现，先放空 stub：

```ts
private startPlaylistPlayback(_id: number): void {
  promptAction.showToast({ message: '功能即将上线', duration: 1500 });
}
```

`openPlaylistActionMenu` 在 D2 实现。

- [ ] **Step 4: 真机测**

DevEco Run → 资料页 → 应该看到歌单列表。点播放显示 toast。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(client): my playlists section in profile"
```

---

## Task D2: 操作菜单（重命名 / 改 mode / 编辑歌曲 / 删除）

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加 @State**

```ts
@State playlistActionMenuOpen: boolean = false;
@State playlistActionMenuTarget: number = 0;   // 0 = 没选

// 重命名子对话框
@State renameDialogOpen: boolean = false;
@State renameInput: string = '';

// 改 mode 子对话框
@State changeModeDialogOpen: boolean = false;
@State changeModeNew: string = 'default';
```

- [ ] **Step 2: 操作菜单 UI**

```ts
@Builder PlaylistActionMenu() {
  if (this.playlistActionMenuOpen) {
    Stack() {
      Column().width('100%').height('100%').backgroundColor('#000000C0')
        .onClick((): void => { this.playlistActionMenuOpen = false; })
      Column() {
        Text('歌单操作').fontSize(16).fontWeight(600).margin({ bottom: 12 })
        Row() { Text('重命名').fontSize(15).layoutWeight(1) }
          .padding(12).onClick((): void => {
            this.playlistActionMenuOpen = false;
            const p = this.myPlaylists.find((x: Playlist): boolean => x.id === this.playlistActionMenuTarget);
            this.renameInput = p ? p.name : '';
            this.renameDialogOpen = true;
          })
        Divider()
        Row() { Text('改模式').fontSize(15).layoutWeight(1) }
          .padding(12).onClick((): void => {
            this.playlistActionMenuOpen = false;
            const p = this.myPlaylists.find((x: Playlist): boolean => x.id === this.playlistActionMenuTarget);
            this.changeModeNew = p ? p.mode : 'default';
            this.changeModeDialogOpen = true;
          })
        Divider()
        Row() { Text('编辑歌曲').fontSize(15).layoutWeight(1) }
          .padding(12).onClick((): void => {
            this.playlistActionMenuOpen = false;
            this.openPlaylistDetail(this.playlistActionMenuTarget);   // D3 里实现
          })
        Divider()
        Row() { Text('删除').fontSize(15).fontColor('#E84')... }
          .padding(12).onClick((): void => {
            this.playlistActionMenuOpen = false;
            this.confirmDeletePlaylist(this.playlistActionMenuTarget);
          })
      }.width('70%').backgroundColor('#FFFFFF').borderRadius(12).padding(16)
    }.width('100%').height('100%').zIndex(101)
  }
}

private openPlaylistActionMenu(id: number): void {
  this.playlistActionMenuTarget = id;
  this.playlistActionMenuOpen = true;
}

private async confirmDeletePlaylist(id: number): Promise<void> {
  // 简化：直接删；正式实现可换 AlertDialog 二次确认
  try {
    await deletePlaylist(id);
    await this.refreshMyPlaylists();
    promptAction.showToast({ message: '已删除', duration: 1500 });
  } catch (e) {
    promptAction.showToast({ message: '删除失败', duration: 2000 });
  }
}

private async submitRename(): Promise<void> {
  const name = this.renameInput.trim();
  if (!name) { promptAction.showToast({ message: '名字不能为空', duration: 1500 }); return; }
  try {
    await patchPlaylist(this.playlistActionMenuTarget, { name });
    await this.refreshMyPlaylists();
    promptAction.showToast({ message: '已重命名', duration: 1500 });
  } catch (e) {
    promptAction.showToast({ message: '重命名失败', duration: 2000 });
  }
  this.renameDialogOpen = false;
}

private async submitChangeMode(): Promise<void> {
  try {
    await patchPlaylist(this.playlistActionMenuTarget, { mode: this.changeModeNew });
    await this.refreshMyPlaylists();
    promptAction.showToast({ message: '已改模式', duration: 1500 });
  } catch (e) {
    promptAction.showToast({ message: '改模式失败', duration: 2000 });
  }
  this.changeModeDialogOpen = false;
}
```

加 `RenameDialog` 和 `ChangeModeDialog`（结构同 NewPlaylistDialog，省略代码——参考 Task C4 模板）。

- [ ] **Step 3: 在主 Stack 调用三个 dialog**

```ts
this.PlaylistActionMenu();
if (this.renameDialogOpen) this.RenameDialog();
if (this.changeModeDialogOpen) this.ChangeModeDialog();
```

- [ ] **Step 4: 真机测重命名 + 改模式 + 删除**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(client): playlist action menu (rename/mode/delete)"
```

---

## Task D3: 歌单详情页（编辑歌曲：拖动排序 / 删除）

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加 @State**

```ts
@State playlistDetailOpen: boolean = false;
@State playlistDetailData: PlaylistDetail | null = null;

private async openPlaylistDetail(id: number): Promise<void> {
  try {
    this.playlistDetailData = await getPlaylist(id);
    this.playlistDetailOpen = true;
  } catch (e) {
    promptAction.showToast({ message: '加载失败', duration: 2000 });
  }
}
```

- [ ] **Step 2: 详情 view（全屏 modal）**

```ts
@Builder PlaylistDetailView() {
  if (this.playlistDetailOpen && this.playlistDetailData) {
    Column() {
      Row() {
        Text(this.playlistDetailData.playlist.name).fontSize(20).fontWeight(600).layoutWeight(1)
        Text('完成').fontSize(15).fontColor('#1E90FF')
          .onClick((): void => { this.playlistDetailOpen = false; })
      }.padding(16)
      List() {
        ForEach(this.playlistDetailData.songs, (s: PlaylistSong, idx: number) => {
          ListItem() {
            Row() {
              Text((idx + 1).toString()).width(30).fontSize(14).fontColor('#888')
              Column() {
                Text(s.song_name).fontSize(15)
                Text(s.artist).fontSize(12).fontColor('#888').margin({ top: 2 })
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text('×').fontSize(20).fontColor('#E84').padding(8)
                .onClick((): void => { this.removeSongAt(s.position); })
            }.padding(12)
          }
        }, (s: PlaylistSong): string => s.position.toString())
      }.layoutWeight(1)
    }.width('100%').height('100%').backgroundColor('#FFFFFF').zIndex(102)
  }
}

private async removeSongAt(position: number): Promise<void> {
  if (!this.playlistDetailData) return;
  const pid: number = this.playlistDetailData.playlist.id;
  try {
    await removeSongFromPlaylist(pid, position);
    this.playlistDetailData = await getPlaylist(pid);
    await this.refreshMyPlaylists();
  } catch (e) { /* ignore */ }
}
```

- [ ] **Step 3: 拖动排序（YAGNI 简化版：先不做，留 stub）**

ArkUI 的 List 拖动排序需要专门 API，工作量较大。本次只做"加歌 / 删歌"，暂不做 reorder UI。reorder API（Task A9）保留备用。

- [ ] **Step 4: 真机测**

进资料页 → 选歌单 → ··· → 编辑歌曲 → 应该列出所有歌 + 每行 × 删除 → 删完返回资料页能看到 song count 减少。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(client): playlist detail view + song delete"
```

---

# Phase E: 歌单播放状态机

## Task E1: 新增 @State 字段 + 状态切换 helper

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加字段（class 顶部）**

```ts
// 歌单播放状态
@State activePlaylistId: number = 0;
@State activePlaylistName: string = '';
@State activePlaylistMode: string = '';
@State activePlaylistSongs: PlaylistSong[] = [];
private activePlaylistIntros: string[] = [];   // 长度 = songs.length + 1
@State activePlaylistIdx: number = 0;          // 0 = 还没播开场，1..N = 第 N 首歌已开播
@State activePlaylistLoading: boolean = false; // 备稿中

// 临时电台状态
@State adhocStyleActive: string = '';   // 空 = 不在临时电台
```

- [ ] **Step 2: 退出 helper**

```ts
private clearPlaylistState(): void {
  this.activePlaylistId = 0;
  this.activePlaylistName = '';
  this.activePlaylistMode = '';
  this.activePlaylistSongs = [];
  this.activePlaylistIntros = [];
  this.activePlaylistIdx = 0;
  this.activePlaylistLoading = false;
}

private clearAdhocState(): void {
  this.adhocStyleActive = '';
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): playlist + adhoc state fields"
```

---

## Task E2: 启动歌单播放（备稿 → 第 1 首）

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 实现 startPlaylistPlayback**

```ts
async startPlaylistPlayback(id: number): Promise<void> {
  this.clearAdhocState();
  this.clearPlaylistState();
  this.activePlaylistLoading = true;
  try {
    const detail = await getPlaylist(id);
    if (!detail.songs || detail.songs.length === 0) {
      promptAction.showToast({ message: '歌单是空的', duration: 1500 });
      this.clearPlaylistState();
      return;
    }
    this.activePlaylistId = detail.playlist.id;
    this.activePlaylistName = detail.playlist.name;
    this.activePlaylistMode = detail.playlist.mode;
    this.activePlaylistSongs = detail.songs;
    this.currentMode = detail.playlist.mode;
    this.autoContinue = true;

    // 转 PlaylistSong → Song 喂 batch intros
    const songs: Song[] = detail.songs.map((s: PlaylistSong): Song => ({
      id: s.song_id, name: s.song_name, artist: s.artist,
      album: s.album, cover: s.cover_url
    }));
    const intrRes = await getPlaylistIntros(songs, detail.playlist.mode, 'short');
    this.activePlaylistIntros = intrRes.intros;
    this.activePlaylistLoading = false;
    this.activePlaylistIdx = 0;

    await this.playPlaylistOpening();
  } catch (e) {
    this.activePlaylistLoading = false;
    promptAction.showToast({ message: '启动失败：' + (e as Error).message, duration: 2000 });
    this.clearPlaylistState();
  }
}
```

- [ ] **Step 2: 实现开场词 + 首歌（核心序列）**

```ts
// 播开场词 → 播第 1 首歌
private async playPlaylistOpening(): Promise<void> {
  if (this.activePlaylistIntros.length === 0 || this.activePlaylistSongs.length === 0) return;
  const opening: string = this.activePlaylistIntros[0];
  // 直接进第 1 首歌的 load，intro 文本 + TTS 由 player.ets 插入串词槽位
  // 复用 loadWithIntro 流程：跟现有 pickAndPlay 同
  await this.playPlaylistSongAt(0, opening);
}

// 播第 idx 首歌（idx 是 songs 数组下标，0..N-1），intro 是这首歌前的串词
private async playPlaylistSongAt(idx: number, intro: string): Promise<void> {
  if (idx < 0 || idx >= this.activePlaylistSongs.length) return;
  const ps: PlaylistSong = this.activePlaylistSongs[idx];
  const song: Song = {
    id: ps.song_id, name: ps.song_name, artist: ps.artist, album: ps.album, cover: ps.cover_url
  };
  const url: string | null = await getSongUrl(song.id);
  if (!url) {
    promptAction.showToast({ message: song.name + ' 暂无音源，跳过', duration: 1500 });
    return this.advancePlaylist();
  }
  this.currentSong = song;
  this.currentSongMode = this.activePlaylistMode;
  this.currentIntro = intro;
  this.activePlaylistIdx = idx + 1;   // 1-based 显示

  // TTS（intro 非空才走）
  const ctx = getContext(this) as common.UIAbilityContext;
  let ttsPath: string = '';
  let ttsLength: number = 0;
  if (intro && intro.length > 0) {
    ttsPath = `${ctx.cacheDir}/dj-intro.wav`;
    ttsLength = await downloadTtsToFile(intro, ttsPath).catch((): number => 0);
  }
  const meta: PlayerMeta = this.buildMeta(song);
  await this.onSongChanged(song);
  if (ttsLength > 0) {
    await player.loadWithIntro(url, meta, ttsPath, ttsLength);
  } else {
    await player.load(url, meta);
  }
  this.isPlaying = true;
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): start playlist playback (opening + song[0])"
```

---

## Task E3: 歌单内自动续首（onEnded 钩子）

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 在 onEnded 回调里加歌单分支**

找到 `player.setOnEnded((): void => {` 块，在重复模式 / autoContinue 之前判断歌单：

```ts
// 歌单模式：在歌单内续首
if (this.activePlaylistId > 0) {
  this.advancePlaylist();
  return;
}
// 单曲循环 / autoContinue 现有逻辑保留
```

- [ ] **Step 2: 实现 advancePlaylist**

```ts
private async advancePlaylist(): Promise<void> {
  const nextIdx: number = this.activePlaylistIdx;   // 当前 1-based，下一首 idx 在 0-based 即 nextIdx
  if (nextIdx >= this.activePlaylistSongs.length) {
    // 歌单播完 → 续电台
    const lastSong: Song | null = this.currentSong;
    const mode: string = this.activePlaylistMode || 'default';
    this.clearPlaylistState();
    this.currentMode = mode;
    this.autoContinue = true;
    if (lastSong) this.pickAndPlay(mode);
    return;
  }
  const intro: string = nextIdx + 1 < this.activePlaylistIntros.length
    ? this.activePlaylistIntros[nextIdx + 1]
    : '';
  await this.playPlaylistSongAt(nextIdx, intro);
}
```

- [ ] **Step 3: 真机测**

资料页选歌单（≥3 首）→ ▶ → 应该看到"备稿中..."（如果没加 loading UI 加一下） → 5-7s 后开播 → 自动播下一首。

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(client): playlist advance on song end"
```

---

## Task E4: 跳过 / 上一首 / 退出

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 找现有 next/prev 按钮 onClick**

`grep -n "playNext\|playPrev" Index.ets`。

- [ ] **Step 2: 在 playNext 入口加歌单分支**

```ts
async playNext(): Promise<void> {
  if (this.activePlaylistId > 0) {
    this.advancePlaylist();
    return;
  }
  // 现有逻辑
  ...
}
```

`playPrev` 类似：

```ts
async playPrev(): Promise<void> {
  if (this.activePlaylistId > 0) {
    const prevIdx: number = this.activePlaylistIdx - 2;   // 当前是 1-based，回到上一首
    if (prevIdx < 0) {
      promptAction.showToast({ message: '已经是第一首', duration: 1500 });
      return;
    }
    const intro: string = prevIdx + 1 < this.activePlaylistIntros.length
      ? this.activePlaylistIntros[prevIdx + 1]
      : '';
    await this.playPlaylistSongAt(prevIdx, intro);
    return;
  }
  // 现有逻辑
  ...
}
```

- [ ] **Step 3: 退出歌单按钮（顶栏 [×]）**

在 mini player / banner 里加 if 渲染：

```ts
if (this.activePlaylistId > 0) {
  Row() {
    Text(this.activePlaylistName + ' · 第 ' + this.activePlaylistIdx + ' 首 / 共 ' +
         this.activePlaylistSongs.length + ' 首').fontSize(12).layoutWeight(1)
    Text('×').fontSize(18).onClick((): void => { this.exitPlaylistKeepRadio(); })
  }.padding(8).backgroundColor('#F5F5F5')
}

private exitPlaylistKeepRadio(): void {
  const mode: string = this.activePlaylistMode || 'default';
  this.clearPlaylistState();
  this.currentMode = mode;
  this.autoContinue = true;
  // 不打断当前播放；下一次 onEnded 会走 pickAndPlay
}
```

- [ ] **Step 4: 切 mode tile 时清歌单状态**

找 mode tile onClick → pickAndPlay 流程，前面加：

```ts
if (this.activePlaylistId > 0) this.clearPlaylistState();
if (this.adhocStyleActive.length > 0) this.clearAdhocState();
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(client): playlist next/prev/exit + mode-switch cleanup"
```

---

## Task E5: 备稿 loading UI

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加 loading 渲染**

```ts
if (this.activePlaylistLoading) {
  Stack() {
    Column().width('100%').height('100%').backgroundColor('#000000A0')
    Column() {
      LoadingProgress().width(40).height(40)
      Text('DJ 正在备稿...').fontSize(14).margin({ top: 12 })
    }.width('70%').padding(24).backgroundColor('#FFFFFF').borderRadius(12)
  }.width('100%').height('100%').zIndex(103)
}
```

- [ ] **Step 2: 真机测**

进入歌单 → 应该看到 loading → 5-7s 后开播。

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): playlist loading UI"
```

---

# Phase F: 灵感页改造 + adhocStyle 贯穿

## Task F1: 改名"搜索" → "灵感"

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`（文本资源）

- [ ] **Step 1: grep 找现有搜索页标题**

`grep -n "搜索" Index.ets`

- [ ] **Step 2: 替换页签 / 标题文本**

把"搜索" → "灵感"。

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): rename 搜索 → 灵感"
```

---

## Task F2: 加 chips UI（5 维度）

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 加 @State**

```ts
@State adhocLang: string = '不限';
@State adhocEra: string = '不限';
@State adhocGenre: string = '不限';
@State adhocBpm: string = '不限';
@State adhocMood: string = '不限';

private clearAdhocChips(): void {
  this.adhocLang = '不限'; this.adhocEra = '不限'; this.adhocGenre = '不限';
  this.adhocBpm = '不限'; this.adhocMood = '不限';
}

// 检查是否有任何 chip 不是"不限"
private hasAdhocChipsActive(): boolean {
  return this.adhocLang !== '不限' || this.adhocEra !== '不限' || this.adhocGenre !== '不限'
      || this.adhocBpm !== '不限' || this.adhocMood !== '不限';
}

// 拼成自然语言 adhocStyle
private buildAdhocStyle(): string {
  const parts: string[] = [];
  if (this.adhocLang !== '不限') parts.push(this.adhocLang + '语');
  if (this.adhocGenre !== '不限') parts.push(this.adhocGenre);
  if (this.adhocEra !== '不限') parts.push(this.adhocEra + ' 年代');
  if (this.adhocBpm !== '不限') parts.push('BPM ' + this.adhocBpm);
  if (this.adhocMood !== '不限') parts.push(this.adhocMood + '感');
  return parts.join('，');
}
```

- [ ] **Step 2: 灵感页主体加 chips 区**

在搜索框下方插入：

```ts
Column() {
  this.AdhocChipsRow('语言', ['中', '英', '日', '韩', '其他', '不限'], this.adhocLang,
    (v: string): void => { this.adhocLang = v; })
  this.AdhocChipsRow('年代', ['70s','80s','90s','00s','10s','20s','不限'], this.adhocEra,
    (v: string): void => { this.adhocEra = v; })
  this.AdhocChipsRow('类型', ['摇滚','民谣','电子','嘻哈','流行','古典','爵士','R&B','不限'], this.adhocGenre,
    (v: string): void => { this.adhocGenre = v; })
  this.AdhocChipsRow('BPM', ['慢','中','快','不限'], this.adhocBpm,
    (v: string): void => { this.adhocBpm = v; })
  this.AdhocChipsRow('情绪', ['温暖','忧郁','治愈','兴奋','平静','不限'], this.adhocMood,
    (v: string): void => { this.adhocMood = v; })
}.padding(12)
```

@Builder helper:

```ts
@Builder AdhocChipsRow(label: string, options: string[], current: string, onPick: (v: string) => void) {
  Row() {
    Text(label).fontSize(13).fontColor('#888').width(40)
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(options, (op: string) => {
        Text(op)
          .fontSize(13).padding({ left: 10, right: 10, top: 4, bottom: 4 }).margin(3)
          .borderRadius(12)
          .backgroundColor(current === op ? '#1E90FF' : '#EEEEEE')
          .fontColor(current === op ? '#FFFFFF' : '#333333')
          .onClick((): void => { onPick(op); })
      }, (op: string): string => op)
    }.layoutWeight(1)
  }.padding({ top: 4, bottom: 4 })
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): adhoc chips UI on inspiration page"
```

---

## Task F3: 状态机 + "开播此风格" 按钮

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 灵感页根据状态切换显示**

```ts
// 灵感页主体
Column() {
  // 搜索框 (复用现有)
  TextInput(...)
  // chips
  this.AdhocChipsArea()
  // 动态区域
  if (this.searchKeyword.length > 0) {
    // 状态 1：搜索结果列表 (复用现有)
    this.SearchResultsList()
  } else if (this.hasAdhocChipsActive()) {
    // 状态 2：摘要 + 开播按钮
    Column() {
      Text(this.buildAdhocStyle()).fontSize(15).margin({ bottom: 16 })
      Button('▶ 开播此风格').width('80%').height(48)
        .onClick((): void => { this.startAdhocStation(); })
    }.padding(24)
  } else {
    // 状态 3：empty state
    Column() {
      Text('搜歌或选 chips 试试').fontSize(15).fontColor('#888')
    }.padding(48)
  }
}
```

- [ ] **Step 2: 实现 startAdhocStation**

```ts
async startAdhocStation(): Promise<void> {
  this.clearPlaylistState();
  this.adhocStyleActive = this.buildAdhocStyle();
  if (!this.currentMode || this.currentMode.length === 0) this.currentMode = 'default';
  this.autoContinue = true;
  // 调 pickAndPlay，下面 F4 改成带 adhocStyle
  await this.pickAndPlay(this.currentMode);
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(client): inspiration page state machine + start adhoc"
```

---

## Task F4: adhocStyleActive 贯穿 getNext 调用

**Files:**
- Modify: `Claudio/entry/src/main/ets/pages/Index.ets`

- [ ] **Step 1: 找 getNext body 构造点**

`grep -n "RadioNextBody" Index.ets` 找到 2 个用法（pickAndPlayInner 和 _prefetchOnce）。

- [ ] **Step 2: 两处都加 adhocStyle 字段**

```ts
// 直接路径（pickAndPlayInner）
const body: RadioNextBody = {
  mode: modeKey,
  currentSong: this.currentSong,
  recent: this.buildRecentForServer(),
  recentIntros: this.collectRecentIntros(),
  currentSongState: this.getCurrentSongState(this.currentSong),
  prevMode: this.currentSongMode,
  adhocStyle: this.adhocStyleActive.length > 0 ? this.adhocStyleActive : undefined
};
```

```ts
// 预取路径（_prefetchOnce）
const body: RadioNextBody = {
  mode: startMode,
  currentSong: prevSong,
  recent: this.buildRecentForServerWithQueue(),
  recentIntros: this.collectRecentIntros(),
  queuePosition: this.prefetchQueue.length,
  currentSongState: this.getCurrentSongState(prevSong),
  prevMode: startMode,
  adhocStyle: this.adhocStyleActive.length > 0 ? this.adhocStyleActive : undefined
};
```

- [ ] **Step 3: 切常驻 mode tile 时清 adhoc**

已在 Task E4 step 4 做过，此处确认。

- [ ] **Step 4: 真机测**

灵感页 → 选 chips（语言=中文 + 类型=民谣 + BPM=慢 + 情绪=温暖）→ "开播此风格" → 应该听到中文民谣慢节奏温暖的歌。

服务端日志验证：

```bash
ssh root@124.222.32.27 "cd /root/claudio && docker-compose logs --tail=20 claudio | grep '\[radio/'"
```

应该看到 `event=enter mode=default` 后的处理用了 effectiveMode（label 带"（临时筛选）"——如果调试日志输出的是 effectiveMode.label）。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(client): plumb adhocStyle through getNext"
```

---

# Phase G: 端到端验收

## Task G1: 跑 spec §9 的 10 条验收标准

**Files:**
- 无（手动测试）

逐条试：

- [ ] **AC1** 灵感页搜歌 + [+加入歌单] 创建一个新歌单（默认名 + 选模式）
- [ ] **AC2** 灵感页搜歌 + [+加入歌单] 加到已有歌单
- [ ] **AC3** 资料页看到歌单列表，按 mode 分组
- [ ] **AC4** 资料页 [···] → 重命名成功，列表名字更新
- [ ] **AC5** 资料页 [···] → 编辑歌曲 → 删除一首，列表数量更新
- [ ] **AC6** 资料页 [▶ 播放] 一个 5 首歌单：备稿 → 开场词 → 5 首带串词 → 续电台
- [ ] **AC7** 灵感页选 chips 拼出"中文民谣 BPM 慢" → 开播 → AI 选了符合的歌
- [ ] **AC8** 临时电台中切到"睡前"mode tile → 临时电台作废，进入睡前电台
- [ ] **AC9** 歌单播放中按 [×] 退出 → 续电台
- [ ] **AC10** 歌单中删除最后一首歌 → 歌单变空显示"0 首"，不可播或播放后立即续电台

发现问题 → 进 G2 修。

---

## Task G2: 修 G1 发现的 bug

针对每个 fail 的 AC：
- [ ] 定位
- [ ] 修
- [ ] 重测
- [ ] commit `fix(playlist|adhoc): <具体问题>`

---

## Task G3: 最终 push + 部署

- [ ] **Step 1: server 端 push + 部署**

```bash
cd C:/Users/xiaotim/Documents/Claude/Projects/radio
git push origin main
scp -o BatchMode=yes server.js root@124.222.32.27:/root/claudio/
ssh root@124.222.32.27 "cd /root/claudio && docker-compose up -d --build claudio"
```

- [ ] **Step 2: 客户端 push**

```bash
cd C:/Users/xiaotim/Documents/Claude/Projects/radio-harmonyos
git push origin main
```

- [ ] **Step 3: 写发布说明**

在 docs/superpowers/plans 里追加 `2026-05-03-playlist-and-inspiration-postmortem.md`，简述：
- 实际工时 vs 估算
- 哪些 AC 一次过，哪些有 bug
- 后续需要的优化（拖动排序 / 搜索关键词 + chips 组合等 YAGNI 项）

---

# Self-Review

针对 spec §9 的 10 条验收标准对照本 plan 的任务覆盖：

| AC | 实现任务 |
|---|---|
| AC1-AC2（创建/加入歌单） | C1-C4 |
| AC3（资料页列表） | D1 |
| AC4-AC5（重命名/删歌） | D2 + D3 |
| AC6（歌单播放 + 续电台） | E1-E5 |
| AC7（chips → adhoc 电台） | F2-F4 |
| AC8（切 mode 清 adhoc） | E4 step 4 + F4 step 3 |
| AC9（[×] 退出歌单 + 续） | E4 step 3 |
| AC10（空歌单边界） | E2 step 1（return early if songs empty）|

✅ 全覆盖。

**Type 一致性检查**：
- `Playlist` 用在 D1/D2 列表展示，类型在 B1 定义 ✅
- `PlaylistDetail` 用在 D3/E2，类型在 B1 定义 ✅
- `PlaylistSong` 用在 D3/E2/E3，类型在 B1 定义 ✅
- `Song` 类型在 types.ets 已有，复用 ✅
- `clearPlaylistState` / `clearAdhocState` 在 E1 定义，E2/E3/E4/F3 调用 ✅

**Placeholder scan**: ✅ 无 TBD/TODO；每个 step 都有具体代码。

**Scope 检查**: 实现任务 32 个，对应 15-21h 工时合理。可拆点：拖动排序（D3 中已说明 YAGNI）、批量加歌（未在 spec）。
