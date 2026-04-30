// tts-bigtts.js — 火山引擎豆包语音合成大模型 双向流式 (V3 WebSocket)
// 文档: https://www.volcengine.com/docs/6561/1329505
//
// 鉴权两种方式（自动选择）：
//   新版控制台：X-Api-Key + X-Api-Resource-Id
//   旧版控制台：X-Api-App-Id + X-Api-Access-Key + X-Api-Resource-Id
//
// X-Api-Resource-Id 取值：
//   seed-tts-2.0 / seed-tts-1.0 / seed-tts-1.0-concurr
//   seed-icl-2.0 / seed-icl-1.0 / seed-icl-1.0-concurr  (声音复刻)
const WebSocket = require('ws');
const zlib = require('zlib');
const crypto = require('crypto');

// 事件码（参见文档 §2.3）
const EV = {
  START_CONNECTION:    1,
  FINISH_CONNECTION:   2,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED:  51,
  CONNECTION_FINISHED:52,
  START_SESSION:     100,
  CANCEL_SESSION:    101,
  FINISH_SESSION:    102,
  SESSION_STARTED:   150,
  SESSION_CANCELED:  151,
  SESSION_FINISHED:  152,
  SESSION_FAILED:    153,
  TASK_REQUEST:      200,
  TTS_SENTENCE_START:350,
  TTS_SENTENCE_END:  351,
  TTS_RESPONSE:      352,
};

// 二进制协议（参见文档 §2.1 "WebSocket 二进制协议"）
// byte0: high nibble = version(0b0001), low nibble = header size(0b0001 = 4字节)
// byte1: high nibble = message type, low nibble = flags
//   msg_type 0b0001 = full-client request
//   msg_type 0b1001 = full-server response
//   msg_type 0b1011 = audio-only response
//   msg_type 0b1111 = error info
//   flags  0b0100   = 携带 event 字段（仅此一种 flag；session_id/connect_id 的存在由 event code 决定，不影响 flags）
// byte2: high nibble = serialization (0b0000 raw / 0b0001 JSON)
//        low  nibble = compression (0b0000 none / 0b0001 gzip)
// byte3: reserved (0)
const HEADER_VERSION_HEADERSIZE = 0x11;
const FLAG_WITH_EVENT           = 0x14; // full-client request + event present (适用于所有上行帧)
const SERIALIZATION_JSON_RAW    = 0x10; // JSON, no compression
const RESERVED                  = 0x00;

function buildFrame(eventCode, payloadObj, sessionId = null) {
  const json = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
  const payload = Buffer.from(json, 'utf8');
  const hasSession = !!sessionId;

  const header = Buffer.alloc(4);
  header[0] = HEADER_VERSION_HEADERSIZE;
  header[1] = FLAG_WITH_EVENT; // 文档：所有 full-client request 都用 0x14；session_id 是否携带不影响 flags
  header[2] = SERIALIZATION_JSON_RAW;
  header[3] = RESERVED;

  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(eventCode, 0);

  const parts = [header, eventBuf];

  if (hasSession) {
    const sidBuf = Buffer.from(sessionId, 'utf8');
    const sidLen = Buffer.alloc(4);
    sidLen.writeUInt32BE(sidBuf.length, 0);
    parts.push(sidLen, sidBuf);
  }

  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(payload.length, 0);
  parts.push(payloadLen, payload);

  return Buffer.concat(parts);
}

// 是否为会话/连接类事件（携带 session_id 或 connection_id 前缀）
function eventCarriesId(code) {
  // 连接类：1/2/50/51/52
  if (code === 1 || code === 2 || (code >= 50 && code <= 52)) return true;
  // 会话类：100-102/150-153/200/350-352
  if (code >= 100 && code <= 102) return true;
  if (code >= 150 && code <= 153) return true;
  if (code === 200 || (code >= 350 && code <= 352)) return true;
  return false;
}

function parseFrame(buf) {
  if (buf.length < 8) return { eventCode: -1, raw: Buffer.alloc(0) };
  const msgType = (buf[1] >> 4) & 0x0F;
  const flags = buf[1] & 0x0F;
  const compression = buf[2] & 0x0F;
  const eventCode = buf.readInt32BE(4);
  let cursor = 8;

  // 错误帧（msg_type=0b1111）：错误码(4) + payload
  if (msgType === 0x0F) {
    if (cursor + 4 > buf.length) return { eventCode, msgType, flags, raw: Buffer.alloc(0) };
    cursor += 4;
  } else if (eventCarriesId(eventCode)) {
    // 会话/连接类事件：长度前缀 + ID
    if (cursor + 4 > buf.length) return { eventCode, msgType, flags, raw: Buffer.alloc(0) };
    const idLen = buf.readUInt32BE(cursor);
    cursor += 4 + idLen;
  }

  if (cursor + 4 > buf.length) return { eventCode, msgType, flags, raw: Buffer.alloc(0) };
  const payloadSize = buf.readUInt32BE(cursor);
  cursor += 4;
  let payload = buf.slice(cursor, cursor + payloadSize);
  if (compression === 1) {
    try { payload = zlib.gunzipSync(payload); } catch {}
  }
  return { eventCode, msgType, flags, raw: payload };
}

function ttsBigtts(opts) {
  const {
    text,
    // 新版控制台
    apiKey,
    // 旧版控制台
    appid,
    accessToken,
    // 必填
    resourceId = 'seed-tts-2.0',
    voiceType,
    // 可选
    model,                 // 如 'seed-tts-1.1' / 'seed-tts-2.0-expressive' / 'seed-tts-2.0-standard'
    sampleRate = 24000,
    format = 'mp3',
    speed = 0,             // 文档：speech_rate 取值 [-50,100]，0 = 正常
    volume = 0,            // 文档：loudness_rate 取值 [-50,100]，0 = 正常
    emotion,               // 可选，如 'angry'
    emotionScale,          // 1~5
    additions,             // 自定义 additions 对象
    timeoutMs = 30000,
    debug = false,
  } = opts;

  if (!apiKey && !(appid && accessToken)) {
    return Promise.reject(new Error('鉴权未配置：需要 apiKey 或 (appid + accessToken)'));
  }
  if (!voiceType) {
    return Promise.reject(new Error('voiceType 不能为空'));
  }

  return new Promise((resolve, reject) => {
    const connectId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const url = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

    const headers = {
      'X-Api-Resource-Id': resourceId,
      'X-Api-Connect-Id': connectId,
    };
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    } else {
      headers['X-Api-App-Id'] = appid;
      headers['X-Api-Access-Key'] = accessToken;
    }

    const ws = new WebSocket(url, { headers, handshakeTimeout: 10000 });

    const audioChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error('TTS WebSocket 超时'));
    }, timeoutMs);

    function done(err, buf) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve({
        contentType: format === 'mp3' ? 'audio/mpeg'
                   : format === 'wav' ? 'audio/wav'
                   : format === 'ogg_opus' ? 'audio/ogg'
                   : 'application/octet-stream',
        buffer: buf,
      });
    }

    function sendFrame(label, eventCode, payloadObj, sid) {
      const frame = buildFrame(eventCode, payloadObj, sid);
      if (debug) {
        const json = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
        console.log(`[bigtts→] ${label} event=${eventCode} len=${frame.length} payload=${json.slice(0,300)}`);
      }
      ws.send(frame);
    }

    ws.on('open', () => {
      if (debug) console.log('[bigtts] WS 已连接，发 START_CONNECTION');
      sendFrame('StartConnection', EV.START_CONNECTION, {});
    });

    ws.on('message', (data) => {
      try {
        const { eventCode, msgType, raw } = parseFrame(data);
        if (debug) {
          const hex = data.slice(0, 32).toString('hex');
          console.log(`[bigtts] len=${data.length} hdr=${hex} event=${eventCode} msgType=${msgType} payload=${raw.toString('utf8').slice(0, 200)}`);
        }

        if (eventCode === EV.CONNECTION_STARTED) {
          // StartSession：设置 speaker / audio_params（不带 text）
          const audio_params = { format, sample_rate: sampleRate };
          if (typeof speed === 'number'  && speed  !== 0) audio_params.speech_rate   = speed;
          if (typeof volume === 'number' && volume !== 0) audio_params.loudness_rate = volume;
          if (emotion)      audio_params.emotion = emotion;
          if (emotionScale) audio_params.emotion_scale = emotionScale;

          const req_params = {
            speaker: voiceType,
            audio_params,
          };
          if (model) req_params.model = model;
          if (additions && typeof additions === 'object') req_params.additions = additions;

          sendFrame('StartSession', EV.START_SESSION, {
            event: EV.START_SESSION,
            namespace: 'BidirectionalTTS',
            user: { uid: 'claudio_fm_user' },
            req_params,
          }, sessionId);
        } else if (eventCode === EV.SESSION_STARTED) {
          // TaskRequest：text 同时放在 req_params 和顶层（兼容服务端多种解析）
          sendFrame('TaskRequest', EV.TASK_REQUEST, {
            event: EV.TASK_REQUEST,
            namespace: 'BidirectionalTTS',
            text,
            req_params: { text },
          }, sessionId);
          sendFrame('FinishSession', EV.FINISH_SESSION, {}, sessionId);
        } else if (eventCode === EV.TTS_RESPONSE) {
          // 音频帧（msg_type=0b1011 audio-only response）
          if (raw && raw.length > 0) audioChunks.push(raw);
        } else if (eventCode === EV.TTS_SENTENCE_START || eventCode === EV.TTS_SENTENCE_END) {
          // 句首/句尾事件，目前仅日志
        } else if (eventCode === EV.SESSION_FINISHED) {
          // session 结束，关连接
          sendFrame('FinishConnection', EV.FINISH_CONNECTION, {});
        } else if (eventCode === EV.SESSION_FAILED || eventCode === EV.CONNECTION_FAILED) {
          done(new Error(`Volcano TTS 事件 ${eventCode}: ${raw?.toString('utf8')?.slice(0, 500) || ''}`));
        } else if (eventCode === EV.CONNECTION_FINISHED) {
          if (audioChunks.length > 0) done(null, Buffer.concat(audioChunks));
          else done(new Error('TTS 完成但没收到音频'));
        } else if (msgType === 0x0F) {
          // 错误帧
          done(new Error(`Volcano TTS 错误帧: ${raw?.toString('utf8')?.slice(0, 500) || ''}`));
        }
      } catch (e) {
        if (debug) console.warn('[bigtts] parseFrame 异常:', e.message);
      }
    });

    ws.on('close', (code, reason) => {
      if (settled) return;
      if (audioChunks.length > 0) {
        done(null, Buffer.concat(audioChunks));
      } else {
        done(new Error(`WebSocket 断开（code=${code}，reason=${reason?.toString() || '无'}）`));
      }
    });

    ws.on('error', (err) => done(err));
  });
}

module.exports = { ttsBigtts };
