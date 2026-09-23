import json, re, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gloss

OCR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr_out")
QSD = json.load(open(r"D:\dsh workspace\tools\extraction\qs_dict.json", encoding="utf-8"))
BY_LOWER = gloss.build_index(QSD)

TP_START = {1:1, 4:2, 8:3, 11:4, 14:5, 18:6, 21:7, 24:8, 28:9}
TOTAL_PAGES = 31

# ---- confirmed OCR garbage tokens (all-caps / mixed-case / letter-glyph noise) ----
DROP = {
    "nkffi", "ILI", "BifiJL", "FhL-t", "fiA", "piace", "ruie", "fifi", "staner",
    "nxfi", "teievision", "Ykfi", "fiJ", "it",
}
# ---- confirmed OCR truncations / artifacts -> corrected headword ----
FIX = {
    "even t": "event",
    "( expo )": "expo",
}
# words that are legitimately capitalised in the book
KEEP_CAPS = {"Antarctica", "Cambridge", "Internet", "Oxford", "Trinity"}

WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*$")
NOISE_RE = re.compile(r"(?i)^(chapter|test\s*paper|section|unit|part)\b")
PAGENO_RE = re.compile(r"^\d{1,3}$")

def tp_of(p):
    tp = None
    for s, n in sorted(TP_START.items()):
        if p >= s: tp = n
    return tp

papers = {n: [] for n in range(1, 10)}
report = []

for p in range(1, TOTAL_PAGES + 1):
    tp = tp_of(p)
    lines = [l.strip() for l in open(os.path.join(OCR, f"p{p:02d}.txt"), encoding="utf-8").read().splitlines()]
    for ln in lines:
        if not ln or NOISE_RE.match(ln) or PAGENO_RE.match(ln):
            continue
        tok = ln
        if tok in FIX:
            tok = FIX[tok]
            report.append((p, tp, ln, tok, "fix"))
        elif not WORD_RE.match(tok):
            continue
        low = tok.lower()
        if low in DROP or tok in DROP:
            report.append((p, tp, tok, None, "drop"))
            continue
        if tok not in KEEP_CAPS:
            tok = low
        # normalise apostrophe
        tok = tok.replace("\u2019", "'")
        papers[tp].append(tok)

# dedupe preserving order, and enrich from the reference dictionary
final = {}
source_count = {}
missed = []
for tp, words in papers.items():
    seen, out = set(), []
    for w in words:
        key = w.lower()
        if key in seen:
            continue
        seen.add(key)
        entry = {"w": w}
        mean, ipa, how, ipa_borrowed = gloss.resolve(w, QSD, BY_LOWER)
        source_count[how.split(":")[0]] = source_count.get(how.split(":")[0], 0) + 1
        if mean:
            entry["m"] = mean
            if how.startswith("curated"):
                entry["d"] = 1          # 标记：人工补充，界面会加提示
            if ipa and ipa != "[]":
                entry["ipa"] = ipa
                if ipa_borrowed:
                    entry["ipad"] = 1   # 音标借自单数/词根形式
        else:
            missed.append((tp, w))
        out.append(entry)
    final[tp] = out

print("=== extracted garbage handling ===")
for r in report:
    print(f"  p{r[0]:02d} TP{r[1]}: {r[2]!r} -> {r[3]!r} ({r[4]})")

print("\n=== word count per test paper ===")
total = 0
for tp in range(1, 10):
    n = len(final[tp])
    total += n
    pages = [p for p in range(1, TOTAL_PAGES + 1) if tp_of(p) == tp]
    enriched = sum(1 for e in final[tp] if "m" in e)
    print(f"  Test Paper {tp}: {n:>3} words  (pdf pages {pages[0]}-{pages[-1]})  with Chinese gloss: {enriched}")
print(f"  TOTAL: {total}")

print("\n=== 释义来源分布 ===")
for k in sorted(source_count, key=lambda x: -source_count[x]):
    print(f"  {k:<12} {source_count[k]:>5}")

have = sum(1 for tp in final for e in final[tp] if e.get("m"))
print(f"\n释义覆盖: {have}/{total} = {have/total*100:.1f}%")
derived = sum(1 for tp in final for e in final[tp] if e.get("d"))
print(f"其中标注为「补充/派生」的: {derived}")

if missed:
    print(f"\n仍无释义的 {len(missed)} 个:")
    for tp, w in missed:
        print(f"  TP{tp}: {w}")

# cross-check against reference coverage
qs_union = set(w.lower() for w in QSD)
mine = set(e["w"].lower() for tp in final for e in final[tp])
print(f"\nwords also found in published word list: {len(mine & qs_union)}/{len(mine)}")

json.dump(final, open(r"D:\dsh workspace\tools\extraction\words_by_paper.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("saved words_by_paper.json")
