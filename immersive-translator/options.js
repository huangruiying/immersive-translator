'use strict';

const fields = ['apiBase', 'apiKey', 'model', 'targetLang', 'prompt', 'mode'];
const els = {};
fields.forEach((f) => (els[f] = document.getElementById(f)));

chrome.storage.sync.get(fields, (s) => {
  fields.forEach((f) => {
    if (s[f] !== undefined) els[f].value = s[f];
  });
});

document.getElementById('save').onclick = () => {
  const obj = {};
  fields.forEach((f) => (obj[f] = els[f].value));
  chrome.storage.sync.set(obj, () => msg('已保存 ✓'));
};

document.getElementById('test').onclick = async () => {
  const settings = {};
  fields.forEach((f) => (settings[f] = els[f].value));
  if (!settings.apiBase || !settings.apiKey) {
    msg('请先填写「接口地址」和「API Key」');
    return;
  }
  msg('测试中…');
  try {
    const r = await callLLM(['Hello, world'], { ...settings, targetLang: settings.targetLang || '中文' });
    msg('连接成功 ✓ 示例译文：' + (r[0] || ''));
  } catch (e) {
    msg('测试失败：' + (e && e.message ? e.message : String(e)));
  }
};

function msg(t) {
  document.getElementById('msg').textContent = t;
}
