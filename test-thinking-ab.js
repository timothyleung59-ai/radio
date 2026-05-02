#!/usr/bin/env node
// A/B 测试：deepseek-v4-flash 关 thinking vs 开 thinking
// 拿 5 首歌，对每首歌让 DJ 写一段 medium 串词，对比响应内容 + 耗时 + 是否带 thinking block。
// 在远端 ~/claudio/ 下运行：node test-thinking-ab.js

const Anthropic = require('@anthropic-ai/sdk').default;
require('dotenv').config();

const SONGS = [
  { name: 'Just the Way You Are', artist: 'Bruno Mars', album: '' },
  { name: '沙滩',                  artist: '陶喆',       album: '' },
  { name: 'City of Stars',         artist: 'Ryan Gosling', album: 'La La Land' },
  { name: '夜空中最亮的星',        artist: '逃跑计划',   album: '' },
  { name: 'Lost in Yesterday',     artist: 'Tame Impala', album: 'The Slow Rush' },
];

const SYS_PROMPT = `你是 Claudio FM 的 AI 电台 DJ。听众点了"让 DJ 介绍这首"，请你用一段串场词介绍当前正在播放的这首歌。

【输出要求 - 至关重要】
直接输出最终 JSON。不要任何思考过程、推理、自言自语。第一个字符必须是 "{"。

【硬规则】
- 严格输出 JSON：{"intro":"..."}，不要任何解释/markdown 包裹
- 串场词 30-80 字，电台话筒前真说话
- 像电台主持人在话筒前真说话，不是写稿
- 可以聊歌手背景、歌曲故事、风格特征、当下听感
- 不要出现"现在为您播放""敬请收听"这种生硬主持腔`;

function buildUserPrompt(song) {
  return [
    `【当前模式】默认电台`,
    `【DJ 说话语调】中文，像深夜电台主持，慵懒不油腻`,
    `【现在时间】休息日 · 上午`,
    `【这首歌】《${song.name}》— ${song.artist}${song.album ? ` · ${song.album}` : ''}`,
  ].join('\n\n');
}

async function callOnce(anthropic, model, song, withThinking) {
  const params = {
    model,
    max_tokens: 1024,
    system: SYS_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(song) }],
  };
  if (!withThinking) {
    params.thinking = { type: 'disabled' };
  }
  const t0 = Date.now();
  let resp;
  try {
    resp = await anthropic.messages.create(params);
  } catch (e) {
    return { error: e.message, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const blocks = resp.content || [];
  const types = blocks.map(b => b.type).join(',') || '<empty>';
  const thinkingBlock = blocks.find(b => b.type === 'thinking');
  const thinkingLen = thinkingBlock ? (thinkingBlock.thinking || '').length : 0;

  // 抽 JSON
  let text = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
  if (!text) {
    const parts = [];
    for (const b of blocks) {
      if (typeof b.text === 'string') parts.push(b.text);
      if (typeof b.thinking === 'string') parts.push(b.thinking);
    }
    text = parts.join('\n').trim();
  }
  let intro = '';
  try {
    intro = JSON.parse(text)?.intro || '';
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { intro = JSON.parse(m[0])?.intro || ''; } catch {}
    }
  }

  return { ms, types, thinkingLen, intro: intro.trim(), rawLen: text.length };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  const model = process.env.ANTHROPIC_MODEL;
  if (!apiKey || !model) {
    console.error('缺 ANTHROPIC_API_KEY / ANTHROPIC_MODEL'); process.exit(1);
  }
  const anthropic = new Anthropic({ apiKey, baseURL });
  console.log(`Model: ${model}`);
  console.log(`BaseURL: ${baseURL || '<default>'}`);
  console.log('='.repeat(80));

  for (const song of SONGS) {
    console.log(`\n♪ 《${song.name}》— ${song.artist}\n`);

    // 关 thinking
    const off = await callOnce(anthropic, model, song, false);
    console.log(`  [thinking=DISABLED]  ${off.ms}ms  blocks=${off.types}  thinking_len=${off.thinkingLen}`);
    console.log(`    intro: ${off.intro || '(空)'}`);
    if (off.error) console.log(`    error: ${off.error}`);

    // 开 thinking（对照组）
    const on = await callOnce(anthropic, model, song, true);
    console.log(`  [thinking=ENABLED]   ${on.ms}ms  blocks=${on.types}  thinking_len=${on.thinkingLen}`);
    console.log(`    intro: ${on.intro || '(空)'}`);
    if (on.error) console.log(`    error: ${on.error}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('完成');
}

main().catch(e => { console.error(e); process.exit(1); });
