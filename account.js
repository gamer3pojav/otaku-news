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

  // ---- finish the AniList implicit grant before anything reads the token ----
  if (AL() && AL().consumeRedirect()) {
    AL().viewer().then(function (u) {
      toast('AniList connected as ' + u.name);
      if (FB() && FB().auth.currentUser) {
        FB().saveProfile(FB().auth.currentUser.uid, {
          anilist: { connected: true, username: u.name, uid: u.id, scoreFormat: u.scoreFormat, connectedAt: Date.now() }
        }).catch(function () {});
      }
      renderMenuIfOpen();
    }).catch(function (e) { toast('AniList token rejected — ' + e.message, true); });
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
    var tooShort = !AL().canPushReview(info.text);
    var box = document.querySelector('.cm-box[data-cm-id="' + (window.CSS && CSS.escape ? CSS.escape(String(info.animeId)) : info.animeId) + '"]');
    if (!box || box.querySelector('.ani-offer')) return;
    var o = document.createElement('div');
    o.className = 'ani-offer';
    o.style.cssText = 'display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:11px;padding:10px 12px;border:1px dashed var(--line);border-radius:10px;font-size:12px;color:var(--ink-soft)';
    o.innerHTML = '<span>Also send <b>' + esc(info.title || 'this') + '</b> — ' + (info.tenths / 20).toFixed(1) + '★ — to your AniList list?</span>' +
      '<button type="button" class="ac-btn" data-act="yes">Push score</button>' +
      (tooShort ? '<span class="hint" style="font-family:var(--mono);font-size:10.5px;color:var(--ink-faint)">' +
        'review text needs ' + AL().reviewLimits.minBody + ' chars on AniList, so your comment is not sent as one</span>'
        : '<button type="button" class="ac-btn" data-act="review">Push score + review</button>');
    box.appendChild(o);
    o.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'yes') {
        pushRating(info.animeId, info.tenths, {});
        o.remove();
      } else if (b.dataset.act === 'review') {
        b.disabled = true; b.textContent = 'Pushing…';
        aniUser().then(function (v) {
          return AL().pushReview(info.animeId, info.tenths, info.text.slice(0, 120), info.text,
            { scoreFormat: (v && v.scoreFormat) || 'POINT_10_DECIMAL' });
        }).then(function (r) {
          toast('Review published on AniList' + (r && r.SaveReview && r.SaveReview.siteUrl ? '' : ''));
          o.remove();
        }).catch(function (err) { b.disabled = false; b.textContent = 'Push score + review'; toast('Review failed — ' + err.message, true); });
      }
    });
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
    var conn = AL() && AL().isConnected();
    var ap = autoPushOn();
    body.innerHTML =
      '<button type="button" data-act="profile">Profile &amp; settings</button>' +
      '<button type="button" data-act="watchlist">My watchlist</button>' +
      '<div class="am-sep"></div>' +
      '<button type="button" data-act="connect">' + (conn ? 'AniList' : 'Connect AniList') +
        '<span class="am-flag ' + (conn ? 'on' : '') + '">' + (conn ? 'linked' : 'not linked') + '</span></button>' +
      '<button type="button" data-act="autopush">Auto-push my scores<span class="am-flag ' + (ap ? 'on' : '') + '">' + (ap ? 'on' : 'off') + '</span></button>' +
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
        else if (act === 'connect') doConnect();
        else if (act === 'autopush') { setAutoPush(!autoPushOn()); toast('Auto-push ' + (autoPushOn() ? 'on' : 'off')); }
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

  function doConnect() {
    if (!AL()) return toast('anilist.js is not loaded', true);
    if (AL().isConnected()) {
      if (!confirm('Disconnect your AniList account from this browser?')) return;
      AL().disconnect();
      toast('AniList disconnected');
      return;
    }
    if (!AL().isConfigured()) return promptClient();
    location.href = AL().authUrl();
  }

  // No registered app yet? The pin flow works with zero config, because AniList
  // hands the token to the user to copy. Kept as a fallback so the feature is
  // testable before anilist.js has a client id.
  function promptClient() {
    var want = prompt(
      'To push ratings to AniList, this site needs an AniList application ' +
      '(anilist.co/settings/developer → Create New Application).\n\n' +
      '1) Paste its Client ID here, or\n' +
      '2) leave it blank and paste a token you got from ' +
      'https://anilist.co/settings/developer → your app → "Authorize" (implicit grant).\n\n' +
      'Client ID (blank = paste a token instead):', '');
    if (want && want.trim()) {
      AL().setClient(want.trim());
      toast('Client ID saved — connecting…');
      location.href = AL().authUrl();
      return;
    }
    var t = prompt('Paste your AniList access token:');
    if (!t || !t.trim()) return;
    try { localStorage.setItem('otaku-anilist-token', t.trim()); } catch (e) { return toast('Could not save the token locally', true); }
    AL().viewer().then(function (u) {
      toast('AniList connected as ' + u.name);
      if (FB() && FB().auth.currentUser) {
        FB().saveProfile(FB().auth.currentUser.uid, {
          anilist: { connected: true, username: u.name, uid: u.id, scoreFormat: u.scoreFormat, connectedAt: Date.now() }
        }).catch(function () {});
      }
    }).catch(function (e) {
      localStorage.removeItem('otaku-anilist-token');
      toast('That token was rejected — ' + e.message, true);
    });
  }

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

  if (document.body.dataset.page === 'account') renderAccountPage();
  else installButton();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { if (document.body.dataset.page !== 'account') installButton(); });

  /* ------------------------------------------------------------ the page */
  function renderAccountPage() {
    var root = $('acct-root');
    if (!root) return;
    if (!me()) {
      root.innerHTML = '<div class="acct-empty"><h2>Log in first</h2><p>A profile lives on your account — sign in and this page fills in.</p>' +
        '<button class="acct-save" type="button" id="acct-go-login">Log in</button></div>';
      var lb = $('login-btn');
      $('acct-go-login').onclick = function () { if (lb) lb.click(); else location.href = 'index.html?auth=login'; };
      fbReady().then(function () { if (me()) { location.reload(); } });
      return;
    }
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

        '<div class="acct-card" id="ani-card">' +
          '<h2>AniList</h2><p class="sub">スコア同期 — your stars can write to your AniList list score</p>' +
          '<div id="ani-body">checking…</div>' +
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
      var picked = p.avatar || '';
      var pick = $('av-pick');
      if (picked) { pick.style.backgroundImage = 'url(' + picked + ')'; pick.classList.add('has-img'); }
      $('av-choose').onclick = function () { $('av-file').click(); };
      pick.onclick = function () { $('av-file').click(); };
      $('av-file').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        shrinkAvatar(f).then(function (dataUrl) {
          picked = dataUrl;
          pick.style.backgroundImage = 'url(' + dataUrl + ')';
          pick.classList.add('has-img');
          var kb = Math.round(dataUrl.length * 0.75 / 1024);
          $('av-hint').innerHTML = '<b>ready</b> — 128×128 JPEG, ' + kb + ' KB · press Save profile';
          if (kb > 40) $('av-hint').innerHTML += ' <b>(large)</b>';
        }).catch(function (err) { toast(err.message, true); });
        e.target.value = '';
      };
      $('av-clear').onclick = function () {
        picked = '';
        pick.style.backgroundImage = '';
        pick.classList.remove('has-img');
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

      renderAni();
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
                : (AL().isConfigured()
                    ? '<button class="acct-save" type="button" id="ani-go" style="font-size:12.5px;padding:9px 18px">Connect AniList</button>'
                    : '<button class="ac-btn" type="button" id="ani-set" style="margin-right:8px">Set Client ID &amp; connect</button>' +
                      '<button class="ac-btn" type="button" id="ani-pin">Paste a token instead</button>')) +
              '<p class="ani-note"><b>How the sync works.</b> AniList has no bare "give a score" API — ' +
              'your stars are written to the <b>list score</b> on your AniList entry, re-expressed for your own ' +
              'score format (' + esc(label) + '), and your list status is left exactly as it was. A comment can ' +
              'only become a real AniList review if it reaches ' + AL().reviewLimits.minBody +
              ' characters, because AniList enforces that server-side. The token stays in <b>this browser only</b> ' +
              '(localStorage) — nothing is sent to a server of ours. Revoke any time at ' +
              '<a href="https://anilist.co/settings/developer" target="_blank" rel="noopener">anilist.co/settings/developer</a>.</p>';
            var on = function (id, fn) { var el = $(id); if (el) el.onclick = fn; };
            on('ani-go', function () { location.href = AL().authUrl(); });
            on('ani-set', function () { promptClient(); });
            on('ani-pin', function () { promptClient(); });
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
        }).catch(function () { box.textContent = 'could not read profile (check Firestore rules).'; });
      }
    }).catch(function (e) {
      root.innerHTML = '<div class="acct-empty"><h2>Could not load your profile</h2><p>' + esc(e.message || e) +
        '</p><p style="font-size:12px">If this is a fresh Firestore, the <code>users</code> collection needs read/write rules for the signed-in uid.</p></div>';
    });
  }
})();
