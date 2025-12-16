// Firebase-режим (если DEV_MODE=false и заполнены переменные окружения)
// Используем Firebase v10 (modular).
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { getDatabase, ref, onValue, set, get, child } from 'firebase/database'

export function initFirebaseFromEnv() {
  const cfg = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  }
  const app = initializeApp(cfg)
  const auth = getAuth(app)
  const db = getDatabase(app)
  return { auth, db }
}

export async function ensureAnonAuth(auth) {
  // если пользователь уже есть — ок; если нет — логиним анонимно
  await new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) { off(); resolve(u) }
    }, reject)
  })
  const cur = auth.currentUser
  if (cur) return cur
  const cred = await signInAnonymously(auth)
  return cred.user
}

export function listenUser(db, uid, cb) {
  const r = ref(db, `users/${uid}`)
  return onValue(r, (snap) => cb(snap.val() || null))
}

export async function saveUser(db, uid, data) {
  await set(ref(db, `users/${uid}`), data)
}

export function listenAllUsers(db, cb) {
  const r = ref(db, 'users')
  return onValue(r, (snap) => cb(snap.val() || {}))
}
