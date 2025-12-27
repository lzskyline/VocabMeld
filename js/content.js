/**
 * VocabMeld 内容脚本
 * 注入到网页中，处理词汇替换和用户交互
 */

// 由于 content script 不支持 ES modules，我们需要将所有代码整合

(async function() {
  'use strict';

  // ============ 配置常量 ============
  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const INTENSITY_CONFIG = {
    low: { maxPerParagraph: 4 },
    medium: { maxPerParagraph: 8 },
    high: { maxPerParagraph: 14 }
  };
  const SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE', 'KBD', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'];
  const SKIP_CLASSES = ['vocabmeld-translated', 'vocabmeld-tooltip', 'hljs', 'code', 'syntax'];
  const DEFAULT_CACHE_MAX_SIZE = 2000;

  // 内置主题配置（可被用户自定义覆盖）
  let BUILT_IN_THEMES = {
    default: {
      primary: '#6366f1',
      underline: 'rgba(99,102,241,0.6)',
      hoverBg: 'rgba(99,102,241,0.15)',
      tooltipWord: '#818cf8',
      underlineWidth: '1.5px',
      underlineStyle: 'solid',
      wordColor: '',  // 保持原样式
      originalColor: ''
    },
    ocean: {
      primary: '#0ea5e9',
      underline: 'rgba(14,165,233,0.7)',
      hoverBg: 'rgba(14,165,233,0.12)',
      tooltipWord: '#38bdf8',
      underlineWidth: '2px',
      underlineStyle: 'dashed',
      wordColor: '#0ea5e9',
      originalColor: '#64748b'
    },
    forest: {
      primary: '#10b981',
      underline: 'rgba(16,185,129,0.6)',
      hoverBg: 'rgba(16,185,129,0.1)',
      tooltipWord: '#34d399',
      underlineWidth: '1.5px',
      underlineStyle: 'dotted',
      wordColor: '#059669',
      originalColor: '#6b7280'
    },
    sunset: {
      primary: '#f59e0b',
      underline: 'rgba(245,158,11,0.7)',
      hoverBg: 'rgba(245,158,11,0.12)',
      tooltipWord: '#fbbf24',
      underlineWidth: '2px',
      underlineStyle: 'wavy',
      wordColor: '#d97706',
      originalColor: '#78716c'
    }
  };

  // ============ 状态管理 ============
  let config = null;
  let isProcessing = false;
  let processedFingerprints = new Set();
  let wordCache = new Map();
  let tooltip = null;
  let selectionPopup = null;
  let intersectionObserver = null;
  let pendingContainers = new Set(); // 待处理的可见容器
  let tooltipHideTimeout = null; // tooltip 延迟隐藏计时器
  let currentTooltipElement = null; // 当前显示 tooltip 的元素

  // ============ 工具函数 ============
  function isDifficultyCompatible(wordDifficulty, userDifficulty) {
    const wordIdx = CEFR_LEVELS.indexOf(wordDifficulty);
    const userIdx = CEFR_LEVELS.indexOf(userDifficulty);
    return wordIdx >= userIdx;
  }

  function generateFingerprint(text, path = '') {
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

  function debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

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
    if (chineseCount / total > 0.3) return 'zh'; // 返回通用中文标识
    return 'en';
  }

  // 判断检测到的语言是否与用户设置的母语匹配
  function isNativeLanguage(detectedLang, nativeLang) {
    // 中文简繁体视为同一语系
    if (detectedLang === 'zh' && (nativeLang === 'zh-CN' || nativeLang === 'zh-TW')) {
      return true;
    }
    return detectedLang === nativeLang;
  }

  function isCodeText(text) {
    const codePatterns = [
      /^(const|let|var|function|class|import|export|return|if|else|for|while)\s/,
      /[{}();]\s*$/,
      /^\s*(\/\/|\/\*|\*|#)/,
      /\w+\.\w+\(/,
      /console\./,
      /https?:\/\//
    ];
    return codePatterns.some(pattern => pattern.test(text.trim()));
  }

  // 重建文本，只保留指定的词汇（用于发送给 AI）
  function reconstructTextWithWords(text, targetWords) {
    const targetWordSet = new Set(targetWords.map(w => w.toLowerCase()));
    const lowerText = text.toLowerCase();
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

    const relevantSentences = sentences.filter(sentence => {
      const lowerSentence = sentence.toLowerCase();
      // 检查英文单词
      const words = sentence.match(/\b[a-zA-Z]{5,}\b/g) || [];
      const hasEnglishMatch = words.some(word => targetWordSet.has(word.toLowerCase()));
      
      // 检查中文短语（直接检查是否包含目标词汇）
      const hasChineseMatch = Array.from(targetWordSet).some(word => {
        // 只检查中文词汇
        if (/[\u4e00-\u9fff]/.test(word)) {
          return lowerSentence.includes(word);
        }
        return false;
      });
      
      return hasEnglishMatch || hasChineseMatch;
    });

    return relevantSentences.join('. ').trim() + (relevantSentences.length > 0 ? '.' : '');
  }

  // ============ 存储操作 ============
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, (syncResult) => {
        // 从 local 获取词汇列表（避免 sync 的 8KB 限制）
        chrome.storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
          // 检查是否有可用的 API 节点
          const apiNodes = syncResult.apiNodes || [];
          const hasApiNodes = apiNodes.some(n => n.enabled);

          config = {
            // 使用新的多节点配置，保留旧字段用于向后兼容
            apiEndpoint: hasApiNodes ? 'multi-node' : (syncResult.apiEndpoint || ''),
            apiKey: syncResult.apiKey || '',
            modelName: syncResult.modelName || 'deepseek-chat',
            apiNodes: apiNodes,
            hasApiNodes: hasApiNodes,
            nativeLanguage: syncResult.nativeLanguage || 'zh-CN',
            targetLanguage: syncResult.targetLanguage || 'en',
            difficultyLevel: syncResult.difficultyLevel || 'B1',
            intensity: syncResult.intensity || 'medium',
            processMode: syncResult.processMode || 'both',
            autoProcess: syncResult.autoProcess ?? false,
            showPhonetic: syncResult.showPhonetic ?? true,
            dictionaryType: syncResult.dictionaryType || 'zh-en',
            showAddMemorize: syncResult.showAddMemorize ?? true,
            cacheMaxSize: syncResult.cacheMaxSize || DEFAULT_CACHE_MAX_SIZE,
            translationStyle: syncResult.translationStyle || 'translation-original',
            theme: syncResult.theme || 'dark',
            enabled: syncResult.enabled ?? true,
            siteMode: syncResult.siteMode || 'all',
            excludedSites: syncResult.excludedSites || syncResult.blacklist || [],
            allowedSites: syncResult.allowedSites || [],
            learnedWords: localResult.learnedWords || [],
            memorizeList: localResult.memorizeList || [],
            colorTheme: syncResult.colorTheme || 'default',
            customTheme: syncResult.customTheme || null,
            customizedThemes: syncResult.customizedThemes || null
          };

          // 加载保存的自定义主题配置
          if (config.customizedThemes) {
            ['ocean', 'forest', 'sunset'].forEach(themeId => {
              if (config.customizedThemes[themeId]) {
                BUILT_IN_THEMES[themeId] = config.customizedThemes[themeId];
              }
            });
          }

          // 应用主题
          applyColorTheme(config.colorTheme, config.customTheme);

          resolve(config);
        });
      });
    });
  }

  // 应用颜色主题
  function applyColorTheme(themeId, customTheme) {
    const theme = themeId === 'custom' && customTheme ? customTheme : BUILT_IN_THEMES[themeId] || BUILT_IN_THEMES.default;
    
    // 创建或更新样式元素
    let styleEl = document.getElementById('vocabmeld-theme-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'vocabmeld-theme-style';
      document.head.appendChild(styleEl);
    }
    
    // 计算渐变的第二个颜色（稍微偏紫/深一点）
    const gradientEnd = theme.primary.replace('#', '');
    const r = Math.max(0, parseInt(gradientEnd.substr(0, 2), 16) - 20);
    const g = Math.max(0, parseInt(gradientEnd.substr(2, 2), 16) - 30);
    const b = Math.min(255, parseInt(gradientEnd.substr(4, 2), 16) + 20);
    const secondColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    
    // 卡片背景色（自定义主题可以设置）
    const cardBgDark = theme.cardBg || '#1e293b';
    const cardBgLight = theme.cardBgLight || '#ffffff';
    const cardBorderDark = theme.cardBorder || '#334155';
    const cardBorderLight = theme.cardBorderLight || '#e2e8f0';
    
    // 下划线样式
    const underlineWidth = theme.underlineWidth || '2px';
    const underlineStyle = theme.underlineStyle || 'solid';
    
    // 暗色主题使用 tooltipWord（浅色版本），亮色主题使用 primary
    // 文本颜色（空值表示保持原样式）
    const wordColorStyle = theme.wordColor ? `color: ${theme.wordColor} !important;` : '';
    const originalColorStyle = theme.originalColor ? `color: ${theme.originalColor} !important;` : '';
    
    styleEl.textContent = `
      .vocabmeld-translated {
        border-bottom: ${underlineWidth} ${underlineStyle} ${theme.underline} !important;
        text-decoration: none !important;
      }
      .vocabmeld-translated:hover {
        background: ${theme.hoverBg} !important;
      }
      ${wordColorStyle ? `.vocabmeld-translated .vocabmeld-word { ${wordColorStyle} }` : ''}
      ${originalColorStyle ? `.vocabmeld-translated .vocabmeld-original { ${originalColorStyle} }` : ''}
      .vocabmeld-tooltip .vocabmeld-tooltip-word {
        color: ${theme.tooltipWord} !important;
      }
      .vocabmeld-tooltip[data-theme="light"] .vocabmeld-tooltip-word {
        color: ${theme.primary} !important;
      }
      .vocabmeld-tooltip {
        background: ${cardBgDark} !important;
        border-color: ${cardBorderDark} !important;
      }
      .vocabmeld-tooltip[data-theme="light"] {
        background: ${cardBgLight} !important;
        border-color: ${cardBorderLight} !important;
      }
    `;
  }

  // 更新 UI 元素的主题
  function updateUITheme() {
    const theme = config?.theme || 'dark';
    if (tooltip) {
      tooltip.setAttribute('data-theme', theme);
    }
    if (selectionPopup) {
      selectionPopup.setAttribute('data-theme', theme);
    }
  }

  async function loadWordCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get('vocabmeld_word_cache', (result) => {
        const cached = result.vocabmeld_word_cache;
        if (cached && Array.isArray(cached)) {
          cached.forEach(item => {
            wordCache.set(item.key, {
              translation: item.translation,
              phonetic: item.phonetic,
              difficulty: item.difficulty
            });
          });
        }
        resolve(wordCache);
      });
    });
  }

  async function saveWordCache() {
    // 使用 Map 确保 key 唯一（Map 本身不会有重复 key）
    const data = [];
    const seenKeys = new Set();
    for (const [key, value] of wordCache) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        data.push({ key, ...value });
      }
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ vocabmeld_word_cache: data }, () => {
        if (chrome.runtime.lastError) {
          console.error('[VocabMeld] Failed to save cache:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async function updateStats(stats) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['totalWords', 'todayWords', 'lastResetDate', 'cacheHits', 'cacheMisses'], (current) => {
        const today = new Date().toISOString().split('T')[0];
        if (current.lastResetDate !== today) {
          current.todayWords = 0;
          current.lastResetDate = today;
        }
        const updated = {
          totalWords: (current.totalWords || 0) + (stats.newWords || 0),
          todayWords: (current.todayWords || 0) + (stats.newWords || 0),
          lastResetDate: today,
          cacheHits: (current.cacheHits || 0) + (stats.cacheHits || 0),
          cacheMisses: (current.cacheMisses || 0) + (stats.cacheMisses || 0)
        };
        chrome.storage.sync.set(updated, () => resolve(updated));
      });
    });
  }

  async function addToWhitelist(original, translation, difficulty) {
    const whitelist = config.learnedWords || [];
    const exists = whitelist.some(w => w.original === original || w.word === translation);
    if (!exists) {
      whitelist.push({ 
        original, 
        word: translation, 
        addedAt: Date.now(),
        difficulty: difficulty || 'B1'
      });
      config.learnedWords = whitelist;
      await new Promise(resolve => chrome.storage.local.set({ learnedWords: whitelist }, resolve));
    }
  }

  async function addToMemorizeList(word) {
    if (!word || !word.trim()) {
      console.warn('[VocabMeld] Invalid word for memorize list:', word);
      return;
    }

    const trimmedWord = word.trim();
    const list = config.memorizeList || [];
    const exists = list.some(w => w.word === trimmedWord);
    
    if (!exists) {
      list.push({ word: trimmedWord, addedAt: Date.now() });
      config.memorizeList = list;
      await new Promise(resolve => chrome.storage.local.set({ memorizeList: list }, resolve));

      // 添加到记忆列表后，立即检查页面上是否存在这些单词并触发翻译
      // 确保配置已加载且扩展已启用
      if (!config) {
        await loadConfig();
      }
      
      // 确保扩展已启用
      if (!config.enabled) {
        showToast(`"${trimmedWord}" 已添加到记忆列表`);
        return;
      }
      
      // 立即触发翻译处理（等待完成以确保翻译结果正确应用到页面）
      try {
        const count = await processSpecificWords([trimmedWord]);
        
        if (count > 0) {
          showToast(`"${trimmedWord}" 已添加到记忆列表并翻译`);
        } else {
          // 即使页面上没有找到，也要确保翻译结果被缓存，以便下次加载时使用
          try {
            await translateSpecificWords([trimmedWord]);
            showToast(`"${trimmedWord}" 已添加到记忆列表`);
          } catch (error) {
            console.error('[VocabMeld] Error translating word:', trimmedWord, error);
            showToast(`"${trimmedWord}" 已添加到记忆列表`);
          }
        }
      } catch (error) {
        console.error('[VocabMeld] Error processing word:', trimmedWord, error);
        showToast(`"${trimmedWord}" 已添加到记忆列表`);
      }
    } else {
      showToast(`"${trimmedWord}" 已在记忆列表中`);
    }
  }

  async function removeFromMemorizeList(word) {
    if (!word || !word.trim()) return;
    
    const trimmedWord = word.trim();
    const list = config.memorizeList || [];
    const newList = list.filter(w => w.word !== trimmedWord);
    
    if (newList.length !== list.length) {
      config.memorizeList = newList;
      await new Promise(resolve => chrome.storage.local.set({ memorizeList: newList }, resolve));
      showToast(`"${trimmedWord}" 已从记忆列表移除`);
    }
  }

  // ============ DOM 处理 ============
  function shouldSkipNode(node, skipStyleCheck = false) {
    if (!node) return true;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return true;
    if (node.nodeType === Node.TEXT_NODE) return shouldSkipNode(node.parentElement, skipStyleCheck);

    const element = node;
    if (SKIP_TAGS.includes(element.tagName)) return true;
    const classList = element.className?.toString() || '';
    if (SKIP_CLASSES.some(cls => classList.includes(cls))) return true;

    // 使用更轻量的可见性检测，避免频繁触发 getComputedStyle
    if (!skipStyleCheck) {
      // 使用 offsetParent 快速检测是否隐藏（display: none 的元素 offsetParent 为 null）
      // 注意：position: fixed 元素的 offsetParent 也是 null，但这些通常不需要处理
      if (element.offsetParent === null && element.tagName !== 'BODY' && element.tagName !== 'HTML') {
        // 排除 position: fixed 的情况
        const position = element.style.position;
        if (position !== 'fixed' && position !== 'sticky') {
          return true;
        }
      }
    }

    if (element.isContentEditable) return true;
    if (element.hasAttribute('data-vocabmeld-processed')) return true;

    return false;
  }

  function getElementPath(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.body) {
      let selector = current.tagName?.toLowerCase() || '';
      if (current.id) selector += `#${current.id}`;
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join('>');
  }

  function findTextContainers(root) {
    const containers = [];
    const blockTags = ['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'BLOCKQUOTE'];
    
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
        if (blockTags.includes(node.tagName)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });

    let node;
    while (node = walker.nextNode()) {
      const hasDirectText = Array.from(node.childNodes).some(
        child => child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 10
      );
      if (hasDirectText) containers.push(node);
    }
    return containers;
  }

  function getTextContent(element) {
    const texts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (shouldSkipNode(node.parentElement)) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (text.length > 0 && !isCodeText(text)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while (node = walker.nextNode()) texts.push(node.textContent);
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  const MAX_SEGMENTS_PER_BATCH = 20; // 每批最多处理的段落数

  function getPageSegments(viewportOnly = false, margin = 500) {
    const segments = [];
    let viewportTop = 0, viewportBottom = Infinity;
    
    if (viewportOnly) {
      viewportTop = window.scrollY - margin;
      viewportBottom = window.scrollY + window.innerHeight + margin;
    }

    const containers = findTextContainers(document.body);

    for (const container of containers) {
      // 已达到批次上限，停止添加
      if (segments.length >= MAX_SEGMENTS_PER_BATCH) break;

      if (viewportOnly) {
        const rect = container.getBoundingClientRect();
        const elementTop = rect.top + window.scrollY;
        const elementBottom = rect.bottom + window.scrollY;
        if (elementBottom < viewportTop || elementTop > viewportBottom) continue;
      }

      const text = getTextContent(container);
      if (!text || text.length < 50) continue;
      if (isCodeText(text)) continue;

      const path = getElementPath(container);
      const fingerprint = generateFingerprint(text, path);
      if (processedFingerprints.has(fingerprint)) continue;

      segments.push({ element: container, text: text.slice(0, 2000), fingerprint, path });
    }

    return segments;
  }

  // ============ 文本替换 ============
  function createReplacementElement(original, translation, phonetic, difficulty) {
    const wrapper = document.createElement('span');
    wrapper.className = 'vocabmeld-translated';
    wrapper.setAttribute('data-original', original);
    wrapper.setAttribute('data-translation', translation);
    wrapper.setAttribute('data-phonetic', phonetic || '');
    wrapper.setAttribute('data-difficulty', difficulty || 'B1');
    
    // 根据配置的样式生成不同的HTML
    const style = config.translationStyle || 'translation-original';
    let innerHTML = '';
    
    switch (style) {
      case 'translation-only':
        // 只显示译文
        innerHTML = `<span class="vocabmeld-word">${translation}</span>`;
        break;
      case 'original-translation':
        // 原文(译文)
        innerHTML = `<span class="vocabmeld-original">${original}</span><span class="vocabmeld-word">(${translation})</span>`;
        break;
      case 'translation-original':
      default:
        // 译文(原文) - 默认样式
        innerHTML = `<span class="vocabmeld-word">${translation}</span><span class="vocabmeld-original">(${original})</span>`;
        break;
    }
    
    wrapper.innerHTML = innerHTML;
    return wrapper;
  }

  function applyReplacements(element, replacements) {
    if (!element || !replacements?.length) return 0;

    let count = 0;
    
    // 获取文本节点的辅助函数（每次调用都重新获取，确保节点引用有效）
    function getTextNodes() {
      const nodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          // 跳过已翻译的元素
          if (parent.classList?.contains('vocabmeld-translated')) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // 跳过不应该处理的节点类型
          if (SKIP_TAGS.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          
          // 跳过代码相关的类
          const classList = parent.className?.toString() || '';
          if (SKIP_CLASSES.some(cls => classList.includes(cls) && cls !== 'vocabmeld-translated')) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // 跳过隐藏元素（使用 offsetParent 快速检测）
          if (parent.offsetParent === null && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
            const position = parent.style.position;
            if (position !== 'fixed' && position !== 'sticky') {
              return NodeFilter.FILTER_REJECT;
            }
          }
          
          // 跳过可编辑元素
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          
          const text = node.textContent.trim();
          if (text.length === 0) return NodeFilter.FILTER_REJECT;
          
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      
      let node;
      while (node = walker.nextNode()) {
        nodes.push(node);
      }
      return nodes;
    }

    // 按位置从后往前排序，避免位置偏移问题
    const sortedReplacements = [...replacements].sort((a, b) => (b.position || 0) - (a.position || 0));

    for (const replacement of sortedReplacements) {
      const { original, translation, phonetic, difficulty } = replacement;
      const lowerOriginal = original.toLowerCase();
      
      // 每次替换后重新获取文本节点，因为DOM结构已改变
      const textNodes = getTextNodes();
      
      for (let i = 0; i < textNodes.length; i++) {
        const textNode = textNodes[i];
        
        // 检查节点是否仍然有效（DOM可能已改变）
        if (!textNode.parentElement || !element.contains(textNode)) {
          continue;
        }
        
        const text = textNode.textContent;
        const lowerText = text.toLowerCase();
        
        // 检查文本节点是否包含目标单词
        if (!lowerText.includes(lowerOriginal)) continue;
        
        // 使用单词边界匹配，确保匹配完整单词
        const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 匹配单词边界（包括中文标点）
        const regex = new RegExp(`(^|[^\\w\\u4e00-\\u9fff])${escapedOriginal}([^\\w\\u4e00-\\u9fff]|$)`, 'i');
        
        let match = regex.exec(text);
        let startIndex = match ? match.index + match[1].length : text.toLowerCase().indexOf(lowerOriginal);
        
        if (startIndex === -1) continue;

        try {
          const range = document.createRange();
          range.setStart(textNode, startIndex);
          range.setEnd(textNode, startIndex + original.length);
          
          const rangeContent = range.toString();
          if (rangeContent.toLowerCase() !== lowerOriginal) continue;

          // 检查是否已经被替换（检查父元素是否是已翻译的元素）
          let parent = textNode.parentElement;
          let isAlreadyReplaced = false;
          while (parent && parent !== element) {
            if (parent.classList?.contains('vocabmeld-translated')) {
              isAlreadyReplaced = true;
              break;
            }
            parent = parent.parentElement;
          }
          
          if (isAlreadyReplaced) continue;

          const wrapper = createReplacementElement(original, translation, phonetic, difficulty);
          range.deleteContents();
          range.insertNode(wrapper);
          count++;
          
          // 找到匹配后立即跳出，因为DOM结构已改变，需要重新获取节点
          break;
        } catch (e) {
          console.error('[VocabMeld] Replacement error:', e, original);
        }
      }
    }

    if (count > 0) element.setAttribute('data-vocabmeld-processed', 'true');
    return count;
  }

  function restoreOriginal(element) {
    if (!element.classList?.contains('vocabmeld-translated')) return;
    const original = element.getAttribute('data-original');
    const textNode = document.createTextNode(original);
    element.parentNode.replaceChild(textNode, element);
  }

  // 恢复页面上所有相同单词的原文
  function restoreAllSameWord(originalWord) {
    document.querySelectorAll('.vocabmeld-translated').forEach(el => {
      if (el.getAttribute('data-original')?.toLowerCase() === originalWord.toLowerCase()) {
        restoreOriginal(el);
      }
    });
  }

  function restoreAll() {
    document.querySelectorAll('.vocabmeld-translated').forEach(restoreOriginal);
    document.querySelectorAll('[data-vocabmeld-processed]').forEach(el => el.removeAttribute('data-vocabmeld-processed'));
    document.querySelectorAll('[data-vocabmeld-observing]').forEach(el => el.removeAttribute('data-vocabmeld-observing'));
    processedFingerprints.clear();
    pendingContainers.clear();
  }

  // ============ API 调用 ============
  async function translateText(text) {
    if (!config.hasApiNodes && !config.apiEndpoint) {
      throw new Error('API 未配置');
    }

    // 确保缓存已加载
    if (wordCache.size === 0) {
      await loadWordCache();
    }

    const detectedLang = detectLanguage(text);
    const isNative = isNativeLanguage(detectedLang, config.nativeLanguage);
    
    // 根据处理模式检查是否需要处理该文本
    // native-only: 只处理母语网页（将母语翻译为目标语言）
    // target-only: 只处理目标语言网页（将目标语言翻译为母语）
    // both: 两者均处理
    if (config.processMode === 'native-only' && !isNative) {
      return { immediate: [], async: null };
    }
    if (config.processMode === 'target-only' && isNative) {
      return { immediate: [], async: null };
    }
    
    const sourceLang = isNative ? config.nativeLanguage : detectedLang;
    const targetLang = isNative ? config.targetLanguage : config.nativeLanguage;
    const maxReplacements = INTENSITY_CONFIG[config.intensity]?.maxPerParagraph || 8;

    // 检查缓存 - 只检查有意义的词汇（排除常见停用词）
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their']);
    
    const words = (text.match(/\b[a-zA-Z]{5,}\b/g) || []).filter(w => !stopWords.has(w.toLowerCase()));
    
    // 对于中文，提取有意义的短语（2-4个字符）
    // 注意：这里只提取用于缓存检查，实际翻译由AI决定返回哪些词汇
    // 提取2-4个字符的短语（避免提取过多无意义的片段）
    const chinesePhrases = [];
    const chineseText = text.match(/[\u4e00-\u9fff]+/g) || [];
    
    // 从中文文本中提取2-4个字符的短语（滑动窗口，步长为1）
    for (const phrase of chineseText) {
      if (phrase.length >= 2) {
        // 提取2-4个字符的短语
        for (let len = 2; len <= Math.min(4, phrase.length); len++) {
          for (let i = 0; i <= phrase.length - len; i++) {
            const subPhrase = phrase.substring(i, i + len);
            chinesePhrases.push(subPhrase);
          }
        }
      }
    }
    
    const allWords = [...new Set([...words, ...chinesePhrases])];

    const cached = [];
    const uncached = [];
    const cachedWordsSet = new Set(); // 用于去重

    for (const word of allWords) {
      const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
      if (wordCache.has(key)) {
        const lowerWord = word.toLowerCase();
        if (!cachedWordsSet.has(lowerWord)) {
          cached.push({ word, ...wordCache.get(key) });
          cachedWordsSet.add(lowerWord);
        }
      } else {
        uncached.push(word);
      }
    }
    
    // 额外检查：检查文本中是否包含已缓存的词汇（用于处理AI返回的词汇与提取不一致的情况）
    // 只检查中文词汇，因为英文词汇已经通过上面的逻辑检查了
    const lowerText = text.toLowerCase();
    for (const [key, value] of wordCache) {
      const [cachedWord, cachedSourceLang, cachedTargetLang] = key.split(':');
      // 只检查相同语言对的缓存，且只检查中文词汇（2个字符以上）
      if (cachedSourceLang === sourceLang && 
          cachedTargetLang === targetLang && 
          /[\u4e00-\u9fff]/.test(cachedWord) && 
          cachedWord.length >= 2) {
        const lowerCachedWord = cachedWord.toLowerCase();
        // 检查是否已经在cached列表中
        if (!cachedWordsSet.has(lowerCachedWord)) {
          // 检查文本中是否包含这个词汇（不区分大小写）
          if (lowerText.includes(lowerCachedWord)) {
            // 找到词汇在文本中的位置
            const idx = text.toLowerCase().indexOf(lowerCachedWord);
            if (idx >= 0) {
              cached.push({ 
                word: text.substring(idx, idx + cachedWord.length), 
                ...value 
              });
              cachedWordsSet.add(lowerCachedWord);
            }
          }
        }
      }
    }

    // 获取已学会单词列表
    const learnedWordsSet = new Set((config.learnedWords || []).map(w => w.original.toLowerCase()));
    
    // 过滤缓存结果（按难度，排除已学会单词）
    const filteredCached = cached
      .filter(c => 
        isDifficultyCompatible(c.difficulty || 'B1', config.difficultyLevel) &&
        !learnedWordsSet.has(c.word.toLowerCase())
      )
      .map(c => {
        const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
        return { 
          original: c.word, 
          translation: c.translation, 
          phonetic: c.phonetic, 
          difficulty: c.difficulty, 
          position: idx >= 0 ? idx : 0, 
          fromCache: true 
        };
      });

    // 立即返回缓存结果（立即显示）
    const immediateResults = filteredCached.slice(0, maxReplacements);
    
    // 更新统计
    if (immediateResults.length > 0) {
      updateStats({ cacheHits: immediateResults.length, cacheMisses: 0 });
    }

    // 如果没有未缓存的词汇，直接返回缓存结果
    if (uncached.length === 0) {
      return { immediate: immediateResults, async: null };
    }

    // 构建只包含未缓存词汇的文本用于发送给 AI
    const filteredText = reconstructTextWithWords(text, uncached);

    // 判断是否需要限制异步替换数量
    const cacheSatisfied = immediateResults.length >= maxReplacements;
    const textTooShort = filteredText.trim().length < 50;
    
    // 如果文本太短，不需要调用API
    if (textTooShort) {
      return { immediate: immediateResults, async: null };
    }

    // 计算还需要翻译的词汇数量
    const remainingSlots = maxReplacements - immediateResults.length;
    
    // 如果缓存已满足配置，异步替换最多1个词；否则按剩余槽位计算
    const maxAsyncReplacements = cacheSatisfied ? 1 : remainingSlots;
    
    // 如果不需要异步替换，直接返回
    if (maxAsyncReplacements <= 0) {
      return { immediate: immediateResults, async: null };
    }
    
    // 动态计算AI应该返回的词汇数量（通常是配置值的1.5-2倍，让AI有选择空间）
    // 但如果缓存已满足或文本极少，限制AI返回数量
    const aiTargetCount = cacheSatisfied 
      ? 1 
      : Math.max(maxAsyncReplacements, Math.ceil(maxReplacements * 1.5));

    // 异步调用 API，处理未缓存的词汇（不阻塞立即返回）
    const asyncPromise = (async () => {
      try {
        const prompt = `你是一个语言学习助手。请分析以下文本，选择适合学习的词汇进行翻译。

## 规则：
1. 选择约 ${aiTargetCount} 个词汇（实际返回数量可以根据文本内容灵活调整，但不要超过 ${maxReplacements * 2} 个）
2. 优先选择：有学习价值的词汇、不同难度级别的词汇
3. 翻译方向：从 ${sourceLang} 翻译到 ${targetLang}
4. 翻译倾向：结合上下文只翻译成最合适的词汇，而不是多个含义。
5. 不要翻译专有名词、缩写、数字、代码等内容，也不要重复翻译已经是${targetLang}的内容。

## CEFR等级从简单到复杂依次为：A1-C2

## 输出格式：
返回 JSON 数组，每个元素包含：
- original: 原词
- translation: 翻译结果
- phonetic: 学习语言(${config.targetLanguage})的音标/发音
- difficulty: CEFR 难度等级 (A1/A2/B1/B2/C1/C2)，请谨慎评估

## 文本：
${filteredText}

## 输出：
只返回 JSON 数组，不要其他内容。`;

        const apiResponse = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'apiRequest',
            endpoint: config.apiEndpoint,
            apiKey: config.apiKey,
            body: {
              model: config.modelName,
              messages: [
                { role: 'system', content: '你是一个专业的语言学习助手。始终返回有效的 JSON 格式。' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.3,
              max_tokens: 2000
            }
          }, response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response?.success) {
              reject(new Error(response?.error || 'API request failed'));
            } else {
              resolve(response.data);
            }
          });
        });

        const data = apiResponse;
        const content = data.choices?.[0]?.message?.content || '[]';
        
        let allResults = [];
        try {
          allResults = JSON.parse(content);
          if (!Array.isArray(allResults)) {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) allResults = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) allResults = JSON.parse(jsonMatch[0]);
        }

        // 先缓存所有词汇（包括所有难度级别），供不同难度设置的用户使用
        // 过滤掉2字以下的中文词汇和小于5个字符的英文单词（避免简单词影响语境）
        for (const item of allResults) {
          // 对于中文，不存储1个字的内容（即只存储2个字及以上的词汇）
          const isChinese = /[\u4e00-\u9fff]/.test(item.original);
          if (isChinese && item.original.length < 2) {
            continue; // 跳过1个字的中文词汇（只存储2个字及以上的）
          }
          // 对于英文，不存储小于5个字符的单词
          const isEnglish = /^[a-zA-Z]+$/.test(item.original);
          if (isEnglish && item.original.length < 5) {
            continue; // 跳过小于5个字符的英文单词
          }
          
          const key = `${item.original.toLowerCase()}:${sourceLang}:${targetLang}`;
          // 如果已存在，先删除（LRU）
          if (wordCache.has(key)) {
            wordCache.delete(key);
          }
          
          // 如果达到上限，删除最早的项
          while (wordCache.size >= (config?.cacheMaxSize || DEFAULT_CACHE_MAX_SIZE)) {
            const firstKey = wordCache.keys().next().value;
            wordCache.delete(firstKey);
          }
          
          // 添加新项
          wordCache.set(key, {
            translation: item.translation,
            phonetic: item.phonetic || '',
            difficulty: item.difficulty || 'B1'
          });
        }
        // 确保缓存保存完成
        await saveWordCache();

        // 本地过滤：只保留符合用户难度设置的词汇，并过滤掉小于5个字符的英文单词
        const filteredResults = allResults.filter(item => {
          // 过滤难度级别
          if (!isDifficultyCompatible(item.difficulty || 'B1', config.difficultyLevel)) {
            return false;
          }
          // 过滤小于5个字符的英文单词
          const isEnglish = /^[a-zA-Z]+$/.test(item.original);
          if (isEnglish && item.original.length < 5) {
            return false;
          }
          return true;
        });

        // 更新统计
        updateStats({ newWords: filteredResults.length, cacheHits: cached.length, cacheMisses: 1 });

        // 修正 AI 返回结果的位置（从过滤文本映射回原始文本）
        const correctedResults = filteredResults.map(result => {
          const originalIndex = text.toLowerCase().indexOf(result.original.toLowerCase());
          return {
            ...result,
            position: originalIndex >= 0 ? originalIndex : result.position
          };
        });

        // 合并缓存结果（去重，避免与已显示的缓存结果重复，排除已学会单词）
        const immediateWords = new Set(immediateResults.map(r => r.original.toLowerCase()));
        const currentLearnedWords = new Set((config.learnedWords || []).map(w => w.original.toLowerCase()));
        const cachedResults = cached
          .filter(c => 
            !immediateWords.has(c.word.toLowerCase()) && 
            !correctedResults.some(r => r.original.toLowerCase() === c.word.toLowerCase()) &&
            !currentLearnedWords.has(c.word.toLowerCase()) &&
            isDifficultyCompatible(c.difficulty || 'B1', config.difficultyLevel)
          )
          .map(c => {
            const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
            return { original: c.word, translation: c.translation, phonetic: c.phonetic, difficulty: c.difficulty, position: idx, fromCache: true };
          });
        
        // API 结果也要过滤已学会单词
        const filteredCorrectedResults = correctedResults.filter(r => !currentLearnedWords.has(r.original.toLowerCase()));

        // 合并结果：补充的缓存结果 + API结果
        // 限制异步替换数量（如果缓存已满足配置或文本极少，最多只替换1个词）
        const mergedResults = [...cachedResults, ...filteredCorrectedResults];
        return mergedResults.slice(0, maxAsyncReplacements);

      } catch (error) {
        console.error('[VocabMeld] Async API Error:', error);
        // API失败时返回空数组，不影响已显示的缓存结果
        return [];
      }
    })();

    return { immediate: immediateResults, async: asyncPromise };
  }

  // ============ 特定单词处理 ============
  async function translateSpecificWords(targetWords) {
    if ((!config.hasApiNodes && !config.apiEndpoint) || !targetWords?.length) {
      return [];
    }

    const detectedLang = detectLanguage(targetWords.join(' '));
    const isNative = isNativeLanguage(detectedLang, config.nativeLanguage);
    const sourceLang = isNative ? config.nativeLanguage : detectedLang;
    const targetLang = isNative ? config.targetLanguage : config.nativeLanguage;

    const uncached = [];
    const cached = [];

    // 检查缓存（复用统一流程）
    for (const word of targetWords) {
      const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
      if (wordCache.has(key)) {
        // LRU: 访问时移到末尾（通过删除再添加实现）
        const cachedItem = wordCache.get(key);
        wordCache.delete(key);
        wordCache.set(key, cachedItem);
        cached.push({ word, ...cachedItem });
      } else {
        uncached.push(word);
      }
    }

    let allResults = cached.map(c => ({
      original: c.word,
      translation: c.translation,
      phonetic: c.phonetic,
      difficulty: c.difficulty
    }));

    // 如果有未缓存的单词，调用API
    if (uncached.length > 0) {
      try {
        const prompt = `你是一个语言学习助手。请翻译以下特定词汇。

## 规则：
1. 必须翻译所有提供的词汇，不要跳过任何词
2. 如果单词是${sourceLang}，则翻译到${targetLang}，反之亦然

## CEFR等级从简单到复杂依次为：A1-C2

## 输出格式：
返回 JSON 数组，每个元素包含：
- original: 原词
- translation: 翻译结果
- phonetic: 学习语言(${config.targetLanguage})的音标/发音
- difficulty: CEFR 难度等级 (A1/A2/B1/B2/C1/C2)

## 要翻译的词汇：
${uncached.join(', ')}

## 输出：
只返回 JSON 数组，不要其他内容。`;

        const apiResponse = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'apiRequest',
            endpoint: config.apiEndpoint,
            apiKey: config.apiKey,
            body: {
              model: config.modelName,
              messages: [
                { role: 'system', content: '你是一个专业的语言学习助手。始终返回有效的 JSON 格式。' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.3,
              max_tokens: 1000
            }
          }, response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response?.success) {
              reject(new Error(response?.error || 'API request failed'));
            } else {
              resolve(response.data);
            }
          });
        });

        const data = apiResponse;
        const content = data.choices?.[0]?.message?.content || '[]';

        let apiResults = [];
        try {
          apiResults = JSON.parse(content);
          if (!Array.isArray(apiResults)) {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) apiResults = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) apiResults = JSON.parse(jsonMatch[0]);
        }

        // 缓存结果（复用统一流程，实现LRU淘汰）
        // 过滤掉2字以下的中文词汇和小于5个字符的英文单词（避免简单词影响语境）
        for (const item of apiResults) {
          // 对于中文，不存储1个字的内容（即只存储2个字及以上的词汇）
          const isChinese = /[\u4e00-\u9fff]/.test(item.original);
          if (isChinese && item.original.length < 2) {
            continue; // 跳过1个字的中文词汇（只存储2个字及以上的）
          }
          // 对于英文，不存储小于5个字符的单词
          const isEnglish = /^[a-zA-Z]+$/.test(item.original);
          if (isEnglish && item.original.length < 5) {
            continue; // 跳过小于5个字符的英文单词
          }
          
          const key = `${item.original.toLowerCase()}:${sourceLang}:${targetLang}`;
          // 如果已存在，先删除（LRU）
          if (wordCache.has(key)) {
            wordCache.delete(key);
          }
          
          // 如果达到上限，删除最早的项
          while (wordCache.size >= (config?.cacheMaxSize || DEFAULT_CACHE_MAX_SIZE)) {
            const firstKey = wordCache.keys().next().value;
            wordCache.delete(firstKey);
          }
          
          // 添加新项
          wordCache.set(key, {
            translation: item.translation,
            phonetic: item.phonetic || '',
            difficulty: item.difficulty || 'B1'
          });
        }
        // 确保缓存保存完成
        await saveWordCache();

        allResults = [...allResults, ...apiResults];

        // 更新统计
        updateStats({ newWords: apiResults.length, cacheHits: cached.length, cacheMisses: 1 });

      } catch (error) {
        console.error('[VocabMeld] API Error for specific words:', error);
        // 如果API失败，至少返回缓存的结果
      }
    }

    return allResults.filter(item => targetWords.some(w => w.toLowerCase() === item.original.toLowerCase()));
  }

  // 根据上下文重新翻译单词
  async function retranslateWithContext(originalWord) {
    if (!config.hasApiNodes && !config.apiEndpoint) {
      showToast('请先配置 API');
      return;
    }
    
    // 找到包含该单词的元素，获取上下文
    const elements = document.querySelectorAll('.vocabmeld-translated');
    let contextSentence = '';
    let targetElement = null;
    
    for (const el of elements) {
      if (el.getAttribute('data-original')?.toLowerCase() === originalWord.toLowerCase()) {
        targetElement = el;
        // 获取父段落的文本作为上下文
        const parent = el.closest('p, div, li, td, span') || el.parentElement;
        if (parent) {
          contextSentence = parent.textContent.trim().slice(0, 300);
        }
        break;
      }
    }
    
    if (!contextSentence) {
      showToast('无法获取上下文');
      return;
    }
    
    showToast('正在重新翻译...');
    
    const detectedLang = detectLanguage(originalWord);
    const isNative = isNativeLanguage(detectedLang, config.nativeLanguage);
    const sourceLang = isNative ? config.nativeLanguage : detectedLang;
    const targetLang = isNative ? config.targetLanguage : config.nativeLanguage;
    
    try {
      const prompt = `你是一个语言学习助手。请根据上下文语境翻译单词。

## 上下文句子：
"${contextSentence}"

## 需要翻译的单词：
${originalWord}

## 规则：
1. 根据上下文确定单词的正确含义和词性
2. 翻译方向：${sourceLang} → ${targetLang}
3. 翻译结果应符合上下文语境

## 输出格式：
返回单个 JSON 对象：
{
  "original": "原词",
  "translation": "根据上下文的正确翻译",
  "phonetic": "学习语言(${config.targetLanguage})的音标",
  "difficulty": "CEFR等级"
}

只返回 JSON，不要其他内容。`;

      const apiResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          endpoint: config.apiEndpoint,
          apiKey: config.apiKey,
          body: {
            model: config.modelName,
            messages: [
              { role: 'system', content: '你是一个专业的语言学习助手。始终返回有效的 JSON 格式。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 500
          }
        }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!response?.success) {
            reject(new Error(response?.error || 'API request failed'));
          } else {
            resolve(response.data);
          }
        });
      });

      const content = apiResponse.choices?.[0]?.message?.content || '';
      let result = null;
      
      try {
        result = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      }
      
      if (!result?.translation) {
        showToast('翻译失败');
        return;
      }
      
      // 更新翻译缓存（先删除旧的，再写入新的）
      const key = `${originalWord.toLowerCase()}:${sourceLang}:${targetLang}`;
      if (wordCache.has(key)) {
        wordCache.delete(key);
      }
      wordCache.set(key, {
        translation: result.translation,
        phonetic: result.phonetic || '',
        difficulty: result.difficulty || 'B1'
      });
      await saveWordCache();
      
      // 清除旧的词典缓存并重新获取
      const dictionaryType = config.dictionaryType || 'zh-en';
      const dictCacheKey = `${originalWord.toLowerCase()}_${dictionaryType}`;
      dictCache.delete(dictCacheKey);
      // 同时清除持久化缓存
      if (persistentDictCache) {
        persistentDictCache.delete(dictCacheKey);
        scheduleDictCachePersist();
      }
      // 后台重新获取词典数据
      fetchDictionaryData(originalWord).catch(() => {});
      
      // 更新页面上所有相同单词的显示
      document.querySelectorAll('.vocabmeld-translated').forEach(el => {
        if (el.getAttribute('data-original')?.toLowerCase() === originalWord.toLowerCase()) {
          el.setAttribute('data-translation', result.translation);
          el.setAttribute('data-phonetic', result.phonetic || '');
          el.setAttribute('data-difficulty', result.difficulty || 'B1');
          
          // 更新显示内容
          const style = config.translationStyle || 'translation-original';
          let innerHTML = '';
          switch (style) {
            case 'translation-only':
              innerHTML = `<span class="vocabmeld-word">${result.translation}</span>`;
              break;
            case 'original-translation':
              innerHTML = `<span class="vocabmeld-original">${originalWord}</span><span class="vocabmeld-word">(${result.translation})</span>`;
              break;
            default:
              innerHTML = `<span class="vocabmeld-word">${result.translation}</span><span class="vocabmeld-original">(${originalWord})</span>`;
          }
          el.innerHTML = innerHTML;
        }
      });
      
      hideTooltip();
      showToast(`已更新翻译: ${result.translation}`);
      
    } catch (error) {
      console.error('[VocabMeld] Retranslate error:', error);
      showToast('重新翻译失败');
    }
  }

  async function processSpecificWords(targetWords) {
    if (!config?.enabled || !targetWords?.length) {
      return 0;
    }

    const targetWordSet = new Set(targetWords.map(w => w.toLowerCase()));
    let processed = 0;

    // 首先检查已翻译的元素，看是否有目标单词已经被翻译了
    const alreadyTranslated = [];
    document.querySelectorAll('.vocabmeld-translated').forEach(el => {
      const original = el.getAttribute('data-original');
      if (original && targetWordSet.has(original.toLowerCase())) {
        alreadyTranslated.push(original.toLowerCase());
      }
    });

    // 查找页面中包含目标单词的文本节点（包括已处理过的容器）
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // 跳过不应该处理的节点类型
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        // 跳过脚本、样式等标签
        if (SKIP_TAGS.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        
        // 跳过代码相关的类
        const classList = parent.className?.toString() || '';
        if (SKIP_CLASSES.some(cls => classList.includes(cls) && cls !== 'vocabmeld-translated')) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 跳过隐藏元素（使用 offsetParent 快速检测）
        if (parent.offsetParent === null && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
          const position = parent.style.position;
          if (position !== 'fixed' && position !== 'sticky') {
            return NodeFilter.FILTER_REJECT;
          }
        }
        
        // 跳过可编辑元素
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        
        const text = node.textContent.trim();
        if (text.length === 0) return NodeFilter.FILTER_REJECT;
        
        // 跳过代码文本
        if (isCodeText(text)) return NodeFilter.FILTER_REJECT;
        
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      // 检查文本节点是否包含目标单词（作为完整单词）
      const words = text.match(/\b[a-zA-Z]{5,}\b/g) || [];
      const chineseWords = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
      const allWords = [...words, ...chineseWords];

      // 检查是否包含目标单词（且该单词还没有被翻译）
      const containsTarget = allWords.some(word => {
        const lowerWord = word.toLowerCase();
        return targetWordSet.has(lowerWord) && !alreadyTranslated.includes(lowerWord);
      });

      if (containsTarget) {
        textNodes.push(node);
      }
    }

    // 如果没有找到未翻译的文本节点，说明单词可能已经被翻译了
    if (textNodes.length === 0) {
      return 0;
    }

    // 构造包含目标单词的文本段落用于处理
    const segments = [];
    for (const textNode of textNodes) {
      // 获取更大的上下文（父元素的文本内容）
      const container = textNode.parentElement;
      if (!container) continue;
      
      // 获取容器的完整文本内容（包括已翻译的部分）
      const containerText = getTextContent(container);
      
      // 如果容器文本太短，尝试获取更大的上下文
      let contextText = containerText;
      if (contextText.length < 30) {
        const grandParent = container.parentElement;
        if (grandParent) {
          contextText = getTextContent(grandParent);
        }
      }

      if (contextText.length >= 10) {
        const path = getElementPath(container);
        const fingerprint = generateFingerprint(contextText, path);
        
        // 检查是否已经处理过这个段落
        const isProcessed = container.hasAttribute('data-vocabmeld-processed') || 
                           container.closest('[data-vocabmeld-processed]');
        
        segments.push({
          element: container,
          text: contextText,
          fingerprint: fingerprint,
          isProcessed: !!isProcessed
        });
      }
    }

    // 去重
    const uniqueSegments = segments.filter((segment, index, self) =>
      index === self.findIndex(s => s.fingerprint === segment.fingerprint)
    );

    // 获取目标单词的翻译
    const translations = await translateSpecificWords(targetWords);

    if (translations.length === 0) {
      return 0;
    }

    // 应用到每个段落
    for (const segment of uniqueSegments) {
      // 为每个翻译添加位置信息（基于当前段落的文本）
      const replacements = translations.map(translation => {
        const position = segment.text.toLowerCase().indexOf(translation.original.toLowerCase());
        return {
          original: translation.original,
          translation: translation.translation,
          phonetic: translation.phonetic,
          difficulty: translation.difficulty,
          position: position >= 0 ? position : 0
        };
      }).filter(r => r.position >= 0 || segment.text.toLowerCase().includes(r.original.toLowerCase()));

      if (replacements.length === 0) continue;

      const count = applyReplacements(segment.element, replacements);
      processed += count;
      
      // 后台预加载词典数据
      const wordsToFetch = replacements.map(r => r.original).concat(replacements.map(r => r.translation));
      prefetchDictionaryData(wordsToFetch);
    }

    return processed;
  }

  // ============ 页面处理 ============
  const MAX_SEGMENTS_PER_REQUEST = 5; // 每个API请求处理的最大段落数
  const REQUEST_INTERVAL_MS = 1000; // API请求间隔（毫秒），避免触发速率限制

  // 使用 IntersectionObserver 实现懒加载
  function setupIntersectionObserver() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }

    intersectionObserver = new IntersectionObserver((entries) => {
      // 检查站点规则
      if (!config?.enabled || !shouldProcessSite()) return;
      
      let hasNewVisible = false;
      
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const container = entry.target;
          // 跳过已处理的容器
          if (container.hasAttribute('data-vocabmeld-processed')) {
            continue;
          }
          
          // 添加到待处理队列（即使已有 observing 标记，因为可能之前处理时被跳过了）
          if (!pendingContainers.has(container)) {
            pendingContainers.add(container);
            container.setAttribute('data-vocabmeld-observing', 'true');
            hasNewVisible = true;
          }
        }
      }

      // 有新可见容器时，触发处理
      if (hasNewVisible && !isProcessing) {
        processPendingContainers();
      }
    }, {
      rootMargin: '500px 0px', // 提前 500px 开始加载
      threshold: 0
    });
  }

  // 处理待处理的可见容器
  const processPendingContainers = debounce(async () => {
    if (isProcessing || pendingContainers.size === 0) return;
    
    isProcessing = true;
    
    try {
      const containers = Array.from(pendingContainers).slice(0, MAX_SEGMENTS_PER_BATCH);
      // 只移除本次要处理的容器，保留后续添加的
      for (const container of containers) {
        pendingContainers.delete(container);
      }
      
      // 收集需要处理的段落
      const segments = [];
      const whitelistWords = new Set((config.learnedWords || []).map(w => w.original.toLowerCase()));
      
      for (const container of containers) {
        // 移除观察标记
        container.removeAttribute('data-vocabmeld-observing');
        
        if (container.hasAttribute('data-vocabmeld-processed')) continue;
        
        const text = getTextContent(container);
        if (!text || text.length < 50) continue;
        if (isCodeText(text)) continue;
        
        const path = getElementPath(container);
        const fingerprint = generateFingerprint(text, path);
        if (processedFingerprints.has(fingerprint)) continue;
        
        // 过滤白名单词汇
        let filteredText = text;
        for (const word of whitelistWords) {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          filteredText = filteredText.replace(regex, '');
        }
        
        if (filteredText.trim().length >= 30) {
          segments.push({ element: container, text: text.slice(0, 2000), filteredText, fingerprint, path });
        }
      }

      // 合并多个段落为一个请求，减少API调用次数
      for (let i = 0; i < segments.length; i += MAX_SEGMENTS_PER_REQUEST) {
        const batch = segments.slice(i, i + MAX_SEGMENTS_PER_REQUEST);
        await processBatchSegments(batch, whitelistWords);
        
        // 添加请求间隔，避免触发API速率限制
        if (i + MAX_SEGMENTS_PER_REQUEST < segments.length) {
          await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL_MS));
        }
      }
    } finally {
      isProcessing = false;
      
      // 如果还有待处理的容器，继续处理
      if (pendingContainers.size > 0) {
        processPendingContainers();
      }
    }
  }, 100);

  // 批量处理多个段落（合并为一个API请求）
  async function processBatchSegments(segments, whitelistWords) {
    if (segments.length === 0) return;
    
    // 合并所有段落的文本，用分隔符隔开
    const combinedText = segments.map(s => s.filteredText).join('\n\n---\n\n');
    
    try {
      const result = await translateText(combinedText);
      
      // 将翻译结果分配给各个段落
      const allReplacements = [...(result.immediate || [])];
      
      // 为每个段落应用匹配的翻译结果
      for (const segment of segments) {
        const segmentText = segment.text.toLowerCase();
        const matchingReplacements = allReplacements.filter(r => 
          segmentText.includes(r.original.toLowerCase()) &&
          !whitelistWords.has(r.original.toLowerCase())
        );
        
        if (matchingReplacements.length > 0) {
          applyReplacements(segment.element, matchingReplacements);
          processedFingerprints.add(segment.fingerprint);
          // 后台预加载词典数据
          const wordsToFetch = matchingReplacements.map(r => r.original).concat(matchingReplacements.map(r => r.translation));
          prefetchDictionaryData(wordsToFetch);
        }
      }
      
      // 处理异步结果
      if (result.async) {
        result.async.then(asyncReplacements => {
          if (asyncReplacements?.length) {
            for (const segment of segments) {
              const segmentText = segment.text.toLowerCase();
              const alreadyReplaced = new Set();
              segment.element.querySelectorAll('.vocabmeld-translated').forEach(el => {
                const original = el.getAttribute('data-original');
                if (original) alreadyReplaced.add(original.toLowerCase());
              });
              
              const matchingReplacements = asyncReplacements.filter(r => 
                segmentText.includes(r.original.toLowerCase()) &&
                !whitelistWords.has(r.original.toLowerCase()) &&
                !alreadyReplaced.has(r.original.toLowerCase())
              );
              
              if (matchingReplacements.length > 0) {
                applyReplacements(segment.element, matchingReplacements);
                // 后台预加载词典数据
                const wordsToFetch = matchingReplacements.map(r => r.original).concat(matchingReplacements.map(r => r.translation));
                prefetchDictionaryData(wordsToFetch);
              }
            }
          }
        }).catch(error => {
          console.error('[VocabMeld] Async translation error:', error);
        });
      }
    } catch (e) {
      console.error('[VocabMeld] Batch processing error:', e);
    }
  }

  // 检查元素是否在视口内
  function isInViewport(element, margin = 500) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    return rect.bottom >= -margin && rect.top <= viewportHeight + margin;
  }

  // 检查站点是否应该被处理
  function shouldProcessSite() {
    const hostname = window.location.hostname;
    if (config.siteMode === 'all') {
      // 所有网站模式：检查是否在排除列表中
      if (config.excludedSites?.some(domain => hostname.includes(domain))) {
        return false;
      }
    } else {
      // 仅指定网站模式：检查是否在允许列表中
      if (!config.allowedSites?.some(domain => hostname.includes(domain))) {
        return false;
      }
    }
    return true;
  }

  // 观察页面中的文本容器
  function observeTextContainers() {
    if (!intersectionObserver) return;
    if (!config?.enabled) return;
    
    // 检查站点规则
    if (!shouldProcessSite()) return;
    
    const containers = findTextContainers(document.body);
    let hasVisibleUnprocessed = false;
    
    for (const container of containers) {
      // 跳过已处理的容器
      if (container.hasAttribute('data-vocabmeld-processed')) {
        continue;
      }
      
      // 检查是否在视口内且未被处理
      if (isInViewport(container)) {
        // 已经在视口内的容器，直接添加到待处理队列
        if (!container.hasAttribute('data-vocabmeld-observing')) {
          pendingContainers.add(container);
          container.setAttribute('data-vocabmeld-observing', 'true');
          hasVisibleUnprocessed = true;
        }
      }
      
      // 观察所有未处理的容器（用于后续滚动）
      intersectionObserver.observe(container);
    }
    
    // 如果有可见但未处理的容器，立即触发处理
    if (hasVisibleUnprocessed && !isProcessing) {
      processPendingContainers();
    }
  }

  async function processPage(viewportOnly = true) {
    if (!config?.enabled) return { processed: 0, disabled: true };

    // 检查站点规则
    const hostname = window.location.hostname;
    if (config.siteMode === 'all') {
      if (config.excludedSites?.some(domain => hostname.includes(domain))) {
        return { processed: 0, excluded: true };
      }
    } else {
      if (!config.allowedSites?.some(domain => hostname.includes(domain))) {
        return { processed: 0, excluded: true };
      }
    }

    // 确保缓存已加载
    if (wordCache.size === 0) {
      await loadWordCache();
    }

    // 处理记忆列表中的单词
    const memorizeWords = (config.memorizeList || []).map(w => w.word).filter(w => w && w.trim());
    if (memorizeWords.length > 0) {
      processSpecificWords(memorizeWords).catch(console.error);
    }

    // 使用 IntersectionObserver 懒加载
    observeTextContainers();

    return { processed: 0, lazy: true };
  }

  // ============ UI 组件 ============
  function createTooltip() {
    if (tooltip) return;
    
    tooltip = document.createElement('div');
    tooltip.className = 'vocabmeld-tooltip';
    tooltip.setAttribute('data-theme', config?.theme || 'dark');
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }

  // 词典缓存
  const dictCache = new Map();
  const DICT_CACHE_STORAGE_KEY = 'vocabmeld_dict_cache';
  const DICT_CACHE_MAX_SIZE = 500;
  let persistentDictCache = null;
  let dictCacheInitPromise = null;
  let dictPersistTimer = null;

  // 初始化持久化词典缓存
  async function ensureDictCacheLoaded() {
    if (persistentDictCache) return;
    if (dictCacheInitPromise) return dictCacheInitPromise;
    
    dictCacheInitPromise = new Promise((resolve) => {
      chrome.storage.local.get(DICT_CACHE_STORAGE_KEY, (result) => {
        const raw = result?.[DICT_CACHE_STORAGE_KEY];
        persistentDictCache = new Map();
        
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item?.key) {
              persistentDictCache.set(item.key, item.value ?? null);
            }
          }
        }
        
        // 限制大小
        while (persistentDictCache.size > DICT_CACHE_MAX_SIZE) {
          const firstKey = persistentDictCache.keys().next().value;
          persistentDictCache.delete(firstKey);
        }
        
        resolve();
      });
    });
    
    return dictCacheInitPromise;
  }

  // 延迟保存持久化缓存
  function scheduleDictCachePersist() {
    if (dictPersistTimer) clearTimeout(dictPersistTimer);
    dictPersistTimer = setTimeout(() => {
      dictPersistTimer = null;
      if (!persistentDictCache) return;
      
      const data = [];
      for (const [key, value] of persistentDictCache) {
        data.push({ key, value });
      }
      chrome.storage.local.set({ [DICT_CACHE_STORAGE_KEY]: data });
    }, 500);
  }

  // 获取持久化缓存
  async function getDictCacheValue(cacheKey) {
    await ensureDictCacheLoaded();
    if (!persistentDictCache?.has(cacheKey)) return undefined;
    
    const value = persistentDictCache.get(cacheKey);
    // LRU: 移动到末尾
    persistentDictCache.delete(cacheKey);
    persistentDictCache.set(cacheKey, value);
    return value;
  }

  // 设置持久化缓存
  async function setDictCacheValue(cacheKey, value) {
    await ensureDictCacheLoaded();
    if (!persistentDictCache) persistentDictCache = new Map();
    
    if (persistentDictCache.has(cacheKey)) persistentDictCache.delete(cacheKey);
    while (persistentDictCache.size >= DICT_CACHE_MAX_SIZE) {
      const firstKey = persistentDictCache.keys().next().value;
      persistentDictCache.delete(firstKey);
    }
    persistentDictCache.set(cacheKey, value ?? null);
    scheduleDictCachePersist();
  }

  // 从有道词典获取中英释义
  async function fetchYoudaoData(word) {
    try {
      const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}&doctype=json`;
      
      // 通过 background script 代理请求（避免 CORS）
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchProxy', url }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!res?.success) {
            reject(new Error(res?.error || 'Fetch failed'));
          } else {
            resolve(res.data);
          }
        });
      });
      
      const ecData = response.ec?.word?.[0];
      if (!ecData) return null;
      
      // 提取音标
      const phonetic = ecData.usphone ? `/${ecData.usphone}/` : (ecData.ukphone ? `/${ecData.ukphone}/` : '');
      
      // 提取释义
      const meanings = [];
      const trs = ecData.trs || [];
      
      for (const tr of trs.slice(0, 4)) {
        const defText = tr.tr?.[0]?.l?.i?.[0] || '';
        if (defText) {
          // 解析词性和释义（格式如 "n. 度，度数"）
          const match = defText.match(/^([a-z]+\.)\s*(.+)$/i);
          if (match) {
            const pos = match[1];
            const def = match[2];
            // 合并相同词性
            const existing = meanings.find(m => m.partOfSpeech === pos);
            if (existing) {
              if (existing.definitions.length < 4) {
                existing.definitions.push(def);
              }
            } else {
              meanings.push({ partOfSpeech: pos, definitions: [def] });
            }
          } else {
            meanings.push({ partOfSpeech: '', definitions: [defText] });
          }
        }
      }
      
      if (meanings.length === 0) return null;
      
      return { word, phonetic, meanings };
    } catch (e) {
      console.error('[VocabMeld] Youdao fetch error:', e);
      return null;
    }
  }

  // 从 Wiktionary 获取英英释义
  async function fetchWiktionaryData(word) {
    try {
      const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&format=json&prop=text&origin=*`;
      
      // 通过 background script 代理请求（与中英词典保持一致）
      const data = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchProxy', url }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!res?.success) {
            reject(new Error(res?.error || 'Fetch failed'));
          } else {
            resolve(res.data);
          }
        });
      });
      
      if (data.error || !data.parse?.text?.['*']) return null;
      
      const htmlString = data.parse.text['*'];
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, 'text/html');
      const contentRoot = doc.querySelector('.mw-parser-output') || doc.body;
      
      // 找到 English 语言部分的范围（h2 id="English" 到下一个 h2）
      const allH2 = contentRoot.querySelectorAll('h2');
      let englishStart = null;
      let englishEnd = null;
      
      for (let i = 0; i < allH2.length; i++) {
        const h2 = allH2[i];
        if (h2.id === 'English' || h2.textContent.includes('English')) {
          englishStart = h2.parentNode?.classList?.contains('mw-heading') ? h2.parentNode : h2;
          // 下一个 h2 就是 English 部分的结束
          if (i + 1 < allH2.length) {
            const nextH2 = allH2[i + 1];
            englishEnd = nextH2.parentNode?.classList?.contains('mw-heading') ? nextH2.parentNode : nextH2;
          }
          break;
        }
      }
      
      if (!englishStart) return null;
      
      const phoneticEl = contentRoot.querySelector('.IPA');
      const phonetic = phoneticEl?.textContent?.trim() || '';
      
      const validPOS = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Interjection', 'Pronoun', 'Preposition', 'Conjunction'];
      const meaningsMap = new Map();
      const headers = contentRoot.querySelectorAll('h3, h4');
      
      for (const header of headers) {
        // 检查 header 是否在 English 部分内
        const headerNode = header.parentNode?.classList?.contains('mw-heading') ? header.parentNode : header;
        
        // 比较 DOM 位置：header 必须在 englishStart 之后
        if (englishStart.compareDocumentPosition(headerNode) & Node.DOCUMENT_POSITION_PRECEDING) {
          continue; // header 在 englishStart 之前，跳过
        }
        // 如果有 englishEnd，header 必须在 englishEnd 之前
        if (englishEnd && (englishEnd.compareDocumentPosition(headerNode) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          continue; // header 在 englishEnd 之后，跳过
        }
        
        const headerText = header.textContent.replace(/\[.*?\]/g, '').trim();
        const matchedPOS = validPOS.find(pos => headerText.includes(pos));
        if (!matchedPOS) continue;
        
        let currentNode = header.parentNode?.classList?.contains('mw-heading') 
          ? header.parentNode : header;
        let definitionList = null;
        
        while (currentNode?.nextElementSibling) {
          currentNode = currentNode.nextElementSibling;
          if (currentNode.tagName === 'OL') {
            definitionList = currentNode;
            break;
          }
          if (['H2', 'H3', 'H4'].includes(currentNode.tagName)) break;
        }
        
        if (definitionList) {
          const listItems = definitionList.querySelectorAll(':scope > li');
          for (const li of Array.from(listItems).slice(0, 3)) {
            const cloneLi = li.cloneNode(true);
            cloneLi.querySelectorAll('.h-usage-example, .e-example, ul, dl, .reference, .citation').forEach(el => el.remove());
            const defText = cloneLi.textContent.replace(/<[^>]*>/g, '').trim().slice(0, 200);
            if (defText) {
              if (!meaningsMap.has(matchedPOS)) {
                meaningsMap.set(matchedPOS, []);
              }
              const defs = meaningsMap.get(matchedPOS);
              if (defs.length < 4) defs.push(defText);
            }
          }
        }
      }
      
      const meanings = [];
      for (const [pos, defs] of meaningsMap) {
        if (meanings.length >= 4) break;
        if (defs.length > 0) meanings.push({ partOfSpeech: pos, definitions: defs });
      }
      
      if (meanings.length === 0) return null;
      return { word, phonetic, meanings };
    } catch (e) {
      console.error('[VocabMeld] Wiktionary fetch error:', e);
      return null;
    }
  }

  // 获取词典数据（根据配置选择 API）
  async function fetchDictionaryData(word, lang = null) {
    const dictionaryType = config.dictionaryType || 'en-en';
    const cacheKey = `${word.toLowerCase()}_${dictionaryType}`;
    
    // 1. 检查内存缓存
    if (dictCache.has(cacheKey)) {
      return dictCache.get(cacheKey);
    }
    
    // 2. 检查持久化缓存
    const persistedValue = await getDictCacheValue(cacheKey);
    if (persistedValue !== undefined) {
      dictCache.set(cacheKey, persistedValue);
      return persistedValue;
    }

    try {
      let result = null;
      
      if (dictionaryType === 'zh-en') {
        // 中英释义：使用有道词典
        result = await fetchYoudaoData(word);
      } else {
        // 英英释义：使用 Wiktionary
        result = await fetchWiktionaryData(word);
      }
      
      dictCache.set(cacheKey, result);
      await setDictCacheValue(cacheKey, result);
      return result;
    } catch (e) {
      console.error('[VocabMeld] Dictionary fetch error:', e);
      dictCache.set(cacheKey, null);
      setDictCacheValue(cacheKey, null);
      return null;
    }
  }

  // 预加载词典数据（替换完成后后台调用）
  function prefetchDictionaryData(words) {
    const targetLang = config.targetLanguage || 'en';
    const dictionaryType = config.dictionaryType || 'en-en';
    
    for (const word of words) {
      const wordLang = detectLanguage(word);
      // 只预加载英文单词（词典主要支持英文）
      if (wordLang !== 'en') continue;
      
      const cacheKey = `${word.toLowerCase()}_${dictionaryType}`;
      if (dictCache.has(cacheKey)) continue;
      
      // 后台静默加载，不阻塞
      fetchDictionaryData(word).catch(() => {});
    }
  }

  // 更新tooltip的词典内容
  function updateTooltipDictionary(dictData) {
    if (!tooltip || !dictData) return;
    
    const dictContainer = tooltip.querySelector('.vocabmeld-tooltip-dict');
    if (!dictContainer) return;
    
    let html = '';
    for (const meaning of dictData.meanings) {
      html += `<div class="vocabmeld-dict-entry">`;
      // 只有当词性非空时才显示词性标签
      if (meaning.partOfSpeech) {
        html += `<span class="vocabmeld-dict-pos">${meaning.partOfSpeech}</span>`;
      }
      html += `<ul class="vocabmeld-dict-defs">`;
      for (const def of meaning.definitions) {
        html += `<li>${def}</li>`;
      }
      html += `</ul></div>`;
    }
    
    dictContainer.innerHTML = html || '<div class="vocabmeld-dict-empty">暂无词典数据</div>';
  }

  function showTooltip(element, mouseX, mouseY) {
    if (!tooltip || !element.classList?.contains('vocabmeld-translated')) return;
    
    // 如果是同一个元素且 tooltip 已显示，不重新计算位置
    if (currentTooltipElement === element && tooltip.style.display === 'block') {
      return;
    }
    currentTooltipElement = element;

    const original = element.getAttribute('data-original');
    const translation = element.getAttribute('data-translation');
    const phonetic = element.getAttribute('data-phonetic');
    const difficulty = element.getAttribute('data-difficulty');
    
    // 检查是否已在记忆列表中
    const isInMemorizeList = (config.memorizeList || []).some(w => 
      w.word.toLowerCase() === original.toLowerCase()
    );
    
    // 判断需要查询词典的单词（目标语言）
    const targetLang = config.targetLanguage || 'en';
    const originalLang = detectLanguage(original);
    const translationLang = detectLanguage(translation);
    
    // 优先查询目标语言的单词
    const isOriginalTargetLang = (originalLang === 'en' && targetLang === 'en') ||
                                  (originalLang === 'zh' && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) ||
                                  (originalLang === 'ja' && targetLang === 'ja') ||
                                  (originalLang === 'ko' && targetLang === 'ko') ||
                                  (originalLang === 'en' && ['fr', 'de', 'es'].includes(targetLang));
    
    const isTranslationTargetLang = (translationLang === 'en' && targetLang === 'en') ||
                                     (translationLang === 'zh' && (targetLang === 'zh-CN' || targetLang === 'zh-TW')) ||
                                     (translationLang === 'ja' && targetLang === 'ja') ||
                                     (translationLang === 'ko' && targetLang === 'ko') ||
                                     (translationLang === 'en' && ['fr', 'de', 'es'].includes(targetLang));
    
    const dictWord = isOriginalTargetLang ? original : (isTranslationTargetLang ? translation : null);

    tooltip.innerHTML = `
      <div class="vocabmeld-tooltip-header">
        <span class="vocabmeld-tooltip-word">${translation}</span>
        <span class="vocabmeld-tooltip-badge" data-difficulty="${difficulty}">${difficulty}</span>
        <button class="vocabmeld-tooltip-btn vocabmeld-btn-memorize ${isInMemorizeList ? 'active' : ''}" data-original="${original}" title="${isInMemorizeList ? '已在记忆列表' : '添加到记忆列表'}">
          <svg viewBox="0 0 24 24" width="16" height="16">
            ${isInMemorizeList 
              ? '<path fill="currentColor" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z"/>'
              : '<path fill="currentColor" d="M12.1,18.55L12,18.65L11.89,18.55C7.14,14.24 4,11.39 4,8.5C4,6.5 5.5,5 7.5,5C9.04,5 10.54,6 11.07,7.36H12.93C13.46,6 14.96,5 16.5,5C18.5,5 20,6.5 20,8.5C20,11.39 16.86,14.24 12.1,18.55M16.5,3C14.76,3 13.09,3.81 12,5.08C10.91,3.81 9.24,3 7.5,3C4.42,3 2,5.41 2,8.5C2,12.27 5.4,15.36 10.55,20.03L12,21.35L13.45,20.03C18.6,15.36 22,12.27 22,8.5C22,5.41 19.58,3 16.5,3Z"/>'
            }
          </svg>
        </button>
      </div>
      ${phonetic && config.showPhonetic ? `
      <div class="vocabmeld-tooltip-phonetic vocabmeld-btn-speak" data-original="${original}" data-translation="${translation}" title="点击发音">
        <svg viewBox="0 0 24 24" width="12" height="12">
          <path fill="currentColor" d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>
        </svg>
        <span>${phonetic}</span>
      </div>
      ` : ''}
      <div class="vocabmeld-tooltip-original">原文: ${original}</div>
      <div class="vocabmeld-tooltip-dict"></div>
      <div class="vocabmeld-tooltip-actions">
        <button class="vocabmeld-tooltip-btn vocabmeld-btn-learned" data-original="${original}" data-translation="${translation}" data-difficulty="${difficulty}" title="标记已学会">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/>
          </svg>
        </button>
        <button class="vocabmeld-tooltip-btn vocabmeld-btn-retranslate" data-original="${original}" title="根据上下文重新翻译">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/>
          </svg>
        </button>
      </div>
    `;

    // 使用 caretRangeFromPoint 找到鼠标所在行的位置
    let posLeft, posTop;
    const caretRange = document.caretRangeFromPoint(mouseX, mouseY);
    if (caretRange && element.contains(caretRange.startContainer)) {
      // 获取当前位置的行高和行底部位置
      const tempRange = document.createRange();
      tempRange.setStart(caretRange.startContainer, caretRange.startOffset);
      tempRange.setEnd(caretRange.startContainer, caretRange.startOffset);
      const caretRect = tempRange.getBoundingClientRect();
      
      // 找到该行的起始位置（向左扩展到行首）
      const textNode = caretRange.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        // 遍历找到当前行的起始字符
        let lineStartOffset = 0;
        for (let i = caretRange.startOffset; i >= 0; i--) {
          tempRange.setStart(textNode, i);
          tempRange.setEnd(textNode, i + 1 > textNode.length ? textNode.length : i + 1);
          const charRect = tempRange.getBoundingClientRect();
          if (Math.abs(charRect.top - caretRect.top) > 5) {
            lineStartOffset = i + 1;
            break;
          }
          lineStartOffset = i;
        }
        tempRange.setStart(textNode, lineStartOffset);
        tempRange.setEnd(textNode, lineStartOffset + 1 > textNode.length ? textNode.length : lineStartOffset + 1);
        const lineStartRect = tempRange.getBoundingClientRect();
        posLeft = lineStartRect.left;
        posTop = caretRect.bottom;
      } else {
        posLeft = caretRect.left;
        posTop = caretRect.bottom;
      }
    } else {
      // 回退方案
      const rect = element.getBoundingClientRect();
      posLeft = rect.left;
      posTop = mouseY + 16;
    }
    
    tooltip.style.left = posLeft + window.scrollX + 'px';
    tooltip.style.top = posTop + window.scrollY + 2 + 'px';
    tooltip.style.display = 'block';
    
    // 显示词典数据（优先从缓存获取）
    const dictionaryType = config.dictionaryType || 'en-en';
    const dictContainer = tooltip.querySelector('.vocabmeld-tooltip-dict');
    if (dictContainer) {
      if (dictWord) {
        const cacheKey = `${dictWord.toLowerCase()}_${dictionaryType}`;
        const cachedData = dictCache.get(cacheKey);
        if (cachedData) {
          // 缓存命中，直接显示
          updateTooltipDictionary(cachedData);
        } else {
          // 缓存未命中，显示加载中并异步获取
          dictContainer.innerHTML = '<div class="vocabmeld-dict-loading">加载词典...</div>';
          fetchDictionaryData(dictWord).then(dictData => {
            if (tooltip.style.display !== 'none') {
              if (dictData) {
                updateTooltipDictionary(dictData);
              } else {
                dictContainer.innerHTML = '<div class="vocabmeld-dict-empty">暂无词典数据</div>';
              }
            }
          });
        }
      } else {
        // 非英文单词
        dictContainer.innerHTML = '<div class="vocabmeld-dict-empty">暂无词典数据</div>';
      }
    }
  }

  function hideTooltip(immediate = false) {
    if (immediate) {
      clearTimeout(tooltipHideTimeout);
      if (tooltip) tooltip.style.display = 'none';
      currentTooltipElement = null;
    } else {
      // 延迟隐藏，给用户时间移动到 tooltip 上
      tooltipHideTimeout = setTimeout(() => {
        if (tooltip) tooltip.style.display = 'none';
        currentTooltipElement = null;
      }, 200);
    }
  }
  
  function cancelHideTooltip() {
    clearTimeout(tooltipHideTimeout);
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'vocabmeld-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('vocabmeld-toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('vocabmeld-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function createSelectionPopup() {
    if (selectionPopup) return;
    
    selectionPopup = document.createElement('div');
    selectionPopup.className = 'vocabmeld-selection-popup';
    selectionPopup.setAttribute('data-theme', config?.theme || 'dark');
    selectionPopup.style.display = 'none';
    selectionPopup.innerHTML = '<button class="vocabmeld-add-memorize">添加到需记忆</button>';
    document.body.appendChild(selectionPopup);

    selectionPopup.querySelector('button').addEventListener('click', async () => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text && text.length < 50) {
        await addToMemorizeList(text);
        showToast(`"${text}" 已添加到需记忆列表`);
      }
      selectionPopup.style.display = 'none';
    });
  }

  // ============ 事件处理 ============
  function setupEventListeners() {
    // 悬停显示提示
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('.vocabmeld-translated');
      const tooltipTarget = e.target.closest('.vocabmeld-tooltip');
      
      if (target) {
        cancelHideTooltip();
        showTooltip(target, e.clientX, e.clientY);
      } else if (tooltipTarget) {
        // 鼠标移入 tooltip 时取消隐藏
        cancelHideTooltip();
      }
    });

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest('.vocabmeld-translated');
      const tooltipTarget = e.target.closest('.vocabmeld-tooltip');
      const relatedTarget = e.relatedTarget;
      
      // 从翻译元素移出时，延迟隐藏
      if (target && 
          !relatedTarget?.closest('.vocabmeld-translated') && 
          !relatedTarget?.closest('.vocabmeld-tooltip')) {
        hideTooltip();
      }
      
      // 从 tooltip 移出时，延迟隐藏
      if (tooltipTarget && 
          !relatedTarget?.closest('.vocabmeld-tooltip') &&
          !relatedTarget?.closest('.vocabmeld-translated')) {
        hideTooltip();
      }
    });

    // tooltip 按钮点击事件
    document.addEventListener('click', (e) => {
      // 发音按钮
      const speakBtn = e.target.closest('.vocabmeld-btn-speak');
      if (speakBtn) {
        e.preventDefault();
        e.stopPropagation();
        const original = speakBtn.getAttribute('data-original');
        const translation = speakBtn.getAttribute('data-translation');
        
        // 检测 original 是否是目标语言
        const originalLang = detectLanguage(original);
        const isOriginalTargetLang = (originalLang === 'en' && config.targetLanguage === 'en') ||
                                     (originalLang === 'zh' && (config.targetLanguage === 'zh-CN' || config.targetLanguage === 'zh-TW')) ||
                                     (originalLang === 'ja' && config.targetLanguage === 'ja') ||
                                     (originalLang === 'ko' && config.targetLanguage === 'ko');
        
        const word = isOriginalTargetLang ? original : translation;
        const lang = config.targetLanguage === 'en' ? 'en-US' : 
                     config.targetLanguage === 'zh-CN' ? 'zh-CN' :
                     config.targetLanguage === 'zh-TW' ? 'zh-TW' :
                     config.targetLanguage === 'ja' ? 'ja-JP' :
                     config.targetLanguage === 'ko' ? 'ko-KR' : 'en-US';
        
        chrome.runtime.sendMessage({ action: 'speak', text: word, lang });
        return;
      }
      
      // 收藏/记忆按钮
      const memorizeBtn = e.target.closest('.vocabmeld-btn-memorize');
      if (memorizeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const original = memorizeBtn.getAttribute('data-original');
        const isActive = memorizeBtn.classList.contains('active');
        
        if (!isActive) {
          addToMemorizeList(original);
          memorizeBtn.classList.add('active');
          memorizeBtn.title = '已在记忆列表';
          // 更新图标为实心
          memorizeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z"/>
            </svg>
          `;
        } else {
          removeFromMemorizeList(original);
          memorizeBtn.classList.remove('active');
          memorizeBtn.title = '添加到记忆';
          // 更新图标为镂空
          memorizeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M12.1,18.55L12,18.65L11.89,18.55C7.14,14.24 4,11.39 4,8.5C4,6.5 5.5,5 7.5,5C9.04,5 10.54,6 11.07,7.36H12.93C13.46,6 14.96,5 16.5,5C18.5,5 20,6.5 20,8.5C20,11.39 16.86,14.24 12.1,18.55M16.5,3C14.76,3 13.09,3.81 12,5.08C10.91,3.81 9.24,3 7.5,3C4.42,3 2,5.41 2,8.5C2,12.27 5.4,15.36 10.55,20.03L12,21.35L13.45,20.03C18.6,15.36 22,12.27 22,8.5C22,5.41 19.58,3 16.5,3Z"/>
            </svg>
          `;
        }
        return;
      }
      
      // 已学会按钮
      const learnedBtn = e.target.closest('.vocabmeld-btn-learned');
      if (learnedBtn) {
        e.preventDefault();
        e.stopPropagation();
        const original = learnedBtn.getAttribute('data-original');
        const translation = learnedBtn.getAttribute('data-translation');
        const difficulty = learnedBtn.getAttribute('data-difficulty') || 'B1';
        
        addToWhitelist(original, translation, difficulty);
        restoreAllSameWord(original);
        hideTooltip();
        showToast(`"${original}" 已标记为已学会`);
        return;
      }
      
      // 重新翻译按钮
      const retranslateBtn = e.target.closest('.vocabmeld-btn-retranslate');
      if (retranslateBtn) {
        e.preventDefault();
        e.stopPropagation();
        const original = retranslateBtn.getAttribute('data-original');
        retranslateWithContext(original);
        return;
      }
    });

    // 选择文本显示添加按钮
    document.addEventListener('mouseup', (e) => {
      if (e.target.closest('.vocabmeld-selection-popup')) return;
      
      // 如果关闭了选中添加功能，直接隐藏弹窗
      if (!config?.showAddMemorize) {
        if (selectionPopup) selectionPopup.style.display = 'none';
        return;
      }
      
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        
        if (text && text.length > 1 && text.length < 50 && !e.target.closest('.vocabmeld-translated')) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          selectionPopup.style.left = rect.left + window.scrollX + 'px';
          selectionPopup.style.top = rect.bottom + window.scrollY + 5 + 'px';
          selectionPopup.style.display = 'block';
        } else {
          selectionPopup.style.display = 'none';
        }
      }, 10);
    });

    // 滚动处理（懒加载）- 使用 IntersectionObserver 时，滚动时重新观察新容器
    const handleScroll = debounce(() => {
      if (config?.autoProcess && config?.enabled) {
        observeTextContainers();
      }
    }, 300);
    window.addEventListener('scroll', handleScroll, { passive: true });

    // 监听 DOM 变化，观察新增的文本容器
    const mutationObserver = new MutationObserver(debounce(() => {
      if (config?.autoProcess && config?.enabled) {
        observeTextContainers();
      }
    }, 500));
    
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 监听配置变化
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync') {
        loadConfig().then(() => {
          if (changes.enabled?.newValue === false) {
            restoreAll();
          }
          // 主题变化时更新 UI
          if (changes.theme) {
            updateUITheme();
          }
          // 难度、强度、样式或处理模式变化时，需要重新处理页面
          if (changes.difficultyLevel || changes.intensity || changes.translationStyle || changes.processMode) {
            restoreAll(); // 先恢复页面（会清除 processedFingerprints）
            if (config.enabled) {
              processPage(); // 重新处理
            }
          }
          // 记忆列表变化时，处理新添加的单词
          if (changes.memorizeList) {
            const oldList = changes.memorizeList.oldValue || [];
            const newList = changes.memorizeList.newValue || [];
            // 找出新添加的单词
            const oldWords = new Set(oldList.map(w => w.word.toLowerCase()));
            const newWords = newList
              .filter(w => !oldWords.has(w.word.toLowerCase()))
              .map(w => w.word);
            
              if (newWords.length > 0 && config.enabled) {
                // 延迟处理，确保DOM已更新
                setTimeout(() => {
                  processSpecificWords(newWords);
                }, 200);
              }
          }
        });
      }
    });

    // 监听来自 popup 或 background 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'processPage') {
        processPage().then(sendResponse);
        return true;
      }
      if (message.action === 'restorePage') {
        restoreAll();
        sendResponse({ success: true });
      }
      if (message.action === 'processSpecificWords') {
        const words = message.words || [];
        if (words.length > 0) {
          processSpecificWords(words).then(count => {
            sendResponse({ success: true, count });
          }).catch(error => {
            console.error('[VocabMeld] Error processing specific words:', error);
            sendResponse({ success: false, error: error.message });
          });
          return true; // 保持消息通道开放以支持异步响应
        } else {
          sendResponse({ success: false, error: 'No words provided' });
        }
      }
      if (message.action === 'getStatus') {
        sendResponse({
          processed: processedFingerprints.size,
          isProcessing,
          enabled: config?.enabled
        });
      }
    });
  }

  // ============ 初始化 ============
  async function init() {
    await loadConfig();
    await loadWordCache();

    
    createTooltip();
    createSelectionPopup();
    
    // 初始化 IntersectionObserver
    setupIntersectionObserver();
    
    setupEventListeners();

    // 自动处理 - 使用 IntersectionObserver 懒加载
    if (config.autoProcess && config.enabled && (config.hasApiNodes || config.apiEndpoint)) {
      // 延迟启动，等待页面渲染完成
      setTimeout(() => {
        // 先处理记忆列表中的单词
        const memorizeWords = (config.memorizeList || []).map(w => w.word).filter(w => w && w.trim());
        if (memorizeWords.length > 0) {
          processSpecificWords(memorizeWords).catch(console.error);
        }
        // 开始观察文本容器
        observeTextContainers();
      }, 500);
    }
    
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
