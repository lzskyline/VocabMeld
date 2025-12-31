# VocabMeld - 沉浸式语言学习 Chrome 插件

<p align="center">
  <img src="icons/icon.svg" width="128" height="128" alt="VocabMeld Logo">
</p>

<p align="center">
  <strong>智能替换网页词汇，创造沉浸式双语学习环境</strong><br>
  <sub>基于「可理解性输入」理论，让语言学习融入日常生活</sub>
</p>

<p align="center">
  <a href="README_EN.md">English</a> | 中文
</p>

<p align="center">
  <img src="assets/preview.png" alt="VocabMeld Preview" width="100%">
</p>

---

>
> 为保证代码质量，本项目完全使用 **Claude Opus 4.5** 开发，价格非常昂贵。如果这个项目对你有帮助，欢迎在页面底部扫码打赏支持，你的支持是我继续更新的动力！⭐

---

## ✨ 核心亮点

- **多 LLM 支持** — 兼容 OpenAI、DeepSeek、Moonshot、Groq、Ollama 等主流 AI 服务
- **CEFR 难度区间** — 精准过滤 A1-C2 任意区间，避开过易/过难词汇
- **智能缓存加速** — LRU 缓存（最高 10000 词），二次访问毫秒级响应
- **双向翻译** — 自动检测页面语言，智能决定翻译方向
- **词汇管理** — 已学会词汇不再替换，需记忆词汇随时复习
- **主题定制** — 深色/浅色模式，多种配色方案可选

---

## 🚀 快速开始

### 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择本项目文件夹

### 配置 API

1. 点击扩展图标 → 设置
2. 选择预设服务（推荐 DeepSeek）或自定义配置
3. 填入 API 密钥，测试连接

### 支持的 API 服务

| 服务商 | 端点 | 推荐模型 |
|--------|------|----------|
| DeepSeek | `https://api.deepseek.com/chat/completions` | deepseek-chat |
| OpenAI | `https://api.openai.com/v1/chat/completions` | gpt-4o-mini |
| Moonshot | `https://api.moonshot.cn/v1/chat/completions` | moonshot-v1-8k |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | llama-3.1-8b-instant |
| Ollama | `http://localhost:11434/v1/chat/completions` | qwen2.5:7b |

---

## 📖 使用技巧

| 操作 | 说明 |
|------|------|
| `Alt+T` | 快速处理当前页面 |
| 悬停词汇 | 查看音标、难度、词典释义 |
| 点击音标 | 播放发音 |
| 点击"已学会" | 该词不再替换 |
| 点击"收藏记忆" | 加入记忆列表 |
| 选中生词 | 添加到需记忆列表 |

**推荐配置**：母语中文 + 学习英语 + B1 难度 + 适中强度

---

## 🔧 功能概览

### 替换强度

| 强度 | 每段最大替换 | 适用场景 |
|------|-------------|----------|
| 较少 | 4 词 | 轻度学习，保持阅读流畅 |
| 适中 | 8 词 | 日常学习，平衡阅读与学习 |
| 较多 | 14 词 | 强化学习，最大化词汇接触 |

### 显示样式

| 样式 | 显示格式 |
|------|---------|
| 译文(原文) | `translated(original)` — 默认 |
| 仅译文 | `translated` — 悬停查看原文 |
| 原文(译文) | `original(translated)` |

### 站点规则

- **所有网站模式**：默认在所有网站运行，可设置排除列表
- **仅指定网站模式**：只在指定的网站上运行
- 支持域名模糊匹配，Popup 中快速切换

---

## 🔒 隐私政策

- **本地存储**：所有数据存储在浏览器本地，不上传任何服务器
- **API 请求**：仅在翻译时发送文本片段到您配置的 AI 服务
- **您控制一切**：API 密钥由您自行提供和管理
- **无追踪**：不包含任何分析、追踪或广告代码

---

## 📚 更多文档

- [技术文档](TECHNICAL.md) — 项目架构、核心算法、开发说明

---

## ☕ 打赏

本项目完全开源，如果对你有帮助，欢迎打赏支持！

<p align="center">
  <img src="assets/wechat.jpg" alt="微信打赏" width="300">
</p>

---

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lzskyline/VocabMeld&type=Date)](https://star-history.com/#lzskyline/VocabMeld&Date)

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。

你可以自由地使用、复制、修改、分发本项目，包括商业用途。唯一要求是保留原版权声明和许可证。

如果你基于本项目进行了二次开发，欢迎标注：

```
Based on VocabMeld (https://github.com/lzskyline/VocabMeld)
```
