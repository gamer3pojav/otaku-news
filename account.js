/* ============================================
   OTAKU NEWS — account.js
   Profile page (picture / name / bio / socials), the account menu, and the
   "push my stars to AniList" wiring.

   Loaded on index.html, anime.html and browse.html so the menu works
   everywhere; on account.html it renders the profile editor itself.
   Depends on: firebase-init.js (window.otakuFirebase), features.js,
   anilist.js (window.otakuAniList) — all optional, it degrades quietly.
   ============================================ */
(function () {
  var FB = function () { return window.otakuFirebase; };
  var AL = function () { return window.otakuAniList; };
  var esc = function (s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var $ = function (id) { return document.getElementById(id); };

  // ---- CSS safety net: pages that forgot the <link> still look right ----
  if (!document.querySelector('link[href="account.css"]')) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'account.css';
    document.head.appendChild(l);
  }

  // ---- finish the AniList connect redirect before anything reads the token ----
  // consumeRedirect() now exchanges ?code=… for the token, so it is async; an
  // old cached anilist.js still returns a sync boolean — Promise.resolve()
  // copes with both without a reload.
  if (AL()) {
    Promise.resolve(AL().consumeRedirect()).then(function (r) {
      if (!r) return;                          // nothing to consume
      if (r && r.error) { toast('AniList connect failed — ' + r.error, true); return; }
      AL().viewer().then(function (u) {
        toast('AniList connected as ' + u.name);
        if (FB() && FB().auth.currentUser) {
          FB().saveProfile(FB().auth.currentUser.uid, {
            anilist: { connected: true, username: u.name, uid: u.id, scoreFormat: u.scoreFormat, connectedAt: Date.now() }
          }).catch(function () {});
        }
        renderMenuIfOpen();
        if (document.body.dataset.page === 'account' && window.__otakuRenderAni) window.__otakuRenderAni();
      }).catch(function (e) { toast('AniList token rejected — ' + e.message, true); });
    }).catch(function () {});
  }

  /* ------------------------------------------------------------ utils */
  var toastT;
  function toast(msg, bad) {
    var el = document.querySelector('.otaku-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'otaku-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:400;' +
        'padding:11px 18px;border-radius:100px;font:600 13px/1.4 system-ui;color:#fff;background:#1a1a1f;' +
        'box-shadow:0 12px 34px rgba(0,0,0,.3);max-width:82vw;text-align:center;transition:opacity .25s';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = bad ? '#c0273d' : '';
    el.style.opacity = '1';
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.style.opacity = '0'; }, 3200);
  }

  // Only http(s) survives — profile fields are user-supplied and rendered as hrefs.
  function safeUrl(v, host) {
    v = (v || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    var u;
    try { u = new URL(v); } catch (e) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (host && u.hostname.indexOf(host) === -1) return '';
    return u.href;
  }

  function fbReady() { return new Promise(function (res) { if (FB()) return res(FB()); var n = 0; var iv = setInterval(function () { if (FB() || ++n > 100) { clearInterval(iv); res(FB()); } }, 50); }); }

  /* ------------------------------------------------------------ profile API */
  var SOCIALS = [
    { key: 'x', label: 'X / Twitter', host: 'x.com', altHost: 'twitter.com', icon: '𝕏' },
    { key: 'instagram', label: 'Instagram', host: 'instagram.com', icon: '◎' },
    { key: 'youtube', label: 'YouTube', host: 'youtube.com', icon: '▶' },
    { key: 'twitch', label: 'Twitch', host: 'twitch.tv', icon: '▣' },
    { key: 'anilist', label: 'AniList', host: 'anilist.co', icon: 'A' },
    { key: 'site', label: 'Website', host: '', icon: '⌂' }
  ];
  var BIO_MAX = 280, NAME_MIN = 3, NAME_MAX = 20;

  function me() {
    var f = FB();
    return f && f.auth && f.auth.currentUser ? f.auth.currentUser : null;
  }
  // "Owner" = the account this site was built and first run on. Deliberately not
  // a box anyone can tick: with no auth claims available, any toggle would be a
  // lie a visitor could paste into localStorage.
  var OWNER_KEY = 'otaku-anilist-owner';
  function ownerAccount() { try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; } }
  // An explicit claim, not "first visitor wins by accident of page order": before
  // anyone claims it the field is closed to strangers, so an unclaimed site must
  // never read as "this caller is the owner".
  function isOwnerMode() {
    var u = me();
    if (!u) return false;
    var saved = ownerAccount();
    if (!saved) return false;                                   // nobody has claimed setup
    return saved.toLowerCase() === (u.displayName || u.email || '').toLowerCase();
  }
  function canClaimOwner() { return !!me() && !ownerAccount(); }
  function claimOwner() {
    var u = me(); if (!u || ownerAccount()) return false;
    try { localStorage.setItem(OWNER_KEY, u.displayName || u.email || ''); return true; } catch (e) { return false; }
  }
  function load() {
    var u = me();
    if (!u || !FB()) return Promise.resolve(null);
    return FB().loadProfile(u.uid).catch(function () { return null; });
  }
  function save(patch) {
    var u = me();
    if (!u) return Promise.reject(new Error('Not signed in.'));
    return FB().saveProfile(u.uid, patch).then(function () { paintChip(); return true; });
  }

  // Downscale in a canvas, then store a data URI. Deliberately NOT Firebase Storage:
  // a 128px q0.82 JPEG is ~5-12 KB, which fits the existing Firestore document with
  // no Storage bucket, no CORS setup and no second ruleset to configure.
  function shrinkAvatar(file, size) {
    size = size || 128;
    return new Promise(function (res, rej) {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Pick an image file.'));
      if (file.size > 6 * 1024 * 1024) return rej(new Error('Image is over 6 MB.'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var side = Math.min(img.naturalWidth, img.naturalHeight) || size;
          var c = document.createElement('canvas');
          c.width = c.height = size;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);   // so PNG alpha doesn't go black
          ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
          URL.revokeObjectURL(url);
          var out = c.toDataURL('image/jpeg', 0.82);
          if (out.length > 480 * 1024) return rej(new Error('Could not compress the image enough.'));
          res(out);
        } catch (e) { rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That image could not be read.')); };
      img.src = url;
    });
  }

  function paintChip() {
    var av = $('user-avatar');
    if (!av || !window.otakuAvatarPaint) return;
    var u = me();
    if (!u) { window.otakuAvatarPaint(av, ''); return; }
    FB().loadProfile(u.uid).then(function (p) { window.otakuAvatarPaint(av, p && p.avatar); }).catch(function () {});
  }

  /* ------------------------------------------------------------ AniList */
  function aniUser() {
    if (!AL() || !AL().isConnected()) return Promise.resolve(null);
    // Signed-in label is available offline from the JWT, so the panel is never blank
    if (AL().decodeToken) {
      var d = AL().decodeToken();
      if (d && d.expired) return Promise.resolve(null);
    }
    if (AL()._viewer) return Promise.resolve(AL()._viewer);
    return AL().viewer().then(function (v) { AL()._viewer = v; return v; }).catch(function () { return null; });
  }
  function autoPushOn() { try { return localStorage.getItem('otaku-anilist-autopush') === '1'; } catch (e) { return false; } }
  function setAutoPush(v) { try { localStorage.setItem('otaku-anilist-autopush', v ? '1' : '0'); } catch (e) {} }

  var pushing = {};
  function pushRating(animeId, tenths, opts) {
    opts = opts || {};
    if (!AL() || !AL().isConnected()) {
      if (!opts.silent) toast('Connect your AniList account first — Profile → AniList', true);
      return Promise.resolve(false);
    }
    if (!tenths) return Promise.resolve(false);
    if (pushing[animeId]) return Promise.resolve(false);
    pushing[animeId] = 1;
    var btn = document.querySelector('.rating-block[data-rating-id="' + (window.CSS && CSS.escape ? CSS.escape(String(animeId)) : animeId) + '"] .ot-ani-push');
    if (btn) { btn.disabled = true; btn.textContent = 'Pushing…'; }
    return aniUser().then(function (v) {
      var fmt = (v && v.scoreFormat) || 'POINT_10_DECIMAL';
      return AL().listEntry(animeId).then(function (entry) {
        // Never invent a status: keep whatever the user's list already says, and
        // only default to COMPLETED for a title they have no entry on at all.
        var status = entry && entry.status ? entry.status : null;
        return AL().pushScore(animeId, tenths, { status: status, scoreFormat: fmt });
      });
    }).then(function (r) {
      var live = (btn && btn.isConnected) ? btn : document.querySelector('.rating-block[data-rating-id="' + (window.CSS && CSS.escape ? CSS.escape(String(animeId)) : animeId) + '"] .ot-ani-push');
      if (live) { live.textContent = '\u2713 On AniList (' + r.score + ')'; live.classList.add('on'); live.disabled = false; }
      toast('Score pushed to AniList: ' + r.score + ' (' + (AL().FORMAT_LABEL[r.format] || r.format) + ' scale)');
      return true;
    }).catch(function (e) {
      if (e.needAuth && AL()) AL().disconnect();
      if (btn) { btn.textContent = 'Retry push'; btn.disabled = false; }
      toast('AniList push failed — ' + e.message, true);
      return false;
    }).then(function (ok) { delete pushing[animeId]; return ok; });
  }

  // stars changed in the rating box → push straight away, if the user opted in
  window.__otakuRatingAutoPush = function (animeId, tenths) {
    if (!autoPushOn() || !AL() || !AL().isConnected()) return;
    pushRating(animeId, tenths, { silent: true });
  };

  // comment posted with stars → offer the push (never auto-post a review behind
  // their back, since AniList reviews are public and permanent-ish)
  window.__otakuAfterComment = function (info) {
    if (!info.tenths || !AL() || !AL().isConnected()) return;
    if (autoPushOn()) pushRating(info.animeId, info.tenths, { silent: true });
  };

  /* ------------------------------------------------------------ account menu */
  var menu = null;
  function closeMenu() { if (menu) menu.classList.remove('open'); }

  function renderMenuIfOpen() {
    if (menu && menu.classList.contains('open')) buildMenuBody();
  }

  function buildMenuBody() {
    var u = me();
    var head = menu.querySelector('.am-head');
    var body = menu.querySelector('.am-body');
    if (!u) {
      head.innerHTML = '<span class="am-av">?</span><div><div class="am-name">Not signed in</div><div class="am-sub">log in to use your profile</div></div>';
      body.innerHTML = '<button type="button" data-act="login">Log in / sign up</button>';
      return;
    }
    head.innerHTML = '<span class="am-av" id="am-av"></span><div style="min-width:0">' +
      '<div class="am-name">' + esc(u.displayName || u.email) + '</div>' +
      '<div class="am-sub">' + esc((u.email || '').split('@')[0]) + '@…</div></div>';
    if (window.otakuAvatarPaint) {
      FB().loadProfile(u.uid).then(function (p) {
        if (p && p.avatar) window.otakuAvatarPaint($('am-av'), p.avatar);
      }).catch(function () {});
    }
    body.innerHTML =
      '<button type="button" data-act="profile">Profile &amp; settings</button>' +
      '<button type="button" data-act="watchlist">My watchlist</button>' +
      '<div class="am-sep"></div>' +
      '<button type="button" data-act="logout">Log out</button>';
  }

  function openMenu(anchor) {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'acct-menu';
      menu.innerHTML = '<div class="am-head"></div><div class="am-body"></div>';
      document.body.appendChild(menu);
      menu.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-act]');
        if (!b) return;
        var act = b.dataset.act;
        closeMenu();
        if (act === 'login') {
          var lb = $('login-btn');
          if (lb) lb.click(); else location.href = 'index.html?auth=login';
        }
        else if (act === 'profile') location.href = 'account.html';
        else if (act === 'watchlist') { var av = $('user-avatar'); if (av) av.click(); }
        else if (act === 'logout') {
          if (FB()) FB().logOut();
          try { localStorage.removeItem('otaku-session'); } catch (e) {}
          toast('Logged out');
          setTimeout(function () { location.reload(); }, 450);
        }
      });
      document.addEventListener('click', function (e) {
        if (menu && menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('.acct-btn')) closeMenu();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    }
    buildMenuBody();
    var r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.left = Math.max(10, Math.min(r.left, window.innerWidth - 250)) + 'px';
    menu.classList.add('open');
  }

  // Site-level defaults, so the owner pre-links once and nobody else has to
  // configure anything. localStorage is this browser; the Firestore profile field
  // is the copy other devices/visitors read — that one needs the users/{uid} write
  // rule, and silently no-ops without it.
  var ANI_SETTINGS_KEY = 'otaku-anilist-settings';
  function aniSettings() {
    try { return JSON.parse(localStorage.getItem(ANI_SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveAniSettings(patch) {
    var next = Object.assign({}, aniSettings(), patch);
    try { localStorage.setItem(ANI_SETTINGS_KEY, JSON.stringify(next)); } catch (e) {}
    if (patch.defaultClientId != null) {
      try { AL().setClient(patch.defaultClientId); } catch (e) {}
      // anilist.js reads its own key, so keep the two in step
      try { patch.defaultClientId ? localStorage.setItem('otaku-anilist-client', patch.defaultClientId)
        : localStorage.removeItem('otaku-anilist-client'); } catch (e) {}
    }
    if (patch.defaultClientSecret != null) {
      try { AL().setSecret(patch.defaultClientSecret); } catch (e) {}
      try { patch.defaultClientSecret ? localStorage.setItem('otaku-anilist-secret', patch.defaultClientSecret)
        : localStorage.removeItem('otaku-anilist-secret'); } catch (e) {}
    }
    // Mirror everything EXCEPT the secret into the Firestore profile: that doc is
    // read by other devices, and a shared client secret is not a profile field.
    var pub = Object.assign({}, next);
    delete pub.defaultClientSecret;
    var u = me();
    if (u && FB()) {
      FB().saveProfile(u.uid, { anilistSettings: pub }).catch(function () {
        toast('Saved on this device only — Firestore refused the write (needs firestore.rules)', true);
      });
    }
    return next;
  }
  function effectiveClientSecret() {
    // Same precedence as the client ID. For the flow to work for every visitor,
    // this belongs in index.html (window.OTAKU_ANILIST_CLIENT_SECRET) — a value
    // saved in the owner's browser only helps the owner's browser.
    if (window.OTAKU_ANILIST_CLIENT_SECRET) return String(window.OTAKU_ANILIST_CLIENT_SECRET);
    try { if (localStorage.getItem('otaku-anilist-secret')) return localStorage.getItem('otaku-anilist-secret'); } catch (e) {}
    return '';
  }
  function effectiveClientId() {
    // A hard-coded global wins: the owner can ship it in index.html and no browser
    // ever holds a half-configured value.
    if (window.OTAKU_ANILIST_CLIENT_ID) return String(window.OTAKU_ANILIST_CLIENT_ID);
    try { if (localStorage.getItem('otaku-anilist-client')) return localStorage.getItem('otaku-anilist-client'); } catch (e) {}
    return '';
  }

  function doConnect() {
    if (!AL()) return toast('anilist.js is not loaded', true);
    if (AL().isConnected()) {
      if (!confirm('Disconnect your AniList account from this browser?')) return;
      AL().disconnect(); toast('Disconnected'); return;
    }
    // Configured by the owner → the visitor just clicks. Nothing to look up.
    if (AL().isConfigured()) { location.href = AL().authUrl(); return; }
    toast('AniList is not linked yet — the site owner sets it once, in Profile → AniList', true);
  }

  // AniList gives every logged-in member a personal token at
  // anilist.co/settings/developer. No application, no client ID, no redirect back
  // to this site, nothing for a third party to be authorised to do.
  function acquireToken() {
    window.open('https://anilist.co/settings/developer', '_blank', 'noopener');
    var t = prompt(
      'A new tab has anilist.co/settings/developer open.\n\n' +
      '1) Make sure you are logged in to AniList there\n' +
      '2) Copy your token\n' +
      '3) Paste it below\n\n' +
      'Nothing is authorised to this site. The token is kept in THIS browser only, ' +
      'never sent to a server of ours, and you can revoke it any time on that page.\n' +
      'Paste blank to cancel.');
    if (!t || !t.trim()) return;
    t = t.trim();
    var d = AL().decodeToken ? AL().decodeToken(t) : null;
    if (d && d.expired) { toast('That token expired — mint a new one', true); return; }
    if (!d && !confirm('That does not look like an AniList token (it did not decode). Save it anyway?')) return;
    try { localStorage.setItem('otaku-anilist-token', t); } catch (e) { return toast('Could not save the token locally', true); }
    renderAniNow();
    var u = me();
    AL().viewer().then(function (v) {
      if (u) FB().saveProfile(u.uid, { anilist: {
        username: v.name, uid: v.id, scoreFormat: v.scoreFormat, linkedAt: Date.now()
      }}).catch(function () {});
      toast('Linked as ' + v.name + (d && d.daysLeft ? ' · valid ~' + d.daysLeft + ' days' : ''));
      renderAniNow();
    }).catch(function (e) {
      // Keep it — a failed check is usually just the network. Verified again on load.
      toast('Token stored' + (d ? ' (AniList id ' + d.id + ')' : '') +
        ' but AniList could not be reached right now — ' + (e.message || e) + '. Will verify on next load.', true);
    });
  }
  // renderAni() is a closure created per page render; the panel exposes itself
  // here so a token that lands mid-session repaints it without a reload.
  function renderAniNow() { if (window.__otakuRenderAni) window.__otakuRenderAni(); }
  // Exposed so the account panel can re-render itself after a token lands.
  window.__otakuRenderAni = renderAniNow;

  function installButton() {
    if (document.querySelector('.acct-btn')) return;
    // Order matters: put it where a "Log in" button lives, so the two swap
    // places visually; otherwise fall back to the nav cluster, then the page's
    // own back-link row (anime.html has no drawer at all).
    var anchor = $('login-btn');
    if (!anchor) {
      var theme = $('theme-toggle');
      anchor = theme || document.querySelector('#user-chip') || document.querySelector('.back-link');
    }
    if (!anchor || !anchor.parentNode) return;
    var b = document.createElement('button');
    b.className = 'acct-btn';
    b.type = 'button';
    b.innerHTML = '◕ <span>Account</span>';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openMenu(b); });
    var host = anchor.parentNode;
    if (host) {
      if (anchor.id === 'login-btn') host.insertBefore(b, anchor);
      else host.insertBefore(b, anchor.nextSibling);
    }
    // chip exists only while logged in; mirror that here
    var sync = function () {
      var on = !!me();
      document.querySelectorAll('.acct-btn').forEach(function (x) { x.classList.toggle('show', on); });
    };
    sync();
    if (FB()) FB().onAuthChange(sync);
    // script.js paints the chip from its own listeners; re-run after it settles
    ['load', 'DOMContentLoaded'].forEach(function (ev) { window.addEventListener(ev, function () { setTimeout(sync, 60); setTimeout(paintChip, 260); }); });
    document.addEventListener('click', function (e) { if (e.target.closest('#user-chip')) setTimeout(paintChip, 120); }, true);
  }

  // The push button is injected by features.js (it owns .rating-mine), and
  // refresh() replaces that element on every repaint — so delegate on document
  // rather than binding, and re-query the node after the refresh lands.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.ot-ani-push');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    var block = btn.closest('.rating-block');
    if (!block) return;
    var sel = block.querySelector('.ot-star-input');
    var tenths = sel && sel.value && sel.value !== '-' ? Number(sel.value) : null;
    if (!tenths) {
      if (block.parentNode) block.parentNode.classList.add('shake');
      toast('Pick some stars first', true);
      return;
    }
    pushRating(block.dataset.ratingId, tenths, {});
  }, true);

  window.otakuAccount = {
    me: me, load: load, save: save, shrinkAvatar: shrinkAvatar,
    pushRating: pushRating, paintChip: paintChip, toast: toast, safeUrl: safeUrl,
    SOCIALS: SOCIALS, BIO_MAX: BIO_MAX, NAME_MIN: NAME_MIN, NAME_MAX: NAME_MAX,
    autoPush: function () { return autoPushOn(); }, setAutoPush: setAutoPush
  };

  // account.html is a fresh page load, so Firebase has not finished restoring the
  // session when deferred scripts run. Rendering off a synchronous read of
  // currentUser is exactly what showed "Log in first" to people who WERE signed in.
  function bootAccountPage() {
    var root = $('acct-root');
    if (!window.__otakuWaitAuth) {              // features.js missing → one retry, then the truth
      return setTimeout(function () {
        if (window.__otakuWaitAuth) bootAccountPage();
        else if (root) root.innerHTML = '<div class="acct-empty"><h2>features.js did not load</h2>' +
          '<p>The account page needs it. Check that <code>features.js</code> sits next to this file.</p></div>';
      }, 600);
    }
    if (root) root.innerHTML = '<div class="acct-empty"><h2>Checking your session…</h2>' +
      '<p style="font-size:12px">Waiting for Firebase to report its real auth state.</p></div>';
    window.__otakuWaitAuth().then(function (name) {
      if (name) return renderAccountPage();
      var f = FB();
      if (f && !f.auth.currentUser) return renderLoginWall();      // genuinely signed out
      if (root) root.innerHTML = '<div class="acct-empty"><h2>Firebase did not load</h2>' +
        '<p>This page needs <code>firebase-init.js</code> next to it. If it is there, open the ' +
        'browser console — a blocked CDN or a bad key shows up there.</p></div>';
    });
  }
  // ---- keep the watchlist dropdown inside the screen on narrow viewports ----
  // style.css anchors .wl-menu to its button (left:0); on the detail hero near the
  // right edge that pushes it off-screen. position:fixed (see account.css) makes the
  // button no longer its containing block, so we place it from the viewport instead.
  (function () {
    var vw = function () { return window.innerWidth || document.documentElement.clientWidth || 1024; };
    function clampMenu(wrap) {
      var menu = wrap && wrap.querySelector('.wl-menu');
      if (!menu) return;
      menu.style.top = menu.style.left = '';
      var btn = wrap.querySelector('.wl-btn') || wrap;
      var r = btn.getBoundingClientRect();
      var m = 8;
      var winH = window.innerHeight || 0;
      var menuH = menu.offsetHeight || 0;
      var w = menu.offsetWidth || 168;
      var left = Math.max(m, Math.min(r.left, vw() - m - w));
      var top = r.bottom + 6;
      if (winH && top + menuH > winH - m && r.top - menuH - 6 > m) {
        top = r.top - menuH - 6;                    // no room below: flip above the button
      }
      menu.style.top = Math.round(Math.max(m, top)) + 'px';
      menu.style.left = Math.round(left) + 'px';
      // measure after placement so a mid-flip can settle in one frame
      if (winH) {
        var real = menu.getBoundingClientRect();
        if (real.bottom > winH - m) menu.style.maxHeight = Math.max(120, winH - m - parseFloat(menu.style.top)) + 'px';
      }
    }
    function repositionAll() {
      document.querySelectorAll('.wl-wrap.open').forEach(clampMenu);
    }
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.wl-btn');
      if (btn) clampMenu(btn.closest('.wl-wrap'));
    }, true);
    // fixed positions are viewport-relative, so the panel must follow the page
    window.addEventListener('resize', repositionAll);
    window.addEventListener('scroll', repositionAll, true);
    document.addEventListener('touchstart', function (e) {
      if (!e.target.closest || !e.target.closest('.wl-wrap')) repositionAll();
    }, { passive: true });
  })();

  if (document.body.dataset.page === 'account') bootAccountPage();
  else installButton();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { if (document.body.dataset.page !== 'account') installButton(); });

  /* ------------------------------------------------------------ the page */
  function renderLoginWall() {
    var root = $('acct-root');
    if (!root) return;
    root.innerHTML = '<div class="acct-empty"><h2>Log in first</h2><p>A profile lives on your account — sign in and this page fills in.</p>' +
      '<button class="acct-save" type="button" id="acct-go-login">Log in</button></div>';
    var lb = $('login-btn');
    $('acct-go-login').onclick = function () { if (lb) lb.click(); else location.href = 'index.html?auth=login'; };
    fbReady().then(function () { if (me()) { location.reload(); } });
  }

  function renderAccountPage() {
    var root = $('acct-root');
    if (!root) return;
    if (!me()) return renderLoginWall();
    var u = me();
    load().then(function (p) {
      p = p || {};
      var soc = p.social || {};
      root.innerHTML =
        '<div class="acct-card">' +
          '<h2>Profile picture</h2><p class="sub">アバター — shown on your comments and in the nav</p>' +
          '<div class="acct-avrow">' +
            '<button type="button" class="acct-avpick" id="av-pick" title="Choose an image">' + esc((u.displayName || u.email || '?').charAt(0).toUpperCase()) + '</button>' +
            '<div class="av-actions">' +
              '<button class="ac-btn" type="button" id="av-choose">Choose image…</button>' +
              '<button class="ac-btn" type="button" id="av-clear">Remove</button>' +
              '<input type="file" id="av-file" accept="image/*" style="display:none">' +
              '<span class="acct-hint" id="av-hint">Square-ish works best · auto-resized to 128×128 JPEG</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="acct-card">' +
          '<h2>Display name</h2><p class="sub">表示名 — 3-20 chars, letters, numbers, _</p>' +
          '<label class="acct-field"><label>Your name</label>' +
            '<input type="text" id="f-name" maxlength="' + NAME_MAX + '" value="' + esc(u.displayName || '') + '">' +
            '<span class="acct-hint">Changing this also renames your <b>username login</b>, watchlist key and comments. Old comments keep the name they were posted with.</span></label>' +
        '</div>' +

        '<div class="acct-card">' +
          '<h2>Bio</h2><p class="sub">自己紹介 — up to ' + BIO_MAX + ' characters</p>' +
          '<textarea id="f-bio" maxlength="' + BIO_MAX + '" placeholder="Three shows you would defend to the death…">' + esc(p.bio || '') + '</textarea>' +
          '<span class="acct-hint"><b id="bio-n">' + ((p.bio || '').length) + '</b> / ' + BIO_MAX + '</span>' +
        '</div>' +

        '<div class="acct-card">' +
          '<h2>Social media</h2><p class="sub">リンク — optional, links open in a new tab</p>' +
          '<div class="acct-social">' +
            SOCIALS.map(function (s) {
              return '<span>' + s.label + '</span><input type="url" data-soc="' + s.key + '" placeholder="' +
                (s.host ? s.host + '/…' : 'https://…') + '" value="' + esc(soc[s.key] || '') + '">';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="acct-card">' +
          '<h2>Your data</h2><p class="sub">データ — where each field lives</p>' +
          '<div id="acct-data"></div>' +
        '</div>' +

        '<div class="acct-actions">' +
          '<button class="acct-save" type="button" id="acct-save">Save profile</button>' +
          '<a class="ac-btn" href="index.html" style="text-decoration:none;display:inline-flex;align-items:center">← Back to the site</a>' +
          '<span class="acct-msg" id="acct-msg"></span>' +
        '</div>';

      var bioEl = $('f-bio');
      bioEl.addEventListener('input', function () { $('bio-n').textContent = String(bioEl.value.length); });

      // avatar
      // a stored avatar may not be an image at all (otakuSafeAvatar, features.js)
      var picked = (window.otakuSafeAvatar ? window.otakuSafeAvatar(p.avatar) : (p.avatar || '')) || '';
      var pick = $('av-pick');
      var setAv = function (v) {
        pick.style.backgroundImage = v ? 'url(' + JSON.stringify(v) + ')' : '';
        pick.classList.toggle('has-img', !!v);
      };
      setAv(picked);
      $('av-choose').onclick = function () { $('av-file').click(); };
      pick.onclick = function () { $('av-file').click(); };
      $('av-file').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        shrinkAvatar(f).then(function (dataUrl) {
          picked = dataUrl;
          setAv(dataUrl);
          var kb = Math.round(dataUrl.length * 0.75 / 1024);
          $('av-hint').innerHTML = '<b>ready</b> — 128×128 JPEG, ' + kb + ' KB · press Save profile';
          if (kb > 40) $('av-hint').innerHTML += ' <b>(large)</b>';
        }).catch(function (err) { toast(err.message, true); });
        e.target.value = '';
      };
      $('av-clear').onclick = function () {
        picked = '';
        setAv('');
        $('av-hint').textContent = 'avatar removed — press Save profile';
      };

      $('acct-save').onclick = function () {
        var msg = $('acct-msg'), btn = $('acct-save');
        var name = ($('f-name').value || '').trim();
        if (name && !/^[A-Za-z0-9_]{3,20}$/.test(name)) {
          msg.className = 'acct-msg bad'; msg.textContent = 'name must be 3-20 chars (letters, numbers, _)'; return;
        }
        var social = {};
        SOCIALS.forEach(function (s) {
          var el = document.querySelector('[data-soc="' + s.key + '"]');
          var v = safeUrl(el.value, s.host);
          if (el.value.trim() && !v) { msg.className = 'acct-msg bad'; msg.textContent = s.label + ' link is not a valid http(s) URL'; return; }
          if (v) social[s.key] = v;
        });
        if (msg.className.indexOf('bad') > -1) return;
        btn.disabled = true; msg.className = 'acct-msg'; msg.textContent = 'saving…';
        var oldName = u.displayName;
        var chain = (name && name !== oldName) ? FB().setDisplayName(u.uid, name) : Promise.resolve();
        chain.then(function () {
          return save({
            name: name || oldName || '', bio: (bioEl.value || '').slice(0, BIO_MAX),
            social: social, avatar: picked, updatedAt: Date.now()
          });
        }).then(function () {
          msg.textContent = 'saved ✓'; msg.className = 'acct-msg ok';
          if (name && name !== oldName) {
            try { localStorage.setItem('otaku-session', name); localStorage.setItem('otaku-watchlist-' + name.toLowerCase(), JSON.stringify(window.otakuWL ? window.otakuWL.all() : {})); } catch (e) {}
            toast('Name changed — reloading so every label updates');
            setTimeout(function () { location.reload(); }, 700);
          }
          renderData();
        }).catch(function (e) {
          msg.textContent = 'could not save: ' + (e.message || e); msg.className = 'acct-msg bad';
        }).then(function () { btn.disabled = false; });
      };

      renderData();

      function renderAni() {
        var box = $('ani-body');
        if (!AL()) { box.textContent = 'anilist.js is not loaded on this page.'; return; }
        var u2 = me();
        FB().loadProfile(u2.uid).then(function (pp) {
          pp = pp || {};
          return aniUser().then(function (v) {
            var conn = !!(v && v.id);
            var label = conn ? (AL().FORMAT_LABEL[v.scoreFormat] || v.scoreFormat) : '—';
            box.innerHTML =
              '<div class="ani-state"><span class="ani-dot ' + (conn ? 'on' : '') + '"></span>' +
              (conn
                ? 'Connected as <b style="margin:0 4px">' + esc(v.name) + '</b> · ' + esc(label) + ' scoring'
                : 'Not connected' + (pp.anilist && pp.anilist.connected ? ' in this browser (linked from another device)' : '')) +
              '</div>' +
              (conn
                ? '<button class="ac-btn" type="button" id="ani-test">Test a push on One Piece</button> ' +
                  '<button class="ac-btn" type="button" id="ani-disc">Disconnect</button> ' +
                  '<button class="ac-btn" type="button" id="ani-auto">Auto-push: ' + (autoPushOn() ? 'ON' : 'off') + '</button>'
                : (effectiveClientId()
                    ? '<button class="acct-save" type="button" id="ani-go" style="font-size:12.5px;padding:9px 18px">Connect AniList</button>' +
                      '<p style="margin-top:10px;font-size:12px;color:var(--ink-soft)">One-click needs the site\'s Firebase bridge to be deployed. ' +
                      'Prefer no setup? <button type="button" class="ac-btn" id="ani-paste">paste a token</button> instead — ' +
                      'yours is at <a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a>.</p>'
                    : '<p style="font-size:13px;margin:0 0 12px;color:var(--ink-soft)">The owner has not linked AniList for this site yet. ' +
                      'Nothing to do here — <a href="#" id="ani-owner-open">open owner setup</a>, or paste your own token: ' +
                      '<button type="button" class="ac-btn" id="ani-paste">paste a token</button></p>')) +
                  (canClaimOwner()
                    ? '<p style="margin-top:12px;font-size:12px;color:var(--ink-soft)">Owner setup is unclaimed, so AniList is off for ' +
                      'visitors. ' + (effectiveClientId() ? '' : 'The site already has a Client ID here — claiming lets you change it. ') +
                      '<button type="button" class="ac-btn" id="ani-claim">Claim setup for this account</button></p>' : '') +
                  (isOwnerMode()
                    // Not merely hidden with CSS: a site-wide setting should not
                    // exist in a visitor's DOM at all, in case a rule is missed.
                    ? '<div id="ani-owner">' +
                      '<label class="acct-field"><span class="lbl">Site-wide AniList Client ID (saved once, works for everyone)</span>' +
                      '<input type="text" id="ani-cid" placeholder="from anilist.co/settings/developer" value="' + esc(effectiveClientId()) + '"></label>' +
                      '<label class="acct-field"><span class="lbl">Site-wide AniList Client Secret (paste it if your app shows one — the code exchange needs it)</span>' +
                      '<input type="password" id="ani-csec" placeholder="shown next to the Client ID" value="' + esc(effectiveClientSecret()) + '"></label>' +
                      '<div class="ani-actions"><button class="ac-btn" type="button" id="ani-cid-save">Save for the whole site</button>' +
                      '<button class="ac-btn" type="button" id="ani-cid-clear">Remove</button>' +
                      '<button class="ac-btn" type="button" id="ani-cid-giveup">Give up setup</button></div>' +
                      '<p class="ani-note">Register the app once at ' +
                      '<a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a> ' +
                      'with the redirect URL <code>' + esc(location.origin + location.pathname) + '</code> — this exact address. ' +
                      'Keep its grant type as <b>Authorization Code</b> (the current default): apps limited to the old ' +
                      '<i>implicit</i> flow are rejected by AniList with <code>unsupported_grant_type</code>. ' +
                      'Then paste the Client ID, plus the Client Secret if your app shows one, and save. ' +
                      'Every visitor just clicks <b>Connect AniList</b> — nobody has to find a developer page. ' +
                      'For this to work in <i>every</i> visitor\'s browser, put both in the globals ' +
                      '<code>window.OTAKU_ANILIST_CLIENT_ID</code> and <code>window.OTAKU_ANILIST_CLIENT_SECRET</code> ' +
                      '(lines in index.html) — they win over anything saved here. ' +
                      'The secret is kept out of Firestore and never mirrored to other devices.</p></div>'
                    : '') +

                  '<button type="button" id="ani-render" style="display:none"></button>' +
              '<p class="ani-note"><b>How the sync works.</b> AniList has no bare "give a score" API — ' +
              'your stars are written to the <b>list score</b> on your AniList entry, re-expressed for your own ' +
              'score format (' + esc(label) + '), and your list status is left exactly as it was. A comment can ' +
              'only become a real AniList review if it reaches ' + AL().reviewLimits.minBody +
              ' characters, because AniList enforces that server-side. The token stays in <b>this browser only</b> ' +
              '(localStorage) — nothing is sent to a server of ours. Revoke any time at ' +
              '<a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a>.</p>';
            var on = function (id, fn) { var el = $(id); if (el) el.onclick = fn; };
            on('ani-paste', function () { acquireToken(); });
            on('ani-go', function () { doConnect(); });
            on('ani-render', function () { renderAni(); });
            on('ani-claim', function () {
              if (claimOwner()) { toast('You own AniList setup for this browser'); renderAni(); }
            });
            on('ani-owner-open', function (e) {
              e.preventDefault();
              var o = $('ani-owner'); if (o) o.style.display = 'block';
            });
            on('ani-cid-save', function () {
              var v = ($('ani-cid').value || '').trim();
              if (!v) return toast('Paste the Client ID first', true);
              var s = $('ani-csec') ? ($('ani-csec').value || '').trim() : '';
              if (!ownerAccount()) claimOwner();      // configuring it is the claim
              saveAniSettings({ defaultClientId: v, defaultClientSecret: s });
              toast(s ? 'Saved — visitors can now connect with one click'
                      : 'Saved — if your app shows a Client Secret, paste it too, or the connect will fail');
              renderAni();
            });
            on('ani-cid-giveup', function () {
              if (!confirm('Release this account as the AniList owner? Another account can then claim setup.')) return;
              try { localStorage.removeItem('otaku-anilist-owner'); } catch (e) {}
              toast('Setup released'); renderAni();
            });
            on('ani-cid-clear', function () {
              saveAniSettings({ defaultClientId: '' });
              try { localStorage.removeItem('otaku-anilist-client'); } catch (e) {}
              toast('Removed'); renderAni();
            });
            on('ani-disc', function () { AL().disconnect(); toast('Disconnected'); renderAni(); });
            on('ani-auto', function (e) { setAutoPush(!autoPushOn()); e.target.textContent = 'Auto-push: ' + (autoPushOn() ? 'ON' : 'off'); });
            on('ani-test', function () {
              toast('pushing One Piece (media 21) at 4★…');
              pushRating('21', 80, {});
            });
          });
        });
      }

      function renderData() {
        var box = $('acct-data');
        if (!box) return;
        var wl = window.otakuWL ? Object.keys(window.otakuWL.all()).length : 0;
        FB().loadProfile(u.uid).then(function (p) {
          p = p || {};
          var rows = [
            ['display name', p.name || u.displayName || '—'],
            ['bio', (p.bio || '—').slice(0, 46) + ((p.bio || '').length > 46 ? '…' : '')],
            ['avatar', p.avatar ? (Math.round(p.avatar.length * 0.75 / 1024) + ' KB, inside users/' + u.uid.slice(0, 6)) : 'not set'],
            ['social links', Object.keys(p.social || {}).length + ' set'],
            ['watchlist', wl + ' titles'],
            ['commented as', esc(u.displayName || u.email || '—')]
          ];
          box.innerHTML = '<div class="acct-social">' + rows.map(function (r) {
            return '<span>' + r[0] + '</span><input type="text" value="' + esc(r[1]) + '" readonly style="background:var(--paper);color:var(--ink-soft);border-color:var(--line)">';
          }).join('') + '</div>' +
          '<p class="ani-note">Profile lives in Firestore at <code>users/' + esc(u.uid) + '</code>. Your login ' +
          'is a Firebase Auth account; the <code>usernames/&lt;name&gt;</code> doc that maps a username to an email is ' +
          'rewritten when you change your name.</p>';
        }).catch(function (e) {
          box.innerHTML = '<p class="ani-note">Profile reads failed: <b>' + esc((e && (e.code || e.message)) || e) +
            '</b><br>Everything still saves to this device. For cross-device sync, add the ' +
            '<code>users/{uid}</code> block from <code>firestore.rules</code> in the Firebase console.</p>';
        });
      }
    }).catch(function (e) {
      root.innerHTML = '<div class="acct-empty"><h2>Could not read your profile</h2><p>' +
        esc((e && (e.code || e.message)) || e) + '</p>' +
        '<p style="font-size:12px;max-width:56ch;margin:0 auto 16px">This is Firestore refusing ' +
        '<code>users/&lt;uid&gt;</code>. Add that block from <code>firestore.rules</code> and reload. ' +
        'Nothing you type is lost either way — saves fall back to this device.</p>' +
        '<button class="acct-save" type="button" onclick="location.reload()">Retry</button></div>';
    });
  }
})();
