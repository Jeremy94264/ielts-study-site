# -*- coding: utf-8 -*-
"""Fetch Bilibili video pages and extract title/description/INITIAL_STATE info."""
import gzip
import json
import re
import ssl
import sys
import urllib.request

URLS = {
    "BV1C2E76zEmk": "https://www.bilibili.com/video/BV1C2E76zEmk/",
    "BV1yMbCetEh6": "https://www.bilibili.com/video/BV1yMbCetEh6/",
    "BV1WA7a6GEqd": "https://www.bilibili.com/video/BV1WA7a6GEqd/",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
}

CTX = ssl.create_default_context()
CTX.check_hostname = True
CTX.verify_mode = ssl.CERT_REQUIRED


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=40, context=CTX) as resp:
        raw = resp.read()
        enc = (resp.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        elif enc == "br":
            import brotli  # may not be installed
            raw = brotli.decompress(raw)
    return raw

def extract_meta(html, pattern):
    m = re.search(pattern, html)
    return m.group(1) if m else None


def main():
    out = []
    for bvid, url in URLS.items():
        out.append("=" * 70)
        out.append("URL: %s" % url)
        try:
            raw = fetch(url)
            # Bilibili pages are UTF-8; decode with fallback
            try:
                html = raw.decode("utf-8")
            except UnicodeDecodeError:
                html = raw.decode("utf-8", errors="replace")
            out.append("FETCH_OK length=%d" % len(html))

            title = extract_meta(html, r"<title[^>]*>(.*?)</title>")
            out.append("TITLE: %s" % (title.strip() if title else "NOT FOUND"))

            og_title = extract_meta(html, r'<meta[^>]*property="og:title"[^>]*content="([^"]*)"')
            out.append("OG_TITLE: %s" % (og_title if og_title else "NOT FOUND"))

            og_desc = extract_meta(html, r'<meta[^>]*property="og:description"[^>]*content="([^"]*)"')
            out.append("OG_DESC: %s" % (og_desc if og_desc else "NOT FOUND"))

            meta_desc = extract_meta(html, r'<meta[^>]*name="description"[^>]*content="([^"]*)"')
            out.append("META_DESC: %s" % (meta_desc if meta_desc else "NOT FOUND"))

            # window.__INITIAL_STATE__
            m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});\s*\(function", html, re.S)
            if not m:
                m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});", html, re.S)
            if m:
                try:
                    state = json.loads(m.group(1))
                    out.append("INITIAL_STATE: PARSED OK")
                    vd = state.get("videoData") or {}
                    if vd:
                        out.append("VIDEO_TITLE: %s" % vd.get("title", "N/A"))
                        out.append("VIDEO_BVID: %s" % vd.get("bvid", "N/A"))
                        owner = vd.get("owner") or {}
                        if owner:
                            out.append("OWNER_NAME: %s" % owner.get("name", "N/A"))
                            out.append("OWNER_MID: %s" % owner.get("mid", "N/A"))
                            out.append("OWNER_FACE: %s" % owner.get("face", "N/A"))
                        desc = vd.get("desc") or ""
                        out.append("VIDEO_DESC(len=%d): %s" % (len(desc), desc[:2000]))
                        pubdate = vd.get("pubdate")
                        out.append("PUBDATE: %s" % pubdate)
                        out.append("PAGES: %s" % json.dumps(vd.get("pages"), ensure_ascii=False)[:500])
                    else:
                        # fall back to top-level desc/title
                        out.append("STATE_KEYS: %s" % sorted(state.keys())[:20])
                        out.append("STATE_TITLE: %s" % state.get("title", "N/A"))
                        d = state.get("desc") or ""
                        out.append("STATE_DESC(len=%d): %s" % (len(d), d[:2000]))
                except Exception as e:
                    out.append("INITIAL_STATE: JSON PARSE FAIL -> %s" % e)
                    out.append("INITIAL_STATE_RAW(len=%d): %s" % (len(m.group(1)), m.group(1)[:800]))
            else:
                out.append("INITIAL_STATE: NOT FOUND")
                # check if it's a verification/risk page
                if "验证" in html or "risk" in html.lower() or "wbi" in html:
                    out.append("PAGE_HINT: maybe verification/risk page")
        except Exception as e:
            out.append("FETCH_FAIL: %r" % e)
        out.append("")
    return "\n".join(out)


if __name__ == "__main__":
    text = main()
    with open("bili_result.txt", "w", encoding="utf-8") as f:
        f.write(text)
    print("done, wrote bili_result.txt, %d chars" % len(text))
