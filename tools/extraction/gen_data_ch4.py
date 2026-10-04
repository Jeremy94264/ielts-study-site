"""生成 Chapter 4 的网页数据文件 + 章节元数据
------------------------------------------------------------
输出：
  apps/tingxie/data/ch4_paper10.js … ch4_paper13.js   （window.CORPUS_DATA[10..13]）
  apps/tingxie/data/meta.js                            （window.CORPUS_META：章节与试卷标签）
  apps/tingxie/data/manifest.json                      （含章节信息的清单）

编号约定：Chapter 3 用 1-9，Chapter 4 接续 10-13。
应用内以编号为主键（SRS 与错题本记录 key = "p<编号>|<单词>"），因此编号必须全局唯一。
"""
import json, os, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "words_by_paper_ch4.json"), encoding="utf-8"))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "apps", "tingxie", "data"))
os.makedirs(OUT, exist_ok=True)


def esc(s):
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


# ---------- Chapter 4 各试卷的展示标签 ----------
LABELS = {
    10: "形容词 TP1",
    11: "形容词 TP2",
    12: "形容词 TP3",
    13: "副词 TP1",
}
INCOMPLETE = {13: True}      # 本 PDF 仅含副词部分首页

# ---------- 1) 生成 ch4_paperN.js ----------
total = 0
for paper in sorted(DATA, key=lambda x: int(x)):
    p = int(paper)
    words = DATA[paper]
    total += len(words)
    lines = []
    for e in words:
        parts = ['w:"%s"' % esc(e["w"])]
        if e.get("m"):
            parts.append('m:"%s"' % esc(e["m"]))
        if e.get("ipa"):
            parts.append('ipa:"%s"' % esc(e["ipa"]))
        if e.get("d"):
            parts.append("d:1")
        if e.get("ipad"):
            parts.append("ipad:1")
        lines.append("  {" + ",".join(parts) + "}")
    note = "（本 PDF 范围内不完整）" if INCOMPLETE.get(p) else ""
    js = (
        "/* 雅思王听力语料库 Chapter 4 · %s - %s%s\n"
        "   来源：扫描版 PDF《雅思王听力语料库_79-89.pdf》经 OCR 提取，共 %d 词 */\n"
        "window.CORPUS_DATA = window.CORPUS_DATA || {};\n"
        "window.CORPUS_DATA[%d] = [\n%s\n];\n"
        % ("形容词" if p < 13 else "副词", LABELS[p], note, len(words), p, ",\n".join(lines))
    )
    fn = os.path.join(OUT, "ch4_paper%d.js" % p)
    open(fn, "w", encoding="utf-8").write(js)
    curated = sum(1 for e in words if e.get("d"))
    print("  ch4_paper%-2d.js  %3d 词  (补充释义 %d)  %6d bytes" % (p, len(words), curated, len(js)))

# ---------- 2) 生成 meta.js（章节 + 试卷标签） ----------
CH3_COUNTS = {1: 110, 2: 140, 3: 113, 4: 111, 5: 143, 6: 111, 7: 101, 8: 146, 9: 139}
ch4_counts = {int(k): len(v) for k, v in DATA.items()}
ch3_total = sum(CH3_COUNTS.values())
ch4_total = sum(ch4_counts.values())

papers_meta = {}
for n in sorted(CH3_COUNTS):
    papers_meta[str(n)] = {"label": "Test Paper %d" % n, "chapter": "ch3", "count": CH3_COUNTS[n]}
for n in sorted(ch4_counts):
    papers_meta[str(n)] = {
        "label": LABELS[n] + ("（不完整）" if INCOMPLETE.get(n) else ""),
        "chapter": "ch4",
        "count": ch4_counts[n],
        "incomplete": bool(INCOMPLETE.get(n)),
    }

meta = {
    "chapters": [
        {
            "id": "ch3",
            "name": "Chapter 3 · 通用词汇",
            "short": "C3",
            "desc": "Test Paper 1–9 · %d 词" % ch3_total,
            "papers": list(range(1, 10)),
        },
        {
            "id": "ch4",
            "name": "Chapter 4 · 形容词 / 副词",
            "short": "C4",
            "desc": "形容词 TP1–3 + 副词 TP1 · %d 词" % ch4_total,
            "papers": sorted(ch4_counts),
        },
    ],
    "papers": papers_meta,
}
js = (
    "/* 听力语料库 · 章节与试卷元数据\n"
    "   由 tools/extraction/gen_data_ch4.py 生成；手工改动请同步数据文件。 */\n"
    "window.CORPUS_META = " + json.dumps(meta, ensure_ascii=False, indent=1) + ";\n"
)
open(os.path.join(OUT, "meta.js"), "w", encoding="utf-8").write(js)
print("\n  meta.js  %d bytes（%d 章节 / %d 试卷）" % (len(js), len(meta["chapters"]), len(papers_meta)))

# ---------- 3) 更新 manifest.json ----------
manifest = {"generated_by": "tools/extraction/gen_data_ch4.py", "chapters": {}}
for ch in meta["chapters"]:
    entry = {"name": ch["name"], "papers": {}}
    for n in ch["papers"]:
        pm = papers_meta[str(n)]
        entry["papers"][str(n)] = {
            "count": pm["count"],
            "file": ("paper%d.js" % n) if n <= 9 else ("ch4_paper%d.js" % n),
            "label": pm["label"],
        }
        if pm.get("incomplete"):
            entry["papers"][str(n)]["incomplete"] = True
    manifest["chapters"][ch["id"]] = entry
manifest["total_words"] = ch3_total + ch4_total
open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8").write(
    json.dumps(manifest, ensure_ascii=False, indent=1))
print("  manifest.json 已更新（总词数 %d）" % manifest["total_words"])
print("\nChapter 4 合计 %d 词" % total)
