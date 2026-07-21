'use strict';

// 前后台共用的纯逻辑：不依赖任何 chrome.* API，仅用 fetch。
// 既能被 background service worker 通过 importScripts 引入，
// 也能被设置页通过 <script> 引入，直接调用。

function buildMessages(texts, settings) {
  const lang = settings.targetLang || '中文';
  const indexed = texts.map((t, i) => `[${i}] ${t}`).join('\n\n');
  const sys =
    `You are a precise translator. Translate the user's input into ${lang}. ` +
    `The input consists of multiple segments, each prefixed with an index marker like [0], [1], [2]... ` +
    `Translate each segment and output ONLY the translations, preserving the exact [index] marker at the start of each, in the same order. ` +
    `Separate segments with a blank line. Do NOT add explanations, headings, or markdown code fences. ` +
    `Keep the original meaning and tone; preserve numbers, names, and formatting placeholders.`;
  const user =
    settings.prompt && settings.prompt.includes('{text}')
      ? settings.prompt.replace(/\{lang\}/g, lang).replace(/\{text\}/g, indexed)
      : indexed;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ];
}

function parseTranslations(content, n) {
  const out = new Array(n).fill('');
  if (!content) return out;
  const re = /\[\s*(\d+)\s*\]\s*([\s\S]*?)(?=(?:\s*\[\s*\d+\s*\])|$)/g;
  let m;
  let count = 0;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const idx = parseInt(m[1], 10);
    if (idx >= 0 && idx < n) { out[idx] = m[2].trim(); count++; }
  }
  if (count >= Math.ceil(n / 2)) return out;
  // 兜底：按行拆分，去掉行首的 [i] 标记
  const lines = content.split('\n').map((l) => l.replace(/^\s*\[\s*\d+\s*\]\s*/, '').trim()).filter(Boolean);
  for (let i = 0; i < Math.min(n, lines.length); i++) out[i] = lines[i];
  return out;
}

async function callLLM(texts, settings) {
  const base = (settings.apiBase || '').replace(/\/+$/, '');
  if (!base) throw new Error('接口地址为空，请填写 Base URL');
  if (!settings.apiKey) throw new Error('API Key 为空，请填写后重试');
  let parsedBase;
  try {
    parsedBase = new URL(base);
  } catch (e) {
    throw new Error('接口地址格式不正确，请填写完整的 Base URL');
  }
  if (parsedBase.protocol === 'http:' && !isLocalHost(parsedBase.hostname)) {
    throw new Error('出于上架安全要求，远程接口必须使用 HTTPS；HTTP 仅允许 localhost/127.0.0.1 本地服务');
  }
  const url = base + (/\/chat\/completions$/i.test(base) ? '' : '/chat/completions');
  const messages = buildMessages(texts, settings);
  const body = {
    model: settings.model || 'gpt-4o-mini',
    messages,
    temperature: 0.3,
    stream: false
  };
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.apiKey
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    const hint = (e && e.message && /Failed to fetch/i.test(e.message))
      ? '（多为接口地址不可达、协议非 https、或该服务未开放 CORS；本地 Ollama 请确认已监听 11434 且允许跨域）'
      : '';
    throw new Error('网络请求失败：' + (e && e.message ? e.message : String(e)) + hint);
  }
  if (!resp.ok) {
    let t = '';
    try { t = await resp.text(); } catch (_) {}
    if (resp.status === 401) throw new Error('API 返回 401：API Key 无效或缺失');
    if (resp.status === 404) throw new Error('API 返回 404：接口地址不正确，请确认以 /v1/chat/completions 结尾');
    if (resp.status === 429) throw new Error('API 返回 429：请求过于频繁或额度不足');
    throw new Error('API 返回 ' + resp.status + '：' + t.slice(0, 300));
  }
  const data = await resp.json().catch(() => ({}));
  const content =
    (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!content) throw new Error('API 未返回译文（请检查模型名是否正确、返回结构是否符合 OpenAI 格式）');
  return parseTranslations(content, texts.length);
}

function isLocalHost(hostname) {
  return /^(localhost|127\.0\.0\.1)$/i.test(hostname);
}
