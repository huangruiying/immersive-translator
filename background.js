'use strict';

importScripts('api.js'); // 引入共用逻辑：callLLM / buildMessages / parseTranslations

const DEFAULTS = {
  apiBase: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  targetLang: '中文',
  prompt: '',
  mode: 'bilingual'
};

chrome.runtime.onInstalled.addListener(() => {
  const keys = Object.keys(DEFAULTS);
  chrome.storage.local.get(keys, (localSettings) => {
    chrome.storage.sync.get(keys, (syncSettings) => {
      const toSet = {};
      for (const k of keys) {
        if (localSettings[k] !== undefined) continue;
        toSet[k] = syncSettings[k] !== undefined ? syncSettings[k] : DEFAULTS[k];
      }
      if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
      chrome.storage.sync.remove(keys);
    });
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'it-page', title: '翻译此页', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'it-sel', title: '翻译选中内容', contexts: ['selection'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === 'it-page') sendToTab(tab.id, { type: 'ACTION', action: 'translate' });
  else if (info.menuItemId === 'it-sel') sendToTab(tab.id, { type: 'TRANSLATE_SELECTION', text: info.selectionText });
});

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    if (command === 'translate-page') sendToTab(tabs[0].id, { type: 'ACTION', action: 'translate' });
    else if (command === 'restore-page') sendToTab(tabs[0].id, { type: 'ACTION', action: 'restore' });
  });
});

async function sendToTab(tabId, msg) {
  const ping = () =>
    new Promise((res) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (resp) => {
        res(!!resp && resp.pong && !chrome.runtime.lastError);
      });
    });
  const doSend = (m) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(tabId, m, () => res(!chrome.runtime.lastError));
    });

  let alive = await ping();
  if (!alive) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 120));
      alive = await ping();
    } catch (e) {
      console.error('[immersive] sendToTab inject failed', e);
      return;
    }
  }
  if (alive) await doSend(msg);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'TRANSLATE') {
    // 正文翻译只接收文本；API Key 和端点配置始终由后台从本地存储读取。
    getStoredSettings()
      .then((settings) => callLLM(normalizeTexts(msg.texts), settings))
      .then((translations) => sendResponse({ translations }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true; // 保持通道打开以等待异步响应
  }
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }
});

function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.keys(DEFAULTS), (s) => {
      resolve({ ...DEFAULTS, ...s });
    });
  });
}

function normalizeTexts(texts) {
  if (!Array.isArray(texts)) return [];
  return texts.map((t) => String(t || '').trim()).filter(Boolean);
}
