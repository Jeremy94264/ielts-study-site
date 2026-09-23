# materials · 学习资料库

本站「📚 资料」模块的全部内容。所有**已处理的 PDF 原文**集中在此，按类型归档。

## 目录结构

```
materials/
├── pdf/          已处理的 PDF 原文（均已提取为站内可用的学习数据）
├── mindmap/      思维导图（.md 可在 markmap.js.org 渲染，.mm 可导入 XMind）
└── data/         由 PDF 提取的结构化数据
```

## pdf/ · 已处理的 PDF 原文

| 文件 | 大小 | 已提取为 | 提取结果 |
|------|------|----------|----------|
| `kaodianciku.pdf` | 1.0 MB | 单词 → 阅读538词汇 | 376 词条：第1类 20 + 第2类 100 + 第3类 256，含释义与真题同义替换 |
| `雅思王听力语料库-3.pdf` | 9.9 MB | 听力 → 单词听写 | 31 页扫描版经 OCR 提取 1114 词，按 Test Paper 1–9 分组，全部带中文释义 |
| `100个句子记完7000个雅思单词001-010.pdf` | 4.1 MB | 单词 → 100句记7000词 | Sentence 01–10 |
| `100个句子记完7000个雅思单词_011-100.pdf` | 24.4 MB | 单词 → 100句记7000词 | Sentence 11–100（合计 100 句 · 769 核心词条 · 186 主题分组） |

> PDF 均为原始影印/电子版，仅供个人学习使用。

## mindmap/ · 思维导图

| 文件 | 说明 |
|------|------|
| `雅思阅读538考点词_第一讲_思维导图.md` | Markmap 格式：内容粘贴到 markmap.js.org 即成交互式导图，也支持 VSCode Markmap 插件 |
| `雅思阅读538考点词_第一讲_思维导图.mm` | FreeMind XML 格式：可导入 XMind / MindMaster / FreeMind |

## data/ · 结构化数据

| 文件 | 说明 |
|------|------|
| `words_pdf_only.json` | 从 `pdf/kaodianciku.pdf` 提取的 376 个词条（单词 / 词性 / 释义 / 真题同义替换），是 `js/words-data.js` 的生成来源 |

## 数据提取管线

提取脚本与中间产物保存在 `../tools/`：

- `tools/extraction/` — 听力语料库 OCR 提取管线（Windows OCR + 词表校验）
- `tools/kaodianciku_full_decoded.txt`、`tools/kaodianciku_text.txt` — 538 词库 PDF 的解码文本
- `tools/bili_*.{py,txt}` — 538 考点词第一讲的视频信息获取脚本与结果

## 如何从 PDF 重新生成数据

1. 编辑/重新提取 PDF → 更新 `data/words_pdf_only.json`
2. 由 json 生成站点词库 `js/words-data.js`（`var IELTS_WORDS = [...]`，字段：`id / no / word / pos / meaning / syn / note / type`）
3. 刷新页面即可生效（学习进度存于浏览器 localStorage，不受影响）
