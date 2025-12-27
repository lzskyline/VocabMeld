/**
 * VocabMeld 存储服务模块
 * 封装 Chrome Storage API，提供统一的存储接口
 */

import { DEFAULT_CONFIG, NODE_STATUS, FAILOVER_CONFIG, generateNodeId, createDefaultNodeStatus } from './config.js';

/**
 * 存储服务类
 */
class StorageService {
  constructor() {
    this.cache = null;
    this.listeners = new Map();
  }

  /**
   * 获取配置值
   * @param {string|string[]|null} keys - 要获取的键，null 则获取所有
   * @returns {Promise<object>}
   */
  async get(keys = null) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, (result) => {
        if (keys === null) {
          resolve({ ...DEFAULT_CONFIG, ...result });
        } else if (typeof keys === 'string') {
          resolve({ [keys]: result[keys] ?? DEFAULT_CONFIG[keys] });
        } else {
          const merged = {};
          keys.forEach(key => {
            merged[key] = result[key] ?? DEFAULT_CONFIG[key];
          });
          resolve(merged);
        }
      });
    });
  }

  /**
   * 设置配置值
   * @param {object} items - 要设置的键值对
   * @returns {Promise<void>}
   */
  async set(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 从本地存储获取数据（用于大量数据如缓存）
   * @param {string|string[]|null} keys
   * @returns {Promise<object>}
   */
  async getLocal(keys = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result);
      });
    });
  }

  /**
   * 设置本地存储数据
   * @param {object} items
   * @returns {Promise<void>}
   */
  async setLocal(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 清除本地存储
   * @param {string|string[]} keys
   * @returns {Promise<void>}
   */
  async removeLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  /**
   * 获取完整配置
   * @returns {Promise<object>}
   */
  async getConfig() {
    return this.get(null);
  }

  /**
   * 更新统计数据
   * @param {object} stats - 统计数据更新
   * @returns {Promise<void>}
   */
  async updateStats(stats) {
    const current = await this.get(['totalWords', 'todayWords', 'lastResetDate', 'cacheHits', 'cacheMisses']);
    const today = new Date().toISOString().split('T')[0];
    
    // 检查是否需要重置今日统计
    if (current.lastResetDate !== today) {
      current.todayWords = 0;
      current.lastResetDate = today;
    }

    const updated = {
      totalWords: current.totalWords + (stats.newWords || 0),
      todayWords: current.todayWords + (stats.newWords || 0),
      lastResetDate: today,
      cacheHits: current.cacheHits + (stats.cacheHits || 0),
      cacheMisses: current.cacheMisses + (stats.cacheMisses || 0)
    };

    await this.set(updated);
    return updated;
  }

  /**
   * 获取白名单（已学会词汇）- 存储在 local 中避免 sync 的 8KB 限制
   * @returns {Promise<Array>}
   */
  async getWhitelist() {
    const result = await this.getLocal('learnedWords');
    return result.learnedWords || [];
  }

  /**
   * 添加词汇到白名单
   * @param {object} word - { original, word, addedAt }
   * @returns {Promise<void>}
   */
  async addToWhitelist(word) {
    const whitelist = await this.getWhitelist();
    const exists = whitelist.some(w => w.original === word.original || w.word === word.word);
    if (!exists) {
      whitelist.push({
        original: word.original,
        word: word.word,
        addedAt: Date.now()
      });
      await this.setLocal({ learnedWords: whitelist });
    }
  }

  /**
   * 从白名单移除词汇
   * @param {string} word - 词汇
   * @returns {Promise<void>}
   */
  async removeFromWhitelist(word) {
    const whitelist = await this.getWhitelist();
    const filtered = whitelist.filter(w => w.original !== word && w.word !== word);
    await this.setLocal({ learnedWords: filtered });
  }

  /**
   * 获取需记忆列表 - 存储在 local 中避免 sync 的 8KB 限制
   * @returns {Promise<Array>}
   */
  async getMemorizeList() {
    const result = await this.getLocal('memorizeList');
    return result.memorizeList || [];
  }

  /**
   * 添加词汇到需记忆列表
   * @param {string} word - 词汇
   * @returns {Promise<void>}
   */
  async addToMemorizeList(word) {
    const list = await this.getMemorizeList();
    const exists = list.some(w => w.word === word);
    if (!exists) {
      list.push({
        word: word,
        addedAt: Date.now()
      });
      await this.setLocal({ memorizeList: list });
    }
  }

  /**
   * 从需记忆列表移除词汇
   * @param {string} word - 词汇
   * @returns {Promise<void>}
   */
  async removeFromMemorizeList(word) {
    const list = await this.getMemorizeList();
    const filtered = list.filter(w => w.word !== word);
    await this.setLocal({ memorizeList: filtered });
  }

  /**
   * 检查站点是否在黑名单
   * @param {string} hostname - 站点域名
   * @returns {Promise<boolean>}
   */
  async isBlacklisted(hostname) {
    const { blacklist } = await this.get('blacklist');
    return (blacklist || []).some(domain => hostname.includes(domain));
  }

  /**
   * 检查站点是否在白名单
   * @param {string} hostname - 站点域名
   * @returns {Promise<boolean>}
   */
  async isWhitelisted(hostname) {
    const { whitelist } = await this.get('whitelist');
    return (whitelist || []).some(domain => hostname.includes(domain));
  }

  /**
   * 添加存储变化监听器
   * @param {function} callback - 回调函数
   * @returns {function} - 取消监听的函数
   */
  addChangeListener(callback) {
    const listener = (changes, areaName) => {
      if (areaName === 'sync' || areaName === 'local') {
        callback(changes, areaName);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // ============ API 节点管理方法 ============

  /**
   * 获取所有 API 节点配置
   * @returns {Promise<Array>}
   */
  async getApiNodes() {
    const result = await this.get('apiNodes');
    return result.apiNodes || [];
  }

  /**
   * 保存 API 节点配置
   * @param {Array} nodes - 节点数组
   * @returns {Promise<void>}
   */
  async saveApiNodes(nodes) {
    // 确保节点数量不超过限制
    const limitedNodes = nodes.slice(0, FAILOVER_CONFIG.maxNodes);
    await this.set({ apiNodes: limitedNodes });
  }

  /**
   * 添加新节点
   * @param {object} node - 节点配置
   * @returns {Promise<object>} - 添加的节点（包含生成的 ID）
   */
  async addApiNode(node) {
    const nodes = await this.getApiNodes();
    if (nodes.length >= FAILOVER_CONFIG.maxNodes) {
      throw new Error(`最多只能添加 ${FAILOVER_CONFIG.maxNodes} 个节点`);
    }

    const newNode = {
      id: generateNodeId(),
      name: node.name || '未命名节点',
      endpoint: node.endpoint || '',
      apiKey: node.apiKey || '',
      model: node.model || '',
      enabled: node.enabled !== false,
      priority: nodes.length  // 新节点默认优先级最低
    };

    nodes.push(newNode);
    await this.saveApiNodes(nodes);

    // 初始化节点状态
    await this.initNodeStatus(newNode.id);

    return newNode;
  }

  /**
   * 更新节点配置
   * @param {string} nodeId - 节点 ID
   * @param {object} updates - 更新内容
   * @returns {Promise<void>}
   */
  async updateApiNode(nodeId, updates) {
    const nodes = await this.getApiNodes();
    const index = nodes.findIndex(n => n.id === nodeId);
    if (index === -1) {
      throw new Error('节点不存在');
    }

    // 不允许修改 ID
    delete updates.id;
    nodes[index] = { ...nodes[index], ...updates };
    await this.saveApiNodes(nodes);
  }

  /**
   * 删除节点
   * @param {string} nodeId - 节点 ID
   * @returns {Promise<void>}
   */
  async deleteApiNode(nodeId) {
    const nodes = await this.getApiNodes();
    const filtered = nodes.filter(n => n.id !== nodeId);

    // 重新计算优先级
    filtered.forEach((node, index) => {
      node.priority = index;
    });

    await this.saveApiNodes(filtered);

    // 清理节点状态
    await this.clearNodeStatus(nodeId);
  }

  /**
   * 更新节点优先级（拖拽排序后调用）
   * @param {Array<string>} nodeIds - 按新优先级排序的节点 ID 数组
   * @returns {Promise<void>}
   */
  async updateNodePriorities(nodeIds) {
    const nodes = await this.getApiNodes();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const reordered = nodeIds
      .map((id, index) => {
        const node = nodeMap.get(id);
        if (node) {
          node.priority = index;
          return node;
        }
        return null;
      })
      .filter(Boolean);

    await this.saveApiNodes(reordered);
  }

  /**
   * 获取所有启用且健康的节点（按优先级排序）
   * @returns {Promise<Array>}
   */
  async getActiveNodes() {
    const nodes = await this.getApiNodes();
    const statuses = await this.getAllNodeStatuses();
    const statusMap = new Map(statuses.map(s => [s.nodeId, s]));

    return nodes
      .filter(node => {
        if (!node.enabled) return false;
        const status = statusMap.get(node.id);
        // 未知状态或健康状态的节点都可用
        return !status || status.status !== NODE_STATUS.ERROR;
      })
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取下一个可用节点（跳过指定节点）
   * @param {string} skipNodeId - 要跳过的节点 ID
   * @returns {Promise<object|null>}
   */
  async getNextActiveNode(skipNodeId) {
    const activeNodes = await this.getActiveNodes();
    return activeNodes.find(n => n.id !== skipNodeId) || null;
  }

  // ============ 节点状态管理方法 ============

  /**
   * 获取所有节点状态
   * @returns {Promise<Array>}
   */
  async getAllNodeStatuses() {
    const result = await this.getLocal('apiNodeStatuses');
    return result.apiNodeStatuses || [];
  }

  /**
   * 获取单个节点状态
   * @param {string} nodeId - 节点 ID
   * @returns {Promise<object>}
   */
  async getNodeStatus(nodeId) {
    const statuses = await this.getAllNodeStatuses();
    return statuses.find(s => s.nodeId === nodeId) || createDefaultNodeStatus(nodeId);
  }

  /**
   * 初始化节点状态
   * @param {string} nodeId - 节点 ID
   * @returns {Promise<void>}
   */
  async initNodeStatus(nodeId) {
    const statuses = await this.getAllNodeStatuses();
    if (!statuses.find(s => s.nodeId === nodeId)) {
      statuses.push(createDefaultNodeStatus(nodeId));
      await this.setLocal({ apiNodeStatuses: statuses });
    }
  }

  /**
   * 更新节点状态
   * @param {string} nodeId - 节点 ID
   * @param {object} updates - 状态更新
   * @returns {Promise<void>}
   */
  async updateNodeStatus(nodeId, updates) {
    const statuses = await this.getAllNodeStatuses();
    const index = statuses.findIndex(s => s.nodeId === nodeId);

    if (index === -1) {
      const newStatus = { ...createDefaultNodeStatus(nodeId), ...updates };
      statuses.push(newStatus);
    } else {
      statuses[index] = { ...statuses[index], ...updates };
    }

    await this.setLocal({ apiNodeStatuses: statuses });
  }

  /**
   * 记录节点错误
   * @param {string} nodeId - 节点 ID
   * @param {string} errorMessage - 错误信息
   * @returns {Promise<object>} - 更新后的状态
   */
  async recordNodeError(nodeId, errorMessage) {
    const status = await this.getNodeStatus(nodeId);
    const now = Date.now();

    // 添加错误时间戳
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

    await this.updateNodeStatus(nodeId, status);
    return status;
  }

  /**
   * 标记节点为健康状态
   * @param {string} nodeId - 节点 ID
   * @returns {Promise<void>}
   */
  async markNodeHealthy(nodeId) {
    await this.updateNodeStatus(nodeId, {
      status: NODE_STATUS.HEALTHY,
      lastError: null,
      lastErrorTime: null,
      recentErrors: []
    });
  }

  /**
   * 清理节点状态
   * @param {string} nodeId - 节点 ID
   * @returns {Promise<void>}
   */
  async clearNodeStatus(nodeId) {
    const statuses = await this.getAllNodeStatuses();
    const filtered = statuses.filter(s => s.nodeId !== nodeId);
    await this.setLocal({ apiNodeStatuses: filtered });
  }

  /**
   * 获取所有处于 error 状态的节点 ID
   * @returns {Promise<Array<string>>}
   */
  async getErrorNodeIds() {
    const statuses = await this.getAllNodeStatuses();
    return statuses
      .filter(s => s.status === NODE_STATUS.ERROR)
      .map(s => s.nodeId);
  }
}

// 导出单例
export const storage = new StorageService();
export default storage;

