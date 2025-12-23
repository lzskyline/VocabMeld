# VocabMeld 技术文档

本文档详细描述 VocabMeld 的技术实现方案。

---

## 项目结构

```
VocabMeld/
├── _locales/               # 国际化文件
│   ├── en/
│   │   └── messages.json
│   └── zh_CN/
│       └── messages.json
├── css/                    # 样式文件
│   ├── content.css         # 注入页面的样式
│   ├── options.css         # 设置页面样式
│   └── popup.css           # 弹出窗口样式
├── icons/                  # 图标文件
│   └── icon.svg
├── js/                     # JavaScript 文件
│   ├── background.js       # 后台脚本
│   ├── content.js          # 内容脚本 (核心逻辑)
│   ├── options.js          # 设置页面脚本
│   ├── popup.js            # 弹出窗口脚本
│   ├── core/               # 核心模块
│   │   ├── config.js       # 配置管理
│   │   └── storage.js      # 存储服务
│   └── services/           # 服务模块
│       ├── cache-service.js # 缓存服务
│       ├── content-segmenter.js # 内容分段
│       └── text-replacer.js # 文本替换
├── manifest.json           # Chrome 扩展配置
├── options.html            # 设置页面
├── popup.html              # 弹出窗口
├── package.json            # 项目配置
├── scripts/                # 构建脚本
│   └── build.js
└── README.md               # 项目说明
```

---

## 技术栈

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES6+)
- CSS Variables + Modern CSS

---

## 核心算法流程

### 页面处理流程

1. **智能分段与增量处理**
   - 通过 `ContentSegmenter` 对页面 DOM 进行遍历，将内容按"语义单元"智能分段
   - 仅处理新增或变化的内容，通过 MutationObserver 监听 DOM 变化
   - 为每个内容段落生成唯一指纹，防止重复处理

2. **精准且高效的 DOM 替换**
   - 采用原生 Range API 精确定位和替换文本节点，保持页面结构完整
   - 自动排除代码块、脚本、样式、已处理内容等
   - 大页面采用懒加载（滚动才按需翻译），动态内容采用防抖优化

3. **智能缓存与状态管理**
   - LRU 缓存机制：可配置容量（500-10000词），自动淘汰最少使用的词汇
   - 并发控制：3个段落同时处理，平衡性能与稳定性
   - 状态追踪：防止重复处理，优化用户体验

### 难度过滤算法

```javascript
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  const wordIdx = CEFR_LEVELS.indexOf(wordDifficulty);
  const userIdx = CEFR_LEVELS.indexOf(userDifficulty);
  // 只显示大于等于用户选择难度的词汇
  return wordIdx >= userIdx;
}
```

---

## CEFR 六级难度体系

| 等级 | 描述 | 词汇特征 |
|------|------|----------|
| A1 | 入门级 | 最基础的日常词汇，如 hello, thank you |
| A2 | 初级 | 简单日常交流词汇，如 weather, family |
| B1 | 中级 | 一般性话题词汇，如 opinion, experience |
| B2 | 中高级 | 抽象概念词汇，如 consequence, implement |
| C1 | 高级 | 专业/学术词汇，如 ubiquitous, paradigm |
| C2 | 精通级 | 罕见/文学词汇，如 ephemeral, quintessential |

**难度过滤逻辑**：用户选择 B2 时，系统显示 B2、C1、C2 难度的词汇（即该等级及以上），避免过于简单的词汇干扰。

---

## 缓存系统

### 缓存机制
- **容量**：可配置 500/1000/2000/5000/10000 个词汇（默认 2000）
- **存储格式**：`原文:源语言:目标语言` 作为键
- **持久化**：使用 `chrome.storage.local` 存储，跨会话保留
- **LRU 淘汰**：达到上限时淘汰最早加入的词汇

### 缓存命中逻辑
1. 发送 API 请求前，检查文本中是否有已缓存词汇
2. 已缓存词汇直接使用缓存结果，不发送给 API
3. 只将未缓存的词汇发送给 LLM 处理
4. 新词汇处理完成后加入缓存

### 优化后的翻译流程
- **先展示缓存**：缓存结果立即显示，无需等待 API
- **异步处理**：未缓存词汇后台异步处理，不阻塞页面
- **避免重复**：已替换的词汇不会被重复替换
- **智能限制**：如果缓存已满足配置，异步替换最多1个词

---

## LLM 智能选词规则

LLM 根据以下规则选择替换词汇：
- **避免替换**：专有名词、数字、代码、URL
- **优先选择**：常用词汇、有学习价值的词汇
- **难度评估**：为每个词汇标注 CEFR 等级（A1-C2）
- **动态数量**：根据用户设置的单词量动态调整翻译数量

---

## 页面内容处理

### 文本过滤规则
- 跳过明显的代码文本（变量声明、命令行等）
- 跳过特定 HTML 标签（script, style, code, pre 等）
- 跳过隐藏元素和可编辑元素

### 视口优先处理
- 优先处理视口内及附近 300px 范围的内容
- 滚动时按需处理新进入视口的内容

### 内容指纹去重
- 为每段文本生成指纹（取内容前100字符的哈希）
- 已处理的指纹存入 Set，避免重复处理
- 页面重新处理时清空指纹缓存

---

## 本地开发

1. 修改代码后，在 `chrome://extensions/` 页面点击刷新按钮
2. 或使用扩展开发工具的热重载功能

---

## 权限说明

| 权限 | 用途 |
|------|------|
| storage | 保存用户设置和学习数据 |
| activeTab | 获取当前标签页信息 |
| scripting | 在网页中注入翻译功能 |
| contextMenus | 提供右键菜单功能 |
| tts | 单词发音功能 |
| host_permissions (all_urls) | 在所有网站上提供翻译服务 |

