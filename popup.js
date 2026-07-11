'use strict';

const statusEl = document.getElementById('status');
const translateBtn = document.getElementById('translate');
const restoreBtn = document.getElementById('restore');
const optionsLink = document.getElementById('options');

function activeTab() {
  return new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => res(t[0])));
}

async function sendAction(action) {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) {
    statusEl.textContent = '该页面不支持翻译';
    return;
  }

  const ping = () =>
    new Promise((res) => {
      chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (resp) => {
        res(!!resp && resp.pong && !chrome.runtime.lastError);
      });
    });

  const doSend = (msg) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(tab.id, msg, () => res(!chrome.runtime.lastError));
    });

  let alive = await ping();
  if (!alive) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 120));
      alive = await ping();
    } catch (e) {
      statusEl.textContent = '注入失败：' + (e && e.message ? e.message : '无法执行脚本');
      return;
    }
  }

  if (!alive) {
    statusEl.textContent = '注入失败，请刷新页面';
    return;
  }

  const ok = await doSend({ type: 'ACTION', action });
  statusEl.textContent = ok
    ? action === 'translate'
      ? '翻译已启动…'
      : '已还原'
    : '注入失败：' + (chrome.runtime.lastError && chrome.runtime.lastError.message ? chrome.runtime.lastError.message : '消息发送失败');
}

translateBtn.onclick = () => { statusEl.textContent = '翻译中…'; sendAction('translate'); };
restoreBtn.onclick = () => { sendAction('restore'); };
optionsLink.onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

chrome.storage.sync.get(['apiKey'], (s) => {
  if (!s.apiKey) statusEl.textContent = '未配置 API Key，请先打开设置';
});
