/**
 * VocabMeld 后台脚本
 * 处理扩展级别的事件和消息
 */

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
      difficultyRange: { min: 'B1', max: 'C2' },
      intensity: 'medium',
      autoProcess: true,
      showPhonetic: true,
      translationStyle: 'translation-original',
      enabled: true,
      siteMode: 'all',
      excludedSites: [],
      allowedSites: [],
      totalWords: 0,
      todayWords: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      cacheHits: 0,
      cacheMisses: 0
    });
    // 词汇列表存储在 local 中，避免 sync 的 8KB 限制
    chrome.storage.local.set({ learnedWords: [], memorizeList: [] });
  }
  
  // 更新时迁移：将 sync 中的词汇列表迁移到 local
  if (details.reason === 'update') {
    chrome.storage.sync.get(['learnedWords', 'memorizeList'], (syncResult) => {
      chrome.storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
        const updates = {};
        const toRemove = [];
        
        // 迁移 learnedWords
        if (syncResult.learnedWords && syncResult.learnedWords.length > 0) {
          const localWords = localResult.learnedWords || [];
          const mergedMap = new Map();
          [...localWords, ...syncResult.learnedWords].forEach(w => {
            const key = w.original || w.word;
            if (!mergedMap.has(key)) mergedMap.set(key, w);
          });
          updates.learnedWords = Array.from(mergedMap.values());
          toRemove.push('learnedWords');
        }
        
        // 迁移 memorizeList
        if (syncResult.memorizeList && syncResult.memorizeList.length > 0) {
          const localList = localResult.memorizeList || [];
          const mergedMap = new Map();
          [...localList, ...syncResult.memorizeList].forEach(w => {
            if (!mergedMap.has(w.word)) mergedMap.set(w.word, w);
          });
          updates.memorizeList = Array.from(mergedMap.values());
          toRemove.push('memorizeList');
        }
        
        if (Object.keys(updates).length > 0) {
          chrome.storage.local.set(updates, () => {
            chrome.storage.sync.remove(toRemove, () => {
              console.log('[VocabMeld] Migrated word lists from sync to local');
            });
          });
        }
      });
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
      chrome.storage.local.get('memorizeList', (result) => {
        const list = result.memorizeList || [];
        if (!list.some(w => w.word === word)) {
          list.push({ word, addedAt: Date.now() });
          chrome.storage.local.set({ memorizeList: list }, () => {
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
    
    // 获取用户配置的语音设置
    chrome.storage.sync.get(['ttsRate', 'ttsVoice'], (settings) => {
      const rate = settings.ttsRate || 1.0;
      const preferredVoice = settings.ttsVoice || '';
      
      // 先停止之前的朗读
      chrome.tts.stop();
      
      const options = {
        lang: lang,
        rate: rate,
        pitch: 1.0
      };
      
      // 如果用户指定了声音，使用用户的选择
      if (preferredVoice) {
        options.voiceName = preferredVoice;
      }
      
      chrome.tts.speak(text, options, () => {
        if (chrome.runtime.lastError) {
          console.error('[VocabMeld] TTS Error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true });
        }
      });
    });
    
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
      'cacheHits', 'cacheMisses'
    ], (syncResult) => {
      // 从 local 获取词汇列表
      chrome.storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
        // 检查是否需要重置今日统计
        const today = new Date().toISOString().split('T')[0];
        if (syncResult.lastResetDate !== today) {
          syncResult.todayWords = 0;
          syncResult.lastResetDate = today;
          chrome.storage.sync.set({ todayWords: 0, lastResetDate: today });
        }
        
        sendResponse({
          totalWords: syncResult.totalWords || 0,
          todayWords: syncResult.todayWords || 0,
          learnedCount: (localResult.learnedWords || []).length,
          memorizeCount: (localResult.memorizeList || []).length,
          cacheHits: syncResult.cacheHits || 0,
          cacheMisses: syncResult.cacheMisses || 0
        });
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
    chrome.storage.local.set({ learnedWords: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  // 清空需记忆列表
  if (message.action === 'clearMemorizeList') {
    chrome.storage.local.set({ memorizeList: [] }, () => {
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
