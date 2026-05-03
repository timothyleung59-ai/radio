// ============================================================
// Aidio FM Prompt 标准框架（v1）
// ============================================================
// 所有需要给 LLM 拼 ctx / system prompt 的路由必须用这里的 helpers。
// 框架定义见 docs/prompt-architecture.md。
//
// 三层结构：
//   ════════ 1) 选歌依据（必读） ════════   ← 跟选歌任务直接相关
//   ════════ 2) 当下场景 ════════           ← 听众当下 narrative
//   ════════ 3) 长期背景（参考） ════════   ← taste / mode.md / chat
//   ════════ DJ 串词指南 ════════           ← 写串词时才出现
//
// 添加新字段时：
//   1. 判断它属于哪一层（影响选择 / 描述当下 / 长期参考）
//   2. 用对应的 builder helper 添加，不要绕过
//   3. 长文本必须经 truncateAtBoundary 截断
// ============================================================

// 按句号 / 换行 / 感叹号优先截断，避免半句话
function truncateAtBoundary(s, maxLen) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= maxLen) return str;
  const head = str.slice(0, maxLen);
  const lastBoundary = Math.max(
    head.lastIndexOf('。'), head.lastIndexOf('.'), head.lastIndexOf('！'),
    head.lastIndexOf('?'), head.lastIndexOf('？'), head.lastIndexOf('\n')
  );
  if (lastBoundary > maxLen * 0.6) return head.slice(0, lastBoundary + 1) + '…';
  return head + '…';
}

// 字符串归一化（用于艺人/歌名匹配）
function normalizeKey(s) {
  return (s || '').toString()
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/feat\.?\s+[^,，;]+/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

// 把合并艺人字符串（"Alan Walker/Coldplay"、"周杰伦 & 林俊杰"、"A,B"）拆成单个艺人。
// 配额检查必须用这个：合作艺人里任何一个超配额都要拒。否则 AI 会用合作版的歌
// 偷渡——比如听众已经听腻了 Coldplay，AI 推一首 "Alan Walker/Coldplay" 就过配额。
function splitArtists(s) {
  if (!s) return [];
  return s.toString()
    .split(/[\/／、,，&]|(?:\s+feat\.?\s+)|(?:\s+ft\.?\s+)/i)
    .map(a => normalizeKey(a))
    .filter(Boolean);
}

// 用户的"已知艺人"集合（高分历史里出现过的）。用来识别"探索艺人"。
function getKnownArtists(db, userId) {
  try {
    const rows = db.prepare(
      `SELECT DISTINCT artist FROM play_history WHERE user_id=? AND COALESCE(score,0) >= 1`
    ).all(userId);
    return new Set(rows.map(r => normalizeKey(r.artist)).filter(Boolean));
  } catch {
    return new Set();
  }
}

// "听众当下" narrative —— 把散落的时间/模式/心情/上一首拼成一句自然语言。
// 关于 currentSong 的描述：只给客观时长，不揣测"喜欢/秒切"等情绪解读，
// 避免 LLM 在串词里说"这首没抓住你"这类容易出错的猜测。
function buildListenerNarrative({ habit, mode, modeKey, curMood, currentSong, currentSongState }) {
  const parts = [];
  if (habit?.weekdayType && habit?.timeBucket) {
    parts.push(`${habit.weekdayType} · ${habit.timeBucket}`);
  }
  if (mode?.label) parts.push(`${mode.label}模式`);
  if (curMood?.mood) {
    parts.push(`心情偏${curMood.mood}${curMood.genre ? `（${curMood.genre}）` : ''}`);
  }
  if (modeKey === 'default' && habit?.sample?.length > 0 && habit?.topArtists?.length > 0) {
    parts.push(`这个时段他常听 ${habit.topArtists.slice(0, 3).join('、')}`);
  }
  if (currentSong) {
    // 客观描述，去掉主观揣测
    const stateText = currentSongState === 'full' ? '刚听完'
      : currentSongState === 'partial' ? '正在听'
      : currentSongState === 'early' ? '刚开始没多久换了'
      : '正在听';
    parts.push(`${stateText}《${currentSong.name}》— ${currentSong.artist}`);
  }
  return parts.length ? (parts.join('，') + '。') : '';
}

// 第 2 层完整文本
function buildSceneLayer(narrative) {
  if (!narrative) return null;
  return `════════ 2) 当下场景 ════════\n【听众当下】${narrative}`;
}

// 第 3 层：长期背景（modeMd / taste / routines / moodrules / chat / 可选 favs/tags）
// 截断长度：modeMd 600 / taste 800 / routines 400 / moodrules 400 / chat 单条 80。
function buildBackgroundLayer({
  readModeMd, userId, modeKey,
  taste, routines, moodrules,
  recentChat, localFavs, seedTags, includeFavs, includeTags
}) {
  const parts = [];
  if (readModeMd) {
    try {
      const modeMd = readModeMd(userId, modeKey);
      if (modeMd?.trim()) parts.push(`【模式偏好（${modeKey}.md）】\n${truncateAtBoundary(modeMd, 600)}`);
    } catch {}
  }
  if (taste) {
    parts.push(`【长期品味】\n${truncateAtBoundary(taste, 800)}`);
  }
  if (routines) {
    parts.push(`【行为习惯】\n${truncateAtBoundary(routines, 400)}`);
  }
  if (moodrules) {
    parts.push(`【情绪规则】\n${truncateAtBoundary(moodrules, 400)}`);
  }
  if (recentChat && recentChat.length) {
    const lines = recentChat.map(c => {
      const who = c.role === 'user' ? '听众' : 'DJ';
      return `${who}: ${truncateAtBoundary(c.content, 80)}`;
    }).join('\n');
    parts.push(`【最近聊天】\n${lines}`);
  }
  if (includeFavs && localFavs?.length) {
    parts.push(`【喜欢歌曲样本】${localFavs.slice(0, 4).map(s => `《${s.song_name}》${s.artist}`).join('; ')}`);
  }
  if (includeTags && seedTags?.length) {
    parts.push(`【种子标签】${seedTags.join('、')}`);
  }
  if (parts.length === 0) return null;
  return `════════ 3) 长期背景（参考） ════════\n${parts.join('\n\n')}`;
}

// DJ 串词指南（只在 lengthSpec 非空时返回）
function buildDjIntroGuide({ lengthSpec, mode, currentSong, recentIntros }) {
  if (!lengthSpec) return null;
  const parts = [
    `长度：${lengthSpec}`,
    mode?.patterTone ? `语调：${mode.patterTone}` : null,
    currentSong ? `承接：上一首是《${currentSong.name}》— ${currentSong.artist}` : null,
    recentIntros && recentIntros.length
      ? `避免开头复读（最近 ${recentIntros.length} 段）：${recentIntros.map(s => '"' + String(s).slice(0, 30).trim() + '..."').join(' / ')}`
      : null
  ].filter(Boolean);
  return `════════ DJ 串词指南 ════════\n${parts.map(p => '• ' + p).join('\n')}`;
}

// 候选池显示（候选池模式专用，每首加 source + ⭐ 标记）
function buildCandidatePoolDisplay({ candidatePool, knownArtists }) {
  const isExplore = (artist) => !knownArtists.has(normalizeKey(artist));
  const sourceTag = (src) => {
    if (src === 'simi') return '相似';
    if (src === 'favorites') return '收藏';
    return '历史';
  };
  const numbered = candidatePool.map((s, i) => {
    const tag = sourceTag(s.source);
    const star = isExplore(s.artist) ? ' ⭐' : '';
    return `${i + 1}. 《${s.name}》— ${s.artist} [${tag}${star}]`;
  }).join('\n');
  const poolArtists = new Set(candidatePool.map(s => normalizeKey(s.artist)));
  const exploreList = Array.from(new Set(
    candidatePool.filter(s => isExplore(s.artist)).map(s => s.artist)
  ));
  return {
    poolBlock: `【候选池 ${candidatePool.length} 首 · ${poolArtists.size} 个艺人 · ${exploreList.length} 个探索艺人 ⭐】
（服务端已过滤听过的+超配额艺人，请从这里选 1 首）
${numbered}`,
    exploreList,
    uniqueArtists: poolArtists.size,
    exploreCount: exploreList.length
  };
}

// 第 1 层 header（每条路由自己拼内容，但格式统一）
function formatLayer1Header() {
  return '════════ 1) 选歌依据（必读） ════════';
}

// "上一首" 描述。注意：调用方决定是否传 currentSong——跨模式切换或概率化场景下应传 null。
// 这里只给客观信号（播了多久），不做"喜欢/没抓住听众"等情绪解读。
function formatPrevSongLine(currentSong, currentSongState) {
  if (!currentSong) return null;
  const stateLabel = currentSongState === 'full' ? '已播完'
    : currentSongState === 'partial' ? '已播一段'
    : currentSongState === 'early' ? '只播了开头'
    : '';
  const suffix = stateLabel ? ` · ${stateLabel}` : '';
  return `【上一首】《${currentSong.name}》— ${currentSong.artist}${suffix}`;
}

// 决定本次是否要传 currentSong 给 LLM 做承接。
// 三个 NO 信号：
//   1. 跨模式切换（prevMode != currentMode）—— 上首歌跟当前 mode 风格不符，承接尴尬
//   2. 用户秒切（state=early）—— 别死缠这首没听完的歌，让 AI 重新开局
//   3. 概率掷骰（默认 60% 承接 / 40% 独立开场）—— 避免每首都"刚听完...让我们..."模板化
function shouldCarryPrevSong({ currentSong, prevMode, currentMode, currentSongState, queuePosition, carryProbability = 0.6 }) {
  if (!currentSong) return false;
  // queue 里非首位歌还是要承接（队列内的连续性是结构性的）
  if (queuePosition > 0) return true;
  // 跨模式：上首歌的 mode 跟现在不一样 → 不承接
  if (prevMode && currentMode && prevMode !== currentMode) return false;
  // 用户秒切：别死缠
  if (currentSongState === 'early') return false;
  // 概率化：让 AI 偶尔独立开场，避免模板化
  return Math.random() < carryProbability;
}

module.exports = {
  truncateAtBoundary,
  normalizeKey,
  splitArtists,
  getKnownArtists,
  buildListenerNarrative,
  buildSceneLayer,
  buildBackgroundLayer,
  buildDjIntroGuide,
  buildCandidatePoolDisplay,
  formatLayer1Header,
  formatPrevSongLine,
  shouldCarryPrevSong,
};
