'use strict';

const fields = ['apiBase', 'apiKey', 'model', 'targetLang', 'prompt', 'mode'];
const els = {};
fields.forEach((f) => (els[f] = document.getElementById(f)));

chrome.storage.local.get(fields, (localSettings) => {
  chrome.storage.sync.get(fields, (syncSettings) => {
    fields.forEach((f) => {
      const value = localSettings[f] !== undefined ? localSettings[f] : syncSettings[f];
      if (value !== undefined) els[f].value = value;
    });
  });
});

document.getElementById('save').onclick = async () => {
  const obj = {};
  fields.forEach((f) => (obj[f] = els[f].value));
  try {
    await ensureApiPermission(obj.apiBase);
    chrome.storage.local.set(obj, () => {
      chrome.storage.sync.remove(fields);
      msg('已保存 ✓');
    });
  } catch (e) {
    msg('保存失败：' + (e && e.message ? e.message : String(e)));
  }
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
    await ensureApiPermission(settings.apiBase);
    const r = await callLLM(['Hello, world'], { ...settings, targetLang: settings.targetLang || '中文' });
    msg('连接成功 ✓ 示例译文：' + (r[0] || ''));
  } catch (e) {
    msg('测试失败：' + (e && e.message ? e.message : String(e)));
  }
};

function msg(t) {
  document.getElementById('msg').textContent = t;
}

function ensureApiPermission(apiBase) {
  const origin = apiOriginPattern(apiBase);
  return new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins: [origin] }, (hasPermission) => {
      if (hasPermission) {
        resolve();
        return;
      }
      chrome.permissions.request({ origins: [origin] }, (granted) => {
        if (granted) resolve();
        else reject(new Error('未授权访问该接口域名'));
      });
    });
  });
}

function apiOriginPattern(apiBase) {
  let url;
  try {
    url = new URL((apiBase || '').trim());
  } catch (e) {
    throw new Error('接口地址格式不正确');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('接口地址必须以 http:// 或 https:// 开头');
  }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    throw new Error('远程接口必须使用 HTTPS；HTTP 仅允许 localhost/127.0.0.1 本地服务');
  }
  return `${url.protocol}//${url.hostname}/*`;
}

function isLocalHost(hostname) {
  return /^(localhost|127\.0\.0\.1)$/i.test(hostname);
}
