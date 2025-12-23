/**
 * VocabMeld 后台脚本
 * 处理扩展级别的事件和消息
 */

// ============ Offscreen Document Management ============
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = 'offscreen.html';

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(offscreenUrl)]
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Avoid creating multiple offscreen documents simultaneously
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play TTS audio from Edge TTS API'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

// ============ Edge TTS Functions ============

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Speak text using Edge TTS API
 */
async function speakWithEdgeTts(text, endpoint, apiKey, voice, speed) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice || 'en-US-AriaNeural',
        speed: speed || 1.0
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge TTS API error: ${response.status} - ${errorText}`);
    }

    // Get audio as blob
    const audioBlob = await response.blob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);

    // Ensure offscreen document exists and send audio to it
    await ensureOffscreenDocument();

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'playAudio',
        audioData: base64Data,
        mimeType: audioBlob.type || 'audio/mpeg'
      }, (response) => {
        resolve(response || { success: true });
      });
    });
  } catch (error) {
    console.error('[VocabMeld] Edge TTS error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Speak using system TTS as fallback
 */
function speakWithSystemTts(text, lang, rate, voiceName) {
  return new Promise((resolve) => {
    chrome.tts.stop();

    const options = {
      lang: lang,
      rate: rate || 1.0,
      pitch: 1.0
    };

    if (voiceName) {
      options.voiceName = voiceName;
    }

    chrome.tts.speak(text, options, () => {
      if (chrome.runtime.lastError) {
        console.error('[VocabMeld] TTS Error:', chrome.runtime.lastError.message);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}

/**
 * Test Edge TTS connection
 */
async function testEdgeTtsConnection(endpoint, apiKey, voice) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'tts-1',
        input: 'Test',
        voice: voice || 'en-US-AriaNeural',
        speed: 1.0
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Check if response is audio
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('audio')) {
      return { success: true, message: '连接成功！' };
    }

    throw new Error('Invalid response type');
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 安装/更新时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[VocabMeld] Extension installed/updated:', details.reason);
  
  // 设置默认配置
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      apiEndpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: '',
      modelName: 'deepseek-chat',
      nativeLanguage: 'zh-CN',
      targetLanguage: 'en',
      difficultyLevel: 'B1',
      intensity: 'medium',
      autoProcess: true,
      showPhonetic: true,
      translationStyle: 'translation-original',
      enabled: true,
      siteMode: 'all',
      excludedSites: [],
      allowedSites: [],
      learnedWords: [],
      memorizeList: [],
      totalWords: 0,
      todayWords: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      cacheHits: 0,
      cacheMisses: 0
    });
  }
  
  // 创建右键菜单
  createContextMenus();
});

// 创建右键菜单
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'vocabmeld-add-memorize',
      title: '添加到需记忆列表',
      contexts: ['selection']
    });
    
    chrome.contextMenus.create({
      id: 'vocabmeld-process-page',
      title: '处理当前页面',
      contexts: ['page']
    });
  });
}

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'vocabmeld-add-memorize' && info.selectionText) {
    const word = info.selectionText.trim();
    if (word && word.length < 50) {
      chrome.storage.sync.get('memorizeList', (result) => {
        const list = result.memorizeList || [];
        if (!list.some(w => w.word === word)) {
          list.push({ word, addedAt: Date.now() });
          chrome.storage.sync.set({ memorizeList: list }, () => {
            // 通知 content script 处理特定单词
            chrome.tabs.sendMessage(tab.id, { 
              action: 'processSpecificWords', 
              words: [word] 
            }).catch(err => {
              console.log('[VocabMeld] Content script not ready, word will be processed on next page load');
            });
          });
        }
      });
    }
  }
  
  if (info.menuItemId === 'vocabmeld-process-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'processPage' });
  }
});

// 快捷键处理
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translation') {
    chrome.tabs.sendMessage(tab.id, { action: 'processPage' });
  }
});

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 语音合成
  if (message.action === 'speak') {
    const text = message.text;
    const lang = message.lang || 'en-US';

    // 获取用户配置的语音设置，包括 Edge TTS
    chrome.storage.sync.get(['ttsRate', 'ttsVoice', 'edgeTtsEnabled', 'edgeTtsEndpoint', 'edgeTtsApiKey', 'edgeTtsVoice', 'edgeTtsSpeed'], async (settings) => {
      const rate = settings.ttsRate || 1.0;
      const preferredVoice = settings.ttsVoice || '';

      // Check if Edge TTS is enabled and configured
      if (settings.edgeTtsEnabled && settings.edgeTtsEndpoint) {
        try {
          const result = await speakWithEdgeTts(
            text,
            settings.edgeTtsEndpoint,
            settings.edgeTtsApiKey || '',
            settings.edgeTtsVoice || 'en-US-AriaNeural',
            settings.edgeTtsSpeed || 1.0
          );
          sendResponse(result);
        } catch (error) {
          console.error('[VocabMeld] Edge TTS failed, falling back to system TTS:', error);
          // Fallback to system TTS
          const result = await speakWithSystemTts(text, lang, rate, preferredVoice);
          sendResponse(result);
        }
      } else {
        // Use system TTS
        const result = await speakWithSystemTts(text, lang, rate, preferredVoice);
        sendResponse(result);
      }
    });

    return true;
  }

  // 测试 Edge TTS 连接
  if (message.action === 'testEdgeTts') {
    testEdgeTtsConnection(message.endpoint, message.apiKey, message.voice)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, message: error.message }));
    return true;
  }

  // Edge TTS 发音测试
  if (message.action === 'speakEdgeTts') {
    speakWithEdgeTts(message.text, message.endpoint, message.apiKey, message.voice, message.speed)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // 获取可用的 TTS 声音列表
  if (message.action === 'getVoices') {
    chrome.tts.getVoices((voices) => {
      sendResponse({ voices: voices || [] });
    });
    return true;
  }
  
  // 测试 API 连接
  if (message.action === 'testApi') {
    testApiConnection(message.endpoint, message.apiKey, message.model)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, message: error.message }));
    return true;
  }
  
  // 发送 API 请求（避免 CORS 问题）
  if (message.action === 'apiRequest') {
    callApi(message.endpoint, message.apiKey, message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // 通用 fetch 代理（用于第三方 API，避免 CORS）
  if (message.action === 'fetchProxy') {
    fetch(message.url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // 获取统计数据
  if (message.action === 'getStats') {
    chrome.storage.sync.get([
      'totalWords', 'todayWords', 'lastResetDate',
      'cacheHits', 'cacheMisses', 'learnedWords', 'memorizeList'
    ], (result) => {
      // 检查是否需要重置今日统计
      const today = new Date().toISOString().split('T')[0];
      if (result.lastResetDate !== today) {
        result.todayWords = 0;
        result.lastResetDate = today;
        chrome.storage.sync.set({ todayWords: 0, lastResetDate: today });
      }
      
      sendResponse({
        totalWords: result.totalWords || 0,
        todayWords: result.todayWords || 0,
        learnedCount: (result.learnedWords || []).length,
        memorizeCount: (result.memorizeList || []).length,
        cacheHits: result.cacheHits || 0,
        cacheMisses: result.cacheMisses || 0
      });
    });
    return true;
  }
  
  // 获取缓存统计
  if (message.action === 'getCacheStats') {
    chrome.storage.sync.get('cacheMaxSize', (syncResult) => {
      const maxSize = syncResult.cacheMaxSize || 2000;
      chrome.storage.local.get('vocabmeld_word_cache', (result) => {
        const cache = result.vocabmeld_word_cache || [];
        sendResponse({
          size: cache.length,
          maxSize: maxSize
        });
      });
    });
    return true;
  }
  
  // 清空缓存
  if (message.action === 'clearCache') {
    chrome.storage.local.remove('vocabmeld_word_cache', () => {
      chrome.storage.sync.set({ cacheHits: 0, cacheMisses: 0 }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  // 清空已学会词汇
  if (message.action === 'clearLearnedWords') {
    chrome.storage.sync.set({ learnedWords: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  // 清空需记忆列表
  if (message.action === 'clearMemorizeList') {
    chrome.storage.sync.set({ memorizeList: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// 通用 API 调用（从 background 发起，避免 CORS）
async function callApi(endpoint, apiKey, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API Error: ${response.status}`);
  }
  
  return await response.json();
}

// 测试 API 连接
async function testApiConnection(endpoint, apiKey, model) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10
      })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }
    
    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return { success: true, message: '连接成功！' };
    }
    
    throw new Error('Invalid response');
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 扩展图标点击（如果没有 popup）
chrome.action.onClicked.addListener((tab) => {
  // 由于我们有 popup，这个不会被触发
  // 但保留以防万一
});

// 标签页更新时检查是否需要注入脚本
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    // 可以在这里做额外的初始化
  }
});

console.log('[VocabMeld] Background script loaded');
