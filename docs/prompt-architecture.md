# Aidio FM Prompt 标准框架（v1）

所有给 LLM 拼 ctx / system prompt 的路由必须遵守这个框架。代码实现在 `lib/prompt-builder.js`。

---

## 1. 三层结构

```
════════ 1) 选歌依据（必读） ════════   ← 跟当前任务直接相关
... 候选池 / 这首歌 / 模式风格 / 上一首 / 预取位置 ...

════════ 2) 当下场景 ════════           ← 听众当下 narrative（一句话）
【听众当下】周五 · 晚上，陪伴模式，心情偏温暖（folk），刚完整听完《X》— A。

════════ 3) 长期背景（参考） ════════   ← 长期偏好 / 模式偏好 / 最近聊天
【模式偏好（companion.md）】... (≤600 字)
【长期品味】... (≤800 字)
【最近聊天】...

════════ DJ 串词指南 ════════           ← 串词输出时才出现
• 长度：30-60 字
• 语调：温暖，像电台老主持
• 承接：上一首是《X》— A
• 避免开头复读（最近 3 段）：...
```

为什么这样分？LLM 对 prompt 末尾内容更敏感——必读约束放最前，背景信息放最后。

---

## 2. 用法

每个 LLM 路由都从 `promptBuilder` 拿 helpers，不要重新实现：

```js
const promptBuilder = require('./lib/prompt-builder');

// 第 1 层
const ctx = [promptBuilder.formatLayer1Header() + '\n' + ...];

// 第 2 层
const narrative = promptBuilder.buildListenerNarrative({
  habit, mode, modeKey, curMood, currentSong, currentSongState
});
ctx.push(promptBuilder.buildSceneLayer(narrative));

// 第 3 层
ctx.push(promptBuilder.buildBackgroundLayer({
  readModeMd, userId, modeKey, taste: userCfg.taste,
  recentChat, includeFavs: false, includeTags: false
}));

// DJ 串词指南（写串词时）
ctx.push(promptBuilder.buildDjIntroGuide({
  lengthSpec, mode, currentSong, recentIntros
}));
```

任何 helper 返回 `null` 时跳过 push，避免空块。

---

## 3. helpers 速查

| helper | 何时用 | 返回 |
|---|---|---|
| `truncateAtBoundary(s, maxLen)` | 长文本（taste/modeMd/chat）必须经过它 | 截断后字符串（按句号优先） |
| `normalizeKey(s)` | 艺人名 / 歌名归一化匹配 | 小写 + 去括号 + 去 feat |
| `getKnownArtists(db, userId)` | 识别"探索艺人" | Set |
| `buildListenerNarrative(...)` | 第 2 层文本 | "周五 · 晚上，..." |
| `buildSceneLayer(narrative)` | 包装第 2 层成完整带 header | `════ 2)... ════\n【听众当下】...` |
| `buildBackgroundLayer(...)` | 第 3 层完整文本 | `════ 3)... ════\n...` |
| `buildDjIntroGuide(...)` | 写串词时 | `════ DJ 串词指南 ════\n...` |
| `buildCandidatePoolDisplay(...)` | 候选池模式 | `{ poolBlock, exploreList, uniqueArtists, exploreCount }` |
| `formatLayer1Header()` | 第 1 层开头 | `════════ 1) 选歌依据（必读） ════════` |
| `formatPrevSongLine(currentSong, state)` | 第 1 层"上一首" | `【上一首（承接基线）】《X》— A · 用户完整听完` |

---

## 4. 加新字段的判断流程

新加一个 ctx 字段时按这个顺序问：

1. **它会改变 LLM 的"选什么/写什么"决定吗？** → 第 1 层
2. **它描述听众/系统当下状态吗？** → 第 2 层（融入 narrative，不要单独开块）
3. **它是长期/历史背景，影响"倾向"但不直接决定？** → 第 3 层
4. **是写串词专用的指令？** → DJ 串词指南

如果是长文本（>200 字），必须经 `truncateAtBoundary` 截断。

---

## 5. 截断长度约定

| 字段 | 最大字数 |
|---|---|
| modeMd（mode.md 内容） | 600 |
| taste（taste.md 内容） | 800 |
| recentChat 单条 | 80 |
| recentIntros 单条 | 30 |
| 探索艺人列表 | 6 个 |

需要调整时改 `lib/prompt-builder.js` 一处即可，全局生效。

---

## 6. 现有路由迁移状态

| 路由 | 用途 | 状态 |
|---|---|---|
| `/api/radio/next` | 选下一首 | ✅ 已迁移 |
| `/api/dj/intro` | 让 DJ 介绍当前歌 | ✅ 已迁移 |
| `/api/dj/playlist-intros` | 给一组歌生成串词序列 | ✅ 已迁移 |
| `/api/chat/*` | 用户聊天 | ⏳ 待迁移（次优先级，prompt 性质不同） |
| 后台 taste analyzer | 长期品味画像生成 | ❌ 不适用（独立分析任务，无 ctx） |
| 后台 mode rules 提炼 | mode.md 规律提炼 | ❌ 不适用（独立分析任务） |

### 临时模式（adhocStyle / adhocPatterTone）

`/api/radio/next` 接受两个可选字段覆盖 mode 的硬编码 style/tone：
- `adhocStyle`: 自然语言描述（≤400 字）。例如 `"中文民谣，2010 年代，BPM 70-100，吉他人声为主"`
- `adhocPatterTone`: 自然语言描述（≤400 字）。可选

用途：搜索页"按 BPM/语言/年代/类型筛"功能 —— 客户端把筛选 chips 拼成 adhocStyle 喂给 server，server 不解析、原样塞进 prompt。这样既不用改 RADIO_MODES 硬编码，又能让用户每次创造一个临时筛选维度。

服务端在 `event=enter` 之后用 `effectiveMode = mode + override` 拼装，prompt 里 mode label 加 "（临时筛选）" 后缀让 AI 知道是临时态。

---

## 7. 反模式 / 别这么做

| ❌ 错 | ✅ 对 |
|---|---|
| 直接 push `【现在时间】...` `【当前模式】...` 几个独立块 | 用 `buildListenerNarrative` 拼成一句话进第 2 层 |
| 重新实现 truncate 逻辑 | `truncateAtBoundary` |
| 重新实现 normalizeKey | `promptBuilder.normalizeKey` |
| sysPrompt 里写"严格按【DJ 说话语调】" | 把语调放进 DJ 串词指南，sysPrompt 里只说"按【DJ 串词指南】" |
| 在 pool 模式下还推 🚫 禁列 / localFavs / seedTags | pool 模式下这些已被候选池过滤，不要再 push |
| 在 free 模式下不传禁列 | free 模式没有候选池兜底，必须传 🚫 禁列 + 艺人配额 |

---

## 8. 当框架不够用时

如果新路由的 ctx 跟现有三层都不匹配（比如它是一个分析报告，不是 DJ 任务）——**不要硬套框架**。但要：

1. 在路由顶部注释说明为什么不用框架
2. 评估能否抽出新的 helper（比如 `buildAnalysisCtx`）补充到 `lib/prompt-builder.js`
3. 如果只是这一处特殊，独立实现可以，但不要复制现有 helper 代码

---

## 9. 改框架本身

修改 `lib/prompt-builder.js` 的 helper 时：

1. 改前：所有调用方过一遍，确认行为变化能接受
2. 改后：跑 `node --check server.js` + 至少手测一次 `/api/radio/next` 和 `/api/dj/intro`
3. 同步更新这份文档
4. 提交时 commit 信息要带 `[prompt-framework]` 前缀，方便追溯

---

更新于：随框架版本演进（v1 = Phase 0-3 + P0-P7 完成时）
