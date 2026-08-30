/* ============================================
   OTAKU NEWS — anilist.js
   Two-way bridge between a local star rating and the visitor's own
   AniList account.

   WHY THIS IS BUILT THE WAY IT IS (each point verified against the live
   schema / a live request, not from memory):
   • AniList has no "rate something 1-10" endpoint. Pushing a rating is done by
     writing the score onto the user's own *list entry* —
     `SaveMediaListEntry(mediaId, status, score)`. Unauthenticated call returns
     401 "Unauthorized.", i.e. the mutation exists and only needs a token.
   • `SaveReview` is NOT usable for a star rating. Its server-side validation
     rejects `body` under 2600 chars and `summary` over 120 — confirmed by a real
     400 response. So a 5-star "meh" can never become an AniList review; we only
     offer the review path when the comment is long enough, and say why otherwise.
   • SaveReview's args are (id, mediaId, body, summary, score, private) — there is
     NO `status` argument, so we must not send one.
   • `score` is interpreted per the user's own MediaListScoreType
     (POINT_100 / POINT_10_DECIMAL / POINT_10 / POINT_5 / POINT_3), so a "4★" has
     to be re-expressed for each format — see toAniScore().
   • Auth is the OAuth2 *authorization code* grant:
     https://anilist.co/api/v2/oauth/authorize?client_id=…&response_type=code.
     The CODE comes back in the query string; consumeRedirect() exchanges it at
     POST /api/v2/oauth/token, so the token still never reaches any server of ours
     (the browser talks straight to AniList — no backend needed).
     WHY NOT IMPLICIT ANYMORE: apps created on the current developer page only
     allow the code grant, and AniList rejects the legacy response_type=token
     request with {"error":"unsupported_grant_type"} (reproduced live). The
     fragment path is kept only for apps registered as *implicit* before that.
     WHY FORM-URLENCODED: a JSON body would trigger a CORS preflight, and OPTIONS
     to the token endpoint returns 404 (verified live) — a preflight can never
     pass, so the exchange must be a "simple request".
     Tokens are long-lived (1 year); AniList has no refresh tokens and no scopes.
   • Because a token means full write access to that account, it is kept in this
     browser only (localStorage) and never copied to Firestore or a server of ours.

   Requires: nothing (not even Firebase). Exposes: window.otakuAniList
   ============================================ */

(function () {
  var EP = "https://graphql.anilist.co";
  var AUTH_URL = "https://anilist.co/api/v2/oauth/authorize";
  var TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
  var LS_TOKEN = "otaku-anilist-token";
  var LS_CLIENT = "otaku-anilist-client";
  var LS_SECRET = "otaku-anilist-secret";
  var LS_STATE = "otaku-anilist-state";
  var LS_USER = "otaku-anilist-user";

  var FORMAT_LABEL = {
    POINT_100: "100-point", POINT_10_DECIMAL: "10-decimal", POINT_10: "10-point",
    POINT_5: "5-star", POINT_3: "3-smiley"
  };

  // AniList applications: https://anilist.co/settings/developer — the redirect URL
  // there must match wherever this site is hosted. Left empty, the connect flow is
  // disabled and ratings simply stay local instead of showing a broken button.
  function clientId() { try { return localStorage.getItem(LS_CLIENT) || ""; } catch (e) { return ""; } }
  function setClient(id) {
    id = (id || "").trim();
    try { id ? localStorage.setItem(LS_CLIENT, id) : localStorage.removeItem(LS_CLIENT); } catch (e) {}
  }
  // The secret, when the owner's app has one (the current developer page shows one
  // next to the client ID). Kept in this browser only — account.js deliberately
  // never mirrors it into the Firestore profile, unlike the client ID.
  function clientSecret() { try { return localStorage.getItem(LS_SECRET) || ""; } catch (e) { return ""; } }
  function setSecret(s) {
    s = (s || "").trim();
    try { s ? localStorage.setItem(LS_SECRET, s) : localStorage.removeItem(LS_SECRET); } catch (e) {}
  }

  function token() { try { return localStorage.getItem(LS_TOKEN) || ""; } catch (e) { return ""; } }
  function setToken(t) {
    try { t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN); } catch (e) {}
    if (!t) { try { localStorage.removeItem(LS_USER); } catch (e) {} }
  }
  function cachedUser() {
    try { return JSON.parse(localStorage.getItem(LS_USER) || "null"); } catch (e) { return null; }
  }
  function cacheUser(u) { try { localStorage.setItem(LS_USER, JSON.stringify(u)); } catch (e) {} }
  // AniList access tokens are JWTs whose payload holds { uid, exp }. Decoding
  // locally means "linked as <name>" is instantly correct even if the API is
  // unreachable — no request, nothing sent anywhere, and it works offline.
  function decodeToken(t) {
    try {
      // Only fall back to the STORED token when no argument was passed. With a
      // falsy-but-present value like '' doing `t || token()` would decode the
      // session's real token and hand back a valid identity — surprising, and
      // wrong for any caller using the result as a sanity check.
      var src = (arguments.length === 0 || t === undefined || t === null) ? token() : t;
      if (typeof src !== 'string' || !src) return null;
      var part = src.split('.')[1];
      if (!part) return null;
      part = part.replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      var raw = atob(part);
      // Browsers tolerate stray characters in atob, so 'not-a-jwt' decodes to
      // junk that JSON.parse can still accept. Require the real token shape
      // before handing anything back — a caller must never see a truthy {} here.
      if (!raw || raw.length < 8) return null;
      var p;
      try { p = JSON.parse(decodeURIComponent(escape(raw))); } catch (e) { return null; }
      if (!p || typeof p !== 'object' || typeof p.uid !== 'number') return null;
      var out = { id: p.uid };
      if (p.exp) {
        out.expiresAt = p.exp * 1000;
        out.expired = p.exp * 1000 < Date.now();
        out.daysLeft = Math.floor((p.exp * 1000 - Date.now()) / 86400000);
      }
      return out;
    } catch (e) { return null; }
  }

  // A stored guess from the last online visit, so the UI isn't blank before /v
  function remembered() { return cachedUser(); }

  function cachedUserFormat() {
    var u = cachedUser();
    return (u && u.scoreFormat) || "POINT_10_DECIMAL";
  }

  // The registered callback, or "" when it can never match (file://).
  function redirectUri() {
    if (/^https?:$/.test(location.protocol)) return location.origin + location.pathname;
    return "";
  }

  function randState() {
    try {
      var b = new Uint8Array(16);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
      else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
      var hex = "";
      for (var j = 0; j < b.length; j++) hex += ("0" + b[j].toString(16)).slice(-2);
      return hex;
    } catch (e) { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  }

  // Begin the authorization code grant. state is kept in this browser so the
  // return trip can prove the redirect is ours (CSRF); a stale entry is dropped
  // by the age check in consumeRedirect().
  function authUrl() {
    var id = clientId();
    if (!id) return "";
    var state = randState();
    try { localStorage.setItem(LS_STATE, JSON.stringify({ s: state, t: Date.now() })); } catch (e) {}
    var q = "client_id=" + encodeURIComponent(id) + "&response_type=code";
    var ru = redirectUri();
    if (ru) q += "&redirect_uri=" + encodeURIComponent(ru);
    q += "&state=" + encodeURIComponent(state);
    return AUTH_URL + "?" + q;
  }

  // Optional server-side exchange. When the site sets
  // window.OTAKU_ANILIST_TOKEN_PROXY (a Firebase Cloud Function that performs the
  // code→token POST — see functions/index.js), the browser hands it ONLY the
  // one-use code; the client secret then lives on the server, not in this
  // browser, and CORS is answered by the function itself. Left empty, the
  // exchange goes straight from this browser to AniList (the form-urlencoded
  // path below) and the secret must be present here.
  function tokenProxy() {
    try {
      var p = window.OTAKU_ANILIST_TOKEN_PROXY;
      return (typeof p === "string" && p) ? p : "";
    } catch (e) { return ""; }
  }

  // Exchange ?code=… for the token. "Simple request" on purpose when going
  // straight to AniList — form-urlencoded, no custom headers — because a JSON
  // body would raise a CORS preflight and OPTIONS to that endpoint 404s
  // (verified live). Through the proxy the body is JSON, but the proxy (not
  // AniList) is the CORS peer and answers the preflight.
  function exchangeCode(code) {
    var proxy = tokenProxy();
    if (proxy) {
      return fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ code: code })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (j && j.token) return j.token;
          var msg = (j && (j.error || j.message)) || ("token proxy HTTP " + res.status);
          if (res.status === 404) {
            msg = "token proxy answered 404 — the Cloud Function isn't deployed at this URL (yet). " +
                  "Check the deploy output and update window.OTAKU_ANILIST_TOKEN_PROXY in index.html.";
          }
          throw new Error(msg);
        });
      });
    }
    var body = "grant_type=authorization_code" +
      "&code=" + encodeURIComponent(code) +
      "&client_id=" + encodeURIComponent(clientId());
    var ru = redirectUri();
    if (ru) body += "&redirect_uri=" + encodeURIComponent(ru);
    var sec = clientSecret();
    if (sec) body += "&client_secret=" + encodeURIComponent(sec);
    return fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: body
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (j && j.access_token) return j.access_token;
        throw new Error((j && (j.message || j.error_description || j.error)) || "AniList HTTP " + res.status);
      });
    });
  }

  // Finish a login redirect. Resolves to:
  //   false          — nothing to consume
  //   true           — a token is stored (code exchange, or a legacy implicit app)
  //   { error: msg } — the flow failed; surface msg to the user
  function consumeRedirect() {
    // 1) Legacy implicit apps (registered before the code-grant era): the token
    //    sits in #access_token=… — read it and scrub the fragment straight away,
    //    otherwise it lingers in the address bar, history, and referer headers.
    var h = location.hash || "";
    if (h.indexOf("access_token=") !== -1) {
      var params = new URLSearchParams(h.replace(/^#/, ""));
      var t = params.get("access_token");
      if (t) {
        setToken(t);
        history.replaceState(null, "", location.pathname + location.search);
        return Promise.resolve(true);
      }
    }
    var qs;
    try { qs = new URLSearchParams(location.search); } catch (e) { qs = null; }
    if (!qs) return Promise.resolve(false);
    // 2) Code grant: ?code=…&state=…
    var code = qs.get("code");
    if (code) {
      var got = qs.get("state") || "";
      var exp = "", age = 0;
      try {
        var st = JSON.parse(localStorage.getItem(LS_STATE) || "null") || {};
        exp = st.s || "";
        age = Date.now() - (st.t || 0);
      } catch (e) {}
      try { localStorage.removeItem(LS_STATE); } catch (e) {}
      // The code is single-use — scrub the URL before the network round-trip.
      history.replaceState(null, "", location.pathname);
      if (exp && got !== exp) {
        return Promise.resolve({ error: "State mismatch — the redirect was rejected for your own safety. Click Connect again." });
      }
      if (exp && age > 2 * 60 * 60 * 1000) {
        return Promise.resolve({ error: "That authorization lapsed — click Connect again." });
      }
      return exchangeCode(code).then(function (tok) {
        setToken(tok);
        return true;
      }).catch(function (e) {
        var m = (e && e.message) ? e.message : "The token exchange failed.";
        // A CORS/network block looks different from an API error: the request
        // never got an answer the browser would show us. Point at the path that
        // always works — a pasted token (anilist.co/settings/developer).
        if (/failed to fetch|networkerror|load failed|network request/i.test(m)) {
          m = "the browser blocked the token exchange before it could answer (cross-origin). " +
              "Use the \"paste a token\" option here instead — a token is available at anilist.co/settings/developer.";
        }
        return { error: m };
      });
    }
    // 3) The user declined, or AniList sent an error back in the query.
    if (qs.get("error")) {
      history.replaceState(null, "", location.pathname);
      return Promise.resolve({ error: qs.get("error_description") || qs.get("error") });
    }
    return Promise.resolve(false);
  }

  function gql(query, variables) {
    var headers = { "Content-Type": "application/json", Accept: "application/json" };
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;
    return fetch(EP, {
      method: "POST", headers: headers,
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (res.status === 401 || res.status === 403) {
          var e401 = new Error("AniList rejected the token — reconnect your account.");
          e401.needAuth = true;
          throw e401;
        }
        if (json.errors && json.errors.length) {
          var first = json.errors[0];
          var v = first.validation;
          var msg = v
            ? Object.keys(v).map(function (k) { return v[k].join(" "); }).join(" ")
            : (first.message || "AniList request failed");
          var e = new Error(msg);
          e.validation = v || null;
          e.status = first.status || res.status;
          throw e;
        }
        if (res.status === 429) throw new Error("AniList rate limit hit — try again in a minute.");
        return json.data;
      });
    });
  }

  // Local rating is tenths: 10,20,…,100 (1–5 stars in half steps).
  // AniList's number means different things per user format.
  function toAniScore(tenths, format) {
    var star = Number(tenths) / 10;                       // 1 … 10 on a 10-pt axis
    switch (format) {
      case "POINT_100": return Math.round(tenths);        // 10 … 100
      case "POINT_10": return Math.max(1, Math.round(star));
      case "POINT_5": return Math.max(1, Math.round(star / 2));
      case "POINT_3": return Math.max(1, Math.min(3, Math.round(star / (10 / 3))));
      case "POINT_10_DECIMAL":
      default: return Math.round(star * 10) / 10;         // 1.0 … 10.0
    }
  }
  function fromAniScore(score, format) {
    var n = Number(score) || 0;
    if (!n) return null;
    switch (format) {
      case "POINT_100": return Math.round(n / 10) * 10;
      case "POINT_10": return Math.round(n) * 10;
      case "POINT_5": return Math.round(n * 2) * 10;
      case "POINT_3": return Math.round(n * (10 / 3) / 10) * 10;
      default: return Math.round(n * 10);
    }
  }

  // Live API returns a bare enum string; tolerate a wrapped object too, and
  // reject anything unknown rather than passing garbage into score mapping.
  function normaliseFormat(sf) {
    var x = (sf && typeof sf === "object") ? sf.scoreFormat : sf;
    return FORMAT_LABEL[x] ? x : "POINT_10_DECIMAL";
  }

  window.otakuAniList = {
    FORMAT_LABEL: FORMAT_LABEL,
    reviewLimits: { minBody: 2600, maxSummary: 120 },
    toAniScore: toAniScore,
    fromAniScore: fromAniScore,
    token: token,
    clientId: clientId,
    setClient: setClient,
    clientSecret: clientSecret,
    setSecret: setSecret,
    redirectUri: redirectUri,
    tokenProxy: tokenProxy,
    authUrl: authUrl,
    exchangeCode: exchangeCode,
    consumeRedirect: consumeRedirect,
    gql: gql,
    isConfigured: function () { return !!clientId(); },
    isConnected: function () { return !!token(); },
    decodeToken: decodeToken,
    disconnect: function () { setToken(""); return Promise.resolve(); },

    viewer: function () {
      return gql("query{Viewer{id name avatar{large medium} mediaListOptions{scoreFormat} siteUrl}}")
        .then(function (d) {
          var v = d.Viewer;
          if (!v) throw new Error("Token is valid but AniList returned no user — reconnect.");
          var u = {
            id: v.id, name: v.name,
            avatar: (v.avatar || {}).large || (v.avatar || {}).medium || "",
            // AniList returns this as a bare enum string, NOT an object — an earlier
          // version asked for scoreFormat{scoreFormat} and got a syntax error.
          scoreFormat: normaliseFormat((v.mediaListOptions || {}).scoreFormat),
            siteUrl: v.siteUrl
          };
          cacheUser(u);
          return u;
        })
        .catch(function (e) {
          // Offline / blocked / expired-token: answer from the JWT itself so the
          // account panel still tells the truth about who is linked.
          var d = decodeToken();
          var r = remembered();
          if (r && r.id && (!d || d.id === r.id) && !(d && d.expired)) return r;
          throw e;
        });
    },

    // Must read the existing entry first: writing status blindly would mark a
    // currently-watching show COMPLETED, which is not ours to decide.
    listEntry: function (mediaId) {
      return gql("query($id:Int){Media(id:$id){id mediaListEntry{status score progress}}}",
        { id: mediaId }).then(function (d) { return (d.Media || {}).mediaListEntry || null; });
    },

    pushScore: function (mediaId, tenths, opts) {
      opts = opts || {};
      var format = opts.scoreFormat || cachedUserFormat();
      var score = toAniScore(tenths, format);
      var status = opts.status || null;
      return gql(
        "mutation($id:Int,$st:MediaListStatus,$sc:Float){SaveMediaListEntry(mediaId:$id,status:$st,score:$sc){id score}}",
        { id: mediaId, st: status, sc: score }
      ).then(function (d) {
        return { entry: d.SaveMediaListEntry, score: score, format: format, review: null };
      });
    },

    // body must be >= 2600 chars and summary <= 120, both enforced by AniList, so
    // callers check canPushReview() first rather than eating a 400.
    canPushReview: function (text) { return (text || "").trim().length >= 2600; },
    // SaveReview.score is Int on a 1-100 axis (the API rejects Float outright),
    // so it needs its own mapping — sharing toAniScore() with list entries would
    // send 8 where 80 is meant.
    toAniReviewScore: function (tenths) {
      return Math.max(1, Math.min(100, Math.round(Number(tenths) || 0)));
    },

    pushReview: function (mediaId, tenths, summary, body, opts) {
      opts = opts || {};
      return gql(
        "mutation($id:Int,$sc:Int,$su:String!,$b:String!){SaveReview(mediaId:$id,score:$sc,summary:$su,body:$b){id score summary siteUrl}}",
        {
          id: mediaId,
          sc: this.toAniReviewScore(tenths),
          su: (summary || "").slice(0, 120), body: (body || "").trim()
        }
      );
    }
  };
})();
