/**
 * VocabMeld 后台脚本
 * 处理扩展级别的事件和消息
 */

// 故障转移配置常量
const FAILOVER_CONFIG = {
  errorWindowMs: 5 * 60 * 1000,
  errorThreshold: 3,
  healthCheckIntervalMs: 5 * 60 * 1000,
  maxNodes: 10
};

// 速率限制配置常量
const RATE_LIMIT_CONFIG = {
  defaultRpm: 60,
  windowMs: 60 * 1000,
  defaultCooldownMs: 60 * 1000
};

const NODE_STATUS = {
  HEALTHY: 'healthy',
  ERROR: 'error',
  UNKNOWN: 'unknown',
  RATE_LIMITED: 'rate_limited',
  COOLDOWN: 'cooldown'
};

// 当前使用的节点 ID（运行时状态）
let currentNodeId = null;

// 健康检查定时器
let healthCheckTimer = null;

// 速率限制计数器（运行时状态，内存中维护）
const nodeRequestCounters = new Map();

/**
 * 清理过期的请求记录
 */
function cleanExpiredRequests(nodeId) {
  const counter = nodeRequestCounters.get(nodeId);
  if (!counter) return;

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_CONFIG.windowMs;

  // 过滤掉超过时间窗口的请求
  counter.requests = counter.requests.filter(t => t > windowStart);

  // 检查冷却期是否已过
  if (counter.cooldownUntil && now >= counter.cooldownUntil) {
    counter.cooldownUntil = null;
  }
}

/**
 * 记录节点请求
 */
function recordNodeRequest(nodeId) {
  let counter = nodeRequestCounters.get(nodeId);
  if (!counter) {
    counter = { requests: [], cooldownUntil: null };
    nodeRequestCounters.set(nodeId, counter);
  }

  counter.requests.push(Date.now());
  cleanExpiredRequests(nodeId);
}

/**
 * 获取节点的有效速率限制值
 */
async function getNodeRateLimit(node) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['rateLimitEnabled', 'globalRateLimit'], (result) => {
      if (!result.rateLimitEnabled) {
        resolve(null);
        return;
      }

      // 节点独立设置优先，否则使用全局设置
      const limit = node.rateLimit !== null && node.rateLimit !== undefined
        ? node.rateLimit
        : (result.globalRateLimit || RATE_LIMIT_CONFIG.defaultRpm);

      resolve(limit);
    });
  });
}

/**
 * 检查节点是否达到速率限制
 * limit 为 0 表示无限制
 */
async function isNodeRateLimited(nodeId, node) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['rateLimitEnabled', 'globalRateLimit'], (result) => {
      // 功能未启用
      if (!result.rateLimitEnabled) {
        resolve({ limited: false });
        return;
      }

      // 获取节点有效限制值（节点独立设置优先）
      // 节点设置 > 0 时使用节点设置，否则使用全局设置
      const nodeLimit = node?.rateLimit;
      const hasCustomLimit = nodeLimit !== null && nodeLimit !== undefined && nodeLimit > 0;
      const limit = hasCustomLimit ? nodeLimit : (result.globalRateLimit || 0);

      // limit 为 0 表示无限制
      if (!limit || limit === 0) {
        resolve({ limited: false, limit: 0 });
        return;
      }

      // 获取或创建计数器
      let counter = nodeRequestCounters.get(nodeId);
      if (!counter) {
        counter = { requests: [], cooldownUntil: null };
        nodeRequestCounters.set(nodeId, counter);
      }

      // 清理过期记录
      cleanExpiredRequests(nodeId);

      // 检查冷却期
      const now = Date.now();
      if (counter.cooldownUntil && now < counter.cooldownUntil) {
        resolve({
          limited: true,
          reason: 'cooldown',
          remaining: counter.cooldownUntil - now,
          cooldownUntil: counter.cooldownUntil,
          limit
        });
        return;
      }

      // 检查请求数
      if (counter.requests.length >= limit) {
        resolve({
          limited: true,
          reason: 'rate',
          count: counter.requests.length,
          limit
        });
        return;
      }

      resolve({
        limited: false,
        count: counter.requests.length,
        limit
      });
    });
  });
}

/**
 * 获取节点冷却剩余时间
 */
function getNodeCooldownRemaining(nodeId) {
  const counter = nodeRequestCounters.get(nodeId);
  if (!counter || !counter.cooldownUntil) return 0;

  const remaining = counter.cooldownUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * 处理 429 速率限制响应
 */
function handleRateLimitResponse(nodeId, retryAfterHeader) {
  const retryAfter = parseInt(retryAfterHeader) || 60;
  let counter = nodeRequestCounters.get(nodeId);
  if (!counter) {
    counter = { requests: [], cooldownUntil: null };
    nodeRequestCounters.set(nodeId, counter);
  }

  counter.cooldownUntil = Date.now() + retryAfter * 1000;
  console.log(`[VocabMeld] Node ${nodeId} rate limited by API, cooldown for ${retryAfter}s`);
}

/**
 * 生成唯一节点 ID
 */
function generateNodeId() {
  return 'node_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 迁移旧版 API 配置到新的多节点格式
 */
async function migrateApiConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiNodes', 'apiConfigs', 'currentApiConfig', 'apiEndpoint', 'apiKey', 'modelName'], async (result) => {
      // 如果已经有新格式的节点配置，跳过迁移
      if (result.apiNodes && result.apiNodes.length > 0) {
        console.log('[VocabMeld] API nodes already exist, skipping migration');
        resolve();
        return;
      }

      const newNodes = [];

      // 情况1：有 apiConfigs（多配置格式）
      if (result.apiConfigs && Object.keys(result.apiConfigs).length > 0) {
        console.log('[VocabMeld] Migrating from apiConfigs format');
        const currentConfig = result.currentApiConfig;
        let priority = 0;

        for (const [name, config] of Object.entries(result.apiConfigs)) {
          newNodes.push({
            id: generateNodeId(),
            name: name,
            endpoint: config.endpoint || '',
            apiKey: config.apiKey || '',
            model: config.model || '',
            enabled: true,
            // 当前使用的配置优先级最高
            priority: name === currentConfig ? 0 : ++priority
          });
        }

        // 重新排序，确保当前配置在最前面
        newNodes.sort((a, b) => a.priority - b.priority);
        newNodes.forEach((node, index) => node.priority = index);
      }
      // 情况2：只有单个 API 配置
      else if (result.apiEndpoint) {
        console.log('[VocabMeld] Migrating from single API config');
        newNodes.push({
          id: generateNodeId(),
          name: 'DeepSeek',
          endpoint: result.apiEndpoint,
          apiKey: result.apiKey || '',
          model: result.modelName || 'deepseek-chat',
          enabled: true,
          priority: 0
        });
      }

      // 如果有迁移的节点，保存并清理旧数据
      if (newNodes.length > 0) {
        chrome.storage.sync.set({ apiNodes: newNodes }, () => {
          // 清理旧字段（保留一段时间以防回滚）
          // chrome.storage.sync.remove(['apiConfigs', 'currentApiConfig', 'apiEndpoint', 'apiKey', 'modelName']);
          console.log('[VocabMeld] Migrated', newNodes.length, 'API nodes');
          resolve();
        });
      } else {
        // 没有旧配置，创建默认节点
        const defaultNode = {
          id: generateNodeId(),
          name: 'DeepSeek',
          endpoint: 'https://api.deepseek.com/chat/completions',
          apiKey: '',
          model: 'deepseek-chat',
          enabled: true,
          priority: 0
        };
        chrome.storage.sync.set({ apiNodes: [defaultNode] }, () => {
          console.log('[VocabMeld] Created default API node');
          resolve();
        });
      }
    });
  });
}

/**
 * 获取所有 API 节点
 */
async function getApiNodes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('apiNodes', (result) => {
      resolve(result.apiNodes || []);
    });
  });
}

/**
 * 获取所有节点状态
 */
async function getAllNodeStatuses() {
  return new Promise((resolve) => {
    chrome.storage.local.get('apiNodeStatuses', (result) => {
      resolve(result.apiNodeStatuses || []);
    });
  });
}

/**
 * 获取单个节点状态
 */
async function getNodeStatus(nodeId) {
  const statuses = await getAllNodeStatuses();
  return statuses.find(s => s.nodeId === nodeId) || {
    nodeId: nodeId,
    status: NODE_STATUS.UNKNOWN,
    lastError: null,
    lastErrorTime: null,
    recentErrors: []
  };
}

/**
 * 更新节点状态
 */
async function updateNodeStatus(nodeId, updates) {
  const statuses = await getAllNodeStatuses();
  const index = statuses.findIndex(s => s.nodeId === nodeId);

  if (index === -1) {
    statuses.push({ nodeId, status: NODE_STATUS.UNKNOWN, lastError: null, lastErrorTime: null, recentErrors: [], ...updates });
  } else {
    statuses[index] = { ...statuses[index], ...updates };
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ apiNodeStatuses: statuses }, resolve);
  });
}

/**
 * 记录节点错误
 */
async function recordNodeError(nodeId, errorMessage) {
  const status = await getNodeStatus(nodeId);
  const now = Date.now();

  status.recentErrors.push(now);
  status.lastError = errorMessage;
  status.lastErrorTime = now;

  // 过滤掉超过时间窗口的错误
  status.recentErrors = status.recentErrors.filter(
    t => now - t < FAILOVER_CONFIG.errorWindowMs
  );

  // 检查是否需要标记为 error
  if (status.recentErrors.length >= FAILOVER_CONFIG.errorThreshold) {
    status.status = NODE_STATUS.ERROR;
  }

  await updateNodeStatus(nodeId, status);
  return status;
}

/**
 * 标记节点为健康状态
 */
async function markNodeHealthy(nodeId) {
  await updateNodeStatus(nodeId, {
    status: NODE_STATUS.HEALTHY,
    lastError: null,
    lastErrorTime: null,
    recentErrors: []
  });
}

/**
 * 获取所有启用且健康的节点（按优先级排序）
 * 当速率限制启用时，会过滤掉达到限制的节点
 */
async function getActiveNodes() {
  const nodes = await getApiNodes();
  const statuses = await getAllNodeStatuses();
  const statusMap = new Map(statuses.map(s => [s.nodeId, s]));

  // 获取速率限制配置
  const rateLimitConfig = await new Promise((resolve) => {
    chrome.storage.sync.get(['rateLimitEnabled', 'globalRateLimit'], resolve);
  });

  const activeNodes = [];

  for (const node of nodes) {
    if (!node.enabled) continue;

    const status = statusMap.get(node.id);
    if (status && status.status === NODE_STATUS.ERROR) continue;

    // 如果启用了速率限制，检查节点是否达到限制
    if (rateLimitConfig.rateLimitEnabled) {
      const limitStatus = await isNodeRateLimited(node.id, node);
      if (limitStatus.limited) {
        continue;
      }
    }

    activeNodes.push(node);
  }

  return activeNodes.sort((a, b) => a.priority - b.priority);
}

/**
 * 获取当前应该使用的节点
 * 当速率限制启用时，优先检查第一个节点是否可用（恢复逻辑）
 */
async function getCurrentNode() {
  const nodes = await getApiNodes();
  const statuses = await getAllNodeStatuses();
  const statusMap = new Map(statuses.map(s => [s.nodeId, s]));

  // 获取速率限制配置
  const rateLimitConfig = await new Promise((resolve) => {
    chrome.storage.sync.get(['rateLimitEnabled', 'globalRateLimit'], resolve);
  });

  // 按优先级排序的启用节点
  const enabledNodes = nodes
    .filter(n => n.enabled)
    .sort((a, b) => a.priority - b.priority);

  if (enabledNodes.length === 0) return null;

  // 如果启用了速率限制
  if (rateLimitConfig.rateLimitEnabled) {
    // 检查第一个节点（优先级最高）是否可用
    const firstNode = enabledNodes[0];
    const firstNodeStatus = statusMap.get(firstNode.id);
    const firstNodeHealthy = !firstNodeStatus || firstNodeStatus.status !== NODE_STATUS.ERROR;

    if (firstNodeHealthy) {
      const limitStatus = await isNodeRateLimited(firstNode.id, firstNode);
      if (!limitStatus.limited) {
        // 第一个节点可用，切回
        if (currentNodeId !== firstNode.id) {
          console.log('[VocabMeld] Switching back to first node:', firstNode.name);
        }
        currentNodeId = firstNode.id;
        return firstNode;
      }
    }

    // 查找第一个未达到限制的节点
    for (const node of enabledNodes) {
      const status = statusMap.get(node.id);
      if (status && status.status === NODE_STATUS.ERROR) continue;

      const limitStatus = await isNodeRateLimited(node.id, node);
      if (!limitStatus.limited) {
        currentNodeId = node.id;
        return node;
      }
    }

    // 所有节点都达到限制
    return null;
  }

  // 原有逻辑：如果有当前节点且仍然可用，继续使用
  if (currentNodeId) {
    const current = enabledNodes.find(n => {
      if (n.id !== currentNodeId) return false;
      const status = statusMap.get(n.id);
      return !status || status.status !== NODE_STATUS.ERROR;
    });
    if (current) return current;
  }

  // 否则使用优先级最高的健康节点
  for (const node of enabledNodes) {
    const status = statusMap.get(node.id);
    if (!status || status.status !== NODE_STATUS.ERROR) {
      currentNodeId = node.id;
      return node;
    }
  }

  return null;
}

/**
 * 切换到下一个可用节点
 */
async function switchToNextNode(failedNodeId) {
  const activeNodes = await getActiveNodes();
  const nextNode = activeNodes.find(n => n.id !== failedNodeId);

  if (nextNode) {
    currentNodeId = nextNode.id;
    console.log('[VocabMeld] Switched to node:', nextNode.name);
    return nextNode;
  }

  return null;
}

/**
 * 解析错误信息
 */
function parseErrorMessage(error, response) {
  if (!response) {
    return '网络连接失败';
  }

  const status = response.status;
  if (status === 401 || status === 403) {
    return '认证失败，请检查 API 密钥';
  }
  if (status === 429) {
    return '请求过于频繁，稍后重试';
  }
  if (status >= 500) {
    return '服务暂时不可用';
  }

  return error?.message || `HTTP ${status}`;
}

/**
 * 带故障转移的 API 调用
 */
async function callApiWithFailover(body, retryCount = 0) {
  const maxRetries = 3;
  const node = await getCurrentNode();

  if (!node) {
    // 检查是否所有节点都达到速率限制
    const rateLimitConfig = await new Promise((resolve) => {
      chrome.storage.sync.get(['rateLimitEnabled'], resolve);
    });

    if (rateLimitConfig.rateLimitEnabled) {
      throw new Error('所有 API 节点均达到速率限制，请稍后重试');
    }
    throw new Error('所有 API 节点均不可用，请检查配置');
  }

  // 记录请求（用于速率限制计数）
  recordNodeRequest(node.id);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (node.apiKey) headers['Authorization'] = `Bearer ${node.apiKey}`;

    const response = await fetch(node.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, model: node.model })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = parseErrorMessage(errorData.error, response);

      // 处理 429 速率限制响应
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        handleRateLimitResponse(node.id, retryAfter);

        // 尝试切换到下一个节点
        if (retryCount < maxRetries) {
          const nextNode = await switchToNextNode(node.id);
          if (nextNode) {
            console.log('[VocabMeld] Rate limited, switching to node:', nextNode.name);
            return callApiWithFailover(body, retryCount + 1);
          }
        }
      }

      // 记录错误
      await recordNodeError(node.id, errorMessage);

      // 尝试切换到下一个节点
      if (retryCount < maxRetries) {
        const nextNode = await switchToNextNode(node.id);
        if (nextNode) {
          console.log('[VocabMeld] Retrying with node:', nextNode.name);
          return callApiWithFailover(body, retryCount + 1);
        }
      }

      throw new Error(errorMessage);
    }

    // 请求成功，标记节点为健康
    await markNodeHealthy(node.id);

    return await response.json();
  } catch (error) {
    // 网络错误等
    if (error.name === 'TypeError' || error.message === 'Failed to fetch') {
      await recordNodeError(node.id, '网络连接失败');

      if (retryCount < maxRetries) {
        const nextNode = await switchToNextNode(node.id);
        if (nextNode) {
          console.log('[VocabMeld] Network error, retrying with node:', nextNode.name);
          return callApiWithFailover(body, retryCount + 1);
        }
      }
    }

    throw error;
  }
}

/**
 * 健康检查：定期检测 error 状态的节点
 */
async function performHealthCheck() {
  const nodes = await getApiNodes();
  const statuses = await getAllNodeStatuses();
  const errorStatuses = statuses.filter(s => s.status === NODE_STATUS.ERROR);

  for (const status of errorStatuses) {
    const node = nodes.find(n => n.id === status.nodeId);
    if (!node || !node.enabled) continue;

    console.log('[VocabMeld] Health checking node:', node.name);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (node.apiKey) headers['Authorization'] = `Bearer ${node.apiKey}`;

      const response = await fetch(node.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: node.model,
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 10
        })
      });

      if (response.ok) {
        await markNodeHealthy(node.id);
        console.log('[VocabMeld] Node recovered:', node.name);
      }
    } catch (error) {
      console.log('[VocabMeld] Node still unhealthy:', node.name);
    }
  }
}

/**
 * 启动健康检查定时器
 */
function startHealthCheckTimer() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }
  healthCheckTimer = setInterval(performHealthCheck, FAILOVER_CONFIG.healthCheckIntervalMs);
  console.log('[VocabMeld] Health check timer started');
}

// 安装/更新时初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[VocabMeld] Extension installed/updated:', details.reason);

  // 设置默认配置
  if (details.reason === 'install') {
    chrome.storage.sync.set({
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
      totalWords: 0,
      todayWords: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      cacheHits: 0,
      cacheMisses: 0
    });
    // 词汇列表存储在 local 中，避免 sync 的 8KB 限制
    chrome.storage.local.set({ learnedWords: [], memorizeList: [] });
  }

  // 迁移 API 配置
  await migrateApiConfig();

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

  // 启动健康检查
  startHealthCheckTimer();
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

  // 测试 API 连接（指定节点）
  if (message.action === 'testApi') {
    testApiConnection(message.endpoint, message.apiKey, message.model)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, message: error.message }));
    return true;
  }

  // 测试指定节点
  if (message.action === 'testNode') {
    (async () => {
      const nodes = await getApiNodes();
      const node = nodes.find(n => n.id === message.nodeId);
      if (!node) {
        sendResponse({ success: false, message: '节点不存在' });
        return;
      }
      const result = await testApiConnection(node.endpoint, node.apiKey, node.model);
      if (result.success) {
        await markNodeHealthy(node.id);
      }
      sendResponse(result);
    })();
    return true;
  }

  // 发送 API 请求（带故障转移）
  if (message.action === 'apiRequest') {
    callApiWithFailover(message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 获取当前使用的节点信息
  if (message.action === 'getCurrentNode') {
    getCurrentNode()
      .then(node => sendResponse({ success: true, node }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 获取所有节点及其状态
  if (message.action === 'getNodesWithStatus') {
    (async () => {
      // 确保配置已迁移（幂等操作）
      await migrateApiConfig();

      const nodes = await getApiNodes();
      const statuses = await getAllNodeStatuses();
      const statusMap = new Map(statuses.map(s => [s.nodeId, s]));

      // 获取速率限制配置
      const rateLimitConfig = await new Promise((resolve) => {
        chrome.storage.sync.get(['rateLimitEnabled', 'globalRateLimit'], resolve);
      });

      const nodesWithStatus = await Promise.all(nodes.map(async (node) => {
        const baseStatus = statusMap.get(node.id) || {
          nodeId: node.id,
          status: NODE_STATUS.UNKNOWN,
          lastError: null,
          lastErrorTime: null,
          recentErrors: []
        };

        // 添加速率限制信息
        let rateLimitInfo = null;
        if (rateLimitConfig.rateLimitEnabled) {
          const limitStatus = await isNodeRateLimited(node.id, node);
          const counter = nodeRequestCounters.get(node.id);

          // 计算有效限制值（与 isNodeRateLimited 逻辑一致）
          const nodeLimit = node.rateLimit;
          const hasCustomLimit = nodeLimit !== null && nodeLimit !== undefined && nodeLimit > 0;
          const limit = hasCustomLimit ? nodeLimit : (rateLimitConfig.globalRateLimit || 0);

          rateLimitInfo = {
            enabled: true,
            limit,
            count: counter?.requests?.length || 0,
            limited: limitStatus.limited,
            reason: limitStatus.reason || null,
            cooldownRemaining: limitStatus.reason === 'cooldown' ? limitStatus.remaining : 0
          };
        }

        return {
          ...node,
          status: baseStatus,
          rateLimitInfo
        };
      }));

      sendResponse({ success: true, nodes: nodesWithStatus, currentNodeId });
    })();
    return true;
  }

  // 获取速率限制状态
  if (message.action === 'getRateLimitStatus') {
    (async () => {
      const nodes = await getApiNodes();
      const rateLimitConfig = await new Promise((resolve) => {
        chrome.storage.sync.get(['rateLimitEnabled', 'globalRateLimit'], resolve);
      });

      if (!rateLimitConfig.rateLimitEnabled) {
        sendResponse({ success: true, enabled: false, nodes: [] });
        return;
      }

      const nodesStatus = await Promise.all(nodes.map(async (node) => {
        const limitStatus = await isNodeRateLimited(node.id, node);
        const counter = nodeRequestCounters.get(node.id);

        // 计算有效限制值（与 isNodeRateLimited 逻辑一致）
        const nodeLimit = node.rateLimit;
        const hasCustomLimit = nodeLimit !== null && nodeLimit !== undefined && nodeLimit > 0;
        const limit = hasCustomLimit ? nodeLimit : (rateLimitConfig.globalRateLimit || 0);

        return {
          nodeId: node.id,
          nodeName: node.name,
          limit,
          count: counter?.requests?.length || 0,
          limited: limitStatus.limited,
          reason: limitStatus.reason || null,
          cooldownRemaining: limitStatus.reason === 'cooldown' ? limitStatus.remaining : 0
        };
      }));

      sendResponse({
        success: true,
        enabled: true,
        globalRateLimit: rateLimitConfig.globalRateLimit,
        nodes: nodesStatus
      });
    })();
    return true;
  }

  // 手动触发健康检查
  if (message.action === 'triggerHealthCheck') {
    performHealthCheck()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 重置节点状态
  if (message.action === 'resetNodeStatus') {
    markNodeHealthy(message.nodeId)
      .then(() => sendResponse({ success: true }))
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

// Service Worker 启动时初始化
(async () => {
  // 确保配置已迁移
  await migrateApiConfig();
  // 启动健康检查定时器
  startHealthCheckTimer();
  console.log('[VocabMeld] Initialization complete');
})();

console.log('[VocabMeld] Background script loaded');
