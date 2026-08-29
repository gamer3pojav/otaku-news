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
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
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

window.otakuFirebase = { signUp, logIn, logOut, onAuthChange, auth, db };
