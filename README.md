# Claudio FM

个人 AI 电台，Vanilla JS + Express + SQLite。

## 它做什么

- **6 个电台模式**（默认 / 工作 / 运动 / 驾驶 / 休息 / 睡前），每个模式有独立的选歌风格、DJ 语调、可手动编辑的偏好 markdown
- **真 AI DJ**：当前歌结束 → AI 从候选池选下一首（pickIndex）+ 写一段电台风格串词 → 火山引擎 TTS 合成 → 串词放完无缝切到下一首
- **候选池架构**：服务端先按"网易云相似 + 用户高分历史"拼一个 ≤30 首预过滤池（去重 + 艺人配额都已应用），LLM 只做选择不做生成；冷启动或池太小自动回退到自由生成模式
- **艺人配额制**：最近 10 首同艺人 ≤1 / 最近 30 首 ≤2 / 最近 30 天 ≤5 三档时间窗，避免连推 Coldplay 这种偏见
- **预取**：当前歌一开始播，后台并行准备"下一首 + TTS 串词"。切歌零等待。1 首缓冲就够（避免预取链放大同艺人偏见）
- **跟 DJ 聊天**：自然语言点歌 / 推荐歌单 / 闲聊；推荐结果可一键全部加入播放列表
- **三层情绪推断**：用户主动输入 > 最近聊天上下文 > 最近一小时播放行为（含跳过率分析）
- **AI 品味画像**：用过去 3 天播放 + 最新 10 收藏 + taste.md 让 AI 写一段你的音乐画像
- **模式自动学习**：每个模式过去 14 天的播放数据 → AI 提炼 4-8 条偏好规律 → 写到 `config/modes/{key}.md` 的 AUTO-LEARN 区块
- **网易云收藏双向同步**：在 app 里点 ♡，同步加入你网易云账号"我喜欢的音乐"；显示红心的判断同时看本地 DB + 网易云 likelist
- **AI 后台任务总控台**：DJ 头像点开 → 看每个 cron 上次跑的时间，一键手动触发

## 技术栈

| 层 | 用了什么 |
|---|---|
| 前端 | Vanilla JS ES Module · Web Audio API · Service Worker |
| 后端 | Node.js · Express 5 · `better-sqlite3` · `node-cron` · `ws` |
| AI | `@anthropic-ai/sdk`（任意 Anthropic 兼容端点） |
| TTS | 火山引擎豆包语音合成 V1 HTTP（1.0 系列 _bigtts 音色） |
| 音源 | 网易云音乐 API（[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 本地代理） |
| 持久化 | SQLite（单文件 `data/claudio.db`） |

## 快速启动

### 前置条件

1. Node 18+
2. Anthropic 兼容的 API Key
3. （可选）火山引擎语音合成大模型账号（V1 接口、`volcano_tts` cluster），仅用于 DJ 串词的 TTS
4. （可选）网易云账号 cookie，用于"我喜欢的音乐"同步

### 安装并启动

```bash
git clone <this-repo>
cd Claudio
npm install
cp .env.example .env       # Windows 下手动复制即可
# 编辑 .env，至少填 ANTHROPIC_API_KEY / ANTHROPIC_MODEL
npm run all                # 同时拉起 Claudio + NetEase API
```

打开 `http://localhost:3001`。

### npm scripts

```
npm run start      # 只启动 Claudio 主服务（不含网易云 API，AI 选歌/搜歌会失败）
npm run dev        # nodemon 模式启动 Claudio
npm run netease    # 只启动网易云 API（端口 3000）
npm run all        # ★ 同时起两个，开发推荐用这个
npm run all:dev    # 同上 + nodemon
```

### Docker 部署

```bash
git clone <this-repo> claudio
cd claudio
cp .env.example .env       # 编辑填真实凭证

# ⚠️ 容器内进程是 node 用户（UID 1000），但宿主机这两个目录默认 root:root
#    不预先 chown 会导致 SQLite 无法打开（SQLITE_CANTOPEN）
mkdir -p data
chown -R 1000:1000 data config

docker compose up -d --build
docker compose logs -f claudio
```

服务起来后访问 `http://<host>:8081/`。compose 已配置：

- `claudio-fm` 容器 → 宿主机 8081（compose 里改 `ports:` 即可）
- `claudio-netease` 容器 → 仅内网 `claudio-net` 暴露，不出容器
- `data/` 与 `config/` 双向 bind mount，配置改完热加载、DB 持久化

> Dockerfile 里的 apk + npm 都已切到阿里云镜像（首次冷 build 约 8–15 分钟）。
> 要换腾讯：把 `mirrors.aliyun.com` 改成 `mirrors.tencent.com`，npm registry 改 `https://mirrors.tencent.com/npm/` 即可。

## .env 字段

```env
# ===== AI =====
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic   # Claude 官方就不要填这行
ANTHROPIC_MODEL=deepseek-v4-flash                       # 任意支持 messages.create 的模型

# ===== 网易云 =====
NETEASE_API=http://localhost:3000
NETEASE_COOKIE=MUSIC_U=xxx...                           # 可选；不填则没有"我喜欢"同步

# ===== TTS（火山引擎 V1 HTTP）=====
VOLC_APPID=...
VOLC_ACCESS_TOKEN=...
VOLC_CLUSTER=volcano_tts
VOLC_VOICE_TYPE=zh_female_wanwanxiaohe_moon_bigtts      # 1.0 _bigtts 系列均可
VOLC_VOLUME=2.0                                          # V1 范围 0.5-2.0；和客户端 GainNode 1.8x 叠加 ≈ 3.6 倍

# ===== 服务 =====
PORT=3001
```

> **关于 V3 大模型 TTS 没接**：开发过程中尝试过 `wss://openspeech.bytedance.com/api/v3/tts/bidirection`，协议层全部走通（建连/会话/句子事件正常），但服务端持续返回 `data: null`、不出音频帧（HTTP V3、SSE V3、WebSocket V3 均如此），是账号侧资源授权问题。1.0 V1 HTTP 路径完全工作，本仓库就用它。

## 项目结构

```
Claudio/
├── server.js                 # 单文件后端 (~2000 行)
├── package.json
├── .env / .env.example
├── data/
│   └── claudio.db            # SQLite 单文件
├── config/
│   ├── agent.md              # AI agent 行为
│   ├── taste.md              # 长期音乐品味（手动编辑）
│   ├── moodrules.md          # 情绪规则（手动编辑）
│   ├── routines.md           # 日常作息
│   └── modes/
│       ├── default.md        # 默认模式偏好
│       ├── work.md
│       ├── workout.md
│       ├── drive.md
│       ├── relax.md
│       └── sleep.md
├── public/
│   ├── index.html            # 单页应用
│   ├── sw.js                 # Service Worker（缓存优先策略）
│   ├── manifest.json
│   ├── css/                  # main.css / player.css / lyrics.css / chat.css / voice.css
│   └── js/
│       ├── app.js            # 总入口、视图切换、AI 任务面板、情绪面板
│       ├── player.js         # 播放器、队列、收藏、♥ 状态
│       ├── radio.js          # 电台模式 + 预取
│       ├── chat.js           # DJ 聊天 + 推荐渲染
│       ├── voice.js          # TTS 播放 + 音波可视化 + GainNode
│       ├── panels.js         # 收藏 / 历史 / 搜索面板
│       ├── lyrics.js         # 歌词
│       ├── visual.js         # 封面翻转 / 频谱 / 粒子
│       └── api.js            # netease + server 包装
└── tts-bigtts.js             # 火山 V3 WebSocket 双向流式实现（保留供未来用）
```

## 核心系统

### 电台模式选歌 + 串词

`POST /api/radio/next` 接收 `{mode, currentSong, recent, queuePosition?, currentSongState?}`。

**Prompt 标准框架**（详见 [`docs/prompt-architecture.md`](docs/prompt-architecture.md)）：

```
════════ 1) 选歌依据（必读） ════════
【候选池 N 首 · M 个艺人 · K 个探索艺人 ⭐】（pool 模式）
  或 🚫 编号歌单禁列 + 🚫 艺人禁列（free 模式）
【模式 / 风格 / 语调】...
【上一首（承接基线）】《X》— A · 用户完整听完
【⚙ 预取位置】这是预取队列的第 N 首...

════════ 2) 当下场景 ════════
【听众当下】周五 · 晚上，陪伴模式，心情偏温暖（folk），刚完整听完《X》— A。

════════ 3) 长期背景（参考） ════════
【模式偏好（companion.md）】... (≤600 字)
【长期品味】... (≤800 字)
【最近聊天】...

════════ DJ 串词指南 ════════
• 长度 / 语调 / 承接 / 避免开头复读
```

**输出**：
- Pool 模式：`{pickIndex: <1-N>, intro: "..."}`，服务端从候选池拿对应歌
- Free 模式：`{song:{name,artist}, intro:"..."}`，服务端 `resolveSong` 走网易云补全

**约束**（详见 `dedup-rules.xlsx`）：
- 第 0 层：候选池预过滤（pool 模式下结构上不可能违反）
- 第 1 层：服务端硬拒（dupId / dupName / 艺人配额超额）
- 第 2 层：sysPrompt 硬规则（pool 5 条 / free 7 条）
- 第 3 层：retry 累积反馈（badPicks 列表强压换艺人）
- 第 4 层：兜底（DB 高分历史三档时间窗，避免 404 卡住客户端）

### 预取（零等待切歌）

每首歌播到 ~1.5 秒时后台并行：

1. `POST /api/radio/next` 让 AI 从候选池选下一首并写串词
2. `POST /api/tts` 把串词合成成 mp3 blob
3. 整体打包暂存为 `prefetchQueue[0]`

**单首缓冲策略**（v2，2026-05）：成功预取 1 首后停手，等当前歌消费完再预取下一首。避免之前"链式填 3 首"放大艺人偏见的问题（用户反馈"连续 Coldplay"的根因）。失败仍走指数退避重试。

切歌时：
- 模式没变 → 消费 `prefetchQueue[0]`：TTS 直接放、URL 直接喂播放器
- 模式变了 → `invalidatePrefetch()` 作废飞行中的请求（generation 计数器防竞态），现拉

### 三层情绪推断

`resolveMood()` 优先级链（在 `server.js` 的 mood 模块内）：

| 优先级 | 来源 | TTL |
|---|---|---|
| 1 | 用户主动输入（"今天有点累想听温柔的"） → AI 解析为 mood/genre/message | 4 小时 |
| 2 | 最近 30 分钟跟 DJ 的聊天上下文 → AI 推断 | 30 分钟 |
| 3 | 最近 1 小时播放行为（曲数、跳过率、艺人集中度）→ AI 推断 | 30 分钟 |

UI：顶栏 🎭 pill 显示当前情绪 + 来源；点 pill 弹面板，可手动写一句话设定 / 让 AI 重新判断 / 清除回退到自动。

### AI 后台任务

| 任务 | 频率 | 输入 | 输出 |
|---|---|---|---|
| `taste-profile` | 每日 07:00 | 过去 3 天播放 + 最新 10 收藏 + `taste.md` | 120-200 字品味画像写到 `preferences.taste_profile` |
| `mood` | 每小时整点 | 见上方"三层情绪推断" | `preferences.current_mood` |
| `mode-learn` | 每日 03:00 | 每个模式过去 14 天的 `play_history WHERE mode=X` | 写到 `config/modes/{key}.md` 的 AUTO-LEARN 区块（4-8 条规律） |
| `daily-playlist` | 每日 07:00 | 品味 + 最近播放 50 条 | 创建一个 `今日推荐` 歌单（10 首） |

**全部支持手动触发**：DJ 头像 → AI 后台任务 → "立即跑一次"。**启动 catch-up**：服务起来 5 秒后自动检查每个任务的 `lastRun`，过期了就异步补跑（mood 1h、其他 24h），不依赖 cron 整点。

### 旧历史回填

`mode` 字段是数据表后加的（`ALTER TABLE`）。旧记录全是 NULL，专门模式（work/workout/...）的 AUTO-LEARN 学不到这部分历史。

按"工作日 + 时段"规则一次性回填（`POST /api/admin/backfill-mode`）：

| 时段 | 工作日 | 周末 |
|---|---|---|
| 早晨 6-10 | work | relax |
| 上午 10-12 | work | drive |
| 午餐 12-14 | default | default |
| 下午 14-18 | work | drive |
| 晚饭 18-20 | relax | relax |
| 晚间 20-23 | relax | relax |
| 深夜 23-6 | sleep | sleep |

UI 在 DJ 头像 → 数据维护 → "📋 立即回填"。规则透明，不动已有 mode，可重跑。

### 收藏与网易云同步

| 操作 | 行为 |
|---|---|
| 点 ♡ | 写本地 `favorites` 表 + 调网易云 `/like?id=X&like=true` 同步 |
| 取消 ♡ | 删本地 + 网易云 `/like?id=X&like=false` |
| 红心状态判定 | 本地命中或网易云 likelist 命中（`/api/netease/likelist` 5 分钟前端缓存） |
| 一次性把本地全部同步到网易云 | `POST /api/admin/sync-favorites-to-netease`（幂等，跳过已存在的） |
| 我喜欢的页面 | 本地未同步部分跟网易云列表去重，同时显示 |

### Service Worker 策略

`public/sw.js` 是 **network-first**（v19 后新策略）：

- API 请求 (`/api/*`) → 不缓存，直走网络
- HTML / JS / CSS → 优先网络，更新缓存；网络不通才用缓存兜底
- 图片 / 字体 / icon → cache-first（极少变化）
- 离线 navigate → 返回缓存的 `/`

**改前端代码不再需要 bump `CACHE_NAME`** —— 用户刷新就拿最新版。仅当往 `PRECACHE` 列表加新文件时才需要 bump。

## API 速查

### 播放器

```
GET    /api/playback-state           # 当前播放状态（含队列）
PUT    /api/playback-state           # 保存当前状态
GET    /api/favorites                # 本地收藏列表
POST   /api/favorites                # 收藏（双写本地 + 网易云）
DELETE /api/favorites/:songId        # 取消收藏（双写）
GET    /api/history?limit=N          # 最近播放历史
POST   /api/history                  # 记录一首
```

### 网易云代理

```
GET    /api/netease/search           # 搜索
GET    /api/netease/song/url         # 取播放 URL
GET    /api/netease/lyric            # 歌词
GET    /api/netease/me/likes         # 我喜欢的音乐（完整 song 列表）
GET    /api/netease/likelist         # 我喜欢的 ID 数组（轻量，前端用）
```

### 电台 / AI

```
POST   /api/radio/next               # AI 选下一首 + 串词
POST   /api/dj/intro                 # AI 写当前歌的介绍串词
GET    /api/radio/modes              # 所有模式
GET    /api/radio/modes/:key/md      # 读模式偏好 MD
PUT    /api/radio/modes/:key/md      # 改模式偏好 MD
POST   /api/radio/modes/:key/learn   # 让 AI 学习单个模式
GET    /api/radio/habit-snapshot     # 当前时段习惯切片
POST   /api/dispatch                 # 跟 DJ 聊天主入口（SSE 流）
GET    /api/chat/history             # 聊天历史
DELETE /api/chat/history             # 清除聊天
```

### 情绪

```
GET    /api/mood                     # 当前情绪（按优先级链解析）
POST   /api/mood                     # 用户主动设定 (body: {input})
POST   /api/mood/refresh             # 强制重新推断
DELETE /api/mood                     # 清除用户设定，回退自动
```

### TTS

```
POST   /api/tts                      # 文字 → mp3 audio buffer (text/event-stream off)
                                       # body: {text, style?}
                                       # 默认走火山 V1 HTTP，可设 VOLC_USE_V3=1 切到 V3 WebSocket
```

### 调度器 / 数据维护

```
GET    /api/scheduler/status                        # 各任务 lastRun 状态
GET    /api/scheduler/daily-playlist                # 最新的"今日推荐"歌单
GET    /api/scheduler/mood                          # 直接读 current_mood（旧端点）
GET    /api/scheduler/taste-profile                 # 当前品味画像
POST   /api/scheduler/trigger/:task                 # 触发 (task: daily-playlist / mood / mode-learn / taste-profile)
POST   /api/admin/backfill-mode                     # 回填旧历史的 mode 字段
GET    /api/admin/backfill-mode/last                # 上次回填的元数据
POST   /api/admin/sync-favorites-to-netease        # 把本地未同步的收藏推到网易云
```

## 数据库表

```sql
favorites(song_id PK, song_name, artist, album, cover_url, added_at)
play_history(id PK, song_id, song_name, artist, album, cover_url, played_at, mode)
chat_messages(id PK, role, content, song_cards, created_at)
playlists(id PK, name, type, created_at)
playlist_songs(playlist_id, song_id, ..., UNIQUE(playlist_id, song_id))
preferences(key PK, value)              # current_mood, taste_profile, scheduler_status,
                                          # backfill_mode_last, theme, volume 等都塞这一张
```

## 开发提示

- **改前端代码**：bump `public/sw.js` 的 `CACHE_NAME`
- **改了 cron 任务函数**：服务重启后 5 秒会触发 catch-up，不用等整点
- **AI 模型切换**：只动 `.env` 的 `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`，无须改代码
- **想看 AI 给的原始 prompt**：把 `console.log(userPrompt)` 加在对应路由的 `messages.create()` 之前
- **本地 DB 浏览**：`data/claudio.db` 用 DB Browser for SQLite 直接打开
- **配置 hot-reload**：`config/*.md` 改完不用重启，下次 prompt 拼接时会重新读

## License

MIT
