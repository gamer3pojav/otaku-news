#!/usr/bin/env python3
"""
serve.py — the "Plan A" backend Otaku News' script.js was written to use.

script.js:903 does `fetch('/api/news')` and, only if that fails, falls back to a
public rss2json proxy in the browser. This serves the real thing: it fetches the
same two feeds server-side, merges + dedupes them, and caches for 24h (matching
the "refreshes every 24h" label the site renders).

Static files are served from this script's own directory, so it runs from wherever
the site lives. The .js MIME type matters: firebase-init.js is loaded as
`<script type="module">`, and a browser refuses a module unless the response is a
JavaScript MIME type.

    python3 serve.py [port]        # default 8000
"""
import email.utils
import html
import http.server
import json
import os
import re
import socketserver
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE_SECS = 24 * 3600  # matches the site's own "refreshes every 24h" copy

FEEDS = [
    ("Anime Corner", "https://animecorner.me/feed/"),
    ("Crunchyroll News", "https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss"),
]

# AniList (and other feeds) reject the default Python-urllib UA with a 403.
UA = "Mozilla/5.0 (compatible; OtakuNews/1.0; local dev backend)"
_cache = {"items": None, "at": 0.0}

TAG_RE = re.compile(r"<[^>]*>")
IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)', re.I)


def clean(text, limit=None):
    if not text:
        return ""
    out = html.unescape(TAG_RE.sub(" ", text))
    out = re.sub(r"\s+", " ", out).strip()
    return out[:limit] if limit else out


def first_image(entry_html, link):
    m = IMG_RE.search(entry_html or "")
    if m:
        return html.unescape(m.group(1))
    return "https://image.thum.io/get/ogImage/" + link if link else ""


def to_ts(entry):
    """pubDate (RFC822) or dc:date (ISO) -> unix seconds."""
    for tag in ("pubDate", "{http://purl.org/dc/elements/1.1/}date"):
        node = entry.find(tag)
        raw = node.text if node is not None else None
        if not raw:
            continue
        raw = raw.strip()
        try:
            return int(email.utils.parsedate_to_datetime(raw).timestamp())
        except Exception:
            pass
        try:  # ISO-8601, e.g. 2026-08-29T04:00:00+00:00
            return int(time.mktime(time.strptime(raw[:19], "%Y-%m-%dT%H:%M:%S")))
        except Exception:
            return 0
    return 0


def fetch_feed(source, url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        root = ET.fromstring(resp.read())
    items = []
    for entry in root.iter("item"):
        def text(tag):
            node = entry.find(tag)
            return node.text if node is not None else ""

        link = clean(text("link"))
        raw_desc = text("description") or ""
        content = entry.find("{http://purl.org/rss/1.0/modules/content/}encoded")
        author = entry.find("{http://purl.org/dc/elements/1.1/}creator")
        cat = entry.find("category")
        item_html = (content.text if content is not None else "") or raw_desc
        items.append({
            "title": clean(text("title")),
            "link": link,
            "desc": clean(raw_desc, 220),
            "ts": to_ts(entry),
            "source": source,
            "author": clean(author.text if author is not None else "", 48),
            "img": first_image(item_html, link),
            "cat": clean(cat.text if cat is not None else ""),
        })
    return [i for i in items if i["title"] and i["link"]]


def get_news():
    now = time.time()
    if _cache["items"] and now - _cache["at"] < CACHE_SECS:
        return _cache["items"]
    items = []
    for source, url in FEEDS:
        try:
            items.extend(fetch_feed(source, url))
        except Exception as exc:  # one dead feed must not kill the endpoint
            print(f"[api/news] feed failed: {source}: {exc.__class__.__name__}: {exc}")
    items.sort(key=lambda n: n["ts"], reverse=True)
    seen_links, seen_titles, deduped = set(), set(), []
    for n in items:
        key = re.sub(r"[^a-z0-9]", "", n["title"].lower())[:40]
        if n["link"] in seen_links or key in seen_titles:
            continue
        seen_links.add(n["link"])
        seen_titles.add(key)
        deduped.append(n)
    deduped = deduped[:30]  # same cap the browser fallback uses
    if deduped:  # never cache an empty/partial failure
        _cache["items"], _cache["at"] = deduped, now
    return deduped


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/api/news":
            try:
                body = json.dumps({"items": get_news()}).encode("utf-8")
            except Exception as exc:
                self.send_error(502, f"feeds unreachable: {exc}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):  # keep it quiet on image noise
        if "/assets/" in (args[0] if args else ""):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"Otaku News  •  http://0.0.0.0:{PORT}  •  serving {ROOT}")
    print(f"Live Wire backend: {', '.join(s for s, _ in FEEDS)} • cache {CACHE_SECS // 3600}h")
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
