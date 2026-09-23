import urllib.request, re, json, time, os

BASE = "http://book.qsbdc.com/word_list.php"
BOOK = 1787
OUT = r"D:\dsh workspace\tools\extraction\qs_groups.json"

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
        except Exception as e:
            if t == tries - 1:
                return None
            time.sleep(1)

data = {}
groups = list(range(25012, 25028))
for g in groups:
    entries = []
    # discover max page
    h = get(f"{BASE}?book_id={BOOK}&tag=all&group_id={g}&page_id=1")
    if not h:
        print(g, "FETCH FAIL")
        continue
    maxpage = 1
    pgs = [int(x) for x in re.findall(r"page_id=(\d+)", h)]
    if pgs:
        maxpage = max(pgs)
    for pid in range(1, maxpage + 1):
        hh = h if pid == 1 else get(f"{BASE}?book_id={BOOK}&tag=all&group_id={g}&page_id={pid}")
        if not hh:
            continue
        ws = re.findall(r'class="hidden_1_1"[^>]*>(.*?)</span>', hh)
        ws = [re.sub(r"<[^>]+>", "", w).replace("&nbsp;", " ").strip() for w in ws]
        entries.extend([w for w in ws if w])
    data[str(g)] = entries
    print(f"group {g}: {len(entries)} words")
    time.sleep(0.3)

json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("saved", OUT, "total", sum(len(v) for v in data.values()))
