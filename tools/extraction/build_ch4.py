"""构建 Chapter 4 词库（Adjective / Adverb）
------------------------------------------------------------
输入：tools/extraction/ocr_out_ch4/p01..p11.txt （Windows OCR，CW90 旋转）
输出：tools/extraction/words_by_paper_ch4.json

处理方式与 Chapter 3（build_words.py）一致：
  OCR 文本 → 清洗噪声 → 页→Test Paper 映射 → 去重 → 用 gloss.py 补释义/音标

Chapter 4 的 paper 编号接续 Chapter 3 的 1-9，从 10 开始（应用内按编号索引，
SRS 与错题本也以编号为键，因此不得与 Ch3 冲突）：
  10 = 形容词 Test Paper 1    11 = 形容词 Test Paper 2
  12 = 形容词 Test Paper 3    13 = 副词 Test Paper 1（本 PDF 只含该部分首页，不完整）
"""
import json, os, re, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gloss

OCR = os.path.join(HERE, "ocr_out_ch4")
QSD = json.load(open(os.path.join(HERE, "qs_dict.json"), encoding="utf-8"))
BY_LOWER = gloss.build_index(QSD)

# ---------- 页 → paper 编号（依据 OCR 中 "Test Paper" 标题出现的页） ----------
PAGE_TO_PAPER = {}
for p in (1, 2, 3):     PAGE_TO_PAPER[p] = 10
for p in (4, 5, 6):     PAGE_TO_PAPER[p] = 11
for p in (7, 8, 9, 10): PAGE_TO_PAPER[p] = 12
PAGE_TO_PAPER[11] = 13

PAPER_META = {
    10: ("形容词 · Test Paper 1", True),
    11: ("形容词 · Test Paper 2", True),
    12: ("形容词 · Test Paper 3", True),
    13: ("副词 · Test Paper 1", False),   # False = 本 PDF 范围内不完整
}

# ---------- OCR 噪声（音标行被 OCR 成纯字母时漏进来的碎片） ----------
DROP = {
    "ifi", "fikj", "dlfrontl", "eigfikj",      # paper 10
    "ieetfikj", "oafikj", "nnlfi", "dthfikj",  # paper 11
    "ilafikj", "itfikj", "ifjkfikj",           # paper 12
    "skeoslll", "tin",                         # paper 13（scarcely 的乱码音标 / 页尾噪声）
}
# ---------- OCR 误识 → 正确词形（均经音标行核对） ----------
FIX = {
    "cheelful": "cheerful",    # 音标 ['tT10fl] = /ˈtʃɪəfʊl/
    "visibie": "visible",      # 音标 ['vrzobl] = /ˈvɪzəbl/
    "finel": "final",          # 音标 ['faml] = /ˈfaɪnl/（同页另有 fine）
}
KEEP_CAPS = {"British", "Olympic"}
NOISE_RE = re.compile(r"(?i)^(chapter|test\s*paper|section|unit|part|adjective|adverb)\b")
PAGENO_RE = re.compile(r"^\d{1,3}$")
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*$")

# ---------- 参考词表未收录、但确属书中的词：人工补充释义 ----------
CURATED = {
    # paper 10
    "archaeological": "adj. 考古学的",
    "artificial": "adj. 人造的，人工的；虚假的",
    "cleanest": "adj. 最干净的（clean 的最高级）",
    "children's": "adj. 儿童的（children 的所有格）",
    "buried": "adj. 埋藏的，埋葬的（bury 的过去分词）",
    "cultural": "adj. 文化的，文化上的",
    "cheaper": "adj. 更便宜的（cheap 的比较级）",
    # paper 11
    "heavier": "adj. 更重的，更沉的（heavy 的比较级）",
    "higher": "adj. 更高的（high 的比较级）",
    "highly-trained": "adj. 训练有素的",
    "mid": "adj. 中间的，中部的",
    "Olympic": "adj. 奥林匹克的（Olympic Games 奥运会）",
    "optic": "adj. 光学的；眼的（optic nerve 视神经）",
    "optional": "adj. 可选的，非强制的",
    "non-active": "adj. 不活跃的，非主动的",
    # paper 12
    "printed": "adj. 印刷的，印制的（print 的过去分词）",
    "purest": "adj. 最纯的（pure 的最高级）",
    "queen's": "adj. 女王的（queen 的所有格）",
    "reinforced": "adj. 加强的，加固的（reinforce 的过去分词）",
    "smart": "adj. 聪明的；时髦的；智能的",
    "simple": "adj. 简单的；朴素的",
    "rising": "adj. 上升的，上涨的（rise 的现在分词）",
    "self-funded": "adj. 自筹资金的，自费的",
    "shared": "adj. 共享的，共用的（share 的过去分词）",
    "sleepy": "adj. 困倦的，想睡的",
    "specialised": "adj. 专门的，专业的（specialise 的过去分词）",
    "stable": "adj. 稳定的；牢固的",
    "stretching": "adj. 伸展的；n. 拉伸（stretch 的现在分词）",
    "washable": "adj. 可洗的，耐洗的",
    # paper 13
    "efficiently": "adv. 高效地，有效率地",
}
CURATED_ALL = dict(gloss.CURATED)
CURATED_ALL.update(CURATED)

# ---------- 解析 ----------
raw_papers = {}
report = []
for p in sorted(PAGE_TO_PAPER):
    paper = PAGE_TO_PAPER[p]
    raw_papers.setdefault(paper, [])
    text = open(os.path.join(OCR, "p%02d.txt" % p), encoding="utf-8").read()
    for raw in text.splitlines():
        ln = raw.strip()
        if not ln or NOISE_RE.match(ln) or PAGENO_RE.match(ln):
            continue
        tok = ln.replace("\u2014", "-").replace("\u2013", "-").replace("\u2019", "'")
        if not WORD_RE.match(tok):
            continue                       # 音标行 / 中文注释 / 含空格噪声 一律丢弃
        low = tok.lower()
        if low in DROP:
            report.append((p, paper, tok, None, "drop"))
            continue
        if low in FIX:
            tok = FIX[low]
            report.append((p, paper, ln, tok, "fix"))
        if tok not in KEEP_CAPS:
            tok = tok.lower()
        raw_papers[paper].append(tok)

# 去重 + 释义补全 + 字母排序
final = {}
src_count = {}
for paper in sorted(raw_papers):
    seen, out = set(), []
    for w in raw_papers[paper]:
        k = w.lower()
        if k in seen:
            continue
        seen.add(k)
        entry = {"w": w}
        mean, ipa, how, borrowed = gloss.resolve(w, QSD, BY_LOWER, CURATED_ALL)
        src_count[how.split(":")[0]] = src_count.get(how.split(":")[0], 0) + 1
        if mean:
            entry["m"] = mean
            if how.startswith("curated"):
                entry["d"] = 1
            if ipa and ipa != "[]":
                entry["ipa"] = ipa
                if borrowed:
                    entry["ipad"] = 1
        else:
            report.append((None, paper, w, None, "无释义"))
        out.append(entry)
    out.sort(key=lambda e: e["w"].lower())
    final[paper] = out

# ---------- 报告 ----------
print("=== OCR 噪声处理（drop / fix）===")
for r in report:
    if r[4] in ("drop", "fix"):
        print("  p%02d paper%-3d %-14r -> %-14r (%s)" % (r[0], r[1], r[2], r[3], r[4]))

print("\n=== 每个 Test Paper 词数 ===")
total = 0
for paper in sorted(final):
    n = len(final[paper])
    total += n
    enriched = sum(1 for e in final[paper] if e.get("m"))
    name, complete = PAPER_META[paper]
    pages = [p for p in sorted(PAGE_TO_PAPER) if PAGE_TO_PAPER[p] == paper]
    print("  paper %d  %-22s %3d 词  有释义 %3d  (pdf p%02d-%02d)%s"
          % (paper, name, n, enriched, pages[0], pages[-1], "" if complete else "  [不完整]"))
print("  合计: %d 词" % total)

print("\n=== 释义来源分布 ===")
for k in sorted(src_count, key=lambda x: -src_count[x]):
    print("  %-10s %4d" % (k, src_count[k]))
have = sum(1 for p in final for e in final[p] if e.get("m"))
print("\n释义覆盖: %d/%d = %.1f%%" % (have, total, have / total * 100))
print("人工补充(标 d:1，界面显示「补充」): %d" % sum(1 for p in final for e in final[p] if e.get("d")))

missed = [(p, e["w"]) for p in final for e in final[p] if not e.get("m")]
if missed:
    print("\n仍无释义: " + ", ".join("paper%d:%s" % (p, w) for p, w in missed))

json.dump({str(k): v for k, v in final.items()},
          open(os.path.join(HERE, "words_by_paper_ch4.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("\nsaved words_by_paper_ch4.json")
