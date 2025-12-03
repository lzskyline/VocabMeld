/**
 * VocabMeld API 服务模块
 * 处理与 LLM API 的通信
 */

import { storage } from '../core/storage.js';
import { INTENSITY_CONFIG, isDifficultyCompatible } from '../core/config.js';
import { cacheService } from './cache-service.js';

/**
 * API 服务类
 */
class ApiService {
  constructor() {
    this.config = null;
  }

  /**
   * 加载配置
   * @returns {Promise<object>}
   */
  async loadConfig() {
    this.config = await storage.getConfig();
    return this.config;
  }

  /**
   * 构建翻译 prompt
   * @param {string} filteredText - 已过滤的文本（只包含未缓存词汇）
   * @param {string} originalText - 原始文本（用于位置映射）
   * @param {object} config - 配置
   * @param {number} aiTargetCount - AI目标词汇数量（可选）
   * @param {number} maxReplacements - 最大替换数量（可选）
   * @returns {string}
   */
  buildPrompt(filteredText, originalText, config, aiTargetCount = 15, maxReplacements = 8) {
    const { nativeLanguage, targetLanguage } = config;

    // 判断翻译方向
    const isNativeText = this.detectLanguage(originalText) === nativeLanguage;
    const sourceLang = isNativeText ? nativeLanguage : targetLanguage;
    const targetLang = isNativeText ? targetLanguage : nativeLanguage;

    return `你是一个语言学习助手。请分析以下文本，选择适合学习的词汇进行翻译。

## 规则：
1. 选择约 ${aiTargetCount} 个词汇（实际返回数量可以根据文本内容灵活调整，但不要超过 ${maxReplacements * 2} 个）
2. 不要翻译：域名、地址、缩写、人名、地名、产品名、数字、代码、URL、已经是目标语言的词
3. 优先选择：有学习价值的词汇、不同难度级别的词汇
4. 翻译方向：从 ${sourceLang} 翻译到 ${targetLang}
5. 翻译倾向：结合上下文，夹杂起来也能容易被理解，尽量只翻译成最合适的词汇，而不是多个含义。

## CEFR等级从简单到复杂依次为：A1-C2

## 输出格式：
返回 JSON 数组，每个元素包含：
- original: 原词
- translation: 翻译结果
- phonetic: 学习语言(${targetLanguage})的音标/发音
- difficulty: CEFR 难度等级 (A1/A2/B1/B2/C1/C2)，请谨慎评估
- position: 在文本中的起始位置

## 文本：
${filteredText}

## 输出：
只返回 JSON 数组，不要其他内容。`;
  }

  /**
   * 重建文本，只保留指定的词汇（用于发送给 AI）
   * @param {string} text - 原始文本
   * @param {string[]} targetWords - 要保留的词汇
   * @returns {string}
   */
  reconstructTextWithWords(text, targetWords) {
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

  /**
   * 简单语言检测
   * @param {string} text - 文本
   * @returns {string} - 语言代码
   */
  detectLanguage(text) {
    // 统计不同语言字符的比例
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
    if (chineseCount / total > 0.3) return 'zh-CN';
    if (latinCount / total > 0.3) return 'en';

    return 'en';
  }

  /**
   * 调用 API 获取翻译
   * @param {string} text - 要处理的文本
   * @param {object} options - 可选配置覆盖
   * @returns {Promise<Array>} - 替换结果数组
   */
  async translate(text, options = {}) {
    await this.loadConfig();
    const config = { ...this.config, ...options };
    
    if (!config.apiKey || !config.apiEndpoint) {
      throw new Error('API 未配置');
    }

    // 初始化缓存
    await cacheService.init();

    // 提取文本中的词汇进行缓存检查
    const words = this.extractWords(text);
    const sourceLang = this.detectLanguage(text);
    const targetLang = sourceLang === config.nativeLanguage 
      ? config.targetLanguage 
      : config.nativeLanguage;
    
    const { cached, uncached } = cacheService.checkWords(words, sourceLang, targetLang);
    
    // 统计缓存命中
    const cacheHits = cached.size;
    const cacheMisses = uncached.length > 0 ? 1 : 0;
    
    // 如果缓存中有足够的词汇，直接返回
    const filteredCached = this.filterCachedResults(cached, config);
    if (filteredCached.length >= (INTENSITY_CONFIG[config.intensity]?.maxPerParagraph || 8)) {
      await storage.updateStats({ cacheHits: filteredCached.length, cacheMisses: 0 });
      return filteredCached;
    }

    // 如果没有未缓存的词汇，直接返回缓存结果
    if (uncached.length === 0) {
      await storage.updateStats({ cacheHits: filteredCached.length, cacheMisses: 0 });
      return filteredCached;
    }

    // 构建只包含未缓存词汇的文本用于发送给 AI
    const filteredText = this.reconstructTextWithWords(text, uncached);

    // 如果过滤后的文本太短，直接返回缓存结果
    if (filteredText.trim().length < 50) {
      await storage.updateStats({ cacheHits: filteredCached.length, cacheMisses: 0 });
      return filteredCached;
    }

    // 调用 API
    const maxReplacements = INTENSITY_CONFIG[config.intensity]?.maxPerParagraph || 8;
    const aiTargetCount = Math.max(maxReplacements, Math.ceil(maxReplacements * 1.5));
    const prompt = this.buildPrompt(filteredText, text, config, aiTargetCount, maxReplacements);
    
    try {
      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.modelName,
          messages: [
            { 
              role: 'system', 
              content: '你是一个专业的语言学习助手，帮助用户通过沉浸式阅读学习新词汇。始终返回有效的 JSON 格式。'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '[]';
      
      // 解析 JSON 响应
      let allResults = this.parseApiResponse(content);

      // 先缓存所有词汇（包括所有难度级别），供不同难度设置的用户使用
      // 过滤掉2字以下的中文词汇和小于5个字符的英文单词（避免简单词影响语境）
      const newCacheItems = allResults
        .filter(item => {
          // 对于中文，不存储1个字的内容（即只存储2个字及以上的词汇）
          const isChinese = /[\u4e00-\u9fff]/.test(item.original);
          if (isChinese && item.original.length < 2) {
            return false; // 跳过1个字的中文词汇（只存储2个字及以上的）
          }
          // 对于英文，不存储小于5个字符的单词
          const isEnglish = /^[a-zA-Z]+$/.test(item.original);
          if (isEnglish && item.original.length < 5) {
            return false; // 跳过小于5个字符的英文单词
          }
          return true;
        })
        .map(item => ({
          word: item.original,
          sourceLang,
          targetLang,
          translation: item.translation,
          phonetic: item.phonetic,
          difficulty: item.difficulty || 'B1' // 默认 B1
        }));
      
      await cacheService.setMany(newCacheItems);
      
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

      // 修正 AI 返回结果的位置（从过滤文本映射回原始文本）
      const correctedResults = filteredResults.map(result => {
        const originalIndex = text.toLowerCase().indexOf(result.original.toLowerCase());
        return {
          ...result,
          position: originalIndex >= 0 ? originalIndex : result.position
        };
      });

      // 更新统计（统计过滤后实际展示的词汇数）
      await storage.updateStats({
        newWords: correctedResults.length,
        cacheHits,
        cacheMisses
      });

      // 合并缓存结果（去重，优先使用新结果）
      const resultWords = new Set(correctedResults.map(r => r.original.toLowerCase()));
      const cachedResults = cached
        .filter(c => !resultWords.has(c.word.toLowerCase()) && isDifficultyCompatible(c.difficulty || 'B1', config.difficultyLevel))
        .map(c => {
          const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
          return { original: c.word, translation: c.translation, phonetic: c.phonetic, difficulty: c.difficulty, position: idx, fromCache: true };
        });

      const mergedResults = [...correctedResults, ...cachedResults];

      // 按强度限制数量
      const maxReplacements = INTENSITY_CONFIG[config.intensity]?.maxPerParagraph || 8;
      return mergedResults.slice(0, maxReplacements);

    } catch (error) {
      console.error('[VocabMeld] API Error:', error);
      throw error;
    }
  }

  /**
   * 从文本中提取词汇
   * @param {string} text - 文本
   * @returns {string[]} - 词汇数组
   */
  extractWords(text) {
    // 匹配英文单词
    const englishWords = text.match(/\b[a-zA-Z]{5,}\b/g) || [];
    
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
    
    return [...new Set([...englishWords, ...chinesePhrases])];
  }

  /**
   * 过滤缓存结果（按难度级别）
   * @param {Map} cached - 缓存数据
   * @param {object} config - 配置
   * @returns {Array}
   */
  filterCachedResults(cached, config) {
    const results = [];

    for (const [word, data] of cached) {
      if (isDifficultyCompatible(data.difficulty, config.difficultyLevel)) {
        results.push({
          original: word,
          translation: data.translation,
          phonetic: data.phonetic,
          difficulty: data.difficulty,
          fromCache: true
        });
      }
    }

    return results;
  }

  /**
   * 解析 API 响应
   * @param {string} content - API 返回内容
   * @returns {Array}
   */
  parseApiResponse(content) {
    try {
      // 尝试直接解析
      let parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      
      // 如果是对象包装的数组
      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results;
      }
      if (parsed.words && Array.isArray(parsed.words)) {
        return parsed.words;
      }
      
      return [];
    } catch (e) {
      // 尝试从文本中提取 JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e2) {
          console.error('[VocabMeld] Failed to parse API response:', e2);
        }
      }
      return [];
    }
  }
}

// 导出单例
export const apiService = new ApiService();
export default apiService;

