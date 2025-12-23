# VocabMeld 技术文档

本文档详细描述 VocabMeld 的技术实现方案，可作为复刻或二次开发的参考。

---

## 目录

- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [架构设计](#架构设计)
- [核心模块实现](#核心模块实现)
- [LLM Prompt 设计](#llm-prompt-设计)
- [数据结构设计](#数据结构设计)
- [存储方案](#存储方案)
- [性能优化策略](#性能优化策略)
- [开发指南](#开发指南)

---

## 项目结构

```
VocabMeld/
├── _locales/                    # 国际化
│   ├── en/messages.json
│   └── zh_CN/messages.json
├── css/
│   ├── content.css              # 注入页面的样式（替换词汇、悬浮卡片）
│   ├── options.css              # 设置页面样式
│   └── popup.css                # 弹出窗口样式
├── icons/
│   └── icon.svg                 # 扩展图标
├── js/
│   ├── background.js            # Service Worker（API 代理、TTS、右键菜单）
│   ├── content.js               # 内容脚本（核心翻译逻辑，约 2500 行）
│   ├── options.js               # 设置页面脚本
│   ├── popup.js                 # 弹出窗口脚本
│   ├── core/
│   │   ├── config.js            # 配置常量
│   │   └── storage.js           # 存储服务封装
│   └── services/
│       ├── cache-service.js     # LRU 缓存服务
│       ├── content-segmenter.js # 页面内容分段器
│       └── text-replacer.js     # DOM 文本替换器
├── manifest.json                # Manifest V3 配置
├── options.html                 # 设置页面
├── popup.html                   # 弹出窗口
└── package.json
```

---

## 技术栈

- **Chrome Extension Manifest V3**
- **Vanilla JavaScript (ES6+)**：无框架依赖，便于维护
- **CSS Variables + Modern CSS**：动态主题支持
- **Chrome Storage API**：`sync` 用于配置，`local` 用于缓存
- **Chrome TTS API**：文本转语音
- **Intersection Observer API**：视口检测，懒加载优化
- **MutationObserver API**：监听 DOM 变化，处理动态内容

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                          │
├─────────────────┬───────────────────────┬───────────────────────┤
│   Background    │    Content Script     │     Options/Popup     │
│   (Service      │    (注入到网页)        │     (扩展页面)         │
│    Worker)      │                       │                       │
├─────────────────┼───────────────────────┼───────────────────────┤
│ • API 代理      │ • DOM 处理            │ • 配置管理            │
│ • TTS 朗读      │ • 文本分段            │ • 词汇管理            │
│ • 右键菜单      │ • LLM 调用            │ • 统计展示            │
│ • 快捷键        │ • 缓存管理            │ • 主题设置            │
│ • 消息路由      │ • 用户交互            │                       │
└─────────────────┴───────────────────────┴───────────────────────┘
                            ↓
              ┌─────────────────────────────┐
              │      Chrome Storage         │
              ├─────────────┬───────────────┤
              │    sync     │    local      │
              │  (配置同步)  │  (本地缓存)   │
              └─────────────┴───────────────┘
```

### 页面处理流程

```
页面加载
    ↓
加载配置 & 缓存
    ↓
检查站点规则（黑/白名单）
    ↓
┌─────────────────────────────────────┐
│         页面内容分段                 │
│  • 遍历 DOM 查找文本容器             │
│  • 生成内容指纹防重复                │
│  • 视口优先处理                      │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│         词汇过滤                     │
│  • 检测页面语言                      │
│  • 排除已学会词汇                    │
│  • 排除停用词/代码                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│         缓存命中检查                 │
│  • 缓存命中 → 直接替换               │
│  • 缓存未命中 → 发送 LLM 请求        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│         LLM 翻译请求                 │
│  • 构造 Prompt                      │
│  • 调用 API（通过 background）       │
│  • 解析返回的 JSON                  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│         难度过滤                     │
│  • 根据用户设置过滤词汇等级          │
│  • 只保留 >= 用户等级的词汇          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│         DOM 替换                     │
│  • Range API 精确定位               │
│  • 创建替换元素                      │
│  • 应用主题样式                      │
└─────────────────────────────────────┘
    ↓
更新缓存 & 统计
```

---

## 核心模块实现

### 1. 内容分段器 (ContentSegmenter)

负责将页面内容智能分段，平衡处理批次大小和上下文相关性。

```javascript
// 核心配置
const CONFIG = {
  minSegmentLength: 50,    // 最小分段长度
  maxSegmentLength: 2000,  // 最大分段长度
  maxSegmentsPerBatch: 20  // 每批最多处理段落数
};

// 需要跳过的标签和类名
const SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE', 'KBD', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'];
const SKIP_CLASSES = ['vocabmeld-translated', 'vocabmeld-tooltip', 'hljs', 'code', 'syntax'];

// 文本容器识别
const BLOCK_TAGS = ['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'BLOCKQUOTE'];
```

**关键方法：**

```javascript
// 1. 检查节点是否应跳过
shouldSkipNode(node) {
  // 跳过特定标签
  // 跳过特定类名
  // 跳过隐藏元素（使用 offsetParent 快速检测）
  // 跳过可编辑元素
  // 跳过已处理元素
}

// 2. 生成内容指纹（防重复处理）
generateFingerprint(text, path) {
  const content = text.slice(0, 100).trim();
  let hash = 0;
  const str = content + path;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// 3. 检测代码文本
isCodeText(text) {
  const codePatterns = [
    /^(const|let|var|function|class|import|export|return)\s/,
    /[{}();]\s*$/,
    /^\s*(\/\/|\/\*|\*|#)/,
    /\w+\.\w+\(/,
    /console\./,
    /https?:\/\//
  ];
  return codePatterns.some(pattern => pattern.test(text.trim()));
}
```

### 2. LRU 缓存服务 (CacheService)

使用 Map 实现的 LRU 缓存，支持持久化。

```javascript
class CacheService {
  constructor() {
    this.cache = new Map();  // Map 保证插入顺序
    this.maxSize = 2000;     // 可配置：500-10000
  }

  // 生成缓存键
  generateKey(word, sourceLang, targetLang) {
    return `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
  }

  // 获取缓存（LRU：访问时移到末尾）
  get(word, sourceLang, targetLang) {
    const key = this.generateKey(word, sourceLang, targetLang);
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);  // 移到末尾
      return item;
    }
    return null;
  }

  // 设置缓存（超出容量时淘汰最早的）
  async set(word, sourceLang, targetLang, data) {
    const key = this.generateKey(word, sourceLang, targetLang);
    
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // 淘汰策略：删除最早的（Map 迭代器的第一个）
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      translation: data.translation,
      phonetic: data.phonetic || '',
      difficulty: data.difficulty || 'B1',
      timestamp: Date.now()
    });
    
    await this.persist();  // 异步持久化
  }

  // 批量检查缓存
  checkWords(words, sourceLang, targetLang) {
    const cached = new Map();
    const uncached = [];
    
    for (const word of words) {
      const item = this.get(word, sourceLang, targetLang);
      if (item) {
        cached.set(word, item);
      } else {
        uncached.push(word);
      }
    }
    
    return { cached, uncached };
  }
}
```

### 3. 文本替换器 (TextReplacer)

使用 Range API 精确替换文本节点。

```javascript
class TextReplacer {
  // 在文本节点中查找并替换
  replaceInTextNode(textNode, original, translation, phonetic, difficulty) {
    const text = textNode.textContent;
    
    // 创建正则匹配（支持中英文边界）
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `(^|[\\s，。、；：""''（）\\[\\]【】])${escapedOriginal}([\\s，。、；：""''（）\\[\\]【】]|$)`, 
      'i'
    );
    
    const match = regex.exec(text);
    if (!match) {
      // 尝试简单匹配（针对中文）
      const simpleIndex = text.indexOf(original);
      if (simpleIndex === -1) return false;
      return this.performReplacement(textNode, simpleIndex, original, translation, phonetic, difficulty);
    }

    const startIndex = match.index + match[1].length;
    return this.performReplacement(textNode, startIndex, original, translation, phonetic, difficulty);
  }

  // 执行 DOM 替换
  performReplacement(textNode, startIndex, original, translation, phonetic, difficulty) {
    try {
      const range = document.createRange();
      range.setStart(textNode, startIndex);
      range.setEnd(textNode, startIndex + original.length);

      // 验证范围内容
      if (range.toString().toLowerCase() !== original.toLowerCase()) {
        return false;
      }

      // 创建替换元素
      const wrapper = this.createReplacementElement(original, translation, phonetic, difficulty);

      // 执行替换
      range.deleteContents();
      range.insertNode(wrapper);
      return true;
    } catch (error) {
      return false;
    }
  }

  // 创建替换元素
  createReplacementElement(original, translation, phonetic, difficulty) {
    const wrapper = document.createElement('span');
    wrapper.className = 'vocabmeld-translated';
    wrapper.setAttribute('data-original', original);
    wrapper.setAttribute('data-translation', translation);
    wrapper.setAttribute('data-phonetic', phonetic || '');
    wrapper.setAttribute('data-difficulty', difficulty || 'B1');
    
    // 根据配置生成不同样式
    // translation-original: 译文(原文)
    // translation-only: 仅译文
    // original-translation: 原文(译文)
    wrapper.innerHTML = `<span class="vocabmeld-word">${translation}</span><span class="vocabmeld-original">(${original})</span>`;
    
    return wrapper;
  }
}
```

### 4. 语言检测

```javascript
function detectLanguage(text) {
  const chineseRegex = /[\u4e00-\u9fff]/g;
  const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
  const koreanRegex = /[\uac00-\ud7af]/g;
  const latinRegex = /[a-zA-Z]/g;

  const chineseCount = (text.match(chineseRegex) || []).length;
  const japaneseCount = (text.match(japaneseRegex) || []).length;
  const koreanCount = (text.match(koreanRegex) || []).length;
  const latinCount = (text.match(latinRegex) || []).length;
  const total = chineseCount + japaneseCount + koreanCount + latinCount || 1;

  if (japaneseCount / total > 0.1) return 'ja';
  if (koreanCount / total > 0.1) return 'ko';
  if (chineseCount / total > 0.3) return 'zh';
  return 'en';
}
```

### 5. CEFR 难度过滤

```javascript
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// 只显示大于等于用户选择难度的词汇
function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  const wordIdx = CEFR_LEVELS.indexOf(wordDifficulty);
  const userIdx = CEFR_LEVELS.indexOf(userDifficulty);
  return wordIdx >= userIdx;
}
```

### 6. 替换强度控制

```javascript
const INTENSITY_CONFIG = {
  low:    { maxPerParagraph: 4 },   // 较少
  medium: { maxPerParagraph: 8 },   // 适中
  high:   { maxPerParagraph: 14 }   // 较多
};
```

---

## LLM Prompt 设计

### 翻译请求 Prompt

```javascript
function buildTranslationPrompt(text, sourceLang, targetLang, difficulty, maxWords) {
  return `You are a vocabulary learning assistant. Analyze the following text and select ${maxWords} vocabulary words to translate.

Rules:
1. Select words appropriate for ${difficulty} level learners (CEFR scale)
2. Avoid: proper nouns, numbers, URLs, code, single letters
3. Prefer: common words with educational value
4. For each word, provide:
   - original: the word as it appears in text
   - translation: translation to ${targetLang}
   - phonetic: IPA pronunciation of the ${sourceLang === 'en' ? 'original' : 'translation'}
   - difficulty: CEFR level (A1-C2)

Text: "${text}"

Respond in JSON format:
{
  "words": [
    {"original": "example", "translation": "例子", "phonetic": "/ɪɡˈzæmpəl/", "difficulty": "A2"},
    ...
  ]
}`;
}
```

### 响应解析

```javascript
function parseTranslationResponse(responseText) {
  try {
    // 提取 JSON 部分（处理可能的 markdown 代码块）
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const data = JSON.parse(jsonStr);
    return data.words || [];
  } catch (error) {
    console.error('[VocabMeld] Failed to parse LLM response:', error);
    return [];
  }
}
```

---

## 数据结构设计

### 缓存项结构

```typescript
interface CacheItem {
  key: string;           // "word:sourceLang:targetLang"
  translation: string;   // 翻译结果
  phonetic: string;      // 音标
  difficulty: string;    // CEFR 等级
  timestamp: number;     // 时间戳
}
```

### 已学会词汇结构

```typescript
interface LearnedWord {
  original: string;      // 原词
  word: string;          // 翻译
  difficulty: string;    // 难度等级
  addedAt: number;       // 添加时间戳
}
```

### 需记忆词汇结构

```typescript
interface MemorizeWord {
  word: string;          // 词汇
  translation?: string;  // 翻译（可能尚未翻译）
  phonetic?: string;     // 音标
  difficulty?: string;   // 难度
  addedAt: number;       // 添加时间戳
}
```

### 页面分段结构

```typescript
interface PageSegment {
  element: HTMLElement;  // DOM 元素引用
  text: string;          // 文本内容（最多 2000 字符）
  fingerprint: string;   // 内容指纹
  path: string;          // DOM 路径
}
```

### 主题配置结构

```typescript
interface ThemeConfig {
  primary: string;           // 主色调
  underline: string;         // 下划线颜色
  hoverBg: string;           // 悬停背景色
  tooltipWord: string;       // 卡片单词颜色
  underlineWidth: string;    // 下划线宽度
  underlineStyle: string;    // 下划线样式 (solid/dashed/dotted/wavy)
  wordColor: string;         // 译文颜色（空=保持原样）
  originalColor: string;     // 原文颜色（空=保持原样）
  cardBg?: string;           // 卡片背景色（暗色）
  cardBgLight?: string;      // 卡片背景色（亮色）
}
```

---

## 存储方案

### chrome.storage.sync（同步存储，有配额限制）

| 键名 | 类型 | 说明 |
|------|------|------|
| apiEndpoint | string | API 端点 |
| apiKey | string | API 密钥 |
| modelName | string | 模型名称 |
| nativeLanguage | string | 母语 |
| targetLanguage | string | 学习语言 |
| difficultyLevel | string | 难度等级 |
| intensity | string | 替换强度 |
| autoProcess | boolean | 自动处理 |
| showPhonetic | boolean | 显示音标 |
| translationStyle | string | 翻译样式 |
| enabled | boolean | 扩展开关 |
| theme | string | 界面主题 |
| colorTheme | string | 配色方案 |
| siteMode | string | 站点模式 |
| excludedSites | string[] | 排除站点 |
| allowedSites | string[] | 允许站点 |
| learnedWords | LearnedWord[] | 已学会词汇 |
| memorizeList | MemorizeWord[] | 需记忆词汇 |
| totalWords | number | 累计接触词汇 |
| todayWords | number | 今日接触词汇 |
| cacheHits | number | 缓存命中次数 |
| cacheMisses | number | 缓存未命中次数 |

### chrome.storage.local（本地存储，容量大）

| 键名 | 类型 | 说明 |
|------|------|------|
| vocabmeld_word_cache | CacheItem[] | 词汇缓存 |

---

## 性能优化策略

### 1. 视口优先处理

```javascript
function getPageSegments(viewportOnly = false, margin = 500) {
  if (viewportOnly) {
    const viewportTop = window.scrollY - margin;
    const viewportBottom = window.scrollY + window.innerHeight + margin;
    // 只处理视口范围内的元素
  }
}
```

### 2. Intersection Observer 懒加载

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      pendingContainers.add(entry.target);
      scheduleProcessing();
    }
  });
}, { rootMargin: '300px' });
```

### 3. 防抖处理 DOM 变化

```javascript
const mutationObserver = new MutationObserver(
  debounce((mutations) => {
    // 处理 DOM 变化
  }, 500)
);
```

### 4. 并发控制

```javascript
const MAX_CONCURRENT = 3;  // 最多 3 个段落同时处理
const processingQueue = [];

async function processWithConcurrency(segments) {
  const results = [];
  for (let i = 0; i < segments.length; i += MAX_CONCURRENT) {
    const batch = segments.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(batch.map(processSegment));
    results.push(...batchResults);
  }
  return results;
}
```

### 5. 缓存优先策略

```javascript
async function processSegment(segment) {
  // 1. 先检查缓存
  const { cached, uncached } = cache.checkWords(words, sourceLang, targetLang);
  
  // 2. 立即应用缓存结果
  if (cached.size > 0) {
    applyReplacements(segment.element, Array.from(cached.entries()));
  }
  
  // 3. 异步处理未缓存词汇
  if (uncached.length > 0) {
    const newWords = await translateWords(uncached);
    applyReplacements(segment.element, newWords);
  }
}
```

### 6. 指纹去重

```javascript
const processedFingerprints = new Set();

function shouldProcess(segment) {
  if (processedFingerprints.has(segment.fingerprint)) {
    return false;
  }
  processedFingerprints.add(segment.fingerprint);
  return true;
}
```

---

## 开发指南

### 环境要求

- Chrome 浏览器 88+
- Node.js 16+（用于构建）

### 本地调试

1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目根目录

### 修改后刷新

1. 修改 `content.js` / `popup.js` / `options.js` 后：
   - 在 `chrome://extensions/` 点击刷新按钮
   - 刷新目标页面

2. 修改 `background.js` 后：
   - 在 `chrome://extensions/` 点击刷新按钮

3. 修改 CSS 后：
   - 刷新目标页面即可

### 调试技巧

```javascript
// 在 content script 中
console.log('[VocabMeld] Debug info:', data);

// 查看缓存
chrome.storage.local.get('vocabmeld_word_cache', console.log);

// 查看配置
chrome.storage.sync.get(null, console.log);
```

### 构建发布

```bash
npm run build  # 生成 dist/ 目录
```

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 保存用户设置和学习数据 |
| `activeTab` | 获取当前标签页信息 |
| `scripting` | 在网页中注入翻译功能 |
| `contextMenus` | 提供右键菜单功能 |
| `tts` | 单词发音功能 |
| `host_permissions: all_urls` | 在所有网站上提供翻译服务 |

---

## 关键实现细节

### API 请求代理

Content Script 无法直接发起跨域请求，通过 Background Script 代理：

```javascript
// content.js
chrome.runtime.sendMessage({
  action: 'apiRequest',
  endpoint: config.apiEndpoint,
  apiKey: config.apiKey,
  body: requestBody
}, (response) => {
  if (response.success) {
    // 处理响应
  }
});

// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'apiRequest') {
    fetch(message.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${message.apiKey}`
      },
      body: JSON.stringify(message.body)
    })
    .then(res => res.json())
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }));
    return true;  // 保持消息通道打开
  }
});
```

### 动态主题应用

```javascript
function applyColorTheme(themeId, customTheme) {
  const theme = BUILT_IN_THEMES[themeId] || BUILT_IN_THEMES.default;
  
  let styleEl = document.getElementById('vocabmeld-theme-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'vocabmeld-theme-style';
    document.head.appendChild(styleEl);
  }
  
  styleEl.textContent = `
    .vocabmeld-translated {
      border-bottom: ${theme.underlineWidth} ${theme.underlineStyle} ${theme.underline} !important;
    }
    .vocabmeld-translated:hover {
      background: ${theme.hoverBg} !important;
    }
    .vocabmeld-tooltip .vocabmeld-tooltip-word {
      color: ${theme.tooltipWord} !important;
    }
  `;
}
```

### 悬浮卡片实现

```javascript
function createTooltip() {
  const tooltip = document.createElement('div');
  tooltip.className = 'vocabmeld-tooltip';
  tooltip.innerHTML = `
    <div class="vocabmeld-tooltip-header">
      <span class="vocabmeld-tooltip-word"></span>
      <span class="vocabmeld-tooltip-badge"></span>
    </div>
    <div class="vocabmeld-tooltip-phonetic"></div>
    <div class="vocabmeld-tooltip-dict"></div>
    <div class="vocabmeld-tooltip-actions">
      <button class="vocabmeld-btn-learned">已学会</button>
      <button class="vocabmeld-btn-retranslate">重试</button>
    </div>
  `;
  document.body.appendChild(tooltip);
  return tooltip;
}

// 显示卡片（带延迟隐藏防抖）
function showTooltip(element) {
  clearTimeout(tooltipHideTimeout);
  
  const rect = element.getBoundingClientRect();
  tooltip.style.left = `${rect.left + window.scrollX}px`;
  tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
  
  // 填充数据
  tooltip.querySelector('.vocabmeld-tooltip-word').textContent = 
    element.getAttribute('data-translation');
  // ...
  
  tooltip.classList.add('visible');
}

function hideTooltip() {
  tooltipHideTimeout = setTimeout(() => {
    tooltip.classList.remove('visible');
  }, 200);
}
```

---

## CEFR 难度体系

| 等级 | 描述 | 词汇特征 | 示例 |
|------|------|----------|------|
| A1 | 入门级 | 最基础的日常词汇 | hello, thank you, yes |
| A2 | 初级 | 简单日常交流词汇 | weather, family, happy |
| B1 | 中级 | 一般性话题词汇 | opinion, experience, difference |
| B2 | 中高级 | 抽象概念词汇 | consequence, implement, significant |
| C1 | 高级 | 专业/学术词汇 | ubiquitous, paradigm, pragmatic |
| C2 | 精通级 | 罕见/文学词汇 | ephemeral, quintessential, serendipity |
