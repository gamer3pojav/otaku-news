/* OTAKU NEWS — shared features: watchlists + comments */
// ============================================
// WATCHLIST ENGINE — per-account, device-local
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
      return true;
    },
    all() {
      const u = currentUser();
      return u ? getList(u) : {};
    },
    lists: LISTS,
    user: currentUser
  };

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
// COMMENTS — per-anime, device-local
// ============================================
(function () {
  function user() { try { return localStorage.getItem('otaku-session'); } catch (e) { return null; } }
  function cKey(id) { return 'otaku-comments-' + id; }
  function getComments(id) {
    try { return JSON.parse(localStorage.getItem(cKey(id)) || '[]'); } catch (e) { return []; }
  }
  const escX = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  window.otakuComments = function (animeId) {
    const comments = getComments(animeId);
    return `<div class="cm-box" data-cm-id="${animeId}">
      <div class="detail-section-label">コメント — Comments (${comments.length})</div>
      <div class="cm-list">
        ${comments.map(c => `<div class="cm-item">
          <span class="cm-avatar">${escX(c.user[0].toUpperCase())}</span>
          <div><div class="cm-head"><b>${escX(c.user)}</b> <span>${new Date(c.at).toLocaleDateString()}</span></div>
          <p>${escX(c.text)}</p></div>
        </div>`).join('') || '<p class="cm-empty">No comments yet. Be the first!</p>'}
      </div>
      ${user()
        ? `<form class="cm-form"><input type="text" maxlength="500" placeholder="Share your take…" required><button type="submit">Post</button></form>`
        : `<p class="cm-login">Log in to comment.</p>`}
    </div>`;
  };

  document.addEventListener('submit', e => {
    const form = e.target.closest('.cm-form');
    if (!form) return;
    e.preventDefault();
    const box = form.closest('.cm-box');
    const id = box.dataset.cmId;
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text || !user()) return;
    const comments = getComments(id);
    comments.push({ user: user(), text, at: Date.now() });
    try { localStorage.setItem(cKey(id), JSON.stringify(comments)); } catch (e2) {}
    box.outerHTML = window.otakuComments(id);
  }, true);
})();
