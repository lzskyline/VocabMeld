/**
 * VocabMeld 配置管理模块
 * 管理所有配置项和默认值
 */

// CEFR 难度等级
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// 替换强度配置
export const INTENSITY_CONFIG = {
  low: { maxPerParagraph: 4, label: '较少' },
  medium: { maxPerParagraph: 8, label: '适中' },
  high: { maxPerParagraph: 14, label: '较多' }
};

// 支持的语言
export const SUPPORTED_LANGUAGES = {
  native: [
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁体中文' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' }
  ],
  target: [
    { code: 'en', name: 'English' },
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁体中文' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' }
  ]
};

// API 预设配置
export const API_PRESETS = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini'
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat'
  },
  moonshot: {
    name: 'Moonshot',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k'
  },
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant'
  },
  ollama: {
    name: 'Ollama (本地)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b'
  }
};

// 默认配置
export const DEFAULT_CONFIG = {
  // API 配置
  apiEndpoint: API_PRESETS.deepseek.endpoint,
  apiKey: '',
  modelName: API_PRESETS.deepseek.model,

  // 速率限制配置
  rateLimitEnabled: false,         // 是否启用速率限制轮询
  globalRateLimit: 60,             // 全局默认 RPM

  // 学习偏好
  nativeLanguage: 'zh-CN',
  targetLanguage: 'en',
  difficultyLevel: 'B1',
  intensity: 'medium',
  
  // 行为设置
  autoProcess: false,
  showPhonetic: true,
  dictionaryType: 'zh-en', // 'zh-en' 中英, 'en-en' 英英
  enabled: true,
  
  // 站点规则
  blacklist: [],
  whitelist: [],
  
  // 统计数据
  totalWords: 0,
  todayWords: 0,
  lastResetDate: new Date().toISOString().split('T')[0],
  
  // 缓存统计
  cacheHits: 0,
  cacheMisses: 0
};

// 缓存配置
export const CACHE_CONFIG = {
  maxSize: 2000,
  storageKey: 'vocabmeld_word_cache'
};

// API 节点状态枚举
export const NODE_STATUS = {
  HEALTHY: 'healthy',   // 正常
  ERROR: 'error',       // 错误（暂时移出候选列表）
  UNKNOWN: 'unknown'    // 未知（初始状态）
};

// 故障转移配置
export const FAILOVER_CONFIG = {
  errorWindowMs: 5 * 60 * 1000,    // 错误统计时间窗口：5 分钟
  errorThreshold: 3,               // 错误阈值：5 分钟内 3 次失败标记为 error
  healthCheckIntervalMs: 5 * 60 * 1000,  // 健康检查间隔：5 分钟
  maxNodes: 10                     // 最大节点数量
};

// 速率限制配置
export const RATE_LIMIT_CONFIG = {
  defaultRpm: 60,                  // 默认每分钟请求数
  windowMs: 60 * 1000,             // 统计窗口：1 分钟
  defaultCooldownMs: 60 * 1000     // 默认冷却时间：60 秒
};

/**
 * 生成唯一 ID
 * @returns {string}
 */
export function generateNodeId() {
  return 'node_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 创建默认 API 节点
 * @param {object} preset - API 预设配置
 * @param {number} priority - 优先级
 * @returns {object}
 */
export function createDefaultNode(preset, priority = 0) {
  return {
    id: generateNodeId(),
    name: preset.name,
    endpoint: preset.endpoint,
    apiKey: '',
    model: preset.model,
    enabled: true,
    priority: priority,
    rateLimit: null  // 每分钟请求数，null = 使用全局设置
  };
}

/**
 * 创建默认节点状态
 * @param {string} nodeId - 节点 ID
 * @returns {object}
 */
export function createDefaultNodeStatus(nodeId) {
  return {
    nodeId: nodeId,
    status: NODE_STATUS.UNKNOWN,
    lastError: null,
    lastErrorTime: null,
    recentErrors: []
  };
}

// 需要跳过的标签
export const SKIP_TAGS = [
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
  'CANVAS', 'SVG', 'VIDEO', 'AUDIO', 'CODE', 'PRE', 'KBD',
  'SAMP', 'VAR', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'
];

// 需要跳过的类名
export const SKIP_CLASSES = [
  'vocabmeld-translated',
  'vocabmeld-tooltip',
  'highlight-mengshen',
  'code',
  'syntax',
  'hljs'
];

/**
 * 判断词汇难度是否符合用户设置
 * @param {string} wordDifficulty - 词汇难度 (A1-C2)
 * @param {string} userDifficulty - 用户设置难度 (A1-C2)
 * @returns {boolean}
 */
export function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  const wordIdx = CEFR_LEVELS.indexOf(wordDifficulty);
  const userIdx = CEFR_LEVELS.indexOf(userDifficulty);
  // 只显示大于等于用户选择难度的词汇
  return wordIdx >= userIdx;
}

/**
 * 获取语言显示名称
 * @param {string} code - 语言代码
 * @returns {string}
 */
export function getLanguageName(code) {
  const all = [...SUPPORTED_LANGUAGES.native, ...SUPPORTED_LANGUAGES.target];
  const lang = all.find(l => l.code === code);
  return lang ? lang.name : code;
}

