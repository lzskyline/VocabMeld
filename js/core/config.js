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
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    qpm: 360
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    qpm: 360
  },
  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    model: 'gemini-2.5-flash',
    qpm: 360
  },
  qwen: {
    name: 'Qwen (通义千问)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    qpm: 360
  },
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant',
    qpm: 360
  },
  ollama: {
    name: 'Ollama (本地)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b',
    qpm: 0
  }
};

// 默认配置
export const DEFAULT_CONFIG = {
  // API 配置
  apiEndpoint: API_PRESETS.deepseek.endpoint,
  apiKey: '',
  modelName: API_PRESETS.deepseek.model,
  
  // 学习偏好
  nativeLanguage: 'zh-CN',
  targetLanguage: 'en',
  difficultyLevel: 'B1',
  difficultyRange: {
    min: 'B1',
    max: 'C2'
  },
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
export function isDifficultyCompatible(wordDifficulty, difficultySetting) {
  const levelToIndex = (level, fallbackIndex) => {
    const idx = CEFR_LEVELS.indexOf(level);
    return idx >= 0 ? idx : fallbackIndex;
  };
  const wordIdx = levelToIndex(wordDifficulty, CEFR_LEVELS.length - 1);

  if (!difficultySetting) {
    return true;
  }

  if (typeof difficultySetting === 'string') {
    const userIdx = levelToIndex(difficultySetting, 0);
    return wordIdx >= userIdx;
  }

  const minIdx = levelToIndex(difficultySetting.min || 'A1', 0);
  const maxIdx = levelToIndex(difficultySetting.max || 'C2', CEFR_LEVELS.length - 1);
  return wordIdx >= Math.min(minIdx, maxIdx) && wordIdx <= Math.max(minIdx, maxIdx);
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
