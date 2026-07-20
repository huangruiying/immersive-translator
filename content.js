(function () {
  'use strict';

  // 防止 content.js 被重复注入后多次执行（MV3 中 executeScript 可能重复注入）
  if (window.__immersiveTranslateLoaded) return;
  window.__immersiveTranslateLoaded = true;

  const TRANS_CLASS = 'immersive-translator__translation';
  const BUBBLE_ID = 'immersive-translator__bubble';
  const STYLE_ID = 'immersive-translator__styles';

  function getRenderSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['mode'], (s) => resolve({ mode: s.mode || 'bilingual' }));
    });
  }

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE',
    'PRE', 'SVG', 'TEMPLATE', 'SELECT', 'OPTION', 'IFRAME', 'BUTTON'
  ]);

  let isTranslating = false;
  let hasPromptedOptions = false;

  function isSkippable(el) {
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.closest && el.closest('.' + TRANS_CLASS)) return true;
    if (document.designMode === 'on') return true;
    if (el.closest && el.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]')) return true;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
    } catch (e) {}
    return false;
  }

  function isAlreadyTranslated(node) {
    const ns = node.nextSibling;
    return !!(ns && ns.nodeType === 1 && ns.classList && ns.classList.contains(TRANS_CLASS));
  }

  function collectTextNodes() {
    const nodes = [];
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isAlreadyTranslated(node)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (isSkippable(parent)) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue;
        if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
        const trimmed = text.trim();
        if (trimmed.length > 3000) return NodeFilter.FILTER_REJECT;
        if (!/[A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed)) return NodeFilter.FILTER_REJECT;
        if (/^https?:\/\/\S+$/i.test(trimmed) || /^[\w.]+@[\w.]+\.\w+$/.test(trimmed)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function renderTranslation(textNode, translation, mode) {
    const parent = textNode.parentElement;
    if (!parent) return;
    let block = false;
    try {
      const display = getComputedStyle(parent).display;
      block = display === 'block' || display === 'flex' || display === 'grid';
    } catch (e) {}
    if (!block) {
      block = ['P', 'LI', 'DIV', 'TD', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'UL', 'OL'].includes(parent.tagName);
    }
    const wrap = document.createElement(block ? 'div' : 'span');
    wrap.className = TRANS_CLASS;
    wrap.textContent = translation;
    if (mode === 'translation') {
      wrap.dataset.orig = textNode.nodeValue;
      textNode.nodeValue = '';
    }
    parent.insertBefore(wrap, textNode.nextSibling);
  }

  // 后台 service worker 可能处于挂起状态，首次发消息会失败；这里自动重试一次
  function sendTranslate(texts) {
    return new Promise((resolve) => {
      let attempt = 2;
      const go = () => {
        chrome.runtime.sendMessage({ type: 'TRANSLATE', texts }, (resp) => {
          if (chrome.runtime.lastError && attempt > 0) {
            attempt--;
            setTimeout(go, 350);
            return;
          }
          resolve(resp || { error: chrome.runtime.lastError && chrome.runtime.lastError.message });
        });
      };
      go();
    });
  }

  async function translatePage() {
    if (isTranslating) return;
    isTranslating = true;
    try {
      const settings = await getRenderSettings();
      const nodes = collectTextNodes();
      if (!nodes.length) return;
      const texts = nodes.map((n) => n.nodeValue.trim());
      const BATCH = 12;
      const MAX_CONCURRENT = 2;
      const batches = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        batches.push({
          nodes: nodes.slice(i, i + BATCH),
          texts: texts.slice(i, i + BATCH)
        });
      }
      let next = 0;
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          const resp = await sendTranslate(batch.texts);
          if (resp && resp.translations) {
            batch.nodes.forEach((node, k) => {
              const t = resp.translations[k];
              if (t) renderTranslation(node, t, settings.mode);
            });
          } else if (resp && resp.error) {
            handleTranslateError(resp.error);
          }
        }
      };
      const workerCount = Math.min(MAX_CONCURRENT, batches.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
    } finally {
      isTranslating = false;
    }
  }

  function restorePage() {
    document.querySelectorAll('.' + TRANS_CLASS).forEach((el) => {
      if (el.dataset && el.dataset.orig !== undefined) {
        const prev = el.previousSibling;
        if (prev && prev.nodeType === 3) prev.nodeValue = el.dataset.orig;
      }
      el.remove();
    });
    const bubble = document.getElementById(BUBBLE_ID);
    if (bubble) bubble.style.display = 'none';
  }

  async function translateSelection(text) {
    if (!text || !text.trim()) return;
    const resp = await sendTranslate([text.trim()]);
    const trans = resp && resp.translations && resp.translations[0];
    if (trans) showBubble(text.trim(), trans);
    else if (resp && resp.error) handleTranslateError(resp.error);
  }

  function handleTranslateError(error) {
    console.error('[immersive] translate error:', error);
    if (!hasPromptedOptions && /API Key|接口地址|授权|permission|HTTPS/i.test(String(error))) {
      hasPromptedOptions = true;
      if (confirm('翻译服务尚未配置完成，是否打开设置？')) chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    }
  }

  function showBubble(orig, trans) {
    let b = document.getElementById(BUBBLE_ID);
    if (!b) {
      b = document.createElement('div');
      b.id = BUBBLE_ID;
      const origEl = document.createElement('div');
      const transEl = document.createElement('div');
      const closeEl = document.createElement('button');
      origEl.className = 'immersive-translator__bubble-orig';
      transEl.className = 'immersive-translator__bubble-trans';
      closeEl.className = 'immersive-translator__bubble-close';
      closeEl.type = 'button';
      closeEl.textContent = '×';
      b.append(origEl, transEl, closeEl);
      document.body.appendChild(b);
      closeEl.addEventListener('click', () => { b.style.display = 'none'; });
    }
    b.querySelector('.immersive-translator__bubble-orig').textContent = orig;
    b.querySelector('.immersive-translator__bubble-trans').textContent = trans;
    b.style.display = 'block';
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      b.style.top = window.scrollY + r.bottom + 8 + 'px';
      b.style.left = window.scrollX + r.left + 'px';
    } else {
      b.style.top = '20px';
      b.style.left = '20px';
    }
  }

  (function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .${TRANS_CLASS} {
        color: #6b7280;
        font-size: 0.85em;
        line-height: 1.5;
        opacity: 0.95;
        margin-top: 2px;
        border-left: 2px solid #93c5fd;
        padding-left: 6px;
        word-break: break-word;
      }
      #${BUBBLE_ID} {
        position: absolute;
        z-index: 2147483647;
        max-width: 360px;
        background: #fff;
        color: #111;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.18);
        padding: 10px 12px;
        font-size: 14px;
        line-height: 1.5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #${BUBBLE_ID} .immersive-translator__bubble-orig { color:#9ca3af; font-size:12px; margin-bottom:4px; }
      #${BUBBLE_ID} .immersive-translator__bubble-trans { color:#111; white-space: pre-wrap; }
      #${BUBBLE_ID} .immersive-translator__bubble-close {
        position:absolute;
        top:2px;
        right:8px;
        border:0;
        background:transparent;
        cursor:pointer;
        color:#9ca3af;
        font-size:16px;
        line-height:1;
      }
    `;
    document.documentElement.appendChild(s);
  })();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ACTION') {
      // 立即回应，保持消息通道打开，避免发送方收到 "port closed" 错误
      sendResponse({ ok: true });
      if (msg.action === 'translate') translatePage();
      else if (msg.action === 'restore') restorePage();
      return true;
    } else if (msg.type === 'TRANSLATE_SELECTION') {
      sendResponse({ ok: true });
      translateSelection(msg.text);
      return true;
    } else if (msg.type === 'PING') {
      sendResponse({ pong: true });
      return true;
    }
  });

  window.__immersiveTranslate = { translatePage, restorePage, translateSelection };
})();
