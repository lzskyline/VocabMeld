/**
 * VocabMeld Options 脚本 - 自动保存版本
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 默认 API 配置
  const DEFAULT_API_CONFIGS = {
    'OpenAI': { endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-4o-mini' },
    'DeepSeek': { endpoint: 'https://api.deepseek.com/chat/completions', apiKey: '', model: 'deepseek-chat' },
    'Moonshot': { endpoint: 'https://api.moonshot.cn/v1/chat/completions', apiKey: '', model: 'moonshot-v1-8k' },
    'Groq': { endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey: '', model: 'llama-3.1-8b-instant' },
    'Ollama': { endpoint: 'http://localhost:11434/v1/chat/completions', apiKey: '', model: 'qwen2.5:7b' }
  };

  // 当前配置状态
  let apiConfigs = {};
  let currentConfigName = '';

  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  function normalizeDifficultyRange(range, fallbackMin = 'B1') {
    const ensureLevel = (level, defaultLevel) => CEFR_LEVELS.includes(level) ? level : defaultLevel;
    const normalizedRange = (range && typeof range === 'object') ? range : {};
    const minLevel = ensureLevel(normalizedRange.min, ensureLevel(fallbackMin, 'B1'));
    const maxLevel = ensureLevel(normalizedRange.max, 'C2');
    let minIndex = CEFR_LEVELS.indexOf(minLevel);
    let maxIndex = CEFR_LEVELS.indexOf(maxLevel);
    if (minIndex < 0) minIndex = 0;
    if (maxIndex < 0) maxIndex = CEFR_LEVELS.length - 1;
    if (maxIndex < minIndex) {
      maxIndex = minIndex;
    }
    return {
      minLevel: CEFR_LEVELS[minIndex],
      maxLevel: CEFR_LEVELS[maxIndex],
      minIndex,
      maxIndex
    };
  }

  // 防抖保存函数
  let saveTimeout;
  function debouncedSave(delay = 500) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, delay);
  }

  // DOM 元素
  const elements = {
    // 导航
    navItems: document.querySelectorAll('.nav-item'),
    sections: document.querySelectorAll('.settings-section'),

    // API 配置
    apiConfigSelect: document.getElementById('apiConfigSelect'),
    newConfigBtn: document.getElementById('newConfigBtn'),
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    deleteConfigBtn: document.getElementById('deleteConfigBtn'),
    configName: document.getElementById('configName'),
    apiEndpoint: document.getElementById('apiEndpoint'),
    apiKey: document.getElementById('apiKey'),
    modelName: document.getElementById('modelName'),
    toggleApiKey: document.getElementById('toggleApiKey'),
    testConnectionBtn: document.getElementById('testConnectionBtn'),
    testResult: document.getElementById('testResult'),

    // 学习偏好
    nativeLanguage: document.getElementById('nativeLanguage'),
    targetLanguage: document.getElementById('targetLanguage'),
    difficultyRangeMin: document.getElementById('difficultyMin'),
    difficultyRangeMax: document.getElementById('difficultyMax'),
    difficultyRangeProgress: document.getElementById('difficultyRangeProgress'),
    selectedDifficulty: document.getElementById('selectedDifficulty'),
    difficultyPresetButtons: document.querySelectorAll('.difficulty-preset'),
    intensityRadios: document.querySelectorAll('input[name="intensity"]'),
    processModeRadios: document.querySelectorAll('input[name="processMode"]'),

    // 行为设置
    autoProcess: document.getElementById('autoProcess'),
    showPhonetic: document.getElementById('showPhonetic'),
    dictionaryTypeRadios: document.querySelectorAll('input[name="dictionaryType"]'),
    showAddMemorize: document.getElementById('showAddMemorize'),
    cacheMaxSizeRadios: document.querySelectorAll('input[name="cacheMaxSize"]'),
    translationStyleRadios: document.querySelectorAll('input[name="translationStyle"]'),
    themeRadios: document.querySelectorAll('input[name="theme"]'),
    
    // 主题样式
    colorThemeRadios: document.querySelectorAll('input[name="colorTheme"]'),
    previewWord: document.getElementById('previewWord'),
    previewTooltip: document.getElementById('previewTooltip'),
    importThemeBtn: document.getElementById('importThemeBtn'),
    exportThemeBtn: document.getElementById('exportThemeBtn'),
    themeEditorSidebar: document.getElementById('themeEditorSidebar'),
    themeEditorPanel: document.getElementById('themeEditorPanel'),
    themeEditorTitle: document.getElementById('themeEditorTitle'),
    themeEditorForm: document.getElementById('themeEditorForm'),
    themeNameInput: document.getElementById('themeNameInput'),
    primaryColor: document.getElementById('primaryColor'),
    underlineColor: document.getElementById('underlineColor'),
    underlineWidth: document.getElementById('underlineWidth'),
    underlineStyle: document.getElementById('underlineStyle'),
    hoverBgColor: document.getElementById('hoverBgColor'),
    wordColorEnabled: document.getElementById('wordColorEnabled'),
    wordColor: document.getElementById('wordColor'),
    originalColorEnabled: document.getElementById('originalColorEnabled'),
    originalColor: document.getElementById('originalColor'),
    tooltipWordColor: document.getElementById('tooltipWordColor'),
    cardBgColor: document.getElementById('cardBgColor'),
    cardBgLightColor: document.getElementById('cardBgLightColor'),
    saveThemeBtn: document.getElementById('saveThemeBtn'),
    ttsVoice: document.getElementById('ttsVoice'),
    ttsRate: document.getElementById('ttsRate'),
    ttsRateValue: document.getElementById('ttsRateValue'),
    testVoiceBtn: document.getElementById('testVoiceBtn'),

    // 站点规则
    siteModeRadios: document.querySelectorAll('input[name="siteMode"]'),
    excludedSitesGroup: document.getElementById('excludedSitesGroup'),
    excludedSitesInput: document.getElementById('excludedSitesInput'),
    allowedSitesGroup: document.getElementById('allowedSitesGroup'),
    allowedSitesInput: document.getElementById('allowedSitesInput'),

    // 词汇管理
    wordTabs: document.querySelectorAll('.word-tab'),
    learnedList: document.getElementById('learnedList'),
    memorizeList: document.getElementById('memorizeList'),
    cachedList: document.getElementById('cachedList'),
    clearLearnedBtn: document.getElementById('clearLearnedBtn'),
    clearMemorizeBtn: document.getElementById('clearMemorizeBtn'),
    clearCacheBtn: document.getElementById('clearCacheBtn'),
    learnedFilters: document.getElementById('learnedFilters'),
    memorizeFilters: document.getElementById('memorizeFilters'),
    cachedFilters: document.getElementById('cachedFilters'),
    learnedSearchInput: document.getElementById('learnedSearchInput'),
    memorizeSearchInput: document.getElementById('memorizeSearchInput'),
    cachedSearchInput: document.getElementById('cachedSearchInput'),
    difficultyFilterBtns: document.querySelectorAll('.difficulty-filter-btn'),

    // 统计
    statTotalWords: document.getElementById('statTotalWords'),
    statTodayWords: document.getElementById('statTodayWords'),
    statLearnedWords: document.getElementById('statLearnedWords'),
    statMemorizeWords: document.getElementById('statMemorizeWords'),
    statCacheSize: document.getElementById('statCacheSize'),
    statHitRate: document.getElementById('statHitRate'),
    cacheProgress: document.getElementById('cacheProgress'),
    resetTodayBtn: document.getElementById('resetTodayBtn'),
    resetAllBtn: document.getElementById('resetAllBtn'),
    
    // 导入导出
    exportDataBtn: document.getElementById('exportDataBtn'),
    importDataBtn: document.getElementById('importDataBtn'),
    importFileInput: document.getElementById('importFileInput'),
    exportSettings: document.getElementById('exportSettings'),
    exportWords: document.getElementById('exportWords'),
    exportStats: document.getElementById('exportStats'),
    exportCache: document.getElementById('exportCache')
  };

  // ============ 内置主题配置 ============
  // 内置主题配置 - 与 content.js 保持一致
  const BUILT_IN_THEMES = {
    default: {
      name: '默认紫',
      primary: '#6366f1',
      underline: 'rgba(99,102,241,0.6)',
      hoverBg: 'rgba(99,102,241,0.15)',
      tooltipWord: '#818cf8',
      underlineWidth: '1.5px',
      underlineStyle: 'solid',
      wordColor: '',
      originalColor: ''
    },
    ocean: {
      name: '海洋蓝',
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
      name: '森林绿',
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
      name: '日落橙',
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

  let customTheme = null;

  // 颜色选择器变化更新显示
  function updateColorValues() {
    if (elements.primaryColor) {
      document.getElementById('primaryColorValue').textContent = elements.primaryColor.value;
    }
    if (elements.underlineColor) {
      document.getElementById('underlineColorValue').textContent = elements.underlineColor.value;
    }
    if (elements.hoverBgColor) {
      document.getElementById('hoverBgColorValue').textContent = elements.hoverBgColor.value;
    }
    if (elements.tooltipWordColor) {
      document.getElementById('tooltipWordColorValue').textContent = elements.tooltipWordColor.value;
    }
    if (elements.cardBgColor) {
      document.getElementById('cardBgColorValue').textContent = elements.cardBgColor.value;
    }
    if (elements.cardBgLightColor) {
      document.getElementById('cardBgLightColorValue').textContent = elements.cardBgLightColor.value;
    }
    if (elements.wordColor) {
      document.getElementById('wordColorValue').textContent = 
        elements.wordColorEnabled?.checked ? elements.wordColor.value : '保持原样';
    }
    if (elements.originalColor) {
      document.getElementById('originalColorValue').textContent = 
        elements.originalColorEnabled?.checked ? elements.originalColor.value : '保持原样';
    }
  }

  // 更新编辑器状态的函数
  function updateThemeEditorState(themeId) {
    const isDefault = themeId === 'default';
    const theme = BUILT_IN_THEMES[themeId] || BUILT_IN_THEMES.default;
    
    // 更新标题
    elements.themeEditorTitle.textContent = theme.name || '主题编辑器';
    
    // 填充表单值
    elements.themeNameInput.value = theme.name || '';
    elements.primaryColor.value = theme.primary || '#6366f1';
    elements.underlineColor.value = theme.underline ? rgbaToHex(theme.underline) : '#6366f1';
    elements.underlineWidth.value = theme.underlineWidth || '2px';
    elements.underlineStyle.value = theme.underlineStyle || 'solid';
    elements.hoverBgColor.value = theme.hoverBg ? rgbaToHex(theme.hoverBg) : '#6366f1';
    elements.tooltipWordColor.value = theme.tooltipWord || '#818cf8';
    elements.cardBgColor.value = theme.cardBg || '#1e293b';
    elements.cardBgLightColor.value = theme.cardBgLight || '#ffffff';
    
    // 译文/原文颜色
    const hasWordColor = theme.wordColor && theme.wordColor !== 'inherit';
    const hasOriginalColor = theme.originalColor && theme.originalColor !== 'inherit';
    elements.wordColorEnabled.checked = hasWordColor;
    elements.wordColor.value = hasWordColor ? theme.wordColor : '#000000';
    elements.originalColorEnabled.checked = hasOriginalColor;
    elements.originalColor.value = hasOriginalColor ? theme.originalColor : '#000000';
    
    // 默认紫不可编辑，其他主题可以编辑
    const formInputs = elements.themeEditorForm.querySelectorAll('input, select, button');
    formInputs.forEach(input => {
      if (input.id === 'wordColor') {
        input.disabled = isDefault || !elements.wordColorEnabled.checked;
      } else if (input.id === 'originalColor') {
        input.disabled = isDefault || !elements.originalColorEnabled.checked;
      } else {
        input.disabled = isDefault;
      }
    });
    
    // 添加/移除禁用样式
    elements.themeEditorForm.classList.toggle('disabled', isDefault);
    
    updateColorValues();
  }
  
  // rgba 转 hex 的辅助函数
  function rgbaToHex(rgba) {
    if (!rgba || rgba.startsWith('#')) return rgba;
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return rgba;
  }

  // 更新预览颜色和页面主色调
  function updatePreviewColors(theme) {
    const root = document.documentElement;
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    
    // 更新预览相关的 CSS 变量
    root.style.setProperty('--preview-primary', theme.primary);
    root.style.setProperty('--preview-underline', theme.underline);
    root.style.setProperty('--preview-bg', theme.hoverBg);
    root.style.setProperty('--preview-underline-width', theme.underlineWidth || '2px');
    root.style.setProperty('--preview-underline-style', theme.underlineStyle || 'solid');
    
    // 计算渐变的第二个颜色（稍微偏紫/深一点）
    const gradientEnd = theme.primary.replace('#', '');
    const r = Math.max(0, parseInt(gradientEnd.substr(0, 2), 16) - 20);
    const g = Math.max(0, parseInt(gradientEnd.substr(2, 2), 16) - 30);
    const b = Math.min(255, parseInt(gradientEnd.substr(4, 2), 16) + 20);
    const secondColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    
    // 亮色主题下使用 primary 颜色，暗色主题下使用 tooltipWord（浅色版本）
    if (currentTheme === 'light') {
      root.style.setProperty('--preview-tooltip-word', theme.primary);
    } else {
      root.style.setProperty('--preview-tooltip-word', theme.tooltipWord);
    }
    
    // 更新预览卡片背景色（如果有自定义设置）
    if (theme.cardBg) {
      root.style.setProperty('--preview-card-bg', theme.cardBg);
    }
    if (theme.cardBgLight) {
      root.style.setProperty('--preview-card-bg-light', theme.cardBgLight);
    }
    
    // 更新页面主色调（按钮、边框等）
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--primary-light', theme.tooltipWord);
    root.style.setProperty('--primary-dark', secondColor);
  }

  // 生成主题 CSS
  function generateThemeCss(theme) {
    return `/* VocabMeld 主题: ${theme.name || '自定义'} */
:root {
  --vocabmeld-primary: ${theme.primary};
  --vocabmeld-underline: ${theme.underline};
  --vocabmeld-underline-width: ${theme.underlineWidth || '2px'};
  --vocabmeld-underline-style: ${theme.underlineStyle || 'solid'};
  --vocabmeld-hover-bg: ${theme.hoverBg};
  --vocabmeld-word-color: ${theme.wordColor || ''};
  --vocabmeld-original-color: ${theme.originalColor || ''};
  --vocabmeld-tooltip-word: ${theme.tooltipWord};
  --vocabmeld-card-bg: ${theme.cardBg || '#1e293b'};
  --vocabmeld-card-bg-light: ${theme.cardBgLight || '#ffffff'};
}`;
  }

  // 解析主题 CSS
  function parseThemeCss(css) {
    try {
      const nameMatch = css.match(/主题:\s*([^\*\/\n]+)/);
      const primaryMatch = css.match(/--vocabmeld-primary:\s*([^;]+)/);
      const underlineMatch = css.match(/--vocabmeld-underline:\s*([^;]+)/);
      const underlineWidthMatch = css.match(/--vocabmeld-underline-width:\s*([^;]+)/);
      const underlineStyleMatch = css.match(/--vocabmeld-underline-style:\s*([^;]+)/);
      const hoverBgMatch = css.match(/--vocabmeld-hover-bg:\s*([^;]+)/);
      const wordColorMatch = css.match(/--vocabmeld-word-color:\s*([^;]+)/);
      const originalColorMatch = css.match(/--vocabmeld-original-color:\s*([^;]+)/);
      const tooltipWordMatch = css.match(/--vocabmeld-tooltip-word:\s*([^;]+)/);
      const cardBgMatch = css.match(/--vocabmeld-card-bg:\s*([^;]+)/);
      const cardBgLightMatch = css.match(/--vocabmeld-card-bg-light:\s*([^;]+)/);
      
      if (!primaryMatch) return null;
      
      return {
        name: nameMatch ? nameMatch[1].trim() : '导入主题',
        primary: primaryMatch[1].trim(),
        underline: underlineMatch ? underlineMatch[1].trim() : `${primaryMatch[1].trim()}80`,
        underlineWidth: underlineWidthMatch ? underlineWidthMatch[1].trim() : '2px',
        underlineStyle: underlineStyleMatch ? underlineStyleMatch[1].trim() : 'solid',
        hoverBg: hoverBgMatch ? hoverBgMatch[1].trim() : `${primaryMatch[1].trim()}1a`,
        wordColor: wordColorMatch ? wordColorMatch[1].trim() : '',
        originalColor: originalColorMatch ? originalColorMatch[1].trim() : '',
        tooltipWord: tooltipWordMatch ? tooltipWordMatch[1].trim() : primaryMatch[1].trim(),
        cardBg: cardBgMatch ? cardBgMatch[1].trim() : '#1e293b',
        cardBgLight: cardBgLightMatch ? cardBgLightMatch[1].trim() : '#ffffff'
      };
    } catch (e) {
      return null;
    }
  }

  // 十六进制转 RGBA
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ============ Tooltip 相关 ============
  let wordTooltip = null;
  let tooltipHideTimeout = null;
  let dictCache = new Map();
  let currentSettings = {};

  function createWordTooltip() {
    if (wordTooltip) return wordTooltip;
    wordTooltip = document.createElement('div');
    wordTooltip.className = 'word-tooltip';
    document.body.appendChild(wordTooltip);

    wordTooltip.addEventListener('mouseenter', () => {
      if (tooltipHideTimeout) {
        clearTimeout(tooltipHideTimeout);
        tooltipHideTimeout = null;
      }
    });

    wordTooltip.addEventListener('mouseleave', () => {
      hideWordTooltip();
    });

    return wordTooltip;
  }

  function showWordTooltip(element, wordData) {
    if (!wordTooltip) createWordTooltip();
    if (tooltipHideTimeout) {
      clearTimeout(tooltipHideTimeout);
      tooltipHideTimeout = null;
    }

    const { original, translation, phonetic, difficulty } = wordData;
    const dictionaryType = currentSettings.dictionaryType || 'zh-en';

    wordTooltip.innerHTML = `
      <div class="word-tooltip-header">
        <span class="word-tooltip-word">${original}</span>
        ${difficulty ? `<span class="word-tooltip-badge">${difficulty}</span>` : ''}
      </div>
      ${phonetic ? `<div class="word-tooltip-phonetic">${phonetic}</div>` : ''}
      ${translation ? `<div class="word-tooltip-original">释义: ${translation}</div>` : ''}
      <div class="word-tooltip-dict">
        <div class="word-tooltip-dict-loading">加载词典...</div>
      </div>
    `;

    const rect = element.getBoundingClientRect();
    wordTooltip.style.left = rect.right + 8 + 'px';
    wordTooltip.style.top = rect.top + 'px';
    wordTooltip.style.display = 'block';

    // 异步加载词典数据
    fetchDictionaryData(original, dictionaryType).then(dictData => {
      if (wordTooltip.style.display !== 'none') {
        updateTooltipDictionary(dictData);
      }
    });
  }

  function hideWordTooltip() {
    if (tooltipHideTimeout) return;
    tooltipHideTimeout = setTimeout(() => {
      if (wordTooltip) {
        wordTooltip.style.display = 'none';
      }
      tooltipHideTimeout = null;
    }, 150);
  }

  function updateTooltipDictionary(dictData) {
    if (!wordTooltip) return;
    const dictContainer = wordTooltip.querySelector('.word-tooltip-dict');
    if (!dictContainer) return;

    if (!dictData || !dictData.meanings || dictData.meanings.length === 0) {
      dictContainer.innerHTML = '<div class="word-tooltip-dict-empty">暂无词典数据</div>';
      return;
    }

    let html = '';
    for (const meaning of dictData.meanings) {
      html += `<div class="word-tooltip-dict-entry">`;
      if (meaning.partOfSpeech) {
        html += `<span class="word-tooltip-dict-pos">${meaning.partOfSpeech}</span>`;
      }
      html += `<ul class="word-tooltip-dict-defs">`;
      for (const def of meaning.definitions) {
        html += `<li>${def}</li>`;
      }
      html += `</ul></div>`;
    }
    dictContainer.innerHTML = html;
  }

  async function fetchDictionaryData(word, dictionaryType) {
    const cacheKey = `${word.toLowerCase()}_${dictionaryType}`;
    if (dictCache.has(cacheKey)) {
      return dictCache.get(cacheKey);
    }

    try {
      let result = null;
      if (dictionaryType === 'zh-en') {
        result = await fetchYoudaoData(word);
      } else {
        result = await fetchWiktionaryData(word);
      }
      dictCache.set(cacheKey, result);
      return result;
    } catch (e) {
      console.error('[VocabMeld] Dictionary fetch error:', e);
      return null;
    }
  }

  async function fetchYoudaoData(word) {
    try {
      const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchProxy', url, options: {} }, (resp) => {
          if (resp && resp.success) {
            resolve(resp.data);
          } else {
            reject(new Error(resp?.error || 'Fetch failed'));
          }
        });
      });

      const meanings = [];
      if (response?.ec?.word) {
        const trs = response.ec.word[0]?.trs || [];
        for (const tr of trs.slice(0, 3)) {
          const text = tr.tr?.[0]?.l?.i?.[0] || '';
          if (text) {
            const posMatch = text.match(/^([a-z]+\.)\s*/);
            if (posMatch) {
              meanings.push({
                partOfSpeech: posMatch[1],
                definitions: [text.replace(posMatch[0], '')]
              });
            } else {
              meanings.push({
                partOfSpeech: '',
                definitions: [text]
              });
            }
          }
        }
      }
      return meanings.length > 0 ? { meanings } : null;
    } catch (e) {
      console.error('[VocabMeld] Youdao fetch error:', e);
      return null;
    }
  }

  async function fetchWiktionaryData(word) {
    try {
      const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.toLowerCase())}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      const meanings = [];
      const seenPos = new Map();

      const entries = data.en || [];
      for (const entry of entries) {
        const pos = entry.partOfSpeech || '';
        const defs = (entry.definitions || []).slice(0, 3).map(d => {
          let def = d.definition || '';
          def = def.replace(/<[^>]+>/g, '');
          return def;
        }).filter(d => d);

        if (defs.length > 0) {
          if (seenPos.has(pos)) {
            const existingDefs = seenPos.get(pos);
            for (const def of defs) {
              if (!existingDefs.includes(def) && existingDefs.length < 3) {
                existingDefs.push(def);
              }
            }
          } else if (seenPos.size < 3) {
            seenPos.set(pos, defs);
            meanings.push({ partOfSpeech: pos, definitions: defs });
          }
        }
      }
      return meanings.length > 0 ? { meanings } : null;
    } catch (e) {
      console.error('[VocabMeld] Wiktionary fetch error:', e);
      return null;
    }
  }

  // 应用主题
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // 更新站点列表显示
  function updateSiteListVisibility(mode) {
    if (mode === 'all') {
      elements.excludedSitesGroup.style.display = 'block';
      elements.allowedSitesGroup.style.display = 'none';
    } else {
      elements.excludedSitesGroup.style.display = 'none';
      elements.allowedSitesGroup.style.display = 'block';
    }
  }

  // 加载可用声音列表（只显示学习语言相关的声音）
  function loadVoices(selectedVoice, resetIfMismatch = false) {
    chrome.runtime.sendMessage({ action: 'getVoices' }, (response) => {
      const voices = response?.voices || [];
      const select = elements.ttsVoice;
      const targetLang = elements.targetLanguage.value;
      
      // 获取目标语言的语言代码前缀
      const langPrefix = getLangPrefix(targetLang);
      
      // 清空现有选项，保留默认
      select.innerHTML = '<option value="">系统默认</option>';
      
      // 只筛选匹配学习语言的声音
      const matchingVoices = voices.filter(voice => {
        const voiceLang = voice.lang || '';
        return voiceLang.startsWith(langPrefix);
      });
      
      // 如果没有匹配的声音，显示提示
      if (matchingVoices.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '无可用声音';
        option.disabled = true;
        select.appendChild(option);
        // 清空存储的声音设置
        if (resetIfMismatch) {
          chrome.storage.sync.set({ ttsVoice: '' });
        }
        return;
      }
      
      // 检查选中的声音是否与当前语言匹配
      const selectedVoiceMatches = selectedVoice && matchingVoices.some(v => v.voiceName === selectedVoice);
      
      // 如果需要重置且不匹配，清空声音设置
      if (resetIfMismatch && selectedVoice && !selectedVoiceMatches) {
        selectedVoice = '';
        chrome.storage.sync.set({ ttsVoice: '' });
      }
      
      // 添加匹配的声音选项
      matchingVoices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.voiceName;
        // 简化显示名称
        const displayName = voice.voiceName
          .replace(/Google\s*/i, '')
          .replace(/Microsoft\s*/i, '')
          .replace(/Apple\s*/i, '');
        option.textContent = displayName;
        if (voice.voiceName === selectedVoice) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    });
  }

  // 获取语言代码前缀
  function getLangPrefix(langCode) {
    const prefixMap = {
      'en': 'en',
      'zh-CN': 'zh',
      'zh-TW': 'zh',
      'ja': 'ja',
      'ko': 'ko',
      'fr': 'fr',
      'de': 'de',
      'es': 'es'
    };
    return prefixMap[langCode] || langCode.split('-')[0];
  }

  // 加载 API 配置列表
  function loadApiConfigs(callback) {
    chrome.storage.sync.get(['apiConfigs', 'currentApiConfig'], (result) => {
      // 如果没有配置，使用默认配置
      apiConfigs = result.apiConfigs || { ...DEFAULT_API_CONFIGS };
      currentConfigName = result.currentApiConfig || Object.keys(apiConfigs)[0] || '';
      
      updateConfigSelect();
      
      if (callback) callback();
    });
  }

  // 更新配置下拉框
  function updateConfigSelect() {
    const select = elements.apiConfigSelect;
    select.innerHTML = '';
    
    // 添加已有配置
    Object.keys(apiConfigs).forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      if (name === currentConfigName) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    
    // 同步更新配置名称输入框
    if (currentConfigName) {
      elements.configName.value = currentConfigName;
    }
  }

  // 应用选中的配置
  function applyConfig(name) {
    if (!apiConfigs[name]) {
      // 新建配置 - 清空所有字段
      elements.configName.value = '';
      elements.apiEndpoint.value = '';
      elements.apiKey.value = '';
      elements.modelName.value = '';
      currentConfigName = '';
      return;
    }
    
    const config = apiConfigs[name];
    elements.configName.value = name;
    elements.apiEndpoint.value = config.endpoint || '';
    elements.apiKey.value = config.apiKey || '';
    elements.modelName.value = config.model || '';
    currentConfigName = name;
  }

  // 保存当前配置
  function saveCurrentConfig() {
    const configName = elements.configName.value.trim();
    const endpoint = elements.apiEndpoint.value.trim();
    const apiKey = elements.apiKey.value.trim();
    const model = elements.modelName.value.trim();
    
    // 非空检测
    if (!configName) {
      showConfigToast('请输入配置名称', true);
      elements.configName.focus();
      return;
    }
    if (!endpoint) {
      showConfigToast('请输入 API 端点', true);
      elements.apiEndpoint.focus();
      return;
    }
    if (!model) {
      showConfigToast('请输入模型名称', true);
      elements.modelName.focus();
      return;
    }
    
    // 检查是否是重命名（当前选中的配置名与输入的不同）
    const selectedConfig = elements.apiConfigSelect.value;
    if (selectedConfig && selectedConfig !== configName && apiConfigs[selectedConfig]) {
      // 删除旧名称的配置
      delete apiConfigs[selectedConfig];
    }
    
    // 保存配置
    apiConfigs[configName] = {
      endpoint: endpoint,
      apiKey: apiKey,
      model: model
    };
    
    currentConfigName = configName;
    
    // 保存到存储
    chrome.storage.sync.set({ 
      apiConfigs: apiConfigs,
      currentApiConfig: currentConfigName,
      apiEndpoint: endpoint,
      apiKey: apiKey,
      modelName: model
    }, () => {
      updateConfigSelect();
      showConfigToast(`配置 "${configName}" 已保存`);
    });
  }

  // 删除配置
  function deleteCurrentConfig() {
    const configName = elements.apiConfigSelect.value;
    if (configName === '_new') return;
    
    if (Object.keys(apiConfigs).length <= 1) {
      alert('至少保留一个配置');
      return;
    }
    
    if (!confirm(`确定要删除配置 "${configName}" 吗？`)) return;
    
    delete apiConfigs[configName];
    currentConfigName = Object.keys(apiConfigs)[0];
    
    // 保存到存储并应用新配置
    chrome.storage.sync.set({ 
      apiConfigs: apiConfigs,
      currentApiConfig: currentConfigName
    }, () => {
      updateConfigSelect();
      applyConfig(currentConfigName);
      // 同时更新当前使用的 API 配置
      const config = apiConfigs[currentConfigName];
      chrome.storage.sync.set({
        apiEndpoint: config.endpoint,
        apiKey: config.apiKey,
        modelName: config.model
      });
      showConfigToast(`配置 "${configName}" 已删除`);
    });
  }

  // 显示配置操作提示
  function showConfigToast(message, isError = false) {
    elements.testResult.textContent = message;
    elements.testResult.className = isError ? 'test-result error' : 'test-result success';
    setTimeout(() => {
      elements.testResult.textContent = '';
      elements.testResult.className = 'test-result';
    }, 2000);
  }

  // 加载配置
  async function loadSettings() {
    // 先加载 API 配置列表
    loadApiConfigs(() => {
      // 应用当前选中的配置
      if (currentConfigName && apiConfigs[currentConfigName]) {
        applyConfig(currentConfigName);
      }
    });
    
    chrome.storage.sync.get(null, (result) => {
      // 主题
      const theme = result.theme || 'dark';
      applyTheme(theme);
      elements.themeRadios.forEach(radio => {
        radio.checked = radio.value === theme;
      });

      // API 配置（如果没有配置列表，使用直接存储的值作为后备）
      if (!result.apiConfigs) {
        elements.apiEndpoint.value = result.apiEndpoint || DEFAULT_API_CONFIGS['DeepSeek'].endpoint;
        elements.apiKey.value = result.apiKey || '';
        elements.modelName.value = result.modelName || DEFAULT_API_CONFIGS['DeepSeek'].model;
      }
      
      // 学习偏好
      elements.nativeLanguage.value = result.nativeLanguage || 'zh-CN';
      elements.targetLanguage.value = result.targetLanguage || 'en';
      
      const storedRange = normalizeDifficultyRange(result.difficultyRange, result.difficultyLevel || 'B1');
      if (elements.difficultyRangeMin) {
        elements.difficultyRangeMin.value = storedRange.minIndex;
      }
      if (elements.difficultyRangeMax) {
        elements.difficultyRangeMax.value = storedRange.maxIndex;
      }
      updateDifficultyLabel();
      
      const intensity = result.intensity || 'medium';
      elements.intensityRadios.forEach(radio => {
        radio.checked = radio.value === intensity;
      });
      
      const processMode = result.processMode || 'both';
      elements.processModeRadios.forEach(radio => {
        radio.checked = radio.value === processMode;
      });
      
      // 行为设置
      elements.autoProcess.checked = result.autoProcess ?? false;
      elements.showPhonetic.checked = result.showPhonetic ?? true;
      const dictionaryType = result.dictionaryType || 'zh-en';
      elements.dictionaryTypeRadios.forEach(radio => {
        radio.checked = radio.value === dictionaryType;
      });
      currentSettings.dictionaryType = dictionaryType;
      elements.showAddMemorize.checked = result.showAddMemorize ?? true;
      
      const cacheMaxSize = result.cacheMaxSize || 2000;
      elements.cacheMaxSizeRadios.forEach(radio => {
        radio.checked = parseInt(radio.value) === cacheMaxSize;
      });
      
      const translationStyle = result.translationStyle || 'translation-original';
      elements.translationStyleRadios.forEach(radio => {
        radio.checked = radio.value === translationStyle;
      });
      
      // 主题样式
      const colorTheme = result.colorTheme || 'default';
      customTheme = result.customTheme || null;
      
      // 加载保存的可修改内置主题配置
      if (result.customizedThemes) {
        ['ocean', 'forest', 'sunset'].forEach(themeId => {
          if (result.customizedThemes[themeId]) {
            BUILT_IN_THEMES[themeId] = result.customizedThemes[themeId];
            // 更新配色选择器中的预览和名称
            const optionEl = document.querySelector(`input[name="colorTheme"][value="${themeId}"]`)?.closest('.color-theme-option');
            if (optionEl) {
              const previewEl = optionEl.querySelector('.color-theme-preview');
              const nameEl = optionEl.querySelector('.color-theme-name');
              const theme = result.customizedThemes[themeId];
              if (previewEl) {
                previewEl.style.setProperty('--preview-underline', theme.underline);
                previewEl.style.setProperty('--preview-bg', theme.hoverBg);
                previewEl.style.setProperty('--underline-width', theme.underlineWidth || '2px');
                previewEl.style.setProperty('--underline-style', theme.underlineStyle || 'solid');
                if (theme.wordColor) previewEl.style.setProperty('--word-color', theme.wordColor);
                if (theme.originalColor) previewEl.style.setProperty('--original-color', theme.originalColor);
              }
              if (nameEl) nameEl.textContent = theme.name;
            }
          }
        });
      }
      
      elements.colorThemeRadios.forEach(radio => {
        radio.checked = radio.value === colorTheme;
      });
      
      // 更新预览
      const activeTheme = BUILT_IN_THEMES[colorTheme] || BUILT_IN_THEMES.default;
      updatePreviewColors(activeTheme);
      
      // 更新编辑器状态
      setTimeout(() => {
        updateThemeEditorState(colorTheme);
      }, 0);
      
      // 站点规则
      const siteMode = result.siteMode || 'all';
      elements.siteModeRadios.forEach(radio => {
        radio.checked = radio.value === siteMode;
      });
      updateSiteListVisibility(siteMode);
      elements.excludedSitesInput.value = (result.excludedSites || result.blacklist || []).join('\n');
      elements.allowedSitesInput.value = (result.allowedSites || []).join('\n');
      
      // 发音设置
      elements.ttsRate.value = result.ttsRate || 1.0;
      elements.ttsRateValue.textContent = (result.ttsRate || 1.0).toFixed(1);
      
      // 加载可用声音列表
      loadVoices(result.ttsVoice || '');
      
      // 加载词汇列表和统计（从 local 获取词汇列表）
      chrome.storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
        loadWordLists(result, localResult.learnedWords || [], localResult.memorizeList || []);
        loadStats(result, localResult.learnedWords || [], localResult.memorizeList || []);
      });
    });
  }

  // 存储原始数据（用于搜索和筛选）
  let allLearnedWords = [];
  let allMemorizeWords = [];
  let allCachedWords = [];

  // 加载词汇列表
  function loadWordLists(result, learnedWords, memorizeList) {
    learnedWords = learnedWords || [];
    memorizeList = memorizeList || [];
    
    // 保存原始数据（包含难度信息）
    allLearnedWords = learnedWords.map(w => ({
      original: w.original,
      word: w.word,
      addedAt: w.addedAt,
      difficulty: w.difficulty || 'B1' // 如果已学会词汇有难度信息则使用，否则默认B1
    }));
    
    allMemorizeWords = memorizeList.map(w => ({
      original: w.word,
      word: '',
      addedAt: w.addedAt,
      difficulty: w.difficulty || 'B1' // 如果需记忆词汇有难度信息则使用，否则默认B1
    }));
    
    // 应用搜索和筛选
    filterLearnedWords();
    filterMemorizeWords();
    
    // 加载缓存
    chrome.storage.local.get('vocabmeld_word_cache', (data) => {
      const cache = data.vocabmeld_word_cache || [];
      const cacheWords = cache.map(item => {
        const [word] = item.key.split(':');
        return { 
          original: word, 
          word: item.translation, 
          addedAt: item.timestamp,
          difficulty: item.difficulty || 'B1',
          phonetic: item.phonetic || '',
          cacheKey: item.key // 保存完整的缓存key用于删除
        };
      });
      
      // 保存原始数据
      allCachedWords = cacheWords;
      
      // 应用搜索和筛选
      filterCachedWords();
    });
  }

  // 渲染词汇列表
  function renderWordList(container, words, type) {
    if (words.length === 0) {
      container.innerHTML = '<div class="empty-list">暂无词汇</div>';
      return;
    }

    container.innerHTML = words.map(w => `
      <div class="word-item">
        <button class="word-speak" data-word="${w.original}" title="播放发音">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>
          </svg>
        </button>
        <span class="word-original" data-original="${w.original}" data-translation="${w.word || ''}" data-phonetic="${w.phonetic || ''}" data-difficulty="${w.difficulty || ''}">${w.original}</span>
        ${w.word ? `<span class="word-translation">${w.word}</span>` : ''}
        ${w.difficulty ? `<span class="word-difficulty difficulty-${w.difficulty.toLowerCase()}">${w.difficulty}</span>` : ''}
        <span class="word-date">${formatDate(w.addedAt)}</span>
        ${type !== 'cached' ? `<button class="word-remove" data-word="${w.original}" data-type="${type}">&times;</button>` : `<button class="word-remove" data-key="${w.cacheKey || ''}" data-type="cached">&times;</button>`}
      </div>
    `).join('');

    // 绑定发音事件
    container.querySelectorAll('.word-speak').forEach(btn => {
      btn.addEventListener('click', () => speakWord(btn.dataset.word));
    });

    // 绑定删除事件
    container.querySelectorAll('.word-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.type === 'cached') {
          removeCacheItem(btn.dataset.key);
        } else {
          removeWord(btn.dataset.word, btn.dataset.type);
        }
      });
    });

    // 绑定单词 hover 事件显示 tooltip
    container.querySelectorAll('.word-original').forEach(span => {
      span.addEventListener('mouseenter', () => {
        const wordData = {
          original: span.dataset.original,
          translation: span.dataset.translation,
          phonetic: span.dataset.phonetic,
          difficulty: span.dataset.difficulty
        };
        showWordTooltip(span, wordData);
      });
      span.addEventListener('mouseleave', () => {
        hideWordTooltip();
      });
    });
  }
  
  // 删除单个缓存项
  function removeCacheItem(key) {
    if (!key) return;
    chrome.storage.local.get('vocabmeld_word_cache', (data) => {
      const cache = data.vocabmeld_word_cache || [];
      const newCache = cache.filter(item => item.key !== key);
      chrome.storage.local.set({ vocabmeld_word_cache: newCache }, () => {
        loadSettings();
      });
    });
  }

  // 发音功能
  function speakWord(word) {
    if (!word) return;
    
    // 检测语言
    const isChinese = /[\u4e00-\u9fff]/.test(word);
    const isJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(word);
    const isKorean = /[\uac00-\ud7af]/.test(word);
    
    let lang = 'en-US';
    if (isChinese) lang = 'zh-CN';
    else if (isJapanese) lang = 'ja-JP';
    else if (isKorean) lang = 'ko-KR';
    
    chrome.runtime.sendMessage({ action: 'speak', text: word, lang });
  }

  // 搜索和筛选已学会词汇
  function filterLearnedWords() {
    const searchTerm = (elements.learnedSearchInput?.value || '').toLowerCase().trim();
    const selectedDifficulty = document.querySelector('.difficulty-filter-btn.active[data-tab="learned"]')?.dataset.difficulty || 'all';
    
    let filtered = allLearnedWords;
    
    // 应用搜索
    if (searchTerm) {
      filtered = filtered.filter(w => 
        w.original.toLowerCase().includes(searchTerm) || 
        (w.word && w.word.toLowerCase().includes(searchTerm))
      );
    }
    
    // 应用难度筛选
    if (selectedDifficulty !== 'all') {
      filtered = filtered.filter(w => w.difficulty === selectedDifficulty);
    }
    
    // 渲染筛选后的列表
    renderWordList(elements.learnedList, filtered, 'learned');
  }

  // 搜索和筛选需记忆词汇
  function filterMemorizeWords() {
    const searchTerm = (elements.memorizeSearchInput?.value || '').toLowerCase().trim();
    const selectedDifficulty = document.querySelector('.difficulty-filter-btn.active[data-tab="memorize"]')?.dataset.difficulty || 'all';
    
    let filtered = allMemorizeWords;
    
    // 应用搜索
    if (searchTerm) {
      filtered = filtered.filter(w => 
        w.original.toLowerCase().includes(searchTerm) || 
        (w.word && w.word.toLowerCase().includes(searchTerm))
      );
    }
    
    // 应用难度筛选
    if (selectedDifficulty !== 'all') {
      filtered = filtered.filter(w => w.difficulty === selectedDifficulty);
    }
    
    // 渲染筛选后的列表
    renderWordList(elements.memorizeList, filtered, 'memorize');
  }

  // 搜索和筛选缓存词汇
  function filterCachedWords() {
    const searchTerm = (elements.cachedSearchInput?.value || '').toLowerCase().trim();
    const selectedDifficulty = document.querySelector('.difficulty-filter-btn.active[data-tab="cached"]')?.dataset.difficulty || 'all';
    
    let filtered = allCachedWords;
    
    // 应用搜索
    if (searchTerm) {
      filtered = filtered.filter(w => 
        w.original.toLowerCase().includes(searchTerm) || 
        (w.word && w.word.toLowerCase().includes(searchTerm))
      );
    }
    
    // 应用难度筛选
    if (selectedDifficulty !== 'all') {
      filtered = filtered.filter(w => w.difficulty === selectedDifficulty);
    }
    
    // 渲染筛选后的列表
    renderWordList(elements.cachedList, filtered, 'cached');
  }

  // 格式化日期
  function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  // 删除词汇
  async function removeWord(word, type) {
    if (type === 'learned') {
      chrome.storage.local.get('learnedWords', (result) => {
        const list = (result.learnedWords || []).filter(w => w.original !== word);
        chrome.storage.local.set({ learnedWords: list }, loadSettings);
      });
    } else if (type === 'memorize') {
      chrome.storage.local.get('memorizeList', (result) => {
        const list = (result.memorizeList || []).filter(w => w.word !== word);
        chrome.storage.local.set({ memorizeList: list }, loadSettings);
      });
    }
  }

  // 加载统计数据
  function loadStats(result, learnedWords, memorizeList) {
    elements.statTotalWords.textContent = result.totalWords || 0;
    elements.statTodayWords.textContent = result.todayWords || 0;
    elements.statLearnedWords.textContent = (learnedWords || []).length;
    elements.statMemorizeWords.textContent = (memorizeList || []).length;
    
    const hits = result.cacheHits || 0;
    const misses = result.cacheMisses || 0;
    const total = hits + misses;
    const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
    elements.statHitRate.textContent = hitRate + '%';
    
    chrome.storage.local.get('vocabmeld_word_cache', (data) => {
      const cacheSize = (data.vocabmeld_word_cache || []).length;
      const checkedRadio = document.querySelector('input[name="cacheMaxSize"]:checked');
      const maxSize = checkedRadio ? parseInt(checkedRadio.value) : 2000;
      elements.statCacheSize.textContent = `${cacheSize}/${maxSize}`;
      elements.cacheProgress.style.width = (cacheSize / maxSize * 100) + '%';
    });
  }

  // 保存设置（静默保存）
  async function saveSettings() {
    const currentRange = getCurrentDifficultyRange();
    const settings = {
      theme: document.querySelector('input[name="theme"]:checked').value,
      apiEndpoint: elements.apiEndpoint.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      modelName: elements.modelName.value.trim(),
      nativeLanguage: elements.nativeLanguage.value,
      targetLanguage: elements.targetLanguage.value,
      difficultyLevel: currentRange.minLevel,
      difficultyRange: {
        min: currentRange.minLevel,
        max: currentRange.maxLevel
      },
      intensity: document.querySelector('input[name="intensity"]:checked').value,
      processMode: document.querySelector('input[name="processMode"]:checked')?.value || 'both',
      autoProcess: elements.autoProcess.checked,
      showPhonetic: elements.showPhonetic.checked,
      dictionaryType: document.querySelector('input[name="dictionaryType"]:checked')?.value || 'zh-en',
      showAddMemorize: elements.showAddMemorize.checked,
      cacheMaxSize: parseInt(document.querySelector('input[name="cacheMaxSize"]:checked').value),
      translationStyle: document.querySelector('input[name="translationStyle"]:checked').value,
      ttsVoice: elements.ttsVoice.value,
      ttsRate: parseFloat(elements.ttsRate.value),
      siteMode: document.querySelector('input[name="siteMode"]:checked').value,
      excludedSites: elements.excludedSitesInput.value.split('\n').filter(s => s.trim()),
      allowedSites: elements.allowedSitesInput.value.split('\n').filter(s => s.trim()),
      colorTheme: document.querySelector('input[name="colorTheme"]:checked')?.value || 'default',
      customTheme: customTheme,
      // 保存可修改的内置主题配置
      customizedThemes: {
        ocean: BUILT_IN_THEMES.ocean,
        forest: BUILT_IN_THEMES.forest,
        sunset: BUILT_IN_THEMES.sunset
      }
    };

    try {
      await chrome.storage.sync.set(settings);
      console.log('[VocabMeld] Settings saved automatically');
    } catch (error) {
      console.error('[VocabMeld] Failed to save settings:', error);
    }
  }

  // 添加自动保存事件监听器
  function addAutoSaveListeners() {
    // 文本输入框 - 失焦时保存
    const textInputs = [
      elements.apiEndpoint,
      elements.apiKey,
      elements.modelName,
      elements.excludedSitesInput,
      elements.allowedSitesInput
    ];

    textInputs.forEach(input => {
      input.addEventListener('blur', () => debouncedSave());
      input.addEventListener('change', () => debouncedSave());
    });

    // 下拉框 - 改变时保存
    elements.nativeLanguage.addEventListener('change', () => debouncedSave(200));
    
    // 缓存上限 - 改变时保存
    elements.cacheMaxSizeRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });
    
    // 站点模式切换
    elements.siteModeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        updateSiteListVisibility(radio.value);
        debouncedSave(200);
      });
    });
    
    // 学习语言改变时，重新加载声音列表
    elements.targetLanguage.addEventListener('change', () => {
      debouncedSave(200);
      // 重新加载声音列表，并重置不匹配的声音设置
      loadVoices(elements.ttsVoice.value, true);
    });

    if (elements.difficultyRangeMin && elements.difficultyRangeMax) {
      const handleInput = (target) => handleDifficultyRangeInput(target);
      elements.difficultyRangeMin.addEventListener('input', () => handleInput(elements.difficultyRangeMin));
      elements.difficultyRangeMax.addEventListener('input', () => handleInput(elements.difficultyRangeMax));
      elements.difficultyRangeMin.addEventListener('change', () => handleInput(elements.difficultyRangeMin));
      elements.difficultyRangeMax.addEventListener('change', () => handleInput(elements.difficultyRangeMax));
    }

    // 单选按钮 - 改变时保存
    elements.intensityRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });

    elements.processModeRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });

    elements.translationStyleRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });

    // 主题 - 改变时立即应用并保存
    elements.themeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        applyTheme(radio.value);
        // 切换亮/暗主题时也需要更新预览颜色
        const colorTheme = document.querySelector('input[name="colorTheme"]:checked')?.value || 'default';
        const activeTheme = colorTheme === 'custom' && customTheme ? customTheme : BUILT_IN_THEMES[colorTheme] || BUILT_IN_THEMES.default;
        updatePreviewColors(activeTheme);
        debouncedSave(200);
      });
    });

    // 开关 - 改变时保存
    const checkboxes = [
      elements.autoProcess,
      elements.showPhonetic,
      elements.showAddMemorize
    ];

    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => debouncedSave(200));
    });
    
    // 词典类型选择
    elements.dictionaryTypeRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });
    
    if (elements.difficultyPresetButtons?.length) {
      elements.difficultyPresetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const minIdx = parseInt(btn.dataset.min, 10);
          const maxIdx = parseInt(btn.dataset.max, 10);
          if (!Number.isNaN(minIdx)) {
            elements.difficultyRangeMin.value = minIdx;
          }
          if (!Number.isNaN(maxIdx)) {
            elements.difficultyRangeMax.value = maxIdx;
          }
          updateDifficultyLabel();
          debouncedSave(200);
        });
      });
    }

    // 发音设置
    elements.ttsVoice.addEventListener('change', () => debouncedSave(200));
    
    elements.ttsRate.addEventListener('input', () => {
      elements.ttsRateValue.textContent = parseFloat(elements.ttsRate.value).toFixed(1);
    });
    elements.ttsRate.addEventListener('change', () => debouncedSave(200));
    
    // 测试发音按钮
    elements.testVoiceBtn.addEventListener('click', () => {
      const targetLang = elements.targetLanguage.value;
      const testTexts = {
        'en': 'Hello, this is a voice test.',
        'zh-CN': '你好，这是一个语音测试。',
        'zh-TW': '你好，這是一個語音測試。',
        'ja': 'こんにちは、これは音声テストです。',
        'ko': '안녕하세요, 음성 테스트입니다.',
        'fr': 'Bonjour, ceci est un test vocal.',
        'de': 'Hallo, dies ist ein Sprachtest.',
        'es': 'Hola, esta es una prueba de voz.'
      };
      const langCodes = {
        'en': 'en-US',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES'
      };
      const testText = testTexts[targetLang] || testTexts['en'];
      const lang = langCodes[targetLang] || 'en-US';
      
      chrome.runtime.sendMessage({ 
        action: 'speak', 
        text: testText, 
        lang: lang
      });
    });
  }

  function getCurrentDifficultyRange() {
    const minValue = parseInt(elements.difficultyRangeMin?.value, 10);
    const maxValue = parseInt(elements.difficultyRangeMax?.value, 10);
    const minIndex = Number.isFinite(minValue) ? minValue : 0;
    const maxIndex = Number.isFinite(maxValue) ? maxValue : CEFR_LEVELS.length - 1;
    const safeMin = Math.max(0, Math.min(minIndex, maxIndex));
    const safeMax = Math.min(CEFR_LEVELS.length - 1, Math.max(minIndex, maxIndex));
    return {
      minIndex: safeMin,
      maxIndex: safeMax,
      minLevel: CEFR_LEVELS[safeMin] || 'A1',
      maxLevel: CEFR_LEVELS[safeMax] || 'C2'
    };
  }

  function handleDifficultyRangeInput(changedElement) {
    if (!elements.difficultyRangeMin || !elements.difficultyRangeMax) return;
    let minValue = parseInt(elements.difficultyRangeMin.value, 10);
    let maxValue = parseInt(elements.difficultyRangeMax.value, 10);
    if (Number.isNaN(minValue)) minValue = 0;
    if (Number.isNaN(maxValue)) maxValue = CEFR_LEVELS.length - 1;
    if (minValue > maxValue) {
      if (changedElement === elements.difficultyRangeMin) {
        minValue = maxValue;
        elements.difficultyRangeMin.value = maxValue;
      } else {
        maxValue = minValue;
        elements.difficultyRangeMax.value = minValue;
      }
    }
    updateDifficultyLabel();
    debouncedSave(200);
  }

  // 更新难度标签
  function updateDifficultyLabel() {
    if (!elements.selectedDifficulty) return;
    const range = getCurrentDifficultyRange();
    elements.selectedDifficulty.textContent = 
      range.minLevel === range.maxLevel ? range.minLevel : `${range.minLevel} - ${range.maxLevel}`;
    
    if (elements.difficultyRangeProgress) {
      const steps = CEFR_LEVELS.length - 1 || 1;
      const minPercent = (range.minIndex / steps) * 100;
      const maxPercent = (range.maxIndex / steps) * 100;
      elements.difficultyRangeProgress.style.left = `${minPercent}%`;
      elements.difficultyRangeProgress.style.width = `${Math.max(0, maxPercent - minPercent)}%`;
    }

    if (elements.difficultyPresetButtons?.length) {
      elements.difficultyPresetButtons.forEach(btn => {
        const btnMin = parseInt(btn.dataset.min, 10);
        const btnMax = parseInt(btn.dataset.max, 10);
        if (btnMin === range.minIndex && btnMax === range.maxIndex) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  }

  // 切换到指定页面
  function switchToSection(sectionId) {
    elements.navItems.forEach(n => n.classList.remove('active'));
    elements.sections.forEach(s => s.classList.remove('active'));
    
    const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    const section = document.getElementById(sectionId);
    
    if (navItem && section) {
      navItem.classList.add('active');
      section.classList.add('active');
    }
    
    // 仅在主题样式页显示编辑器侧边栏
    if (elements.themeEditorSidebar) {
      elements.themeEditorSidebar.style.display = sectionId === 'style' ? '' : 'none';
    }
  }

  // 从 hash 加载页面
  function loadSectionFromHash() {
    const hash = window.location.hash.slice(1); // 去掉 #
    if (hash) {
      const section = document.getElementById(hash);
      if (section) {
        switchToSection(hash);
      }
    }
  }

  // 事件绑定
  function bindEvents() {
    // 导航切换
    elements.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        
        // 更新 URL hash
        window.location.hash = section;
        
        switchToSection(section);
      });
    });
    
    // 监听 hash 变化（浏览器前进后退）
    window.addEventListener('hashchange', loadSectionFromHash);

    // 配置选择器
    elements.apiConfigSelect.addEventListener('change', () => {
      const selectedValue = elements.apiConfigSelect.value;
      applyConfig(selectedValue);
      // 切换配置时保存当前使用的配置
      if (apiConfigs[selectedValue]) {
        chrome.storage.sync.set({ 
          currentApiConfig: selectedValue,
          apiEndpoint: elements.apiEndpoint.value,
          apiKey: elements.apiKey.value,
          modelName: elements.modelName.value
        });
      }
    });

    // 新建配置按钮
    elements.newConfigBtn.addEventListener('click', () => {
      // 添加临时的"新建配置"选项并选中
      const select = elements.apiConfigSelect;
      let newOption = select.querySelector('option[value="_new"]');
      if (!newOption) {
        newOption = document.createElement('option');
        newOption.value = '_new';
        newOption.textContent = '— 新建配置 —';
        select.insertBefore(newOption, select.firstChild);
      }
      select.value = '_new';
      
      elements.configName.value = '';
      elements.apiEndpoint.value = '';
      elements.apiKey.value = '';
      elements.modelName.value = '';
      currentConfigName = '';
      elements.configName.focus();
    });

    // 保存配置按钮
    elements.saveConfigBtn.addEventListener('click', saveCurrentConfig);
    
    // 删除配置按钮
    elements.deleteConfigBtn.addEventListener('click', deleteCurrentConfig);

    // 切换 API 密钥可见性
    elements.toggleApiKey.addEventListener('click', () => {
      const type = elements.apiKey.type === 'password' ? 'text' : 'password';
      elements.apiKey.type = type;
    });

    // 测试连接
    elements.testConnectionBtn.addEventListener('click', async () => {
      elements.testConnectionBtn.disabled = true;
      elements.testResult.textContent = '测试中...';
      elements.testResult.className = 'test-result';

      chrome.runtime.sendMessage({
        action: 'testApi',
        endpoint: elements.apiEndpoint.value,
        apiKey: elements.apiKey.value,
        model: elements.modelName.value
      }, (response) => {
        elements.testConnectionBtn.disabled = false;
        if (response?.success) {
          elements.testResult.textContent = '✓ 连接成功';
          elements.testResult.className = 'test-result success';
        } else {
          elements.testResult.textContent = '✗ ' + (response?.message || '连接失败');
          elements.testResult.className = 'test-result error';
        }
      });
    });

    // 词汇标签切换
    elements.wordTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        elements.wordTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.word-list').forEach(list => {
          list.classList.toggle('hidden', list.dataset.tab !== tabName);
        });
        
        // 显示/隐藏搜索和筛选器
        document.querySelectorAll('.word-filters').forEach(filter => {
          filter.classList.toggle('hidden', filter.dataset.tab !== tabName);
        });
      });
    });

    // 初始化时检查当前激活的标签
    const activeTab = document.querySelector('.word-tab.active');
    if (activeTab) {
      const tabName = activeTab.dataset.tab;
      document.querySelectorAll('.word-filters').forEach(filter => {
        filter.classList.toggle('hidden', filter.dataset.tab !== tabName);
      });
    }

    // 搜索输入事件
    if (elements.learnedSearchInput) {
      elements.learnedSearchInput.addEventListener('input', () => {
        filterLearnedWords();
      });
    }

    if (elements.memorizeSearchInput) {
      elements.memorizeSearchInput.addEventListener('input', () => {
        filterMemorizeWords();
      });
    }

    if (elements.cachedSearchInput) {
      elements.cachedSearchInput.addEventListener('input', () => {
        filterCachedWords();
      });
    }

    // 难度筛选按钮事件
    elements.difficultyFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        // 只激活同一tab的按钮
        document.querySelectorAll(`.difficulty-filter-btn[data-tab="${tab}"]`).forEach(b => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        
        // 根据tab调用对应的筛选函数
        if (tab === 'learned') {
          filterLearnedWords();
        } else if (tab === 'memorize') {
          filterMemorizeWords();
        } else if (tab === 'cached') {
          filterCachedWords();
        }
      });
    });

    // 清空按钮
    elements.clearLearnedBtn.addEventListener('click', () => {
      if (confirm('确定要清空所有已学会词汇吗？')) {
        chrome.runtime.sendMessage({ action: 'clearLearnedWords' }, () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    elements.clearMemorizeBtn.addEventListener('click', () => {
      if (confirm('确定要清空需记忆列表吗？')) {
        chrome.runtime.sendMessage({ action: 'clearMemorizeList' }, () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    elements.clearCacheBtn.addEventListener('click', () => {
      if (confirm('确定要清空词汇缓存吗？')) {
        chrome.runtime.sendMessage({ action: 'clearCache' }, () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    // 统计重置
    elements.resetTodayBtn.addEventListener('click', () => {
      chrome.storage.sync.set({ todayWords: 0 }, () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    elements.resetAllBtn.addEventListener('click', () => {
      if (confirm('确定要重置所有数据吗？这将清空所有统计和词汇列表。')) {
        chrome.storage.sync.set({
          totalWords: 0,
          todayWords: 0,
          cacheHits: 0,
          cacheMisses: 0
        });
        // 词汇列表存储在 local 中
        chrome.storage.local.set({ learnedWords: [], memorizeList: [] });
        chrome.storage.local.remove('vocabmeld_word_cache', () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    // 导出数据
    elements.exportDataBtn.addEventListener('click', async () => {
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString()
      };

      // 获取 sync 存储的数据
      const syncData = await new Promise(resolve => chrome.storage.sync.get(null, resolve));
      
      // 根据勾选项添加数据
      if (elements.exportSettings.checked) {
        exportData.settings = {
          apiEndpoint: syncData.apiEndpoint,
          apiKey: syncData.apiKey,
          modelName: syncData.modelName,
          apiConfigs: syncData.apiConfigs,
          currentApiConfig: syncData.currentApiConfig,
          nativeLanguage: syncData.nativeLanguage,
          targetLanguage: syncData.targetLanguage,
          difficultyLevel: syncData.difficultyLevel,
          difficultyRange: syncData.difficultyRange,
          intensity: syncData.intensity,
          autoProcess: syncData.autoProcess,
          showPhonetic: syncData.showPhonetic,
          dictionaryType: syncData.dictionaryType,
          showAddMemorize: syncData.showAddMemorize,
          cacheMaxSize: syncData.cacheMaxSize,
          translationStyle: syncData.translationStyle,
          theme: syncData.theme,
          ttsVoice: syncData.ttsVoice,
          ttsRate: syncData.ttsRate,
          siteMode: syncData.siteMode,
          excludedSites: syncData.excludedSites,
          allowedSites: syncData.allowedSites
        };
      }
      
      if (elements.exportWords.checked) {
        // 词汇列表存储在 local 中
        const localWords = await new Promise(resolve => chrome.storage.local.get(['learnedWords', 'memorizeList'], resolve));
        exportData.learnedWords = localWords.learnedWords || [];
        exportData.memorizeList = localWords.memorizeList || [];
      }
      
      if (elements.exportStats.checked) {
        exportData.stats = {
          totalWords: syncData.totalWords,
          todayWords: syncData.todayWords,
          lastResetDate: syncData.lastResetDate,
          cacheHits: syncData.cacheHits,
          cacheMisses: syncData.cacheMisses
        };
      }
      
      if (elements.exportCache.checked) {
        const localData = await new Promise(resolve => chrome.storage.local.get('vocabmeld_word_cache', resolve));
        exportData.cache = localData.vocabmeld_word_cache || [];
      }

      // 下载文件
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vocabmeld-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // 导入数据
    elements.importDataBtn.addEventListener('click', () => {
      elements.importFileInput.click();
    });

    elements.importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.version) {
          alert('无效的备份文件');
          return;
        }

        if (!confirm('导入将覆盖现有数据，确定继续吗？')) {
          return;
        }

        const syncUpdates = {};
        const localUpdates = {};

        if (data.settings) {
          Object.assign(syncUpdates, data.settings);
        }
        if (data.learnedWords) {
          // 词汇列表存储在 local 中
          localUpdates.learnedWords = data.learnedWords;
        }
        if (data.memorizeList) {
          // 词汇列表存储在 local 中
          localUpdates.memorizeList = data.memorizeList;
        }
        if (data.stats) {
          Object.assign(syncUpdates, data.stats);
        }
        if (data.cache) {
          // 导入时去重
          const seenKeys = new Set();
          const deduplicatedCache = [];
          for (const item of data.cache) {
            if (item.key && !seenKeys.has(item.key)) {
              seenKeys.add(item.key);
              deduplicatedCache.push(item);
            }
          }
          localUpdates.vocabmeld_word_cache = deduplicatedCache;
        }

        // 保存数据
        if (Object.keys(syncUpdates).length > 0) {
          await new Promise(resolve => chrome.storage.sync.set(syncUpdates, resolve));
        }
        if (Object.keys(localUpdates).length > 0) {
          await new Promise(resolve => chrome.storage.local.set(localUpdates, resolve));
        }

        alert('导入成功！页面将刷新。');
        location.reload();
      } catch (err) {
        alert('导入失败：' + err.message);
      }

      // 重置文件输入
      e.target.value = '';
    });

    // ============ 主题样式事件 ============
    // 主题选择变化
    elements.colorThemeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        const themeId = radio.value;
        const theme = themeId === 'custom' && customTheme ? customTheme : BUILT_IN_THEMES[themeId];
        if (theme) {
          updatePreviewColors(theme);
        }
        updateThemeEditorState(themeId);
        debouncedSave(200);
      });
    });
    
    // 初始化编辑器状态
    const initialTheme = document.querySelector('input[name="colorTheme"]:checked')?.value || 'default';
    updateThemeEditorState(initialTheme);

    // 导入主题按钮
    elements.importThemeBtn?.addEventListener('click', () => {
      const css = prompt('请粘贴主题 CSS 代码:');
      if (css) {
        const parsed = parseThemeCss(css);
        if (parsed) {
          const selectedThemeId = document.querySelector('input[name="colorTheme"]:checked')?.value;
          if (selectedThemeId && selectedThemeId !== 'default') {
            // 更新当前选中的主题
            BUILT_IN_THEMES[selectedThemeId] = parsed;
            updatePreviewColors(parsed);
            updateThemeEditorState(selectedThemeId);
            saveSettings();
            alert('主题导入成功！');
          } else {
            alert('请先选择一个可编辑的主题（海洋蓝/森林绿/日落橙）');
          }
        } else {
          alert('无法解析主题 CSS，请检查格式是否正确。');
        }
      }
    });

    // 导出主题按钮
    elements.exportThemeBtn?.addEventListener('click', () => {
      const selectedTheme = document.querySelector('input[name="colorTheme"]:checked')?.value;
      const theme = selectedTheme === 'custom' && customTheme ? customTheme : BUILT_IN_THEMES[selectedTheme];
      if (theme) {
        const css = generateThemeCss(theme);
        navigator.clipboard.writeText(css).then(() => {
          alert('主题 CSS 已复制到剪贴板！');
        }).catch(() => {
          prompt('复制以下主题 CSS:', css);
        });
      }
    });

    elements.primaryColor?.addEventListener('input', updateColorValues);
    elements.cardBgColor?.addEventListener('input', updateColorValues);
    elements.cardBgLightColor?.addEventListener('input', updateColorValues);
    elements.underlineColor?.addEventListener('input', updateColorValues);
    elements.hoverBgColor?.addEventListener('input', updateColorValues);
    elements.tooltipWordColor?.addEventListener('input', updateColorValues);
    elements.wordColor?.addEventListener('input', updateColorValues);
    elements.originalColor?.addEventListener('input', updateColorValues);
    
    // 译文/原文颜色启用切换
    elements.wordColorEnabled?.addEventListener('change', () => {
      elements.wordColor.disabled = !elements.wordColorEnabled.checked;
      document.getElementById('wordColorValue').textContent = 
        elements.wordColorEnabled.checked ? elements.wordColor.value : '保持原样';
    });
    elements.originalColorEnabled?.addEventListener('change', () => {
      elements.originalColor.disabled = !elements.originalColorEnabled.checked;
      document.getElementById('originalColorValue').textContent = 
        elements.originalColorEnabled.checked ? elements.originalColor.value : '保持原样';
    });

    // 保存主题（实时保存）
    elements.saveThemeBtn?.addEventListener('click', () => {
      const selectedThemeId = document.querySelector('input[name="colorTheme"]:checked')?.value;
      
      // 默认紫不可修改
      if (selectedThemeId === 'default') return;
      
      const name = elements.themeNameInput.value.trim() || BUILT_IN_THEMES[selectedThemeId]?.name || '自定义';
      const primary = elements.primaryColor.value;
      
      const updatedTheme = {
        name,
        primary,
        underline: hexToRgba(elements.underlineColor.value, 0.6),
        hoverBg: hexToRgba(elements.hoverBgColor.value, 0.15),
        tooltipWord: elements.tooltipWordColor.value,
        underlineWidth: elements.underlineWidth.value,
        underlineStyle: elements.underlineStyle.value,
        wordColor: elements.wordColorEnabled.checked ? elements.wordColor.value : '',
        originalColor: elements.originalColorEnabled.checked ? elements.originalColor.value : '',
        cardBg: elements.cardBgColor.value,
        cardBgLight: elements.cardBgLightColor.value
      };
      
      // 更新内置主题
      BUILT_IN_THEMES[selectedThemeId] = updatedTheme;
      
      // 更新显示
      elements.themeEditorTitle.textContent = name;
      
      // 更新配色选择器中的预览
      const previewEl = document.querySelector(`input[name="colorTheme"][value="${selectedThemeId}"]`)
        ?.closest('.color-theme-option')
        ?.querySelector('.color-theme-preview');
      if (previewEl) {
        previewEl.style.setProperty('--preview-underline', updatedTheme.underline);
        previewEl.style.setProperty('--preview-bg', updatedTheme.hoverBg);
        previewEl.style.setProperty('--underline-width', updatedTheme.underlineWidth);
        previewEl.style.setProperty('--underline-style', updatedTheme.underlineStyle);
        if (updatedTheme.wordColor) {
          previewEl.style.setProperty('--word-color', updatedTheme.wordColor);
        }
        if (updatedTheme.originalColor) {
          previewEl.style.setProperty('--original-color', updatedTheme.originalColor);
        }
      }
      
      // 更新名称
      const nameEl = document.querySelector(`input[name="colorTheme"][value="${selectedThemeId}"]`)
        ?.closest('.color-theme-option')
        ?.querySelector('.color-theme-name');
      if (nameEl) {
        nameEl.textContent = name;
      }
      
      updatePreviewColors(updatedTheme);
      saveSettings();
    });

    // 添加自动保存事件监听器
    addAutoSaveListeners();
  }

  // 初始化
  bindEvents();
  loadSettings();
  loadSectionFromHash(); // 从 hash 恢复页面

  // 监听 storage 变化（实时响应其他页面的主题切换）
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.theme) {
      const newTheme = changes.theme.newValue;
      applyTheme(newTheme);
      elements.themeRadios.forEach(radio => {
        radio.checked = radio.value === newTheme;
      });
    }
  });
});
