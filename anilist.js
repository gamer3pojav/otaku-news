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
   • Auth is OAuth2 *implicit* grant: https://anilist.co/api/v2/oauth/authorize
     ?client_id=…&response_type=token. The token comes back in the URL FRAGMENT, so
     it never reaches any server — which is exactly why no backend is needed.
     Tokens are long-lived (1 year); AniList has no refresh tokens and no scopes.
   • Because a token means full write access to that account, it is kept in this
     browser only (localStorage) and never copied to Firestore or a server of ours.

   Requires: nothing (not even Firebase). Exposes: window.otakuAniList
   ============================================ */

(function () {
  var EP = "https://graphql.anilist.co";
  var AUTH_URL = "https://anilist.co/api/v2/oauth/authorize";
  var LS_TOKEN = "otaku-anilist-token";
  var LS_CLIENT = "otaku-anilist-client";
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

  function token() { try { return localStorage.getItem(LS_TOKEN) || ""; } catch (e) { return ""; } }
  function setToken(t) {
    try { t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN); } catch (e) {}
    if (!t) { try { localStorage.removeItem(LS_USER); } catch (e) {} }
  }
  function cachedUser() {
    try { return JSON.parse(localStorage.getItem(LS_USER) || "null"); } catch (e) { return null; }
  }
  function cacheUser(u) { try { localStorage.setItem(LS_USER, JSON.stringify(u)); } catch (e) {} }
  function cachedUserFormat() {
    var u = cachedUser();
    return (u && u.scoreFormat) || "POINT_10_DECIMAL";
  }

  // Finish the implicit grant. The token sits in #access_token=…, so it is read here
  // and the fragment is scrubbed straight away — otherwise it stays in the address
  // bar, in history, and in any referer header the page later sends.
  function consumeRedirect() {
    var h = location.hash || "";
    if (h.indexOf("access_token=") === -1) return false;
    var params = new URLSearchParams(h.replace(/^#/, ""));
    var t = params.get("access_token");
    if (!t) return false;
    setToken(t);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }

  function authUrl() {
    var id = clientId();
    if (!id) return "";
    var q = "client_id=" + encodeURIComponent(id) + "&response_type=token";
    // Only send redirect_uri when actually http(s)-hosted; a file:// origin can
    // never be a registered callback and AniList would reject the whole request.
    if (/^https?:$/.test(location.protocol)) {
      q += "&redirect_uri=" + encodeURIComponent(location.origin + location.pathname);
    }
    return AUTH_URL + "?" + q;
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
    authUrl: authUrl,
    consumeRedirect: consumeRedirect,
    gql: gql,
    isConfigured: function () { return !!clientId(); },
    isConnected: function () { return !!token(); },
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
