/* OTAKU NEWS — shared features: watchlists + comments */
// ============================================
// WATCHLIST ENGINE — per-account, synced via Firestore
// ============================================
(function () {
  const LISTS = ['Watching', 'Plan to Watch', 'Completed'];

  function currentUser() {
    try { return localStorage.getItem('otaku-session'); } catch (e) { return null; }
  }
  function wlKey(user) { return 'otaku-watchlist-' + user.toLowerCase(); }
  function getList(user) {
    try { return JSON.parse(localStorage.getItem(wlKey(user)) || '{}'); } catch (e) { return {}; }
  }
  function saveList(user, list) {
    try { localStorage.setItem(wlKey(user), JSON.stringify(list)); } catch (e) {}
  }
  function currentUid() {
    const u = window.otakuFirebase && window.otakuFirebase.auth.currentUser;
    return u ? u.uid : null;
  }

  window.otakuWL = {
    status(id) {
      const u = currentUser();
      if (!u) return null;
      const entry = getList(u)[id];
      return entry ? entry.list : null;
    },
    set(id, listName, meta) {
      const u = currentUser();
      if (!u) return false;
      const list = getList(u);
      if (listName === null) delete list[id];
      else list[id] = { list: listName, title: meta.title || '', img: meta.img || '', added: Date.now() };
      saveList(u, list);
      const uid = currentUid();
      if (uid && window.otakuFirebase) window.otakuFirebase.saveWatchlist(uid, list);
      return true;
    },
    all() {
      const u = currentUser();
      return u ? getList(u) : {};
    },
    lists: LISTS,
    user: currentUser
  };

  // On login, pull this account's watchlist from Firestore once and
  // merge it in — so a new device (or a cleared browser) picks up
  // anything saved elsewhere. Local entries always win on conflict.
  if (window.otakuFirebase) {
    window.otakuFirebase.onAuthChange(async (uname) => {
      if (!uname) return;
      const uid = currentUid();
      if (!uid) return;
      try {
        const remote = await window.otakuFirebase.loadWatchlist(uid);
        saveList(uname, Object.assign({}, remote, getList(uname)));
      } catch (e) {}
    });
  }

  // ---- Watchlist button injected into detail popups/pages ----
  window.otakuWLButton = function (id, title, img) {
    const status = window.otakuWL.status(id);
    const label = status ? '✓ ' + status : '+ Add to Watchlist';
    return `<div class="wl-wrap" data-wl-id="${id}" data-wl-title="${(title || '').replace(/"/g, '&quot;')}" data-wl-img="${img || ''}">
      <button class="wl-btn${status ? ' on' : ''}">${label}</button>
      <div class="wl-menu">
        ${LISTS.map(l => `<button class="wl-opt${status === l ? ' cur' : ''}" data-list="${l}">${l}</button>`).join('')}
        ${status ? '<button class="wl-opt wl-remove" data-list="">Remove</button>' : ''}
      </div>
    </div>`;
  };

  document.addEventListener('click', e => {
    const btn = e.target.closest('.wl-btn');
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      if (!currentUser()) {
        const login = document.getElementById('login-btn');
        if (login) login.click();
        else location.href = 'index.html?auth=login';
        return;
      }
      btn.closest('.wl-wrap').classList.toggle('open');
      return;
    }
    const opt = e.target.closest('.wl-opt');
    if (opt) {
      e.preventDefault(); e.stopPropagation();
      const wrap = opt.closest('.wl-wrap');
      const id = wrap.dataset.wlId;
      const listName = opt.dataset.list || null;
      window.otakuWL.set(id, listName, { title: wrap.dataset.wlTitle, img: wrap.dataset.wlImg });
      const status = window.otakuWL.status(id);
      wrap.outerHTML = window.otakuWLButton(id, wrap.dataset.wlTitle, wrap.dataset.wlImg);
      return;
    }
    document.querySelectorAll('.wl-wrap.open').forEach(w => {
      if (!w.contains(e.target)) w.classList.remove('open');
    });
  }, true);

  // ---- My List panel (opens from user chip) ----
  function renderMyList() {
    const u = currentUser();
    if (!u) return;
    let panel = document.getElementById('mylist-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'mylist-panel';
      panel.className = 'mylist-overlay';
      document.body.appendChild(panel);
    }
    const all = window.otakuWL.all();
    const ids = Object.keys(all);
    panel.innerHTML = `<div class="mylist-modal">
      <button class="mylist-close">✕</button>
      <h3>${u}'s Watchlist</h3>
      ${LISTS.map(l => {
        const items = ids.filter(id => all[id].list === l);
        if (!items.length) return '';
        return `<div class="mylist-label">${l} (${items.length})</div>
        <div class="mylist-grid">${items.map(id => `
          <a class="mylist-item" href="anime.html?id=${id}">
            ${all[id].img ? `<img src="${all[id].img}" loading="lazy" alt="">` : ''}
            <span>${all[id].title}</span>
          </a>`).join('')}</div>`;
      }).join('') || '<p class="mylist-empty">Nothing saved yet — open any anime and hit "+ Add to Watchlist"</p>'}
    </div>`;
    panel.classList.add('open');
    document.body.classList.add('lb-locked');
    panel.querySelector('.mylist-close').onclick = closeMyList;
    panel.onclick = e => { if (e.target === panel) closeMyList(); };
  }
  function closeMyList() {
    const p = document.getElementById('mylist-panel');
    if (p) p.classList.remove('open');
    document.body.classList.remove('lb-locked');
  }
  // user chip avatar opens the list
  document.addEventListener('click', e => {
    if (e.target.closest('#user-avatar') || e.target.closest('#user-name')) {
      e.preventDefault();
      renderMyList();
    }
  });
})();

// ============================================
// COMMENTS — shared/public, stored in Firestore
// ============================================
(function () {
  function user() { try { return localStorage.getItem('otaku-session'); } catch (e) { return null; } }
  const escX = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // ---- ratings are stored as "tenths" (10,20,…,100) ----
  // Tenths, not 1-5, because AniList's native axis is out of 10 and its POINT_100
  // format is out of 100. Storing tenths makes "push to AniList" a copy, never a
  // lossy re-round — and half stars fall out for free.
  function starsHTML(tenths, interactive, cur) {
    const t = Number(tenths) || 0;
    const picked = cur == null ? null : Number(cur);
    let h = `<span class="ot-stars${interactive ? ' ot-stars-pick' : ''}">`;
    for (let i = 1; i <= 5; i++) {
      const v = picked == null ? t : picked;
      const full = v >= i * 20, half = !full && v >= i * 20 - 10;
      h += `<span class="ot-star${full ? ' f2' : half ? ' f1' : ''}"></span>`;
    }
    if (interactive) {
      h += `<select class="ot-star-input"${picked ? ' data-cur="' + picked + '"' : ''}>
        <option value=""${!picked ? ' selected' : ''}>☆ rate</option>
        ${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v =>
          `<option value="${v}"${picked === v ? ' selected' : ''}>${(v / 20).toFixed(1)}★</option>`).join('')}
        <option value="-"${picked === -1 ? ' selected' : ''}>clear</option>
      </select>`;
    }
    return h + '</span>';
  }
  window.otakuStars = starsHTML;

  // Firestore rules re-check ownership; hiding the button is only UX.
  function canModerate() {
    try { return !!JSON.parse(localStorage.getItem('otaku-mod') || '0'); } catch (e) { return false; }
  }

  async function renderList(comments) {
    if (!comments.length) return '<p class="cm-empty">No comments yet. Be the first!</p>';
    // One batched read (Firestore 'in' caps at 30 docs) so commenters show their
    // profile picture instead of a coloured initial.
    const pics = {};
    const fb = window.otakuFirebase;
    if (fb) {
      const uids = [...new Set(comments.map(c => c.uid).filter(Boolean))].slice(0, 30);
      if (uids.length) {
        try {
          const m = await import("https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js");
          const snap = await m.getDocs(m.query(m.collection(fb.db, "users"), m.where("__name__", "in", uids)));
          snap.forEach(d => { const av = (d.data() || {}).avatar; if (av) pics[d.id] = av; });
        } catch (e) { /* avatars are cosmetic — never block the thread */ }
      }
    }
    return comments.map(c => {
      const mine = !!(c.uid && fb && fb.auth.currentUser && c.uid === fb.auth.currentUser.uid);
      const del = (mine || canModerate()) && c.id
        ? '<button class="cm-del" type="button" title="Delete your comment">✕</button>' : '';
      const av = pics[c.uid] ? `<img src="${pics[c.uid]}" alt="">` : escX((c.user || '?')[0].toUpperCase());
      return `<div class="cm-item" data-cm-doc="${escX(c.id || '')}" data-cm-uid="${escX(c.uid || '')}">
      <span class="cm-avatar${pics[c.uid] ? ' has-img' : ''}">${av}</span>
      <div class="cm-main"><div class="cm-head"><b>${escX(c.user)}</b> <span>${new Date(c.at).toLocaleDateString()}</span>${del}</div>
      ${c.tenths ? `<div class="cm-stars">${starsHTML(c.tenths)}<em>${(c.tenths / 20).toFixed(1)}/5</em></div>` : ''}
      <p>${escX(c.text)}</p></div>
    </div>`;
    }).join('');
  }

  // Synchronous shell so the page renders instantly; otakuCommentsRefresh
  // fills in the real, shared thread right after (comments live in
  // Firestore now, so every visitor sees the same list).
  window.otakuComments = function (animeId, mediaTitle) {
    return `<div class="cm-box" data-cm-id="${animeId}" data-cm-title="${escX(mediaTitle || '')}">
      <div class="detail-section-label">コメント — Comments (<span class="cm-count">…</span>)</div>
      ${window.otakuRatingBox ? window.otakuRatingBox(animeId, mediaTitle) : ''}
      <div class="cm-list"><p class="cm-empty">Loading comments…</p></div>
      ${user()
        ? `<form class="cm-form">
             <div class="cm-form-stars">${starsHTML(0, true)}<span class="cm-form-hint">rate it — optional</span></div>
             <input type="text" maxlength="500" placeholder="Share your take…" required><button type="submit">Post</button></form>`
        : `<p class="cm-login">Log in to comment.</p>`}
    </div>`;
  };

  window.otakuCommentsRefresh = async function (animeId) {
    const box = document.querySelector('.cm-box[data-cm-id="' + CSS.escape(String(animeId)) + '"]');
    if (!box || !window.otakuFirebase) return;
    try {
      const comments = await window.otakuFirebase.loadComments(animeId);
      box.querySelector('.cm-count').textContent = comments.length;
      box.querySelector('.cm-list').innerHTML = await renderList(comments);
    } catch (e) {
      box.querySelector('.cm-list').innerHTML = '<p class="cm-empty">Couldn\u2019t load comments right now.</p>';
    }
  };

  // ---- rating widgets: delegated so they survive re-renders ----
  document.addEventListener('change', e => {
    const sel = e.target.closest('.ot-star-input');
    if (!sel) return;
    const form = sel.closest('.cm-form');
    const block = sel.closest('.rating-block');
    const id = block ? block.dataset.ratingId : (sel.closest('.cm-box') || {}).dataset?.cmId;
    if (!id) return;
    // '' = nothing picked yet, '-' = clear. Number('-') is NaN, and Number('') is 0,
    // so both need handling before the conversion or "clear" writes a bogus score.
    const v = (sel.value === '-' || sel.value === '') ? null : (Number(sel.value) || null);
    if (form) {                       // picking while writing a comment: paint only
      sel.closest('.ot-stars').querySelectorAll('.ot-star').forEach((st, i) => {
        const full = v && v >= (i + 1) * 20;
        const half = !full && !!v && v >= (i + 1) * 20 - 10;
        st.className = 'ot-star' + (full ? ' f2' : half ? ' f1' : '');
      });
      return;
    }
    (window.__otakuApplyRating || function () {})(id, v, sel);
  });

  // ---- comment deletion ----
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.cm-del');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const item = btn.closest('.cm-item'), box = btn.closest('.cm-box');
    const fb = window.otakuFirebase;
    if (!item || !box || !fb) return;
    const cur = fb.auth.currentUser;
    if (!cur || cur.uid !== item.dataset.cmUid) {
      if (!canModerate()) return;                  // not yours, not a mod: no-op
    }
    const docId = item.dataset.cmDoc;
    if (!docId) return;
    if (!confirm('Delete this comment? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      await fb.deleteComment(box.dataset.cmId, docId);
      await window.otakuCommentsRefresh(box.dataset.cmId);
      if (window.__otakuRatingRefresh) window.__otakuRatingRefresh(box.dataset.cmId);
    } catch (err) {
      btn.disabled = false;
      alert('Could not delete — ' + (err.message || err));
    }
  }, true);

  document.addEventListener('submit', async e => {
    const form = e.target.closest('.cm-form');
    if (!form) return;
    e.preventDefault();
    const box = form.closest('.cm-box');
    const id = box.dataset.cmId;
    const input = form.querySelector('input');
    const text = input.value.trim();
    const uname = user();
    if (!text || !uname || !window.otakuFirebase) return;
    // read the picker BEFORE the refresh replaces the form, or this is null
    const sel = form.querySelector('.ot-star-input');
    const tenths = sel && sel.value ? Number(sel.value) : 0;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const current = window.otakuFirebase.auth.currentUser;
      await window.otakuFirebase.postComment(id, {
        user: uname, uid: current ? current.uid : null, text, tenths: tenths || null
      });
      // Mirror the stars onto the shared per-title score so the aggregate and the
      // AniList push both see it. null clears (merge-delete on the field).
      if (current) {
        await window.otakuFirebase.setScore(id, current.uid, tenths || null);
        if (window.__otakuRatingRefresh) window.__otakuRatingRefresh(id);
        if (window.__otakuAfterComment) {
          window.__otakuAfterComment({
            animeId: id, tenths: tenths || null, text: text,
            uid: current.uid, user: uname,
            title: box.dataset.cmTitle || document.title.replace(/\s*—.*$/, '')
          });
        }
      }
      input.value = '';
      await window.otakuCommentsRefresh(id);
    } catch (e2) {
      // leave their typed comment in the box so nothing gets lost
    } finally {
      btn.disabled = false;
    }
  }, true);
})();

// ============================================
// RATINGS — one aggregate per title + the current user's own number
// ============================================
(function () {
  const fb = () => window.otakuFirebase;

  window.otakuRatingBox = function (animeId, title) {
    return `<div class="rating-block" data-rating-id="${animeId}" data-rating-title="${(title || '').replace(/"/g, '&quot;')}">
      <div class="rating-agg"><span class="ra-avg">—</span><span class="ra-stars"></span><span class="ra-count">loading…</span></div>
      <div class="rating-dist"></div>
      <div class="rating-mine"></div>
    </div>`;
  };

  async function refresh(animeId) {
    const box = document.querySelector('.rating-block[data-rating-id="' + CSS.escape(String(animeId)) + '"]');
    const f = fb();
    if (!box || !f) return;
    try {
      const all = (await f.loadScores(animeId)) || {};
      const cur = f.auth.currentUser;
      const mine = cur ? (all[cur.uid] || null) : null;
      const vals = Object.keys(all).map(k => all[k]).filter(v => v > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      box.querySelector('.ra-avg').textContent = avg ? (avg / 20).toFixed(1) : '—';
      box.querySelector('.ra-stars').innerHTML = window.otakuStars ? window.otakuStars(avg) : '';
      box.querySelector('.ra-count').textContent = vals.length
        ? vals.length + ' rating' + (vals.length > 1 ? 's' : '') + ' · ★ ' + (avg / 20).toFixed(1) + '/5'
        : 'no ratings yet';
      const buckets = [0, 0, 0, 0, 0];
      vals.forEach(v => { buckets[Math.min(4, Math.max(0, Math.ceil(v / 20) - 1))]++; });
      const max = Math.max.apply(null, buckets) || 1;
      box.querySelector('.rating-dist').innerHTML = [5, 4, 3, 2, 1].map((st, i) =>
        '<div class="rd-row"><span>' + st + '★</span><span class="rd-bar"><i style="width:' +
        Math.round(buckets[4 - i] / max * 100) + '%"></i></span><em>' + buckets[4 - i] + '</em></div>'
      ).join('');
      box.querySelector('.rating-mine').innerHTML = cur
        ? '<span class="rm-label">Your rating</span>' +
          (window.otakuStars ? window.otakuStars(mine || 0, true, mine) : '') +
          (mine ? '<em>' + (mine / 20).toFixed(1) + '</em>' : '') +
          ' <button type="button" class="ot-ani-push">Push to AniList</button>'
        : '<span class="rm-label">Log in to rate</span>';
    } catch (e) {
      box.querySelector('.ra-count').textContent = 'ratings unavailable';
    }
  }
  window.__otakuRatingRefresh = refresh;

  window.__otakuApplyRating = async function (animeId, tenths, srcEl) {
    const f = fb();
    if (!f) return;
    const cur = f.auth.currentUser;
    if (!cur) {
      const login = document.getElementById('login-btn');
      if (login) login.click();
      return;
    }
    try {
      await f.setScore(animeId, cur.uid, tenths);
      await refresh(animeId);
      // refresh() rebuilds .rating-mine, so the freshly-picked value must be
      // re-applied to the returned markup or the stars look unsaved.
      const after = document.querySelector('.rating-block[data-rating-id="' + CSS.escape(String(animeId)) + '"] .ot-star-input');
      if (after) after.value = tenths == null ? '' : String(tenths);
      // A change typed in the picker pushes straight away — no extra click needed.
      if (tenths && window.__otakuRatingAutoPush) window.__otakuRatingAutoPush(animeId, tenths);
    } catch (e) { /* aggregate row already reflects the attempt */ }
    if (srcEl && srcEl.tagName === 'SELECT') srcEl.value = tenths == null ? '' : String(tenths);
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.rating-block').forEach(b => refresh(b.dataset.ratingId));
  });
})();

// ============================================
// PROFILE HELPERS shared by the account page, the nav chip and the comment
// list. The account UI itself lives in account.js.
// ============================================
(function () {
  function paint(el, pic) {
    if (!el) return;
    if (pic) {
      el.style.backgroundImage = 'url(' + pic + ')';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.classList.add('has-img');
      if (!el.dataset.initial) el.dataset.initial = el.textContent;  // script.js writes an initial
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('has-img');
      if (el.dataset.initial) { el.textContent = el.dataset.initial; delete el.dataset.initial; }
    }
  }
  function paintChip() {
    const f = window.otakuFirebase;
    const av = document.getElementById('user-avatar');
    if (!av) return;
    if (!f || !f.auth.currentUser) { paint(av, ''); return; }
    f.loadProfile(f.auth.currentUser.uid).then(p => paint(av, p && p.avatar)).catch(() => {});
  }
  window.otakuProfilePic = function (uid) {
    const f = window.otakuFirebase;
    if (!f || !uid) return Promise.resolve('');
    return f.loadProfile(uid).then(p => (p && p.avatar) || '').catch(() => '');
  };
  window.otakuAvatarPaint = paint;
  if (window.otakuFirebase) {
    window.otakuFirebase.onAuthChange(paintChip);
    document.addEventListener('DOMContentLoaded', paintChip);
  }
})();
