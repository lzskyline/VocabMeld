/**
 * VocabMeld 后台脚本
 * 处理扩展级别的事件和消息
 */

// 多节点轮询状态
let endpointRoundRobin = 0;

// 检测是否是 Gemini API
function isGeminiApi(endpoint) {
  return endpoint.includes('generativelanguage.googleapis.com');
}

// 将 OpenAI 格式请求转换为 Gemini 格式
function convertToGeminiFormat(body) {
  const messages = body.messages || [];
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
  }

  const geminiBody = {
    contents,
    generationConfig: {
      temperature: body.temperature || 0.3,
      maxOutputTokens: body.max_tokens || 8192
    }
  };

  if (systemInstruction) {
    geminiBody.systemInstruction = systemInstruction;
  }

  return geminiBody;
}

// 将 Gemini 响应转换为 OpenAI 格式
function convertFromGeminiFormat(geminiResponse) {
  let text = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // 清理 Markdown 代码块包装（Gemini 2.5 会返回 ```json ... ```）
  text = text.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  return {
    choices: [{
      message: {
        role: 'assistant',
        content: text
      },
      finish_reason: 'stop'
    }]
  };
}

// 获取可用的 API 节点（已启用且未超过速率限制）
async function getAvailableEndpoints() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiEndpoints', 'apiConfigs', 'currentApiConfig', 'apiEndpoint', 'apiKey', 'modelName'], (syncResult) => {
      chrome.storage.local.get('endpointUsage', (localResult) => {
        let endpoints = syncResult.apiEndpoints || [];

        // 兼容旧版多配置 (apiConfigs)
        if (endpoints.length === 0 && syncResult.apiConfigs && Object.keys(syncResult.apiConfigs).length > 0) {
          const currentConfig = syncResult.currentApiConfig;
          endpoints = Object.entries(syncResult.apiConfigs).map(([name, config]) => ({
            id: name.toLowerCase().replace(/\s+/g, '-'),
            name: name,
            endpoint: config.endpoint || '',
            apiKey: config.apiKey || '',
            model: config.model || '',
            qpm: 0,
            enabled: name === currentConfig
          }));
          // 确保至少有一个启用
          if (!endpoints.some(ep => ep.enabled) && endpoints.length > 0) {
            endpoints[0].enabled = true;
          }
        }
        // 兼容旧版单配置
        else if (endpoints.length === 0 && syncResult.apiEndpoint) {
          endpoints = [{
            id: 'legacy',
            name: '默认配置',
            endpoint: syncResult.apiEndpoint,
            apiKey: syncResult.apiKey || '',
            model: syncResult.modelName || '',
            qpm: 0,
            enabled: true
          }];
        }

        const usage = localResult.endpointUsage || {};
        const now = Date.now();
        const windowStart = now - 60000; // 1分钟窗口

        // 筛选可用节点
        const available = endpoints.filter(ep => {
          if (!ep.enabled) return false;

          const epUsage = usage[ep.id] || { requests: [] };
          const recentRequests = (epUsage.requests || []).filter(t => t > windowStart).length;

          // 如果 qpm 为 0 表示不限速
          if (ep.qpm === 0) return true;

          return recentRequests < ep.qpm;
        });

        resolve({ endpoints, available, usage });
      });
    });
  });
}

// 选择下一个节点（轮询策略）
function selectNextEndpoint(available) {
  if (available.length === 0) return null;

  endpointRoundRobin = (endpointRoundRobin + 1) % available.length;
  return available[endpointRoundRobin];
}

// 记录节点使用
async function recordEndpointUsage(endpointId) {
  return new Promise((resolve) => {
    chrome.storage.local.get('endpointUsage', (result) => {
      const usage = result.endpointUsage || {};
      const now = Date.now();
      const windowStart = now - 60000;

      if (!usage[endpointId]) {
        usage[endpointId] = { requests: [] };
      }

      // 清理过期记录并添加新记录
      usage[endpointId].requests = usage[endpointId].requests
        .filter(t => t > windowStart)
        .concat([now]);

      chrome.storage.local.set({ endpointUsage: usage }, resolve);
    });
  });
}

// 带重试和节点切换的 API 调用
async function callApiWithRetry(body, maxRetries = 3, debugText = '') {
  let lastError = null;
  let triedEndpoints = new Set();

  // 使用传入的 debugText，如果没有则尝试从 body 中提取
  const textPreview = debugText || body.messages?.[body.messages.length - 1]?.content?.slice(0, 80) || '';
  console.log(`[VocabMeld] translateText start ${new Date().toISOString()} ${textPreview}...`);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { available } = await getAvailableEndpoints();

    // 过滤掉已尝试失败的节点
    const remaining = available.filter(ep => !triedEndpoints.has(ep.id));

    if (remaining.length === 0) {
      // 所有节点都已尝试或不可用
      console.log(`[VocabMeld] translateText end ${new Date().toISOString()} [FAILED] 没有可用节点`);
      throw lastError || new Error('没有可用的 API 节点');
    }

    const endpoint = selectNextEndpoint(remaining);
    if (!endpoint) {
      console.log(`[VocabMeld] translateText end ${new Date().toISOString()} [FAILED] 没有可用节点`);
      throw new Error('没有可用的 API 节点');
    }

    try {
      // 记录使用
      await recordEndpointUsage(endpoint.id);

      console.log(`[VocabMeld] 使用节点: ${endpoint.name} (${endpoint.id}), 尝试 ${attempt + 1}/${maxRetries}`);

      const result = await callApi(
        endpoint.endpoint,
        endpoint.apiKey,
        { ...body, model: endpoint.model }
      );

      console.log(`[VocabMeld] translateText end ${new Date().toISOString()}`, result);
      return result;
    } catch (error) {
      console.log(`[VocabMeld] Endpoint ${endpoint.name} failed:`, error.message);
      lastError = error;
      triedEndpoints.add(endpoint.id);

      // 继续尝试下一个节点
      continue;
    }
  }

  console.log(`[VocabMeld] translateText end ${new Date().toISOString()} [FAILED]`, lastError?.message);
  throw lastError || new Error('API 调用失败');
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
      // 发送到 content script 进行翻译后再添加到记忆列表
      chrome.tabs.sendMessage(tab.id, {
        action: 'translateAndAddToMemorize',
        word: word
      }).catch(err => {
        console.log('[VocabMeld] Content script not ready');
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
  
  // 发送 API 请求（避免 CORS 问题）- 使用多节点轮询
  if (message.action === 'apiRequest') {
    callApiWithRetry(message.body, 3, message._debugText)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 发送 API 请求（指定节点，不使用轮询）
  if (message.action === 'apiRequestDirect') {
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
  // 检测是否是 Gemini API
  if (isGeminiApi(endpoint)) {
    return callGeminiApi(endpoint, apiKey, body);
  }

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

// Gemini API 调用
async function callGeminiApi(endpoint, apiKey, body) {
  // Gemini 使用 URL 参数传递 API Key
  const url = `${endpoint}?key=${apiKey}`;
  const geminiBody = convertToGeminiFormat(body);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini API Error: ${response.status}`);
  }

  const geminiResponse = await response.json();
  return convertFromGeminiFormat(geminiResponse);
}

// 测试 API 连接
async function testApiConnection(endpoint, apiKey, model) {
  try {
    // Gemini API 使用不同的测试方式
    if (isGeminiApi(endpoint)) {
      return testGeminiApiConnection(endpoint, apiKey);
    }

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

// 测试 Gemini API 连接
async function testGeminiApiConnection(endpoint, apiKey) {
  try {
    const url = `${endpoint}?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 10 }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0]) {
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
