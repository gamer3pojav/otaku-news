/* ============================================
   OTAKU NEWS — script.js
   All the JavaScript (NOT Java, bro) 😤
   ============================================ */

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
window.addEventListener('load', () => window.scrollTo(0, 0));

// ---------- 60fps scroll reveals (IntersectionObserver = zero scroll-handler jank) ----------
  const revealTargets = document.querySelectorAll(
    '.featured-card, .section-head, .news-item, .review-card:not(.live-card), .rank-item, .newsletter, .live-controls, .live-status'
  );
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target); // fire once, stop observing = less work per frame
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });

  revealTargets.forEach((el, i) => {
    el.classList.add('reveal');
    // Small stagger within viewport batches, capped so nothing feels sluggish
    el.style.transitionDelay = Math.min((i % 6) * 45, 220) + 'ms';
    io.observe(el);
  });

  // Reveal live-API cards as they're injected, batched via rAF (no layout thrash)
  const liveGridObserver = new MutationObserver(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('#live-grid .live-card:not(.reveal)').forEach((el, i) => {
        el.classList.add('reveal');
        el.style.transitionDelay = Math.min(i * 40, 280) + 'ms';
        requestAnimationFrame(() => el.classList.add('in'));
      });
    });
  });
  liveGridObserver.observe(document.getElementById('live-grid'), { childList: true });

  // ---------- Theme toggle ----------
  const themeBtn = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const themes = ['light', 'dark', 'cyberpunk'];

  function applyTheme(theme) {
    if (!themes.includes(theme)) theme = 'light';
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('otaku-theme', theme); } catch (e) {}
    if (themeBtn) {
      themeBtn.title = 'Theme: ' + theme.charAt(0).toUpperCase() + theme.slice(1) + ' (Click to change)';
    }
  }

  // Load saved preference, else follow system
  let saved = null;
  try { saved = localStorage.getItem('otaku-theme'); } catch (e) {}
  applyTheme(saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') || 'light';
      const nextIdx = (themes.indexOf(current) + 1) % themes.length;
      applyTheme(themes[nextIdx]);
    });
  }

  function subscribe(e) {
    e.preventDefault();
    const form = e.target;
    const email = form.querySelector('input[type="email"]').value.trim();
    try { localStorage.setItem('otaku-nl-email', email); } catch (err) {}
    // backend if available; static hosting just shows success
    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    }).catch(() => {});
    form.style.display = 'none';
    document.querySelector('.nl-unsub-done').style.display = 'none';
    document.querySelector('.nl-done').style.display = 'block';
  }

  // ---------- Newsletter unsubscribe / resubscribe ----------
  document.addEventListener('click', e => {
    if (e.target.id === 'nl-unsub') {
      let email = '';
      try { email = localStorage.getItem('otaku-nl-email') || ''; } catch (err) {}
      fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      }).catch(() => {});
      try { localStorage.removeItem('otaku-nl-email'); } catch (err) {}
      document.querySelector('.nl-done').style.display = 'none';
      document.querySelector('.nl-unsub-done').style.display = 'block';
    }
    if (e.target.id === 'nl-resub') {
      document.querySelector('.nl-unsub-done').style.display = 'none';
      const form = document.querySelector('.nl-form');
      form.style.display = '';
      form.querySelector('input').focus();
    }
  });

  // Returning subscriber? show subscribed state
  (function () {
    let email = '';
    try { email = localStorage.getItem('otaku-nl-email') || ''; } catch (err) {}
    if (email) {
      const form = document.querySelector('.nl-form');
      if (form) {
        form.style.display = 'none';
        document.querySelector('.nl-done').style.display = 'block';
      }
    }
  })();

  
// ---------- Real creator lookup (shared) ----------
function creatorOf(m) {
  const ROLES = ['Original Creator', 'Original Story', 'Story & Art', 'Story', 'Original Character Design'];
  const edges = (m.staff && m.staff.edges) || [];
  for (const role of ROLES) {
    const hit = edges.find(e => (e.role || '').trim() === role);
    if (hit) return hit.node.name.full;
  }
  return null;
}

  // ---------- Live search ----------
  const searchInput = document.getElementById('search');
  const featured = document.querySelector('.featured');
  const groups = [
    { items: () => document.querySelectorAll('#news .news-item'),    empty: document.querySelector('#news .no-results') },
    { items: () => document.querySelectorAll('#reviews .review-card'), empty: document.querySelector('#reviews .no-results') },
    { items: () => document.querySelectorAll('#rankings .rank-item'), empty: document.querySelector('#rankings .no-results') },
    { items: () => document.querySelectorAll('#airing .live-card'), empty: null },
  ];

  searchInput.addEventListener('pagefilter', () => {
    const q = searchInput.value.trim().toLowerCase();

    // Featured card counts too
    if (featured) {
      const match = !q || featured.textContent.toLowerCase().includes(q);
      featured.style.display = match ? '' : 'none';
    }

    groups.forEach(group => {
      let visible = 0;
      group.items().forEach(el => {
        const match = !q || el.textContent.toLowerCase().includes(q);
        el.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      if (group.empty) group.empty.style.display = (q && visible === 0) ? 'block' : 'none';
    });
  });

  // ---------- Live AniList API section ----------
  const liveGrid = document.getElementById('live-grid');
  const liveError = document.getElementById('live-error');
  const liveStatusText = document.getElementById('live-status-text');
  const sortButtons = document.querySelectorAll('#airing .live-controls button');

  const QUERY = `
    query ($sort: [MediaSort]) {
      Page(perPage: 16) {
        media(status: RELEASING, type: ANIME, sort: $sort, isAdult: false) {
          id
          title { english romaji }
          averageScore
          popularity
          genres
          format
          episodes
          duration
          description(asHtml: false)
          updatedAt
          siteUrl
          coverImage { large }
          studios(isMain: true) { nodes { name } }
          staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
          nextAiringEpisode { episode timeUntilAiring }
        }
      }
    }`;

  function timeAgo(unixSec) {
    if (!unixSec) return 'unknown';
    const s = Math.floor(Date.now() / 1000) - unixSec;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function untilText(sec) {
    if (sec == null) return null;
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
    return d > 0 ? `EP in ${d}d ${h}h` : `EP in ${h}h`;
  }

  async function loadLive(sort) {
    liveError.style.display = 'none';
    liveGrid.style.display = '';
    liveGrid.innerHTML = '<div class="skeleton"></div>'.repeat(8);
    liveStatusText.textContent = 'Fetching live data from AniList…';
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { sort: [sort] } })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const shows = json.data.Page.media;

      const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

      liveGrid.innerHTML = shows.map(m => {
        const title = m.title.english || m.title.romaji;
        const studio = (m.studios.nodes[0] || {}).name || '—';
        const score = m.averageScore ? (m.averageScore / 10).toFixed(2) : '—';
        const next = m.nextAiringEpisode;
        const badge = next ? untilText(next.timeUntilAiring) : null;
        const genres = (m.genres || []).slice(0, 3);
        const format = m.format === 'TV' ? 'TV' : (m.format || '').replace(/_/g, ' ');
        const epInfo = next ? `EP ${next.episode - 1}${m.episodes ? ' / ' + m.episodes : ''}` : (m.episodes ? m.episodes + ' eps' : '');
        const fans = m.popularity >= 1000 ? (m.popularity / 1000).toFixed(0) + 'k fans' : (m.popularity ? m.popularity + ' fans' : '');
        const desc = esc((m.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).slice(0, 220);
        return `
        <a class="review-card live-card" href="anime.html?id=${m.id}">
          <div class="thumb">
            <img src="${m.coverImage.large}" alt="${esc(title)} cover" loading="lazy">
            <span class="score">${score}</span>
            ${badge ? `<span class="ep-badge">${badge}</span>` : ''}
            ${desc ? `<span class="desc-overlay"><span>${desc}${desc.length >= 220 ? '…' : ''}</span></span>` : ''}
          </div>
          <div class="body">
            <div class="show-name">${title}</div>
            <div class="studio">${studio}</div>
            ${creatorOf(m) ? `<div class="card-author"><span class="author-tag">AUTHOR</span>${creatorOf(m)}</div>` : ''}
            <div class="live-meta">
              ${format ? `<span class="meta-chip">${format}</span>` : ''}
              ${epInfo ? `<span class="meta-chip">${epInfo}</span>` : ''}
              ${m.duration ? `<span class="meta-chip">${m.duration}min</span>` : ''}
            </div>
            <div class="genre-row">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>
            <p class="verdict">Updated ${timeAgo(m.updatedAt)}${next ? ` · next: EP ${next.episode}` : ''}${fans ? ` · ${fans}` : ''}</p>
          </div>
        </a>`;
      }).join('');

      liveStatusText.textContent = `Live from AniList · ${shows.length} shows · fetched ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      liveGrid.style.display = 'none';
      liveError.style.display = 'block';
      liveStatusText.textContent = 'API unreachable';
    }
  }

  sortButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      sortButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadLive(btn.dataset.sort);
    });
  });

  loadLive('UPDATED_AT_DESC');
  // auto-refresh airing every 30 min
  let currentSort = 'UPDATED_AT_DESC';
  sortButtons.forEach(b => b.addEventListener('click', () => { currentSort = b.dataset.sort; }));
  setInterval(() => { if (!document.hidden) loadLive(currentSort); }, 1800000);

  // Press "/" anywhere to jump to search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.dispatchEvent(new Event('pagefilter'));
      searchInput.blur();
    }
  });

// ---------- Auth (login / signup) ----------
(function () {
  const modal = document.getElementById('auth-modal');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const chip = document.getElementById('user-chip');
  const form = document.getElementById('auth-form');
  const errBox = document.getElementById('auth-error');
  const emailInput = document.getElementById('auth-email');
  const userInput = document.getElementById('auth-username');
  const passInput = document.getElementById('auth-password');
  let mode = 'login'; // or 'signup'

  function setMode(m) {
    mode = m;
    const signup = m === 'signup';
    document.getElementById('auth-title').textContent = signup ? 'Join the crew' : 'Welcome back';
    document.getElementById('auth-sub').textContent = signup
      ? '登録 — CREATE YOUR OTAKU NEWS ACCOUNT'
      : 'ログイン — LOG IN TO OTAKU NEWS';
    document.getElementById('auth-submit').textContent = signup ? 'Sign up' : 'Log in';
    emailInput.style.display = signup ? '' : 'none';
    emailInput.required = signup;
    passInput.autocomplete = signup ? 'new-password' : 'current-password';
    document.getElementById('auth-switch').innerHTML = signup
      ? 'Already a member? <a id="auth-toggle-mode">Log in</a>'
      : 'New here? <a id="auth-toggle-mode">Create an account</a>';
    document.getElementById('auth-toggle-mode').onclick = () => setMode(signup ? 'login' : 'signup');
    errBox.style.display = 'none';
  }

  function openModal(m) { setMode(m); modal.classList.add('open'); document.body.classList.add('lb-locked'); setTimeout(() => userInput.focus(), 250); }
  function closeModal() { modal.classList.remove('open'); document.body.classList.remove('lb-locked'); form.reset(); errBox.style.display = 'none'; }

  // Arrived here via a "log in first" redirect from a page with no
  // login button of its own (e.g. tapping Add to Watchlist on anime.html)
  if (new URLSearchParams(location.search).get('auth') === 'login') {
    openModal('login');
    history.replaceState(null, '', location.pathname + location.hash);
  }

  function showLoggedIn(name) {
    loginBtn.style.display = 'none';
    chip.style.display = 'flex';
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-avatar').textContent = name[0];
  }
  function showLoggedOut() {
    loginBtn.style.display = '';
    chip.style.display = 'none';
  }

  loginBtn.addEventListener('click', () => openModal('login'));
  document.getElementById('auth-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  // ---- Firebase accounts (real backend — see firebase-init.js) ----
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errBox.style.display = 'none';
    const body = { username: userInput.value, password: passInput.value };
    if (mode === 'signup') body.email = emailInput.value;
    try {
      const user = mode === 'signup'
        ? await window.otakuFirebase.signUp(body)
        : await window.otakuFirebase.logIn(body);
      showLoggedIn(user);
      // Write this AFTER signUp/logIn resolve, so it overwrites any
      // premature (email-only) value the onAuthChange listener below
      // may have written while the new profile name was still saving.
      try { localStorage.setItem('otaku-session', user); } catch (e) {}
      closeModal();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  });

  logoutBtn.addEventListener('click', () => window.otakuFirebase.logOut());

  // Reflect Firebase's real auth state. Also mirror it into
  // otaku-session so features.js (watchlist/comments, used on
  // anime.html too) still knows who's logged in without changes.
  window.otakuFirebase.onAuthChange(user => {
    if (user) {
      showLoggedIn(user);
      try { localStorage.setItem('otaku-session', user); } catch (e) {}
    } else {
      showLoggedOut();
      try { localStorage.removeItem('otaku-session'); } catch (e) {}
    }
  });
})();

// ---------- Hamburger menu ----------
(function () {
  const btn = document.getElementById('menu-btn');
  const drawer = document.getElementById('menu-drawer');

  function setOpen(open) {
    btn.classList.toggle('open', open);
    drawer.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(!drawer.classList.contains('open'));
  });

  // Close when clicking a link inside, outside, or pressing Esc
  drawer.addEventListener('click', e => {
    if (e.target.tagName === 'A' || e.target.id === 'login-btn') setOpen(false);
  });
  document.addEventListener('click', e => {
    if (drawer.classList.contains('open') && !drawer.contains(e.target) && e.target !== btn) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) setOpen(false);
  });
})();

// ---------- Trending tags -> live search ----------
(function () {
  const tags = document.querySelectorAll('.trend-tag');
  const search = document.getElementById('search');
  tags.forEach(tag => {
    tag.addEventListener('click', () => {
      const q = tag.textContent;
      const alreadyActive = tag.classList.contains('active');
      tags.forEach(t => t.classList.remove('active'));
      if (alreadyActive) {
        search.value = '';           // second click clears the filter
      } else {
        tag.classList.add('active');
        search.value = q;
      }
      search.dispatchEvent(new Event('pagefilter'));
      if (!alreadyActive) document.getElementById('news').scrollIntoView({ behavior: 'smooth' });
    });
  });
  // typing manually clears tag highlight
  search.addEventListener('input', () => {
    if (!tags.length) return;
    const q = search.value.trim().toLowerCase();
    tags.forEach(t => {
      if (t.textContent.toLowerCase() !== q) t.classList.remove('active');
    });
  });
})();

// ---------- Expandable news articles ----------
document.querySelectorAll('.news-item[data-expand]').forEach(item => {
  item.addEventListener('click', e => {
    if (e.target.closest('a')) return; // let source links click through
    item.classList.toggle('expanded');
  });
});

// ---------- Drawer search mirrors main search ----------
(function () {
  const main = document.getElementById('search');
  const drawer = document.getElementById('drawer-search-input');
  if (!drawer) return;
  drawer.addEventListener('input', () => {
    main.value = drawer.value;
    main.dispatchEvent(new Event('input'));
  });
  drawer.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      main.value = drawer.value;
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      const dw = document.getElementById('menu-drawer');
      const mb = document.getElementById('menu-btn');
      if (dw) dw.classList.remove('open');
      if (mb) mb.classList.remove('open');
    }
  });
})();

// ---------- Discover section: full AniList catalog on the home page ----------
(function () {
  const grid = document.getElementById('browse-grid');
  if (!grid) return;
  const statusLine = document.getElementById('status-line');
  const emptyBox = document.getElementById('browse-empty');
  const loadBtn = document.getElementById('load-more');
  const qInput = document.getElementById('q');

  const state = { search: '', genre: '', status: '', sort: 'POPULARITY_DESC', type: 'ANIME', page: 1, loading: false };

  const CATALOG_QUERY = `
    query ($page: Int, $search: String, $genre: String, $status: MediaStatus, $sort: [MediaSort], $type: MediaType) {
      Page(page: $page, perPage: 36) {
        pageInfo { total hasNextPage }
        media(type: $type, search: $search, genre: $genre, status: $status, sort: $sort, isAdult: false) {
          id
          title { english romaji }
          averageScore popularity format episodes seasonYear
          genres
          coverImage { large }
          studios(isMain: true) { nodes { name } }
          staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
        }
      }
    }`;

  const escC = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function card(m) {
    const title = m.title.english || m.title.romaji;
    const studio = (m.studios.nodes[0] || {}).name || '—';
    const score = m.averageScore ? (m.averageScore / 10).toFixed(2) : '—';
    const bits = [
      (m.format || '').replace(/_/g, ' '),
      m.episodes ? m.episodes + ' eps' : null,
      m.seasonYear
    ].filter(Boolean).join(' · ');
    const genres = (m.genres || []).slice(0, 3);
    return `
      <a class="review-card" href="anime.html?id=${m.id}">
        <div class="thumb">
          <img src="${m.coverImage.large}" alt="${escC(title)} cover" loading="lazy">
          <span class="score">${score}</span>
        </div>
        <div class="body">
          <div class="show-name">${escC(title)}</div>
          <div class="studio">${escC(studio)}</div>
          ${creatorOf(m) ? `<div class="card-author"><span class="author-tag">AUTHOR</span>${escC(creatorOf(m))}</div>` : ''}
          <div class="live-meta">${bits ? `<span class="meta-chip">${bits}</span>` : ''}</div>
          <div class="genre-row">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>
        </div>
      </a>`;
  }

  async function fetchPage(append) {
    if (state.loading) return;
    state.loading = true;
    loadBtn.disabled = true;
    emptyBox.style.display = 'none';
    if (!append) {
      grid.innerHTML = '<div class="skeleton"></div>'.repeat(8);
      statusLine.textContent = 'Searching the catalog…';
    } else {
      loadBtn.textContent = 'Loading…';
    }
    try {
      const variables = { page: state.page, sort: [state.sort], type: state.type };
      if (state.search) variables.search = state.search;
      if (state.genre) variables.genre = state.genre;
      if (state.status) variables.status = state.status;

      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: CATALOG_QUERY, variables })
      });
      if (!res.ok) throw 0;
      const { data } = await res.json();
      const { media, pageInfo } = data.Page;

      let fresh = media;
      if (append) {
        const have = new Set([...grid.querySelectorAll('a[href*="id="], a[data-detail]')].map(el =>
          el.dataset.detail || (el.href.match(/id=(\d+)/) || [])[1]));
        fresh = media.filter(m => !have.has(String(m.id)));
      }
      const html = fresh.map(card).join('');
      if (append) grid.insertAdjacentHTML('beforeend', html);
      else grid.innerHTML = html;

      if (!media.length && !append) {
        emptyBox.style.display = 'block';
        statusLine.textContent = '0 results';
      } else {
        const shown = grid.querySelectorAll('.review-card').length;
        statusLine.textContent = `Showing ${shown.toLocaleString()} of ${pageInfo.total.toLocaleString()} anime — live from AniList`;
      }
      loadBtn.style.display = pageInfo.hasNextPage ? '' : 'none';
    } catch (e) {
      statusLine.textContent = 'API unreachable — try refreshing.';
      if (!append) grid.innerHTML = '';
      emptyBox.style.display = 'block';
      emptyBox.textContent = '⚠️ Couldn\'t reach AniList. Refresh to retry.';
    } finally {
      state.loading = false;
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load more ↓';
    }
  }

  function restart() { state.page = 1; fetchPage(false); }

  let deb;
  qInput.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      state.search = qInput.value.trim();
      restart();
    }, 450);
  });

  function wireRow(rowId, key, dataAttr) {
    document.getElementById(rowId).addEventListener('click', e => {
      const chip = e.target.closest('.fchip');
      if (!chip) return;
      document.querySelectorAll('#' + rowId + ' .fchip').forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
      state[key] = chip.dataset[dataAttr];
      restart();
    });
  }
  wireRow('type-row', 'type', 'type');
  wireRow('genre-row', 'genre', 'genre');
  wireRow('status-row', 'status', 'status');
  wireRow('sort-row', 'sort', 'sort');

  loadBtn.addEventListener('click', () => { state.page++; fetchPage(true); });

  fetchPage(false);
})();

// ---------- Upcoming anime (live AniList API) ----------
(function () {
  const grid = document.getElementById('upcoming-grid');
  if (!grid) return;
  const statusEl = document.getElementById('upcoming-status');
  const errBox = document.getElementById('upcoming-error');

  const UPCOMING_QUERY = `
    query {
      Page(perPage: 16) {
        media(type: ANIME, status: NOT_YET_RELEASED, sort: [POPULARITY_DESC], isAdult: false) {
          id
          title { english romaji }
          popularity
          format
          season seasonYear
          startDate { year month day }
          genres
          coverImage { large }
          studios(isMain: true) { nodes { name } }
          staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
        }
      }
    }`;

  const escU = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function premiereText(m) {
    const d = m.startDate || {};
    if (d.year && d.month && d.day) {
      const when = new Date(d.year, d.month - 1, d.day);
      const days = Math.ceil((when - Date.now()) / 86400000);
      const dateStr = MONTHS[d.month] + ' ' + d.day + ', ' + d.year;
      return { badge: days > 0 ? (days > 99 ? '99+ days' : days + ' days') : 'Soon', date: dateStr };
    }
    if (d.year && d.month) return { badge: null, date: MONTHS[d.month] + ' ' + d.year };
    if (m.season && m.seasonYear) return { badge: null, date: m.season + ' ' + m.seasonYear };
    if (d.year) return { badge: null, date: '' + d.year };
    return { badge: null, date: 'TBA' };
  }

  fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: UPCOMING_QUERY })
  })
  .then(r => { if (!r.ok) throw 0; return r.json(); })
  .then(({ data }) => {
    const shows = data.Page.media;
    grid.innerHTML = shows.map(m => {
      const title = m.title.english || m.title.romaji;
      const studio = (m.studios.nodes[0] || {}).name || 'Studio TBA';
      const prem = premiereText(m);
      const genres = (m.genres || []).slice(0, 3);
      const hype = m.popularity >= 1000 ? (m.popularity / 1000).toFixed(0) + 'k hyped' : m.popularity + ' hyped';
      return `
      <a class="review-card live-card" href="anime.html?id=${m.id}">
        <div class="thumb">
          <img src="${m.coverImage.large}" alt="${escU(title)} cover" loading="lazy">
          ${prem.badge ? `<span class="ep-badge">🗓 ${prem.badge}</span>` : ''}
          <span class="score" style="background:linear-gradient(100deg,var(--accent),#ff8a5c);border:none">SOON</span>
        </div>
        <div class="body">
          <div class="show-name">${escU(title)}</div>
          <div class="studio">${escU(studio)}</div>
          ${creatorOf(m) ? `<div class="card-author"><span class="author-tag">AUTHOR</span>${escU(creatorOf(m))}</div>` : ''}
          <div class="live-meta">
            ${m.format ? `<span class="meta-chip">${(m.format || '').replace(/_/g, ' ')}</span>` : ''}
            <span class="meta-chip">${prem.date}</span>
          </div>
          <div class="genre-row">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>
          <p class="verdict">🔥 ${hype}</p>
        </div>
      </a>`;
    }).join('');
    statusEl.textContent = `Live from AniList · ${shows.length} most-hyped upcoming shows · fetched ${new Date().toLocaleTimeString()}`;
  })
  .catch(() => {
    grid.style.display = 'none';
    errBox.style.display = 'block';
    statusEl.textContent = 'API unreachable';
  });
})();

// ---------- Live Power Rankings (tabbed: season / all time / trending / hyped) ----------
(function () {
  const list = document.getElementById('rank-list');
  if (!list) return;
  const statusEl = document.getElementById('rank-status');
  const tabs = document.querySelectorAll('#rank-tabs button[data-mode]');

  const MODES = {
    season:   { args: 'status: RELEASING, sort: [SCORE_DESC], popularity_greater: 20000', label: 'top airing shows by community score', metric: 'score' },
    alltime:  { args: 'sort: [SCORE_DESC], popularity_greater: 50000', label: 'highest-rated anime of all time', metric: 'score' },
    trending: { args: 'sort: [TRENDING_DESC]', label: 'trending right now', metric: 'trend' },
    hyped:    { args: 'status: NOT_YET_RELEASED, sort: [POPULARITY_DESC]', label: 'most-hyped upcoming anime', metric: 'fans' }
  };

  const escR = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function loadRanks(mode) {
    const cfg = MODES[mode];
    list.innerHTML = '<div class="skeleton" style="aspect-ratio:auto;height:64px;margin-bottom:10px"></div>'.repeat(5);
    statusEl.textContent = 'Computing rankings…';
    const q = `query { Page(perPage: 15) { media(type: ANIME, isAdult: false, ${cfg.args}) {
      id title { english romaji } averageScore popularity trending genres
      stats { scoreDistribution { score amount } }
      coverImage { large } studios(isMain: true) { nodes { name } }
      staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } } } } }`;

    fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: q })
    })
    .then(r => { if (!r.ok) throw 0; return r.json(); })
    .then(({ data }) => {
      let shows = data.Page.media;
      if (cfg.metric === 'score') {
        const exactOf = m => {
          const dist = m.stats && m.stats.scoreDistribution;
          if (!dist || !dist.length) return m.averageScore || 0;
          const total = dist.reduce((s, x) => s + x.amount, 0);
          return total ? dist.reduce((s, x) => s + x.score * x.amount, 0) / total : (m.averageScore || 0);
        };
        shows = shows.slice().sort((a, b) => exactOf(b) - exactOf(a));
      }
      const maxMetric = Math.max(...shows.map(m =>
        cfg.metric === 'trend' ? (m.trending || 0) :
        cfg.metric === 'fans' ? (m.popularity || 0) : (m.averageScore || 0)));

      // movement vs. last visit (stored per tab)
      let prevOrder = {};
      try { prevOrder = JSON.parse(localStorage.getItem('otaku-ranks-' + mode) || '{}'); } catch (e) {}
      const nowOrder = {};
      shows.forEach((m, i) => { nowOrder[m.id] = i + 1; });

      list.innerHTML = shows.map((m, i) => {
        const title = m.title.english || m.title.romaji;
        const studio = (m.studios.nodes[0] || {}).name || '—';
        const genres = (m.genres || []).slice(0, 2).join(' · ');
        const fans = m.popularity >= 1000 ? Math.round(m.popularity / 1000) + 'k fans' : '';
        let move = '';
        const prev = prevOrder[m.id];
        if (prev) {
          const diff = prev - (i + 1);
          if (diff > 0) move = `<span class="rank-move up">▲${diff}</span>`;
          else if (diff < 0) move = `<span class="rank-move down">▼${-diff}</span>`;
          else move = `<span class="rank-move same">—</span>`;
        } else if (Object.keys(prevOrder).length) {
          move = `<span class="rank-move new">NEW</span>`;
        }
        let value, width;
        if (cfg.metric === 'trend') {
          value = '🔥 ' + (m.trending || 0);
          width = maxMetric ? (m.trending || 0) / maxMetric * 100 : 0;
        } else if (cfg.metric === 'fans') {
          value = Math.round((m.popularity || 0) / 1000) + 'k';
          width = maxMetric ? (m.popularity || 0) / maxMetric * 100 : 0;
        } else {
          let exact = null;
          const dist = m.stats && m.stats.scoreDistribution;
          if (dist && dist.length) {
            const total = dist.reduce((s, x) => s + x.amount, 0);
            if (total > 0) exact = dist.reduce((s, x) => s + x.score * x.amount, 0) / total / 10;
          }
          if (exact) {
            value = '★ ' + exact.toFixed(2);
            width = exact * 10;
          } else {
            value = m.averageScore ? '★ ' + (m.averageScore / 10).toFixed(2) : '—';
            width = m.averageScore || 0;
          }
        }
        return `
        <a class="rank-item" href="anime.html?id=${m.id}" style="text-decoration:none;color:inherit" title="Score: AniList community average (MAL may differ)">
          <span class="rank-num${i === 0 ? ' gold' : ''}">${String(i + 1).padStart(2, '0')}</span>
          <img class="rank-poster" src="${m.coverImage.large}" alt="${escR(title)} poster" loading="lazy">
          <div class="rank-info">
            <div class="name">${escR(title)}${i === 0 ? ' 👑' : ''} ${move}</div>
            <div class="why">${creatorOf(m) ? escR(creatorOf(m)) + ' · ' : ''}${escR(studio)}${genres ? ' · ' + genres : ''}${fans ? ' · ' + fans : ''}</div>
          </div>
          <div class="rank-bar-wrap">
            <div class="rank-bar"><span style="--w:${(width/100).toFixed(3)}"></span></div>
            <div class="rank-score">${value}</div>
          </div>
        </a>`;
      }).join('');
      try { localStorage.setItem('otaku-ranks-' + mode, JSON.stringify(nowOrder)); } catch (e) {}
      statusEl.textContent = `Live from AniList · ${cfg.label} · fetched ${new Date().toLocaleTimeString()}`;
    })
    .catch(() => {
      statusEl.textContent = 'API unreachable — rankings unavailable right now.';
      list.innerHTML = '';
    });
  }

  let currentMode = 'season';
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      loadRanks(currentMode);
    });
  });

  // manual refresh button
  const refreshBtn = document.getElementById('rank-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    setTimeout(() => refreshBtn.classList.remove('spinning'), 800);
    loadRanks(currentMode);
  });

  // auto-refresh every 10 minutes while the page is open
  setInterval(() => {
    if (!document.hidden) loadRanks(currentMode);
  }, 600000);

  loadRanks('season');
})();

// ---------- Live Wire: real news via backend RSS proxy ----------
(function () {
  const list = document.getElementById('wire-list');
  if (!list) return;
  const statusEl = document.getElementById('wire-status');
  const errBox = document.getElementById('wire-error');
  const escW = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function ago(ts) {
    if (!ts) return '';
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function render(items, via) {
    const withImg = items.filter(n => n.img);
    const hero = withImg[0] || items[0];
    const rest = items.filter(n => n !== hero).slice(0, 9);
    list.innerHTML = `
      ${hero ? `
      <a class="wire-hero" href="${escW(hero.link)}" target="_blank" rel="noopener">
        ${hero.img ? `<div class="wh-img"><img src="${escW(hero.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.wh-img').style.display='none'"></div>` : ''}
        <div class="wh-body">
          <span class="wire-badge hot">BREAKING</span>
          <h4>${escW(hero.title)}</h4>
          <p>${escW(hero.desc)}</p>
          <span class="wh-meta">${hero.author ? 'By ' + escW(hero.author) + ' · ' : ''}${escW(hero.source)} · ${ago(hero.ts) || 'NEW'}</span>
        </div>
      </a>` : ''}
      <div class="wire-grid">
        ${rest.map(n => {
          const isVideo = /video|trailer|\bpv\b|opening|ending|music video|\bmv\b/i.test(n.title + ' ' + (n.cat || ''));
          const fb = isVideo
            ? '<span class="wc-fb wc-play"><span class="wc-play-btn">▶</span></span>'
            : '<span class="wc-fb">速報</span>';
          return `
        <a class="wire-card${n.img ? '' : ' wire-card-text'}" href="${escW(n.link)}" target="_blank" rel="noopener">
          ${n.img ? `<div class="wc-img">${fb}<img src="${escW(n.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>` : ''}
          <div class="wc-body">
            <h5>${escW(n.title)}</h5>
            <span class="wc-meta"><span class="wire-badge">${escW(n.source)}</span> ${n.author ? 'By ' + escW(n.author) + ' · ' : ''}${ago(n.ts) || 'NEW'}</span>
          </div>
        </a>`;
        }).join('')}
      </div>`;
    if (window.__feedTicker) window.__feedTicker(items);
    if (window.__feedEditorial) window.__feedEditorial(items);
    if (window.__feedFeature) window.__feedFeature(items);
    statusEl.innerHTML = `Live · ${items.length} headlines · ${via} · refreshes every 24h · <span id="wire-clock"></span>`;
    // Real-time news hour clock (IST, ticks every second)
    const clockEl = document.getElementById('wire-clock');
    if (clockEl && !window._wireClockTimer) {
      // visitor's own timezone, auto-detected
      let tzAbbr = '';
      try {
        tzAbbr = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
          .formatToParts(new Date())
          .find(p => p.type === 'timeZoneName').value;
      } catch (e) {}
      const tick = () => {
        const el = document.getElementById('wire-clock');
        if (!el) return;
        el.textContent = new Date().toLocaleTimeString(undefined, {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        }) + (tzAbbr ? ' ' + tzAbbr : '');
      };
      tick();
      window._wireClockTimer = setInterval(tick, 1000);
    }
  }

  // Plan A: our Python backend (best - cached, merged)
  function tryBackend() {
    return fetch('/api/news?t=' + Date.now())
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(({ items }) => {
        if (!items || !items.length) throw 0;
        render(items, 'via Otaku News server');
      });
  }

  // Plan B: browser-side via public rss2json proxy (works on static hosting)
  function tryBrowserFeeds() {
    const FEEDS = [
      { source: 'Anime Corner', url: 'https://animecorner.me/feed/' },
      { source: 'Crunchyroll News', url: 'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss' }
    ];
    return Promise.allSettled(FEEDS.map(f =>
      fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(f.url) + '&t=' + Date.now())
        .then(r => { if (!r.ok) throw 0; return r.json(); })
        .then(d => (d.items || []).map(it => ({
          title: it.title,
          link: it.link,
          desc: (it.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220),
          ts: it.pubDate ? Math.floor(new Date(it.pubDate).getTime() / 1000) : 0,
          source: f.source,
          author: (it.author || '').slice(0, 48),
          img: it.thumbnail || (it.enclosure && it.enclosure.link)
            || (it.link ? 'https://image.thum.io/get/ogImage/' + it.link : '')
        })))
    )).then(results => {
      let items = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value)
        .sort((a, b) => b.ts - a.ts);
      const sL = new Set(), sT = new Set();
      items = items.filter(n => {
        const k = (n.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
        if (sL.has(n.link) || sT.has(k)) return false;
        sL.add(n.link); sT.add(k);
        return true;
      });
      if (!items.length) throw 0;
      render(items.slice(0, 30), 'direct from feeds');
    });
  }

  tryBackend()
    .catch(() => tryBrowserFeeds())
    .catch(() => {
      list.style.display = 'none';
      errBox.style.display = 'block';
      statusEl.textContent = 'Live news unavailable';
    });
})();

// ---------- Live anime search with acronym support (JJK -> Jujutsu Kaisen) ----------
(function () {
  const input = document.getElementById('search');
  if (!input) return;
  const wrap = input.closest('.search-wrap');
  const drop = document.createElement('div');
  drop.className = 'search-drop';
  wrap.appendChild(drop);

  // Popular shorthand map (instant hits)
  const SHORT = {
    jjk: 'Jujutsu Kaisen', aot: 'Attack on Titan', snk: 'Shingeki no Kyojin',
    fmab: 'Fullmetal Alchemist Brotherhood', fma: 'Fullmetal Alchemist',
    mha: 'My Hero Academia', bnha: 'Boku no Hero Academia',
    opm: 'One Punch Man', op: 'One Piece', csm: 'Chainsaw Man',
    ds: 'Demon Slayer', kny: 'Kimetsu no Yaiba', tpn: 'The Promised Neverland',
    sao: 'Sword Art Online', dbz: 'Dragon Ball Z', dbs: 'Dragon Ball Super',
    hxh: 'Hunter x Hunter', jojo: "JoJo's Bizarre Adventure",
    rezero: 'Re:Zero', konosuba: 'KonoSuba', oshinoko: 'Oshi no Ko',
    slime: 'That Time I Got Reincarnated as a Slime', tbate: 'The Beginning After the End',
    wsb: 'Weekly Shonen', sxf: 'Spy x Family', drs: 'Dr. Stone',
    mob: 'Mob Psycho 100', bc: 'Black Clover', tg: 'Tokyo Ghoul',
    tr: 'Tokyo Revengers', vs: 'Vinland Saga', sl: 'Solo Leveling',
    fs: 'Frieren', erased: 'Boku dake ga Inai Machi', agk: 'Akame ga Kill'
  };

  // Acronym scorer: does query match first letters of title words?
  function acronymMatch(query, title) {
    const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w =>
      w && !['the', 'of', 'a', 'an', 'no', 'wa', 'ga', 'to', 'x'].includes(w));
    if (!words.length) return false;
    const initials = words.map(w => w[0]).join('');
    const q = query.toLowerCase();
    if (initials === q) return true;            // exact acronym: aot
    if (initials.startsWith(q) && q.length >= 2) return true;  // partial: jj -> jjk
    // backup: first + middle + last letters of long single names
    if (words.length === 1 && words[0].length >= 6 && q.length === 3) {
      const w = words[0];
      if (q === w[0] + w[Math.floor(w.length / 2)] + w[w.length - 1]) return true;
    }
    return false;
  }

  const SQ = `query($s:String){Page(perPage:8){media(search:$s,type:ANIME,sort:[POPULARITY_DESC],isAdult:false){
    id title{english romaji}coverImage{medium}averageScore seasonYear format}}}`;

  const escS = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let deb, lastQuery = '';

  function render(shows, tag) {
    if (!shows.length) {
      drop.innerHTML = '<div class="sd-empty">見つかりません — no anime found</div>';
      return;
    }
    drop.innerHTML = shows.map(m => {
      const t = m.title.english || m.title.romaji;
      return `<a class="sd-item" href="anime.html?id=${m.id}">
        <img src="${m.coverImage.medium}" alt="" loading="lazy">
        <div><div class="sd-name">${escS(t)}</div>
        <div class="sd-meta">${[m.format, m.seasonYear, m.averageScore ? '★ ' + (m.averageScore / 10).toFixed(2) : null].filter(Boolean).join(' · ')}</div></div>
        ${tag ? `<span class="sd-tag">${tag}</span>` : ''}
      </a>`;
    }).join('');
  }

  async function apiSearch(term, tag) {
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: SQ, variables: { s: term } })
      });
      if (!res.ok) throw 0;
      const { data } = await res.json();
      return data.Page.media;
    } catch (e) { return []; }
  }

  async function doSearch(q) {
    drop.classList.add('open');
    drop.innerHTML = '<div class="sd-empty">検索中 — searching…</div>';
    const lower = q.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1) known shorthand -> search expanded name
    if (SHORT[lower]) {
      const shows = await apiSearch(SHORT[lower]);
      if (q !== lastQuery) return;
      return render(shows, lower.toUpperCase());
    }

    // 2) normal API search
    let shows = await apiSearch(q);
    if (q !== lastQuery) return;

    // 3) short query with weak results? try acronym matching against trending pool
    if (lower.length >= 2 && lower.length <= 5 && shows.length < 3) {
      try {
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `query{Page(perPage:50){media(type:ANIME,sort:[POPULARITY_DESC],isAdult:false){
            id title{english romaji}coverImage{medium}averageScore seasonYear format}}}` })
        });
        const { data } = await res.json();
        if (q !== lastQuery) return;
        const acr = data.Page.media.filter(m =>
          acronymMatch(lower, m.title.english || '') || acronymMatch(lower, m.title.romaji || ''));
        const seen = new Set(shows.map(m => m.id));
        shows = [...shows, ...acr.filter(m => !seen.has(m.id))].slice(0, 6);
        if (acr.length) return render(shows, 'ABBR');
      } catch (e) {}
    }
    render(shows);
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    lastQuery = q;
    clearTimeout(deb);
    if (!q) input.dispatchEvent(new Event('pagefilter'));  // cleared -> unhide page sections
    if (q.length < 2) { drop.classList.remove('open'); return; }
    deb = setTimeout(() => doSearch(q), 350);
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) drop.classList.remove('open');
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') drop.classList.remove('open');
    if (e.key === 'Enter') {
      e.preventDefault();
      let q = input.value.trim();
      if (!q) return;
      // expand known shorthand (jjk -> Jujutsu Kaisen)
      const key = q.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (SHORT[key]) q = SHORT[key];
      drop.classList.remove('open');
      // jump straight to the Discover catalog with the query applied
      const discoverInput = document.getElementById('q');
      if (discoverInput) {
        discoverInput.value = q;
        discoverInput.dispatchEvent(new Event('input'));
        document.getElementById('discover').scrollIntoView({ behavior: 'smooth' });
      } else {
        // fallback (e.g. detail page): go to browse page with deep link
        location.href = 'browse.html?q=' + encodeURIComponent(q);
      }
    }
  });
})();

// ---------- Blur-up image loading (marks imgs sharp when ready) ----------
(function () {
  function markLoaded(img) {
    if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
    else {
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
    }
  }
  // existing images
  document.querySelectorAll('img').forEach(markLoaded);
  // future images (live sections render async)
  new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'IMG') markLoaded(node);
      else if (node.querySelectorAll) node.querySelectorAll('img').forEach(markLoaded);
    }));
  }).observe(document.body, { childList: true, subtree: true });
})();

// ---------- Staff Pick: live poster + score ----------
(function () {
  const slot = document.getElementById('pick-poster');
  if (!slot) return;
  fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query{Media(id:140407){coverImage{large}averageScore popularity}}' })
  })
  .then(r => { if (!r.ok) throw 0; return r.json(); })
  .then(({ data }) => {
    const m = data.Media;
    slot.innerHTML = `<img src="${m.coverImage.large}" alt="The Greatest Estate Developer cover" loading="lazy">`;
    const meta = document.getElementById('pick-meta');
    if (meta && m.averageScore) {
      meta.insertAdjacentHTML('afterbegin',
        `<span class="genre-tag">★ ${(m.averageScore / 10).toFixed(2)}</span><span class="genre-tag">${Math.round(m.popularity / 1000)}k readers</span>`);
    }
  })
  .catch(() => {});
})();

// ---------- AUTO-EVERYTHING: self-updating chrome ----------
(function () {
  // 1) Hero meta: issue #, date, season+week — computed from today's real date
  const now = new Date();
  const epoch = new Date(2026, 0, 5); // issue #1 week (site canon)
  const week = Math.max(1, Math.floor((now - epoch) / 604800000) + 1);
  const issueEl = document.getElementById('hm-issue');
  if (issueEl) issueEl.textContent = 'ISSUE #' + week;
  const dateEl = document.getElementById('hm-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const m = now.getMonth() + 1;
  const season = m <= 3 ? 'WINTER' : m <= 6 ? 'SPRING' : m <= 9 ? 'SUMMER' : 'FALL';
  const seasonStartMonth = m <= 3 ? 0 : m <= 6 ? 3 : m <= 9 ? 6 : 9;
  const seasonWeek = Math.max(1, Math.ceil((now - new Date(now.getFullYear(), seasonStartMonth, 1)) / 604800000));
  const seasonEl = document.getElementById('hm-season');
  if (seasonEl) seasonEl.textContent = season + ' SEASON, WEEK ' + seasonWeek;

  // 2) Footer year auto
  document.querySelectorAll('footer').forEach(f => {
    f.innerHTML = f.innerHTML.replace(/© \d{4}/, '© ' + now.getFullYear());
  });

  // 3) Ticker: rebuild from live headlines once news arrives
  function feedTicker(items) {
    const track = document.getElementById('ticker-track');
    if (!track || !items || !items.length) return;
    const heads = items.slice(0, 6).map(n =>
      `<span><b class="tick-star">★</b> ${(n.title || '').toUpperCase().slice(0, 70)}</span>`).join('');
    track.innerHTML = heads + heads; // doubled for seamless loop
  }
  window.__feedTicker = feedTicker;
})();

// ---------- Auto-curated Editorial: The Week in Anime ----------
(function () {
  const list = document.getElementById('ed-list');
  if (!list) return;
  const statusEl = document.getElementById('ed-status');
  const escE = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // editorial scoring: big-announcement words boost a story to "editorial-worthy"
  const HOT = [
    ['season', 4], ['confirmed', 5], ['announced', 5], ['reveals', 3], ['premiere', 4],
    ['trailer', 2], ['movie', 4], ['film', 4], ['anime adaptation', 6], ['manga', 2],
    ['returns', 3], ['finale', 4], ['release date', 5], ['cast', 2], ['studio', 2],
    ['one piece', 3], ['jujutsu', 3], ['re:zero', 3], ['chainsaw', 3], ['dandadan', 3]
  ];
  function edScore(n) {
    const t = (n.title + ' ' + n.desc).toLowerCase();
    let s = 0;
    HOT.forEach(([w, p]) => { if (t.includes(w)) s += p; });
    if (n.img) s += 2;
    return s;
  }
  const CATS = [
    [/movie|film/i, 'Film'], [/manga|manhwa|novel/i, 'Manga'],
    [/game|steam|playstation|nintendo/i, 'Games'], [/concert|music|song|theme/i, 'Music'],
    [/season|episode|anime|series|tv/i, 'TV'], [/.*/, 'Industry']
  ];
  function catOf(n) {
    const t = n.title + ' ' + (n.cat || '');
    for (const [re, label] of CATS) if (re.test(t)) return label;
    return 'News';
  }
  function dateTag(ts) {
    if (!ts) return 'THIS WEEK';
    return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }

  function renderEditorial(items) {
    // last 7 days, best-scoring, spread across sources
    const weekAgo = Date.now() / 1000 - 604800;
    const pool = items.filter(n => n.ts > weekAgo);
    const picked = pool.map(n => [edScore(n), n])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 5).map(x => x[1]);
    if (!picked.length) { statusEl.textContent = 'No stories curated yet — check Live Wire above.'; return; }

    list.innerHTML = picked.map(n => `
      <div class="news-item" data-expand>
        <span class="news-date">${dateTag(n.ts)}</span><span class="news-author">${n.author ? 'By ' + escE(n.author) + ' · ' : ''}Via ${escE(n.source)}</span>
        <div>
          <h4>${escE(n.title)}</h4>
          <p>${escE(n.desc)}</p>
          <div class="article-body">
            <p>${escE(n.desc)}</p>
            <p class="article-src">Full story: <a href="${escE(n.link)}" target="_blank" rel="noopener">${escE(n.source)} ↗</a></p>
          </div>
        </div>
        <span class="news-cat">${catOf(n)}</span>
      </div>`).join('');

    // re-wire expand behavior for the new nodes
    list.querySelectorAll('.news-item[data-expand]').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        item.classList.toggle('expanded');
      });
    });
    statusEl.textContent = `Auto-curated · top ${picked.length} stories of the week · picked by relevance score`;
  }
  window.__feedEditorial = renderEditorial;
})();

// ---------- Auto front-page feature: robot editor picks the biggest story ----------
(function () {
  window.__feedFeature = function (items) {
    const card = document.getElementById('featured-card');
    if (!card || !items || !items.length) return;
    // strongest story of the week WITH an image (front page needs a visual)
    const weekAgo = Date.now() / 1000 - 604800;
    const HOT = [['season', 4], ['confirmed', 5], ['announced', 5], ['reveals', 3], ['premiere', 4],
      ['movie', 4], ['film', 4], ['anime adaptation', 6], ['release date', 5], ['finale', 4],
      ['one piece', 3], ['jujutsu', 3], ['re:zero', 3], ['chainsaw', 3], ['dandadan', 3]];
    const score = n => {
      const t = (n.title + ' ' + n.desc).toLowerCase();
      let s = n.img ? 3 : -99;
      HOT.forEach(([w, p]) => { if (t.includes(w)) s += p; });
      return s;
    };
    const best = items.filter(n => n.ts > weekAgo).sort((a, b) => score(b) - score(a))[0];
    if (!best || score(best) < 5) return; // keep the hand-written fallback if news is weak
    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    card.href = best.link;
    card.target = '_blank';
    card.rel = 'noopener';
    card.removeAttribute('data-detail');
    const t = document.getElementById('feat-title');
    const d = document.getElementById('feat-desc');
    const b = document.getElementById('feat-byline');
    const im = document.getElementById('feat-img');
    if (t) t.textContent = best.title;
    if (d) d.textContent = best.desc;
    if (b) b.textContent = (best.author ? 'By ' + best.author + ' · ' : '') + 'Via ' + best.source + ' · this week\'s top story';
    if (im && best.img) im.innerHTML = `<img src="${esc(best.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  };
})();
