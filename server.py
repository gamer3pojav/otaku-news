#!/usr/bin/env python3
"""
OTAKU NEWS — server.py
Static file server + auth API (signup / login / logout / me).
Zero dependencies — pure Python stdlib.
Passwords: PBKDF2-HMAC-SHA256, 200k iterations, per-user salt.
Sessions: random 32-byte tokens in an HttpOnly cookie.
"""
import json, os, re, secrets, hashlib, time, gzip, io, urllib.request, xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from http import cookies

ROOT = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(ROOT, "users.json")
SESSIONS = {}  # token -> username (in-memory; resets on restart)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ---------- Live news (RSS proxy with cache) ----------
NEWS_FEEDS = [
    ("Anime Corner", "https://animecorner.me/feed/"),
    ("Crunchyroll News", "https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss"),
]
NEWS_CACHE = {"at": 0, "items": []}
NEWS_TTL = 86400  # 24 hours


def fetch_news():
    now = time.time()
    if now - NEWS_CACHE["at"] < NEWS_TTL and NEWS_CACHE["items"]:
        return NEWS_CACHE["items"]
    items = []
    for source, url in NEWS_FEEDS:
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OtakuNews/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                root = ET.fromstring(resp.read())
            NS = {"media": "http://search.yahoo.com/mrss/",
                  "dc": "http://purl.org/dc/elements/1.1/"}
            for item in root.iter("item"):
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                img = ""
                thumb = item.find("media:thumbnail", NS)
                if thumb is not None:
                    img = thumb.get("url", "")
                if not img:
                    mc = item.find("media:content", NS)
                    if mc is not None and (mc.get("type", "") or "").startswith("image"):
                        img = mc.get("url", "")
                if not img:
                    enc = item.find("enclosure")
                    if enc is not None and (enc.get("type", "") or "").startswith("image"):
                        img = enc.get("url", "")
                desc = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
                desc = re.sub(r"\s+", " ", desc).strip()[:220]
                pub = (item.findtext("pubDate") or "").strip()
                try:
                    ts = time.mktime(time.strptime(pub[:25].strip(), "%a, %d %b %Y %H:%M:%S"))
                except ValueError:
                    ts = 0
                author = (item.findtext("author") or item.findtext("dc:creator", namespaces=NS) or "").strip()
                # emails sometimes prefix the name: "a@b.com (Name)"
                am = re.search(r"\(([^)]+)\)", author)
                if am:
                    author = am.group(1)
                cats = [c.text.strip() for c in item.findall("category") if c.text]
                items.append({"title": title, "link": link, "desc": desc,
                              "date": pub, "ts": ts, "source": source, "img": img,
                              "author": author[:48],
                              "cat": (cats[0] if cats else "News")[:24]})
        except Exception as e:
            print("[otaku-news] feed error", source, e)
    # fetch og:image for stories whose feed had no image (bounded: max 8, cached via NEWS_CACHE)
    OG_RE1 = re.compile(r"og:image[\"'][^>]*content=[\"']([^\"']+)")
    OG_RE2 = re.compile(r"content=[\"']([^\"']+)[\"'][^>]*og:image")
    fetched = 0
    for it in items:
        if it["img"] or fetched >= 8:
            continue
        try:
            req = urllib.request.Request(it["link"], headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OtakuNews/1.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                head = resp.read(60000).decode("utf-8", "ignore")
            m2 = OG_RE1.search(head) or OG_RE2.search(head)
            if m2:
                it["img"] = m2.group(1)
            fetched += 1
        except Exception:
            fetched += 1
    items.sort(key=lambda x: x["ts"], reverse=True)
    # dedupe: exact links + near-identical titles across feeds
    seen_links, seen_titles, unique = set(), set(), []
    for it in items:
        key = re.sub(r"[^a-z0-9]", "", it["title"].lower())[:40]
        if it["link"] in seen_links or key in seen_titles:
            continue
        seen_links.add(it["link"])
        seen_titles.add(key)
        unique.append(it)
    items = unique
    if items:
        NEWS_CACHE["at"] = now
        NEWS_CACHE["items"] = items[:30]
    return NEWS_CACHE["items"]


SUBS_FILE = os.path.join(ROOT, "subscribers.json")


def load_subs():
    if os.path.exists(SUBS_FILE):
        with open(SUBS_FILE) as f:
            return json.load(f)
    return []


def save_subs(subs):
    with open(SUBS_FILE, "w") as f:
        json.dump(subs, f, indent=2)


def load_users():
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE) as f:
            return json.load(f)
    return {}


def save_users(users):
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 200_000
    ).hex()
    return salt, digest


GZIP_TYPES = ('.html', '.css', '.js', '.json', '.svg')
CACHE_TYPES = {'.jpg': 604800, '.jpeg': 604800, '.webp': 604800, '.png': 604800,
               '.css': 3600, '.js': 3600}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # gzip static text files + cache headers for assets
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            idx = os.path.join(path, 'index.html')
            if os.path.isfile(idx):
                path = idx
        ext = os.path.splitext(path)[1].lower()
        accepts_gzip = 'gzip' in (self.headers.get('Accept-Encoding') or '')

        if os.path.isfile(path) and ext in GZIP_TYPES and accepts_gzip:
            try:
                with open(path, 'rb') as f:
                    raw = f.read()
                buf = io.BytesIO()
                with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=6) as gz:
                    gz.write(raw)
                data = buf.getvalue()
                self.send_response(200)
                self.send_header('Content-Type', self.guess_type(path))
                self.send_header('Content-Encoding', 'gzip')
                self.send_header('Content-Length', str(len(data)))
                if ext in CACHE_TYPES:
                    self.send_header('Cache-Control', f'max-age={CACHE_TYPES[ext]}')
                self.end_headers()
                return io.BytesIO(data)
            except OSError:
                pass
        return super().send_head()

    # ---------- helpers ----------
    def send_json(self, code, payload, set_cookie=None):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return {}

    def current_user(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        token = c.get("otaku_session")
        return SESSIONS.get(token.value) if token else None

    # ---------- routes ----------
    def do_POST(self):
        if self.path == "/api/signup":
            return self.api_signup()
        if self.path == "/api/login":
            return self.api_login()
        if self.path == "/api/logout":
            return self.api_logout()
        if self.path == "/api/subscribe":
            return self.api_subscribe()
        if self.path == "/api/unsubscribe":
            return self.api_unsubscribe()
        self.send_json(404, {"error": "Not found"})

    def do_GET(self):
        if self.path == "/api/me":
            user = self.current_user()
            return self.send_json(200, {"user": user})
        if self.path == "/api/news":
            return self.send_json(200, {"items": fetch_news()})
        super().do_GET()

    # ---------- auth ----------
    def api_signup(self):
        data = self.read_body()
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", username):
            return self.send_json(400, {"error": "Username must be 3-20 chars (letters, numbers, _)."})
        if not EMAIL_RE.fullmatch(email):
            return self.send_json(400, {"error": "That email doesn't look right."})
        if len(password) < 8:
            return self.send_json(400, {"error": "Password must be at least 8 characters."})

        users = load_users()
        key = username.lower()
        if key in users:
            return self.send_json(409, {"error": "Username already taken."})
        if any(u["email"] == email for u in users.values()):
            return self.send_json(409, {"error": "Email already registered."})

        salt, digest = hash_password(password)
        users[key] = {"username": username, "email": email, "salt": salt, "hash": digest}
        save_users(users)
        return self.start_session(username)

    def api_login(self):
        data = self.read_body()
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        users = load_users()
        user = users.get(username)
        if not user:
            return self.send_json(401, {"error": "Invalid username or password."})
        _, digest = hash_password(password, user["salt"])
        if not secrets.compare_digest(digest, user["hash"]):
            return self.send_json(401, {"error": "Invalid username or password."})
        return self.start_session(user["username"])

    def api_logout(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        token = c.get("otaku_session")
        if token:
            SESSIONS.pop(token.value, None)
        expired = "otaku_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        return self.send_json(200, {"ok": True}, set_cookie=expired)

    # ---------- newsletter ----------
    def api_subscribe(self):
        data = self.read_body()
        email = (data.get("email") or "").strip().lower()
        if not EMAIL_RE.fullmatch(email):
            return self.send_json(400, {"error": "That email doesn't look right."})
        subs = load_subs()
        if email in subs:
            return self.send_json(200, {"ok": True, "already": True})
        subs.append(email)
        save_subs(subs)
        return self.send_json(200, {"ok": True})

    def api_unsubscribe(self):
        data = self.read_body()
        email = (data.get("email") or "").strip().lower()
        subs = load_subs()
        if email in subs:
            subs.remove(email)
            save_subs(subs)
            return self.send_json(200, {"ok": True})
        return self.send_json(404, {"error": "This email isn't on the list."})

    def start_session(self, username):
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = username
        cookie = f"otaku_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800"
        return self.send_json(200, {"user": username}, set_cookie=cookie)

    def log_message(self, fmt, *args):
        print("[otaku-news]", fmt % args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    print("Otaku News server on http://0.0.0.0:8000")
    server.serve_forever()
