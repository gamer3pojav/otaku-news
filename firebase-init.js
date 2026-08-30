/* ============================================
   OTAKU NEWS — firebase-init.js
   Connects the site to Firebase Authentication + Firestore.
   Loaded as a <script type="module">, so it can use real `import`
   statements straight from Google's CDN — no npm / bundler needed.
   ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { deleteDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB5G9iiz5dmqnta70hsooKvKr11MQ8xCJo",
  authDomain: "otaku-news-1062.firebaseapp.com",
  projectId: "otaku-news-1062",
  storageBucket: "otaku-news-1062.firebasestorage.app",
  messagingSenderId: "603955563445",
  appId: "1:603955563445:web:52047451feaad4515b27fc",
  measurementId: "G-VJ8Z7JS0L2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------------------------------------------------------
// Firebase Auth signs people in with EMAIL. This site's UI signs
// people in with USERNAME (email is only collected at signup).
// To bridge that gap, every signup also saves a tiny
// "usernames/{username} -> email" doc in Firestore, and login
// looks that doc up first to find the matching email.
// ---------------------------------------------------------------

function usernameKey(username) {
  return (username || "").trim().toLowerCase();
}

function friendlyError(err) {
  const messages = {
    "auth/email-already-in-use": "That email is already registered.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/weak-password": "Password is too weak — try at least 8 characters.",
    "auth/wrong-password": "Wrong password.",
    "auth/invalid-credential": "Incorrect username or password.",
    "auth/user-not-found": "No account with that username. Sign up first!",
    "auth/too-many-requests": "Too many attempts — wait a bit and try again.",
    "auth/network-request-failed": "Network error — check your connection."
  };
  const code = err && err.code;
  return new Error((code && messages[code]) || (err && err.message) || "Something went wrong.");
}

async function signUp({ username, email, password }) {
  const uname = (username || "").trim();
  const key = usernameKey(uname);

  if (!/^[A-Za-z0-9_]{3,20}$/.test(uname)) {
    throw new Error("Username must be 3-20 chars (letters, numbers, _).");
  }
  if ((password || "").length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const unameRef = doc(db, "usernames", key);
  const existing = await getDoc(unameRef);
  if (existing.exists()) {
    throw new Error("That username is already taken.");
  }

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw friendlyError(err);
  }

  await updateProfile(cred.user, { displayName: uname });
  await setDoc(unameRef, { email, uid: cred.user.uid });

  return uname;
}

async function logIn({ username, password }) {
  const key = usernameKey(username);
  const unameRef = doc(db, "usernames", key);
  const snap = await getDoc(unameRef);
  if (!snap.exists()) {
    throw new Error("No account with that username. Sign up first!");
  }
  const { email } = snap.data();

  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw friendlyError(err);
  }

  return cred.user.displayName || username;
}

function logOut() {
  return signOut(auth);
}

// Fires immediately with the current user (or null), then again on
// every login/logout. `cb` receives just the display name, or null.
function onAuthChange(cb) {
  onAuthStateChanged(auth, (user) => {
    cb(user ? (user.displayName || user.email) : null);
  });
}

// ---------------------------------------------------------------
// Watchlist — one doc per user (keyed by uid), holding the whole
// { [animeId]: {list,title,img,added} } map. features.js keeps its
// own localStorage copy for instant, offline-safe reads/writes, and
// just mirrors changes here so the data follows the account.
// ---------------------------------------------------------------
async function loadWatchlist(uid) {
  const snap = await getDoc(doc(db, "watchlists", uid));
  return snap.exists() ? snap.data() : {};
}
function saveWatchlist(uid, list) {
  return setDoc(doc(db, "watchlists", uid), list).catch(() => {});
}

// ---------------------------------------------------------------
// Comments — shared/public, stored per anime so every visitor sees
// the same thread (localStorage alone can't do that, it's per device).
// ---------------------------------------------------------------
async function loadComments(animeId) {
  const q = query(collection(db, "comments", String(animeId), "items"), orderBy("at", "asc"), limit(200));
  const snap = await getDocs(q);
  // `id` is the Firestore doc id — required for deletion.
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}
function postComment(animeId, { user, uid, text }) {
  return addDoc(collection(db, "comments", String(animeId), "items"), { user, uid, text, at: Date.now() });
}


// ---------------------------------------------------------------
// PROFILES — one doc per uid at users/{uid}.
// Avatars are stored here as a ~128px base64 JPEG rather than in
// Firebase Storage, so no Storage bucket / rules have to be configured
// for this to work. A 128px q0.8 JPEG is ~6-14 KB, well inside the
// 1 MB per-document limit (compression happens client-side, account.js).
// ---------------------------------------------------------------
async function loadProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
function saveProfile(uid, patch) {
  // merge:true so a bio edit never clobbers someone's avatar set from
  // another tab/device mid-session.
  return setDoc(doc(db, "users", uid), patch, { merge: true });
}
async function setDisplayName(uid, name) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  await updateProfile(user, { displayName: name });
  const uname = (name || "").trim();
  const key = usernameKey(uname);
  if (key) await setDoc(doc(db, "usernames", key), { email: user.email, uid }, { merge: true });
}

// ---------------------------------------------------------------
// RATINGS — 5 stars, stored as tenths (10..100, step 10) because that
// is the shape AniList's POINT_100 score format expects. Keeping the
// tenths here means "push to AniList" is a 1:1 copy, not a re-round.
// Scores are GLOBAL (one number per title, all visitors see it); the
// per-user write to AniList happens in anilist.js.
// ---------------------------------------------------------------
async function loadScores(animeId) {
  const snap = await getDoc(doc(db, "scores", String(animeId)));
  return snap.exists() ? snap.data() : {};
}
function setScore(animeId, uid, tenths) {
  const ref_ = doc(db, "scores", String(animeId));
  if (tenths === null) return setDoc(ref_, { [uid]: null }, { merge: true }).catch(() => {});
  return setDoc(ref_, { [uid]: tenths }, { merge: true }).catch(() => {});
}

// ---------------------------------------------------------------
// COMMENT DELETION. The doc id is the Firestore auto-id the comment was
// created with, so loadComments() has to hand it back — features.js keeps
// it on the rendered node and passes it here. Authorship is re-checked
// server-side by the security rules, not just hidden in the UI.
// ---------------------------------------------------------------
function deleteComment(animeId, commentDocId) {
  return deleteDoc(doc(db, "comments", String(animeId), "items", commentDocId));
}

window.otakuFirebase = {
  signUp,
  logIn,
  logOut,
  onAuthChange,
  auth,
  db,
  loadWatchlist,
  saveWatchlist,
  loadComments,
  postComment,
  deleteComment,
  loadProfile,
  saveProfile,
  setDisplayName,
  loadScores,
  setScore
};
