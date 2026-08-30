# Otaku News — build notes

A faithful, runnable copy of the 9 files in `uploads/`, plus the feature layer
(comment deletion, star ratings with AniList sync, and an account/profile page).

Run it:            `python3 serve.py 8000`   (also works on any plain static host)
Deploy it:         upload this folder as-is. No build step, no npm, no bundler.
Rebuild from src:  `node /home/user/build.js`  (inputs: /home/user/uploads + /home/user/src)

---

## What was added

| File | What |
|---|---|
| `account.html` | The profile page: picture, name, bio, social links, AniList panel, data summary |
| `account.js` | Profile read/write, avatar resize, account menu, AniList connect + push |
| `account.css` | Stars, comment actions, chip avatar, menu, profile form (reuses style.css tokens) |
| `anilist.js` | AniList connect (one-click OAuth implicit grant, or a pasted personal token) + score/review mutations |
| `firestore.rules` | The **enforcement** for delete/ownership — read this one |
| `serve.py` | `/api/news` backend (`script.js` was written to use it; optional) |

Modified in place: `features.js` (stars, delete, aggregate ratings, avatar paint,
score mirror), `firebase-init.js` (profiles, scores, deleteComment, doc ids), and the
four pages (new `<link>`/`<script>` tags; `anime.html` also passes the title to comments).

## Deploying to GitHub Pages — upload these 13 files

  index.html  anime.html  browse.html  account.html  404.html
  style.css   account.css
  script.js   features.js   firebase-init.js   lightbox.js   anilist.js   account.js
  assets/logo.jpg
  firestore.rules  (paste into the Firebase console, not onto Pages)
  serve.py         (optional — only if you host the /api/news proxy somewhere)

`account.html`, `account.css`, `account.js` and `anilist.js` are NEW; `features.js`,
`firebase-init.js`, `index.html`, `anime.html` and `browse.html` were MODIFIED.
Uploading the folder as a whole is the safest option. If a stale `features.js` is
left on the site, the profile page prints "features.js did not load" and the rating
row stays on "Firebase unavailable" — both are now deliberate, visible messages
rather than a silent hang.

## One thing to do for cross-device profiles

**Paste `firestore.rules` into the Firebase console** (Firestore → Rules → Deploy).
Two reasons:
* without the `users/{uid}` and `scores/{animeId}` blocks in it, those reads are
  refused — profile saves then fall back to **this device only** (that fallback is
  built in, so the page still works), and a fresh Firestore with a restrictive
  default also cannot show shared ratings;
* until you do, "only the author can delete" and "only you can edit your profile"
  are UI-only: the button is hidden, but the data is world-writable.

The rules file also states the one trade-off that cannot be fixed there: the
username→email mapping must be world-readable for username login, which means
registered emails are discoverable.

## How the star ↔ AniList sync actually works

Worth knowing because the two obvious designs are impossible:

* **A rating cannot become an AniList *review*.** `SaveReview` is validated
  server-side: `body` must be ≥ 2600 chars and `summary` ≤ 120. Verified — a short
  review returns `400 validation`. So the review path is only offered when your
  comment is already long enough; otherwise the UI says so instead of failing.
* **What the "Push to AniList" button really writes** is the score on your own
  **list entry**: `SaveMediaListEntry(mediaId, status, score)`. Before writing, it
  reads `Media.mediaListEntry` and **reuses your existing status**, so a show you are
  watching is never marked COMPLETED by a rating.
* **Scores are format-aware.** AniList interprets the number per your own
  `MediaListOptions.scoreFormat` (`POINT_100` / `POINT_10_DECIMAL` / `POINT_10` /
  `POINT_5` / `POINT_3`). Ratings are stored locally as tenths (10…100) so the
  conversion is arithmetic, not re-rounding. `POINT_5` + 4★ sends `4`; `POINT_100`
  + 4★ sends `80`.
* **Visitors click one button; the owner configures once.** Nobody is asked to hunt
  for a developer page. `Profile → AniList → Connect AniList` is an ordinary
  "sign in with AniList" hop and nothing more.
* **Owner setup, once, ~2 minutes:** register an app at
  `anilist.co/settings/developer`, set its redirect URL to the exact page address,
  paste the Client ID into `Profile → AniList`, press "Save for the whole site".
  That field only renders for the account holding the setup claim — it is not in
  other visitors' DOM at all — and "Give up setup" releases it. Prefer not to keep
  a value in a browser? Add `window.OTAKU_ANILIST_CLIENT_ID = "…"` to `index.html`;
  the global wins over anything stored locally.
* **Personal token, kept as a fallback** for anyone who would rather not authorise
  an app at all: "paste a token" takes the one from AniList's developer page, keeps it
  in `localStorage`, and reads "linked as <you>" from the JWT, so it is correct even
  offline. Tokens last a year and the remaining days are shown.
* **The hard limit:** every AniList write needs a bearer token — there is no
  anonymous rating endpoint, and the docs say so plainly. So a star can only ever land
  on a list its owner has authorised. There is no third option. This site holds no
  visitor tokens on a server: they stay in the visitor's own browser and are revocable
  at AniList at any time.

## Design notes

* **Avatars are not in Firebase Storage.** They are resized to 128×128 JPEG in a
  canvas (~5–12 KB) and stored inside `users/{uid}`. Deliberate: no bucket, no CORS
  config, no second ruleset, and the existing Firestore project just works.
* **Comment delete needs the Firestore doc id**, so `loadComments()` now returns
  `{id, …}` and the id rides on the rendered node.
* **Renaming is not cosmetic.** `setDisplayName()` updates the Firebase profile *and*
  rewrites the `usernames/<name>` mapping doc, or the new name could not log in.
  It migrates your watchlist key too. Old comments keep the name they were posted with.
* `otaku-mod` in `localStorage` reveals delete buttons on other people's comments
  for you alone. Real moderation needs a claims-based check (and rules to back it).
* Social inputs are protocol-checked before rendering — `javascript:` and
  off-host values are dropped rather than displayed.

## Fixed after the first deploy (mobile screenshots)

* **Profile page said "Log in first" while signed in.** account.js rendered from a
  synchronous `auth.currentUser` read on a fresh page load, before Firebase had
  restored the session. It now waits for the module *and* the first real auth event;
  a genuine signed-out visitor still gets the login wall.
* **Comments and ratings stuck on "loading…" / "0".** Same race from the other side:
  `firebase-init.js` is an ES module, so `window.otakuFirebase` is undefined for a
  few hundred ms after everything else has run, and the read helpers returned early
  and never retried. They now wait (`__otakuWaitFB`) and, if it truly never arrives,
  say so out loud instead of hanging.
* **`decodeToken('')` returned the stored token's identity** rather than null — a
  falsy argument now decodes as garbage instead of falling back to the session.
* Profiles fall back to `localStorage` (`otaku-profile-<uid>`) whenever Firestore
  refuses, so a missing ruleset degrades to on-device only instead of a blank page.
* **"Add to Watchlist" — the menu opened with "Plan to Watch" cut off.** Three
  layout faults in the original CSS compounded: `.cr-hero` sets `overflow: hidden`
  so it *clipped* the dropdown, `.wl-menu`'s `z-index: 60` could not outrun that clip
  (it lives inside the clipped box), and `.cr-hero__inner { z-index: 2 }` trapped the
  whole subtree *below* the hero overlay's `backdrop-filter`, so the open menu painted
  under a blurred layer. `position: fixed` escapes both the clip and the stacking
  context — so `account.css` now pins `.wl-wrap.open .wl-menu` to the viewport at
  `z-index: 500`, lifts `.wl-wrap` itself, and `account.js` clamps it inside the
  viewport (flipping above the button when there is no room below) and re-clamps on
  `resize`/`scroll`. `style.css` and `anime.html` are **not** touched.
* **Comment avatars were a stored XSS.** `users/{uid}.avatar` is written by its
  owner and the rules cap only its *length*, never its shape, and it is rendered
  `allow read: if true` into every visitor's thread. A saved avatar of
  `x" onerror="…` came back out as `<img src="x" onerror="…" alt="">` — one line in
  the profile page, executing for everyone who ever saw that user comment. All three
  render sites now go through `otakuSafeAvatar()`, which accepts only
  `data:image/{jpeg,png,gif,webp};base64,…`, plus the value is escaped and the CSS
  `url()` is quoted with `JSON.stringify`. A rejected value degrades to the coloured
  initial, exactly like having no avatar.
* **The batched avatar read never returned anything.** It used
  `where("__name__", "in", uids)` — a *string field path*, not the document-id
  reference — so Firestore looked for a literal `__name__` field, matched zero docs,
  and every commenter silently showed an initial. Now
  `where(FieldPath.documentId(), "in", uids)`. Cosmetic in effect, but it means the
  feature you asked for (avatars on the profile showing through the site) was inert.
* **Stars are clean.** The picker is inline (no dropdown to clip), `otakuStars`
  escapes nothing because it emits only numbers, the aggregate bar uses a computed
  width, and the score/`tenths` round-trip was already covered. Nothing changed there.
* **Watchlist panel (the list behind the avatar) escaped raw.** `renderMyList()`
  interpolated the saved title and cover URL straight into `innerHTML`. Titles come
  from AniList and cover URLs from whatever a render last persisted, so a `"><img
  onerror=…>` in either ran as script for every signed-in visitor of that device.
  Now escaped (`esc()`) with cover URLs restricted to `https:`/`data:` (`safeImg()`).
  The comments path already escaped; this one did not. 3 of the new assertions fail
  if the fix is removed, so the guard bites.
* `firestore.rules` re-pasted: the `users/{uid}` `hasOnly()` list now includes
  `anilistSettings`. Without it the write was rejected and your AniList owner id
  stayed on one device instead of following you.

  *(The dropdown logic was never broken — the state machine, the Firestore mirror and
  the reload merge all worked; the menu was simply off-screen. That is why the earlier
  112 assertions stayed green while it looked dead to a finger.)*

## AniList connect: implicit → authorization code grant (2026-08-30)

* **Symptom:** on the deployed site, "Connect AniList" ended in
  `{"error":"unsupported_grant_type","message":"The authorization grant type is
  not supported by the authorization server."}`.
* **Cause:** the site requested the legacy *implicit* grant
  (`response_type=token`). Apps created on the current developer page only allow
  the *authorization code* grant (they are issued a client secret; implicit is no
  longer what you get), so AniList rejects the request. That exact JSON is
  AniList's rejection — reproduced live from the token endpoint, which answers
  with the same body for any grant the app does not allow.
* **`anilist.js`**: `authUrl()` now sends `response_type=code` plus a 128-bit
  `state` (kept in `otaku-anilist-state` with a timestamp; mismatched or >2h-old
  state is rejected). `consumeRedirect()` is now async and resolves
  `false | true | {error}`: (1) still consumes a legacy `#access_token` fragment
  for apps registered as implicit, (2) exchanges `?code&state` at
  `POST /api/v2/oauth/token`, (3) surfaces a `?error=…` redirect (user decline).
  The exchange is **form-urlencoded on purpose**: a JSON body would raise a CORS
  preflight, and OPTIONS to that endpoint returns 404 (verified live) — a
  preflight can never pass. If the fetch itself is blocked (CORS), the surfaced
  message points at the "paste a token" option instead of a cryptic failure.
  New: `clientSecret()` / `setSecret()` (key `otaku-anilist-secret`).
* **`account.js`**: the boot hook awaits `consumeRedirect()` — wrapped in
  `Promise.resolve()` so a stale cached `anilist.js` (sync boolean) can't throw.
  Owner setup gained a **Client Secret** field; `saveAniSettings()` strips it
  before the Firestore mirror (that profile doc is readable by other devices — a
  shared secret is not a profile field).
* **Deploy:** replace `anilist.js` and `account.js`.
* **Owner, once:** if your app shows a Client Secret next to the Client ID,
  paste it in Profile → AniList. For it to work in *every* visitor's browser,
  both values belong in `window.OTAKU_ANILIST_CLIENT_ID` /
  `window.OTAKU_ANILIST_CLIENT_SECRET` lines in index.html (same precedence as
  the client ID already had).
* **One thing I could not verify without a real app:** whether the token
  endpoint answers a registered origin's CORS request — live probes with an
  unknown client_id returned no `Access-Control-Allow-Origin` at all. If the
  exchange is blocked in a real browser, the toast says exactly that, and
  "paste a token" (personal token, anilist.co/settings/developer) remains the
  always-working path — no app, no redirect, nothing to configure.
* **Verification:** `node ani-oauth-test.js` — 39 assertions driving the real
  `anilist.js` in a vm sandbox with stubbed location/history/localStorage/fetch:
  authorize-URL shape (code grant, exact registered redirect, 128-bit state),
  state round-trip, mismatch rejection (no network call), exchange payload
  (grant_type, code, client_id, redirect_uri, url-encoded secret), single-use
  URL scrubbing, legacy fragment, `?error=` surfacing, API-error vs
  CORS-failure messages, plus `decodeToken` and score-mapping regressions.

## Firebase Cloud Function exchange proxy (optional, recommended)

The site's project (`otaku-news-1062`) has a Firebase backend, so the code→token
exchange can run through a Cloud Function instead of straight from the visitor's
browser. Deploying it removes the one remaining unknown (AniList's token endpoint
showed no CORS headers in live probes) and moves the client secret server-side:

* `functions/index.js` — HTTPS function `anilistToken` (v2, Node 20). Origin-
  allowlisted (site + local dev), answers its own CORS preflight, takes only the
  one-use `code`, does the form-urlencoded POST to AniList, returns `{token}`.
  The secret is read from a function secret and never echoed.
* `firebase.json` — set `ANILIST_CLIENT_ID` + `ANILIST_REDIRECT_URI` under
  `functions.params` (both non-secret; the client ID is already public).
* `.firebaserc` — pins the default project to `otaku-news-1062`.

Deploy (from the repo root, with the Firebase CLI logged in):

    cd functions && npm install && cd ..
    # edit firebase.json → paste your client ID
    firebase functions:secrets:set ANILIST_CLIENT_SECRET
    firebase deploy --only functions

Then, once (the URL is in the deploy output / console → Functions; the region
prefix is whatever your project uses):

    <script>window.OTAKU_ANILIST_TOKEN_PROXY = "https://<region>-otaku-news-1062.cloudfunctions.net/anilistToken";</script>

`anilist.js` reads that global: set → exchange via the function (browser sends
only the code); unset → direct browser→AniList exchange (the form-urlencoded
path, secret in the browser as before). So the function is a pure upgrade, not a
dependency. With it deployed, the browser-side Client Secret field in
Profile → AniList is no longer needed for visitors.

No rate limiter in v1: the code is single-use and the free-tier quota already
bounds abuse; the origin allowlist is the real gate. If the site gets busy, add
a Firestore counter keyed by IP+minute.

## Verification

* `node ani-oauth-test.js` — **49/49** assertions on the 2026-08-30 connect
  flow: drives the real `anilist.js` in a vm sandbox with stubbed
  location/history/localStorage/fetch (authorize-URL shape, state round-trip +
  mismatch rejection, direct exchange payload, proxy mode, legacy fragment,
  error surfacing, decodeToken/score regressions).
* `node functions/smoke-test.js` — **17/17** assertions: loads the real Cloud
  Function (firebase-functions v5 installed) and drives it with fake req/res —
  preflight 204/403, origin allowlist (incl. localhost), method/body validation,
  not-configured 500, no code/secret echo.
* `node /home/user/test-harness/run.js` — **152/152** assertions, driving the real
  `features.js` / `account.js` / `anilist.js` in jsdom with a stubbed Firebase:
  delete on own vs forged comment, picker painting, aggregate math, payload shape,
  save/rename validation, URL sanitising, push flow (status preserved, format mapped,
  401 drops the token), signed-out behaviour.
* All four AniList operations re-checked against the **live** API: 4/4 schema-valid.
  (That check found three bugs a mock cannot: `scoreFormat{}` is a bare enum,
  `MediaList.userDeleted` does not exist, and `SaveReview.score` is `Int`.)
* All 17 local routes serve 200 with correct MIME; `text/javascript` on the ES module.
* Every new guard above was verified to bite: with the fix removed, the suite fails
  exactly the assertions covering it (3 for the watchlist panel, 5 for avatars/query).
* `node --check` clean on all five JS files.
* The watchlist dropdown is asserted two ways, because jsdom has no layout: the
  built `account.css` is parsed for the escape rules (`position: fixed`, `z-index`,
  `.wl-wrap` lifted) and `style.css` for the *absence* of edits; and `clampMenu()` is
  fed synthetic `getBoundingClientRect()` geometry to prove it keeps the menu on-screen,
  flips it when there is no room below, and re-clamps on `scroll`. A behaviour test
  alone cannot catch a clipping or stacking bug.
* The original 9 uploads are unmodified except the injected Cloudflare block
  (stripped — it targets `/cdn-cgi/`, which does not exist here) and the 4 pages'
  new tag lines. `assets/logo.jpg` was recovered from `index.html`'s inlined base64
  because `lightbox.js` references it and it was never uploaded.

## Still worth doing

* `index.html` is ~507 KB because 6 images are inlined as base64. Externalising them
  is a one-line-each change and cuts it to roughly 18 KB.
* `scores/{animeId}` grows one field per rater and is not capped — fine for a hobby
  site, worth a summary doc if it ever gets busy.
