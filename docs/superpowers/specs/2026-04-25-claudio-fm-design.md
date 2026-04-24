# Claudio FM - 设计规格书

## 概述

Claudio FM 是一个沉浸式 AI 电台门户应用。将音乐播放器与 AI DJ 聊天界面结合，打造个性化听歌体验——AI 角色 Claudio 负责选歌、分享见解、与用户互动。

**目标平台**：移动端优先，本地使用，纯 HTML/CSS/JS 前端 + Node.js 后端。

## 参考资料

- 参考网站：https://mmguo.dev/claudio-fm/
- 设计灵感：Apple Music 电台布局、网易云音乐手机端
- 视觉风格：从专辑封面动态取色、流体渐变动画、粒子特效

## 技术架构

### 技术栈

- **前端**：纯 HTML/CSS/JS（无框架）
- **后端**：Node.js + Express（单服务）
- **数据库**：SQLite（通过 `better-sqlite3`）
- **音乐 API**：网易云音乐 API（自建于 `http://192.168.5.103:3000`）
- **AI**：Claude API（通过 Anthropic SDK，经服务端代理）
- **语音合成**：浏览器 Web Speech API（`SpeechSynthesis`），用于 DJ 语音模式。零依赖、即时、本地运行。如浏览器语音质量不足，回退到预录音频。

### 服务端职责

`server.js` 承担以下角色：

1. **静态文件服务** — 托管 `public/` 目录
2. **Claude API 代理** — `POST /api/chat` 代理流式 Claude API 调用
3. **配置加载器** — `GET /api/config` 读取并返回 md 配置文件
4. **数据 API** — SQLite 存储的用户数据增删改查接口

## 项目结构

```
claudio/
├── server.js                 # Express 服务
├── package.json
├── .env                      # ANTHROPIC_API_KEY
├── data/
│   └── claudio.db            # SQLite 数据库（自动创建）
├── config/
│   ├── taste.md              # 音乐品味配置（用户后续填充）
│   ├── routines.md           # 行为习惯配置（用户后续填充）
│   └── moodrules.md          # 情绪规则配置（用户后续填充）
├── public/
│   ├── index.html            # 主页面
│   ├── css/
│   │   ├── main.css          # 全局样式、CSS 变量、动画
│   │   ├── player.css        # 播放器区域样式
│   │   ├── chat.css          # 聊天窗口样式
│   │   ├── lyrics.css        # 歌词组件样式
│   │   └── voice.css         # DJ 语音模式样式
│   ├── js/
│   │   ├── app.js            # 主入口，模块初始化
│   │   ├── player.js         # 播放器逻辑（播放/暂停/上下曲/进度条）
│   │   ├── lyrics.js         # 歌词获取、解析、逐行高亮、翻转动画
│   │   ├── chat.js           # Claude API 聊天（流式输出）、歌曲卡片渲染
│   │   ├── api.js            # 网易云 API 封装（搜索/歌单/歌词）
│   │   ├── visual.js         # 动态取色、流体背景、粒子、节拍律动光效
│   │   ├── voice.js          # DJ 语音模式（TTS 播放、波形、音频闪避）
│   │   ├── storage.js        # 前端数据访问层（调用服务端 API）
│   │   └── config.js         # md 配置文件加载器
│   └── assets/
│       └── icons/            # SVG 图标
└── docs/
    └── superpowers/specs/    # 设计文档
```

## 页面布局

移动端优先的竖向布局，分为三大区域：

```
┌─────────────────────────────┐
│  [☀/🌙]    Claudio FM   [≡] │  ← 顶部栏：主题切换、标题、菜单
├─────────────────────────────┤
│                             │
│        [专辑封面]            │  ← 封面区（点击翻转显示歌词）
│     （动态取色背景）          │
│       （节拍律动光效）        │
│                             │
├─────────────────────────────┤
│  ♡  歌曲名                   │
│  ──●─────────── 2:34/4:01   │  ← 播放条：收藏、歌曲信息、进度条
│  ⟲    ▶    ⟳               │     控制：随机、播放、循环
├─────────────────────────────────────────────┤
│  [Claudio头像]  Claudio FM  [你的头像]       │  ← 聊天头部
├─────────────────────────────────────────────┤
│                                             │
│  Claudio: Yo, 这首歌有来头...                │
│                                             │
│  ┌─────────────────────────────┐            │
│  │ 🎵 If — Bread          ▶ + │            │  ← 歌曲卡片（可交互）
│  └─────────────────────────────┘            │
│                                             │
│  你: 推荐首安静的歌                           │
│                                             │
│  Claudio: 收到，马上安排...                   │
│                                             │
├─────────────────────────────────────────────┤
│  [输入消息...]                      [发送]   │  ← 聊天输入框
└─────────────────────────────────────────────┘
```

### 封面 ↔ 歌词翻转

- 默认状态：显示专辑封面，背景色从封面提取
- 点击封面：CSS 3D `rotateY(180deg)` 过渡（0.6s），翻出歌词面板
- 歌词面板：逐行高亮，跟随播放进度自动滚动
- 再次点击：翻转回封面
- 实现方式：CSS `perspective` + `transform-style: preserve-3d` 容器的正反两面

### 头像弹出面板

- **Claudio 头像点击** → 底部滑出面板，显示：
  - 电台信息（名称、描述、风格标签）
  - **个人音乐品味画像**（核心功能）：
    - **生成时机**：每日定时任务（早上 7 点），与每日歌单推荐一起执行
    - **数据来源**：网易云收藏列表 + 近期听歌历史 + `taste.md` + `moodrules.md`
    - **生成内容**：Claudio 以 DJ 口吻撰写的品味总结 + 听歌类型关键词（喜欢的歌手、风格、年代等）
    - **展示内容**：风格偏好雷达图 / 常听年代 / 最爱艺人 Top5 / 听歌人格描述
    - **示例**："Yo, 你是个 90 年代 R&B 老灵魂，偶尔也来点 lo-fi 舒缓一下。深夜是你的黄金时段，你总在凌晨两点找那些带烟味的爵士。"
    - **存储**：生成结果入库到 SQLite `preferences` 表（key: `taste_profile`）
    - **读取**：用户第一次打开网页时直接从数据库获取，无需等待实时生成
- **用户头像点击** → 底部滑出面板，显示：
  - 喜欢的歌曲列表（来自 SQLite `favorites` 表）
  - 最近播放记录
  - 用户创建的歌单

### DJ 语音沉浸模式

从聊天界面触发，当 Claudio 对某首歌有见解/推荐理由时：

```
┌─────────────────────────────┐
│           [X] 关闭           │
├─────────────────────────────┤
│                             │
│   ═══╦═══╤═══╦═══╤═══      │  ← DJ 语音实时波形（Canvas）
│  ════╬═══╪═══╬═══╪═══      │
│   ═══╩═══╧═══╩═══╧═══      │
│                             │
├─────────────────────────────┤
│                             │
│  "Yo, 这首歌有故事..."       │  ← DJ 说的话，逐行滚动
│                             │
│  "1971年，David Gates        │
│   拿起一把吉他..."           │
│                             │
└─────────────────────────────┘
```

**音频混音行为**：

- 正常播放：歌曲增益 = 1.0
- DJ 说话时：歌曲增益渐变到 0.2（300ms）+ 加混响效果 → DJ 语音增益 = 1.0
- DJ 说完后：歌曲增益渐变恢复到 1.0（600ms），移除混响
- 两者通过 Web Audio API 同时播放

## 视觉设计

### 动态取色

```
专辑封面 URL → Canvas 绘制 → getImageData() → 颜色量化
→ 提取主色板（primary、secondary、accent）
→ 更新 CSS 变量（--color-primary、--color-secondary、--color-accent）
→ 所有视觉元素自动响应
```

算法：对采样像素做 k-means 聚类，按饱和度和频率取前 3 种颜色。

### 流体背景

- 全屏流体渐变色块（蓝、紫、强调色）
- 颜色由 `--color-primary` 和 `--color-secondary` 驱动
- 缓慢移动的 CSS 动画（26s–42s 周期）
- `filter: blur(120px) saturate(1.1)` + `mix-blend-mode: screen`
- 噪点纹理叠加增加质感

### 粒子特效

- 触发时机：切换歌曲、翻转封面、点击收藏
- Canvas 粒子系统
- 粒子从操作起点向外爆散
- 颜色：`--color-accent`，带透明度衰减
- 每次爆发约 50–100 个粒子，1s 生命周期

### 节拍律动边框光效

- 专辑封面卡片有动画 `box-shadow` 光效
- 光效颜色：`--color-primary` 到 `--color-accent` 渐变
- 强度由 Web Audio `AnalyserNode` 低频（20–200Hz）驱动
- 跟着节拍脉动，60fps 流畅动画

### 主题切换

- 亮/暗模式通过 `<html>` 的 `data-theme` 属性控制
- 右上角切换按钮（太阳/月亮图标）
- 持久化到 SQLite `preferences` 表
- 暗色模式（默认）：`#0a0a10` 底色，白色文字
- 亮色模式：`#f5f5f5` 底色，深色文字
- 流体背景根据主题调整透明度/饱和度

## 播放器

### 控制项

- 播放/暂停（居中）
- 上一曲 / 下一曲
- 随机播放开关
- 循环模式切换（关闭 / 全部循环 / 单曲循环）
- 进度条（可拖拽）
- 收藏按钮（红心图标，切换状态）

### 播放队列

- 当前歌单歌曲加载到内存队列
- 随机模式：Fisher-Yates 洗牌算法打乱队列
- 循环模式：关闭（播放完停止）、全部（循环队列）、单曲（循环当前）
- **持久化（跨会话续播）**：
  - 每次歌曲切换时，将当前播放状态写入 SQLite
  - 存储内容：当前歌曲 ID + 播放进度（秒）+ 播放队列（有序歌曲 ID 列表）+ 播放模式
  - 用户下次打开网页时自动恢复上次播放位置，实现"跨会话续播"
  - 新增 SQLite 表 `playback_state` 存储播放状态

### 音频来源

- 歌曲通过网易云 API 获取：`/song/url?id={song_id}`
- 直接音频流地址，通过 HTML5 `<audio>` 元素播放
- 通过 `createMediaElementSource()` 连接到 Web Audio API 进行分析

## 聊天系统

> Agent 配置体系、system prompt 拼装、歌曲推荐协议等详见上方「Agent 集成架构」章节。

### 聊天 UI

- 消息以气泡形式显示（Claudio 左对齐，用户右对齐）
- Claudio 消息带头像，用户消息带用户头像
- 歌曲卡片内嵌在 Claudio 的消息中
- 流式文字配合打字指示器
- 自动滚动到最新消息
- 底部固定：输入框 + 发送按钮

### 聊天内嵌歌曲卡片

```
正常状态：                    无直链状态（置灰）：
┌─────────────────────┐      ┌─────────────────────┐
│ [封面] 歌曲名        │      │ [封面] 歌曲名        │
│        艺术家    ▶ + │      │        艺术家    ⚠   │
└─────────────────────┘      └─────────────────────┘
                              （灰色遮罩，按钮禁用）
```

- `▶` 按钮：替换当前曲目并播放
- `+` 按钮：添加到当前歌单
- **无直链处理**：Claude 推荐歌曲后，前端通过网易云 API `/song/url` 获取播放直链。如果返回为空或无权限，歌曲卡片整体置灰（灰色遮罩 + 降低透明度），播放和添加按钮禁止操作，显示"暂无音源"提示

## Agent 集成架构

### 配置体系（四层）

Claudio 的人格和行为由四个配置文件驱动，全部存放在 `config/` 目录：

| 文件 | 用途 | 说明 |
|------|------|------|
| `taste.md` | 音乐品味 | 定义 Claudio 喜欢什么类型的音乐、偏好哪些年代/风格/艺人 |
| `routines.md` | 行为习惯 | 定义不同时段的音乐模式、固定节目环节、日常习惯 |
| `moodrules.md` | 情绪规则 | 定义情绪如何影响选歌和对话语调 |
| `agent.md` | Agent 提示词 | 核心人设 prompt（用户单独创建，定义 Claudio 的身份、说话风格、行为准则） |

### Agent 加载流程

```
服务启动
  ↓
读取 config/ 目录下四个 md 文件
  ↓
缓存到内存（支持热重载：文件变化时自动重新加载）
  ↓
用户发消息时：
  ↓
消息分流引擎（前端 /api/dispatch）
  ↓
┌─────────────┬──────────────────┬──────────────────┐
│ 简单指令     │ 音乐操作          │ 自然语言聊天       │
│ 直接执行     │ 网易云 API        │ Claude API        │
└─────────────┴──────────────────┴──────────────────┘
  ↓
解析回复 → 渲染文本 + 语音 + 歌曲卡片
```

### 消息分流引擎

用户输入的消息通过 `/api/dispatch` 统一入口，根据意图分类路由：

| 分类 | 触发条件 | 路由目标 | 示例 |
|------|----------|----------|------|
| **简单指令** | 播放控制类关键词 | 服务端直接执行 | "下一首"、"暂停"、"音量调大"、"随机播放" |
| **音乐操作** | 搜索/歌单/歌词相关 | 网易云 API | "搜索周杰伦"、"播放晴天"、"今天推荐什么歌单" |
| **自然语言** | 其他所有对话 | Claude API | "给我推荐首安静的歌"、"这首歌有什么故事" |

分流策略：
- 前端做初步意图识别（关键词匹配），快速响应简单指令
- 复杂意图统一走 Claude，由 Claude 在回复中决定是否需要调用网易云 API（tool use）
- 所有消息都记录到 SQLite `chat_messages` 表

### Claude 回复结构化协议

Claude 的回复必须遵循以下 JSON 结构：

```json
{
  "say": "回复给用户的消息文本",
  "reason": "推荐理由（如果有歌曲推荐）",
  "play": [
    {"id": "歌曲ID", "name": "歌曲名", "artist": "艺术家", "album": "专辑", "cover": "封面URL"}
  ],
  "segue": "要用 TTS 朗读的语音内容（歌曲描述、赏析等，由 Claude 决定是否生成）"
}
```

### 各字段展示方式

| 字段 | 展示形式 | 说明 |
|------|----------|------|
| `say` + `reason` | 文字气泡 | 拼接后在聊天气泡中以文字格式展示 |
| `segue` | 语音播放 | 通过 TTS 朗读，同时在聊天中显示语音波形条 |
| `play` | 歌曲卡片 | 每首歌渲染为可交互卡片（▶ 播放 / + 添加） |

**展示顺序**（在聊天气泡中从上到下）：
1. 文字区域：`say` + `reason`（合并展示）
2. 语音区域：`segue` 的语音波形条（可点击播放/暂停）
3. 歌曲区域：`play` 列表中的歌曲卡片

### Agent API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 返回所有 md 配置文件内容（JSON） |
| POST | `/api/config/:filename` | 更新指定配置文件内容 |
| POST | `/api/dispatch` | 消息分流入口（自动路由到对应处理器） |
| POST | `/api/chat` | 发送消息给 Claude（流式 SSE，返回结构化 JSON） |
| GET | `/api/chat/history` | 获取历史聊天记录（分页） |

### 音乐品味画像

品味画像由每日定时任务预生成，用户打开网页时直接读取：

- **生成时机**：每日 07:00 定时任务自动执行
- **输入数据**：网易云收藏列表 + 近期听歌历史 + `taste.md` + `moodrules.md`
- **输出内容**：Claudio 以 DJ 口吻撰写的品味总结，包含：
  - 听歌人格描述（一段文字）
  - 听歌类型关键词（风格、年代、场景）
  - 偏好艺人 Top5
- **存储**：SQLite `preferences` 表（key: `taste_profile`）
- **读取**：用户打开网页时直接从数据库获取，无需等待

## 网易云 API 集成

使用的端点（均指向 `http://192.168.5.103:3000`）：

| 功能 | 端点 | 参数 |
|------|------|------|
| 搜索歌曲 | `/cloudsearch` | `keywords`、`type=1`、`limit` |
| 歌曲播放 URL | `/song/url` | `id`、`br=320000` |
| 歌词 | `/lyric` | `id` |
| 推荐歌单 | `/personalized` | `limit` |
| 歌单详情 | `/playlist/detail` | `id` |
| 每日推荐 | `/recommend/songs` | （需要登录） |
| 专辑封面 | 来自搜索/歌单响应 | 封面 URL |

## 数据持久化（SQLite）

### 数据表

```sql
CREATE TABLE favorites (
  song_id TEXT PRIMARY KEY,
  song_name TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  cover_url TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id TEXT,
  song_name TEXT,
  artist TEXT,
  album TEXT,
  cover_url TEXT,
  played_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playlist_songs (
  playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT,
  song_name TEXT,
  artist TEXT,
  album TEXT,
  cover_url TEXT,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (playlist_id, song_id)
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  song_cards TEXT,  -- JSON 数组：推荐的歌曲卡片数据
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE playback_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- 只有一行
  current_song_id TEXT,
  current_song_name TEXT,
  current_song_artist TEXT,
  current_song_album TEXT,
  current_song_cover TEXT,
  progress_seconds REAL DEFAULT 0,
  queue_song_ids TEXT,  -- JSON 数组：当前播放队列的歌曲 ID 列表
  queue_index INTEGER DEFAULT 0,
  play_mode TEXT DEFAULT 'off',  -- off / all / one / shuffle
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 服务端 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 返回 md 配置文件（JSON） |
| POST | `/api/chat` | 代理 Claude API（流式 SSE） |
| GET | `/api/favorites` | 获取喜欢列表 |
| POST | `/api/favorites` | 添加到喜欢 |
| DELETE | `/api/favorites/:songId` | 从喜欢中移除 |
| GET | `/api/history` | 获取播放历史 |
| POST | `/api/history` | 记录播放事件 |
| GET | `/api/playlists` | 获取用户歌单列表 |
| POST | `/api/playlists` | 创建歌单 |
| GET | `/api/playlists/:id` | 获取歌单详情（含歌曲） |
| POST | `/api/playlists/:id/songs` | 向歌单添加歌曲 |
| DELETE | `/api/playlists/:id/songs/:songId` | 从歌单移除歌曲 |
| GET | `/api/chat/history` | 获取聊天历史 |
| GET | `/api/preferences` | 获取所有偏好设置 |
| PUT | `/api/preferences` | 更新偏好设置 |
| GET | `/api/playback-state` | 获取上次播放状态（续播用） |
| PUT | `/api/playback-state` | 保存当前播放状态 |

## Web Audio 架构

```
                         ┌─────────────────┐
歌曲音频 ──→ MediaElementSource ──→ GainNode(增益:1.0) ──→ AnalyserNode ──→ 输出
                                          │
                                          │ （DJ 说话时连接）
                                          │
DJ 语音 ──→ MediaElementSource ──→ GainNode(增益:1.0) ──┘
                                     │
                                     └──→ ConvolverNode(混响) ──→ （可选）
```

- `AnalyserNode` 输出：波形 Canvas、节拍检测（用于光效）
- 歌曲 `GainNode`：动画 1.0 → 0.2（闪避）→ 1.0（恢复）
- DJ 语音期间给歌曲加 Convolver 混响，营造"电台直播间"感觉

## 配置文件

`config/` 目录下三个 Markdown 文件，模板供用户后续填充：

### taste.md

定义 Claudio 的音乐品味偏好、风格倾向、年代偏好等。

### routines.md

定义行为习惯、不同时段的音乐模式、固定节目环节。

### moodrules.md

定义情绪如何影响选歌、对话语调变化规则。

这些文件在服务启动时加载，注入到 Claude 的 system prompt 中。

## 定时任务模块

服务端内置定时任务调度器（使用 `node-cron`），支持以下自动化任务：

### 每日歌单推荐（每天 07:00）

- 触发时间：每天早上 7:00
- 流程：调用 Claude API，传入 `taste.md` + 最近播放历史 + `moodrules.md`，生成当日推荐歌单
- Claude 返回歌曲列表（JSON 格式），通过网易云 API 搜索匹配
- 生成的歌单存入 SQLite `playlists` 表（标记为 `type: daily`）
- 用户打开 App 时，首页展示"今日推荐"歌单
- 同时通过聊天推送一条消息："早安！今天的歌单安排上了 🎵"

### 每小时情绪检查

- 触发频率：每小时一次
- 流程：调用 Claude API，传入 `moodrules.md` + 当前时间 + 最近聊天记录，判断当前"电台情绪"
- 输出：情绪标签（如：平静、亢奋、忧郁、深夜模式）+ 推荐曲风
- 情绪结果存入 SQLite `preferences` 表（key: `current_mood`）
- 如果用户正在收听，根据情绪自动调整播放队列的曲风权重
- 如果用户不在收听，下次打开时展示情绪对应的推荐

### 定时任务 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scheduler/status` | 查看定时任务运行状态 |
| GET | `/api/scheduler/daily-playlist` | 获取今日推荐歌单 |
| GET | `/api/scheduler/mood` | 获取当前情绪状态 |
| POST | `/api/scheduler/trigger/:task` | 手动触发指定任务（调试用） |

## Mock 模块（待实现）

以下模块当前使用 Mock 数据，后续补充真实实现：

### Mock 日历模块

- **用途**：根据用户日程安排推荐音乐
- **Mock 实现**：提供一个 `config/schedule.json` 文件，手动定义日程条目
- **数据格式**：
  ```json
  [
    {"time": "08:00", "event": "晨跑", "mood": "energetic", "duration": 30},
    {"time": "14:00", "event": "专注工作", "mood": "focus", "duration": 120},
    {"time": "22:00", "event": "睡前放松", "mood": "calm", "duration": 60}
  ]
  ```
- **行为**：定时任务检查当前时间匹配的日程事件 → 根据 mood 调用 Claude 推荐对应曲风
- **后续**：接入真实日历 API（Google Calendar / Apple Calendar）

### Mock 声音管线（TTS）

- **用途**：DJ Claudio 的语音输出
- **Mock 实现**：使用浏览器 Web Speech API（`SpeechSynthesis`）
- **流程**：
  1. Claude 生成推荐文本
  2. 调用 `SpeechSynthesis.speak()` 朗读文本
  3. 通过 `AnalyserNode` 获取语音波形数据
  4. Canvas 绘制实时语音波形
- **限制**：浏览器语音质量有限，无情感控制
- **后续**：接入专业 TTS 服务（如 ElevenLabs / Azure TTS / Fish Audio），支持自定义音色、情感、语速

### Mock 模块 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schedule` | 获取日程列表 |
| POST | `/api/schedule` | 更新日程 |
| POST | `/api/tts/speak` | 触发 TTS 播放（返回文本，前端调用 Web Speech API） |

## 字体

- **正文**：Inter（UI 元素、正文文本）
- **展示**：Doto（电台名称、标题）
- **辅助**：Space Grotesk（导航、标签）

全部从 Google Fonts 加载。

## 错误处理

- 网易云 API 失败：显示 toast 通知，自动跳到下一首
- Claude API 失败：在聊天气泡中显示错误信息，允许重试
- 音频播放错误：自动跳过并通知
- TTS 失败：DJ 语音模式回退为纯文本显示

## 测试策略

- 在移动端 Chrome/Safari 上手动测试
- 验证所有网易云 API 端点与本地服务配合正常
- 测试 Claude 流式对话在长对话下的表现
- 测试音频混音（闪避 + 混响）在各浏览器的兼容性
- 验证 SQLite 数据在服务重启后持久化正常

## 推荐实现阶段

鉴于项目规模，建议分阶段实现：

1. **第一阶段 — 基础搭建**：项目脚手架、server.js、SQLite 初始化、静态文件服务、基础 HTML 结构
2. **第二阶段 — 播放器**：网易云 API 集成、音频播放、进度条、基础控制（播放/暂停/上下曲）
3. **第三阶段 — 视觉**：动态取色、流体背景、封面展示、主题切换
4. **第四阶段 — 歌词**：从网易云获取歌词、封面翻转歌词动画、逐行高亮
5. **第五阶段 — Agent 集成**：四层配置文件加载（agent.md + taste.md + routines.md + moodrules.md）、消息分流引擎（/api/dispatch）、结构化 JSON 回复协议（say/reason/play/segue）、system prompt 拼装、Claude API 流式调用
6. **第六阶段 — 聊天 UI**：聊天气泡渲染（文字 + 语音波形条 + 歌曲卡片三层结构）、流式文字打字效果、消息内歌曲卡片（播放/添加）、从聊天直接播放歌曲
7. **第七阶段 — 定时任务**：每日歌单推荐（07:00）、每小时情绪检查、node-cron 调度器、任务状态 API
8. **第八阶段 — Mock 模块**：Mock 日历（schedule.json + 日程匹配推荐）、Mock 声音管线（Web Speech API + 波形可视化）
9. **第九阶段 — 数据持久化**：收藏、歌单、播放历史、聊天记录持久化、偏好设置
10. **第十阶段 — 打磨**：粒子特效、节拍律动光效、DJ 语音沉浸模式、头像弹出面板、错误处理
