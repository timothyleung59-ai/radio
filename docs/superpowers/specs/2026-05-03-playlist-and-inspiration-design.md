# 歌单功能 + 灵感页 设计文档

**日期**：2026-05-03
**状态**：已确认设计，进入 implementation plan
**关联痛点**：#2（播放列表 + DJ 串歌单）+ #3（搜索页临时模式）

---

## 1. 背景

### 痛点 #2 — 没有播放列表
当前系统只有 prefetchQueue（系统层预取，1 首缓冲）和 currentSong（在播）。用户没法主动创建一个歌单让 DJ 帮忙串起来播。

### 痛点 #3 — 搜索页缺乏自定义模式
现有 6 个常驻电台模式（默认/工作/运动/驾驶/休息/睡前）是硬编码的。用户想要按音乐属性（语言/年代/类型/BPM/情绪）临时定制一个 vibe 让 AI 选歌。

### 用户原话
> "搜索页面应该增加灵活的自定义模式类型（不是常驻的模式），可根据音乐的语言、时代、类型、BPM 等筛选条件，并在切换其他模型前，按照该模型的约束条件 DJ 串歌"

> "搜索页面，搜索结果除了播放外，还有一个加入歌单的按钮，实现歌曲加入歌单；已经有的歌单，在资料页面进行管理"

> "歌单可衔接固定的几个电台模式，就是歌单类别有'休息''睡前'之类的"

---

## 2. 总体设计

### 2.1 概念模型
- **歌单（playlist）**：用户主动选定的一组歌，按顺序播 + DJ 串词。每个歌单**必须**关联一个电台模式（决定 DJ 语调），可选取个名字。
- **灵感页（inspiration）**：替换原"搜索"标题。两种交互并存：
  - 输关键词搜歌（保留原行为）
  - 选 chips 创建临时电台（adhocStyle 喂给 AI）

### 2.2 心智模型差异
| 概念 | 持久 | 用户主导歌曲选择 | DJ 介入 |
|---|---|---|---|
| 模式（mode）| - | ❌ AI 选 | ✅ |
| 歌单（playlist）| ✅ | ✅ 用户选 | ✅ |
| 临时电台（adhoc）| ❌ | ❌ AI 选 | ✅ |
| 单曲手动播放 | - | ✅ 用户选 | ❌（首歌不写串词，续电台时才有）|

---

## 3. 灵感页（替代搜索页）

### 3.1 布局

```
┌─────────────────────────────────────┐
│ 🎵 灵感                              │
├─────────────────────────────────────┤
│ 🔍 [搜歌名/艺人 或 用下面 chips 创建临时电台]│
├─────────────────────────────────────┤
│ 语言：[中] [英] [日] [韩] [其他] [不限]  │
│ 年代：[70s] [80s] [90s] [00s] [10s] [20s] [不限] │
│ 类型：[摇滚] [民谣] [电子] [嘻哈] [流行] [古典] [爵士] [R&B] [不限] │
│ BPM： [慢] [中] [快] [不限]              │
│ 情绪：[温暖] [忧郁] [治愈] [兴奋] [平静] [不限] │
├─────────────────────────────────────┤
│  动态区域 ↓                            │
└─────────────────────────────────────┘
```

### 3.2 chips 行为
- **5 个维度**：语言 / 年代 / 类型 / BPM / 情绪
- **单选**：每维度只能选 1 个 chip。点同维度其他 chip 切换；选第二次同 chip 取消（回到"不限"）
- **默认**：全部"不限"（视觉上"不限"高亮）
- **不持久**：退出灵感页 chips 状态重置

### 3.3 状态机
| 输入状态 | 动态区域显示 |
|---|---|
| 关键词非空 | 搜索结果列表（每行有 [▶播放] [+加入歌单]）|
| 关键词空 + 至少 1 维 chip 非"不限" | chips 摘要 + [▶ 开播此风格] 大按钮 |
| 关键词空 + 全"不限" | empty state："搜歌或选 chips 试试" |
| 关键词非空 + chips 也选了 | 优先搜索结果。chips 暂存（视觉提示"已选 N 个 chip"），不影响显示 |

### 3.4 chips → adhocStyle 拼接
拼成自然语言喂给 server。例：
```
chips: 语言=中文 / 年代=10s / 类型=民谣 / BPM=慢 / 情绪=温暖
adhocStyle: "中文民谣，2010 年代，BPM 慢节奏，温暖治愈感"
```
"不限"维度直接跳过不写。adhocPatterTone 暂不传（用 default mode 的 patterTone）。

### 3.5 临时电台播放语义
点 [开播此风格] →
1. POST `/api/radio/next` 带 `mode: 'default'` + `adhocStyle: <拼出的字符串>`
2. server 用 effectiveMode（mode + adhocStyle override）调 LLM
3. 进入电台播放 + autoContinue=true + 后续 prefetch 也都带这个 adhocStyle
4. 用户切到其他常驻 mode tile → 临时电台作废，进入选中 mode

需要客户端维护一个状态字段 `adhocStyleActive: string | null`，每次选歌请求都把它带上。

---

## 4. 歌单功能

### 4.1 创建/添加流程

**入口**：
- 灵感页搜索结果（每行 [+加入歌单] 按钮）
- 资料页"播放历史"列表（每行加 [+加入歌单] 按钮）
- 资料页"我的收藏"列表（每行加 [+加入歌单] 按钮）

**流程**：
```
点 [+加入歌单]
  ↓
弹出 picker（按 mode 分组）：
  📁 休息
    🎵 我的休息歌单 #1  (5 首)
  📁 睡前
    🎵 我的睡前歌单 #1  (8 首)
  ────
  ➕ 新建歌单
  ↓
（点新建）→ 新建歌单弹层：
  名字（可选）：______________
  模式：[默认] [工作] [运动] [驾驶] [休息] [睡前]
  [取消] [创建]
  ↓
创建后立即把当前歌加入新歌单
  ↓
Toast: "已加入 我的休息歌单 #2"
```

**新建歌单规则**：
- 名字可选；为空时自动生成 `我的{模式 label}歌单 #{N}`，N = 该 user 该 mode 已有歌单数 + 1
- 模式必填（6 选 1）
- song 加入时 dedup：同 song_id 已经在歌单里则 toast "已存在，跳过"

### 4.2 资料页歌单管理

```
资料页
├─ 用户信息（现有）
├─ ...
└─ 我的歌单
   ┌─────────────────────────────┐
   │ 🎵 我的休息歌单 #1     5 首  │
   │    [休息]                    │
   │    [▶ 播放]  [···]           │
   └─────────────────────────────┘
   ...
```

**[···] 操作菜单**：
- 重命名（改 name）
- 编辑歌曲 → 进入歌单详情页：
  - 列出所有歌曲 + 拖动排序 + 删除单首
  - 顶部"+ 添加歌曲"跳到灵感页（带 playlist_id 上下文，搜到歌一点 [+加入] 自动加这个歌单）
- 改模式（改 mode tag）
- 删除歌单（确认弹窗）

### 4.3 歌单播放语义

**点 [▶ 播放]**：
1. UI：进入"备稿"loading 状态
2. POST `/api/dj/playlist-intros` 带 `{ songs, mode, length: 'short' }`，约 5-7 秒
3. 同时并行：
   - 拉第 1 首歌的 URL（`getSongUrl`）
   - 等串词到了立刻 TTS 第 1 段开场（已有 downloadTtsToFile）
4. 都就绪后：
   - 主播放页顶栏显示 `我的休息歌单 #1 · 第 0 首 / 共 5 首  [×]`
   - 播开场词 → 播第 1 首 → 第 1 首串词 → 播第 2 首 → ... → 第 5 首播完
5. 第 5 首播完后：autoContinue=true + currentMode=`{歌单的 mode}` + 用第 5 首做 simi 种子续电台

**播放控制**：
| 操作 | 行为 |
|---|---|
| 跳过下一首 | 当前 idx + 1（跳过未播串词；如果当前是串词阶段直接跳到下一首歌）。已经是最后一首 → 退出歌单 + 续电台 |
| 上一首 | 当前 idx - 1（回到上一首歌；如果当前 idx ≤ 1 则什么都不做或回到开场词）|
| 暂停/播放 | 现有逻辑（全局通用，不区分歌单内外）|
| [×] 退出歌单 | 清歌单状态，转入普通电台续播（用歌单 mode + 当前播过的最后一首做 simi 种子）|
| 切到别的 mode tile | 退出歌单 + 进入选中 mode 电台 |
| 全部播完 | 自动续电台（按歌单 mode）|

**TTS 失败兜底**：
- 某段 TTS 下载失败 → 跳过 TTS 直接放下一首歌（保证主歌曲不卡）
- 所有 TTS 都失败 → 仍然顺序播 5 首歌，DJ 文本仍显示在 DJ NOTES 卡片

### 4.4 数据模型

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

### 4.5 API（新增）

| 端点 | 用途 |
|---|---|
| `GET /api/playlists` | 列出用户所有歌单（含每个的 song count）|
| `GET /api/playlists/:id` | 单个歌单详情（含 songs 数组）|
| `POST /api/playlists` | 新建歌单 `{ name?, mode }` → 返回 id |
| `PATCH /api/playlists/:id` | 改名 / 改 mode `{ name?, mode? }` |
| `DELETE /api/playlists/:id` | 删除歌单（CASCADE 删 songs）|
| `POST /api/playlists/:id/songs` | 加歌 `{ song: { id, name, artist, album?, cover? } }` → song_id 重复返 200 + skipped:true |
| `DELETE /api/playlists/:id/songs/:position` | 删第 N 位歌曲 → 后面歌曲 position 上移 |
| `PATCH /api/playlists/:id/reorder` | 整体重排 `{ songIds: ['id1','id2',...] }` → 重写 position |

已就绪（不重做）：
- `POST /api/dj/playlist-intros` ✅
- `POST /api/radio/next` 带 `adhocStyle` ✅

---

## 5. 客户端状态机

新增 `@State` 字段：
```ts
// 灵感页 chips
@State adhocChips: { 语言: string, 年代: string, 类型: string, BPM: string, 情绪: string };

// 临时电台运行态（影响每次 /api/radio/next 调用）
@State adhocStyleActive: string = '';   // 空字符串 = 没在临时电台

// 歌单播放运行态
@State activePlaylistId: number = 0;        // 0 = 没在歌单
@State activePlaylistName: string = '';
@State activePlaylistMode: string = '';
@State activePlaylistSongs: Song[] = [];
@State activePlaylistIntros: string[] = [];   // 长度 = songs.length + 1
@State activePlaylistIdx: number = 0;         // 当前播第几首（0 = 开场词，1..N = 歌）
```

**状态切换边界**：
- 用户切常驻 mode tile → 清 `adhocStyleActive` + 清歌单状态
- 用户点资料页 [▶ 播放] 歌单 → 清 `adhocStyleActive` + 设歌单状态
- 用户点灵感页 [▶ 开播此风格] → 清歌单状态 + 设 `adhocStyleActive`

---

## 6. 不在本次设计内（YAGNI）

刻意排除的需求：
- ❌ 共享歌单给其他用户
- ❌ 歌单封面自定义（用第 1 首歌的 cover）
- ❌ 歌单导入导出（JSON / 链接）
- ❌ adhocStyle 持久化（每次进灵感页重置）
- ❌ adhoc 临时电台支持"保存为歌单"（如果之后需要可加，反向把临时电台过去 N 首做成歌单）
- ❌ 多语言 chips 标签翻译

---

## 7. 工时估算

| 阶段 | 工时 |
|---|---|
| 服务端 playlist CRUD（5 端点 + DB schema 迁移） | 2-3h |
| 客户端"加入歌单"按钮 + picker（3 个入口）| 2-3h |
| 客户端资料页歌单管理 UI（列表 + 详情 + 操作菜单） | 3-4h |
| 客户端歌单播放状态机 + UI | 2-3h |
| 客户端灵感页改造（chips + 状态切换） | 3-4h |
| 客户端临时电台 adhocStyleActive 状态贯穿 | 1-2h |
| 联调 + 真机测试 | 2h |
| **总计** | **15-21 小时**（约 2-3 个工作日） |

---

## 8. 风险与缓解

### R1：歌单播放"备稿" 5-7 秒等待感
**缓解**：loading 屏显示 DJ 准备步骤进度（"DJ 正在备稿... 已就绪 3/6 段"），用户感知是"在做事"不是"卡死"。可以播一个轻动画。

### R2：playlist-intros LLM 失败 / 返回不全
**缓解**：服务端已经有兜底（fallback: 简单串词），客户端拿到 fallback=true 也照样播。

### R3：歌单里的歌网易云突然下架
**缓解**：每首播放前 getSongUrl 失败 → 跳过当前 + toast "《XXX》暂无音源"，继续下一首

### R4：adhocStyle 字段被恶意 prompt 注入
**缓解**：服务端已 slice(0, 400) + 由 chips 拼接（用户没法直接输任意文本到 adhocStyle 字段）

### R5：用户在歌单中途切到其他 mode tile，歌单状态丢失
**预期行为**：是的，按设计文档 §4.3 "切到别的 mode tile → 退出歌单"。如果用户反馈混乱再考虑 modal 确认。

---

## 9. 验收标准

实现完成后必须能完成以下流程：

1. ✅ 灵感页搜歌 + [+加入歌单] 创建一个新歌单（默认名 + 选模式）
2. ✅ 灵感页搜歌 + [+加入歌单] 加到已有歌单
3. ✅ 资料页看到歌单列表，按 mode 分组
4. ✅ 资料页 [···] → 重命名成功，列表名字更新
5. ✅ 资料页 [···] → 编辑歌曲 → 删除一首，列表数量更新
6. ✅ 资料页 [▶ 播放] 一个 5 首歌单：备稿 → 开场词 → 5 首歌带串词依次播 → 第 5 首播完后续电台（按 mode）
7. ✅ 灵感页选 chips 拼出"中文民谣 BPM 慢" → [开播此风格] → AI 选了符合的歌（实测验证 adhocStyle 已生效）
8. ✅ 临时电台中切到"睡前"mode tile → 临时电台作废，进入睡前电台
9. ✅ 歌单播放中按 [×] 退出 → 续电台（按歌单 mode）
10. ✅ 歌单中删除最后一首歌 → 歌单变空但不报错（资料页显示"0 首"，不可播放或播放后立即结束）
