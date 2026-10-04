"""解析 Chapter 4 的 OCR 结果，生成候选词表供审查
------------------------------------------------------------
来源：《雅思王听力语料库》Chapter 4（Adjective / Adverb）
OCR：tools/extraction/ocr_out_ch4/p01..p11.txt（CW90 旋转）

页面 → Test Paper 映射（按书内 "Test Paper" 标题出现的位置确定）：
  p01-p03  Chapter 4 · Adjective · Test Paper 1
  p04-p06  Chapter 4 · Adjective · Test Paper 2
  p07-p10  Chapter 4 · Adjective · Test Paper 3
  p11      Chapter 4 · Adverb    · Test Paper 1（本 PDF 仅含首页，不完整）

用法: python analyze_ch4.py            # 生成候选词报告
"""
import json, os, re, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gloss

OCR = os.path.join(HERE, "ocr_out_ch4")
QSD = json.load(open(os.path.join(HERE, "qs_dict.json"), encoding="utf-8"))
BY_LOWER = gloss.build_index(QSD)

# 页 → 应用内的 paper 编号（Chapter 3 占用 1-9，Chapter 4 从 10 开始）
PAGE_TO_PAPER = {}
for p in (1, 2, 3):    PAGE_TO_PAPER[p] = 10   # 形容词 TP1
for p in (4, 5, 6):    PAGE_TO_PAPER[p] = 11   # 形容词 TP2
for p in (7, 8, 9, 10): PAGE_TO_PAPER[p] = 12  # 形容词 TP3
PAGE_TO_PAPER[11] = 13                          # 副词 TP1（不完整）

NOISE_RE = re.compile(r"(?i)^(chapter|test\s*paper|section|unit|part|adjective|adverb)\b")
PAGENO_RE = re.compile(r"^\d{1,3}$")
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*$")
# 正当的大写词（书中确实大写）
KEEP_CAPS = {"British", "Olympic", "English", "American", "European", "Chinese", "Internet"}

papers = {}
report = []
for p in sorted(PAGE_TO_PAPER):
    paper = PAGE_TO_PAPER[p]
    papers.setdefault(paper, [])
    path = os.path.join(OCR, "p%02d.txt" % p)
    for raw in open(path, encoding="utf-8").read().splitlines():
        ln = raw.strip()
        if not ln or NOISE_RE.match(ln) or PAGENO_RE.match(ln):
            continue
        # 归一化：破折号/全角连字符 -> 半角
        tok = ln.replace("\u2014", "-").replace("\u2013", "-").replace("\u2019", "'")
        if not WORD_RE.match(tok):
            report.append((p, paper, ln, None, "非单词行(IPA/噪声)"))
            continue
        if tok not in KEEP_CAPS:
            tok = tok.lower() if tok.islower() or tok.istitle() else tok
            if tok not in KEEP_CAPS:
                tok = tok.lower()
        papers[paper].append(tok)

# 去重 + 释义补全
result = {}
for paper in sorted(papers):
    seen, out = set(), []
    for w in papers[paper]:
        k = w.lower()
        if k in seen:
            continue
        seen.add(k)
        mean, ipa, how, borrowed = gloss.resolve(w, QSD, BY_LOWER)
        e = {"w": w}
        if mean:
            e["m"] = mean
            if how.startswith("curated"):
                e["d"] = 1
            if ipa and ipa != "[]":
                e["ipa"] = ipa
                if borrowed:
                    e["ipad"] = 1
        e["_how"] = how
        out.append(e)
    result[paper] = out

# ---------- 报告 ----------
b = io.StringIO()
b.write("Chapter 4 候选词统计\n")
b.write("=" * 66 + "\n")
for paper in sorted(result):
    withm = sum(1 for e in result[paper] if e.get("m"))
    b.write("  paper %d: %3d 词，有释义 %3d\n" % (paper, len(result[paper]), withm))
b.write("  合计: %d 词\n\n" % sum(len(v) for v in result.values()))

b.write("需要人工审查的候选（参考词典未命中，可能是 OCR 噪声或词典缺词）\n")
b.write("=" * 66 + "\n")
for paper in sorted(result):
    miss = [e for e in result[paper] if not e.get("m")]
    if not miss:
        continue
    b.write("  paper %d (%d 个):\n" % (paper, len(miss)))
    b.write("    " + ", ".join(e["w"] for e in miss) + "\n")
b.write("\n")

b.write("全部候选词（按 paper）\n")
b.write("=" * 66 + "\n")
for paper in sorted(result):
    b.write("  --- paper %d ---\n" % paper)
    words = [e["w"] for e in result[paper]]
    for i in range(0, len(words), 10):
        b.write("    " + "  ".join("%-16s" % w for w in words[i:i + 10]) + "\n")
    b.write("\n")

# 释义来源分布
from collections import Counter
c = Counter(e["_how"].split(":")[0] for v in result.values() for e in v)
b.write("释义来源分布: " + ", ".join("%s=%d" % (k, v) for k, v in c.most_common()) + "\n")

open(os.path.join(HERE, "_ch4_candidates.txt"), "w", encoding="utf-8").write(b.getvalue())
json.dump(result, open(os.path.join(HERE, "_ch4_raw.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(b.getvalue()[:1500])
print("...\n完整报告已写入 _ch4_candidates.txt")
