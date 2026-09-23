import json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, "words_by_paper.json"), encoding="utf-8"))
OUT = os.path.join(HERE, "..", "tingxie", "data")
os.makedirs(OUT, exist_ok=True)


def esc(s):
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


total = 0
for tp in range(1, 10):
    words = data[str(tp)]
    total += len(words)
    lines = []
    for e in words:
        parts = ['w:"%s"' % esc(e["w"])]
        if e.get("m"):
            parts.append('m:"%s"' % esc(e["m"]))
        if e.get("ipa"):
            parts.append('ipa:"%s"' % esc(e["ipa"]))
        if e.get("d"):
            parts.append('d:1')                 # 释义为人工补充
        if e.get("ipad"):
            parts.append('ipad:1')              # 音标借自单数/词根形式
        lines.append("  {" + ",".join(parts) + "}")
    body = ",\n".join(lines)
    js = (
        "/* 雅思王听力语料库 Chapter 3 - Test Paper %d\n"
        "   来源：扫描版 PDF OCR 提取，共 %d 词 */\n"
        "window.CORPUS_DATA = window.CORPUS_DATA || {};\n"
        "window.CORPUS_DATA[%d] = [\n%s\n];\n" % (tp, len(words), tp, body)
    )
    p = os.path.join(OUT, "paper%d.js" % tp)
    open(p, "w", encoding="utf-8").write(js)
    derived = sum(1 for e in words if e.get("d"))
    print("paper%d.js  %3d words  (补充释义 %d)  %d bytes" % (tp, len(words), derived, len(js)))

manifest = {str(tp): {"count": len(data[str(tp)]), "file": "paper%d.js" % tp} for tp in range(1, 10)}
open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8").write(
    json.dumps(manifest, ensure_ascii=False, indent=1))
print("total words:", total)
