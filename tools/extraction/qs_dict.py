import urllib.request, re, json, time

BASE = "http://book.qsbdc.com/word_list.php"
BOOK = 1787
OUT = r"D:\dsh workspace\tools\extraction\qs_dict.json"

def get(url, tries=3):
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            for enc in ("utf-8", "gb18030"):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    continue
            return raw.decode("utf-8", "replace")
        except Exception:
            if t == tries - 1:
                return None
            time.sleep(1)

ROW = re.compile(
    r'class="hidden_1_1"[^>]*>(?P<word>.*?)</span>.*?'
    r'class="hidden_2_1"[^>]*>(?P<ipa>.*?)</span>.*?'
    r'class="hidden_3_1"[^>]*>(?P<mean>.*?)</span>',
    re.S)

def clean(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", " ").replace("&amp;", "&")
    return s.strip()

entries = {}
for g in range(25012, 25028):
    h = get(f"{BASE}?book_id={BOOK}&tag=all&group_id={g}&page_id=1")
    if not h:
        print(g, "fail"); continue
    pgs = [int(x) for x in re.findall(r"page_id=(\d+)", h)] or [1]
    maxpage = max(pgs)
    count = 0
    for pid in range(1, maxpage + 1):
        hh = h if pid == 1 else get(f"{BASE}?book_id={BOOK}&tag=all&group_id={g}&page_id={pid}")
        if not hh: continue
        for m in ROW.finditer(hh):
            w = clean(m.group("word"))
            if not w: continue
            entries.setdefault(w, {"ipa": clean(m.group("ipa")), "mean": clean(m.group("mean"))})
            count += 1
    print(f"group {g}: {count} rows, dict size {len(entries)}")
    time.sleep(0.3)

json.dump(entries, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("saved", OUT, len(entries))
