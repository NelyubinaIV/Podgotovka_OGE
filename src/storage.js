import { APP_STORAGE_PREFIX } from './config.js'
import { uid as genUid } from './utils.js'

function key(...parts) {
  return [APP_STORAGE_PREFIX, ...parts].join(':')
}

export function getOrCreateUid() {
  const k = key('uid')
  let v = localStorage.getItem(k)
  if (!v) {
    v = genUid()
    localStorage.setItem(k, v)
  }
  return v
}

export function defaultUserData() {
  return {
    nickname: '',
    candies: 0,
    attempts: {},
    lessonDone: {},
    lastSeen: Date.now()
  }
}

export function loadUser(uid) {
  const raw = localStorage.getItem(key('user', uid))
  if (!raw) return defaultUserData()
  try {
    const data = JSON.parse(raw)
    return { ...defaultUserData(), ...data }
  } catch {
    return defaultUserData()
  }
}

export function saveUser(uid, data) {
  localStorage.setItem(key('user', uid), JSON.stringify(data))
}

export function touchUser(uid) {
  const data = loadUser(uid)
  data.lastSeen = Date.now()
  saveUser(uid, data)
  return data
}

export function listenUser(uid, cb) {
  const handler = (e) => {
    if (e.key === key('user', uid)) cb(loadUser(uid))
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

export function listAllUsers() {
  const users = {}
  const prefix = key('user', '')
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(prefix)) {
      const uid = k.slice(prefix.length)
      users[uid] = loadUser(uid)
    }
  }
  return users
}

export function seedFakeUsers() {
  // Чтобы админ‑панель не была пустой в DEV.
  const fake = {
    dev_user_001: {
      nickname: 'Маша_9А',
      candies: 52,
      attempts: { t1: [{ score: 9, maxScore: 10, ts: Date.now() - 86400000 }] },
      lessonDone: { l1: { ts: Date.now() - 86400000 } },
      lastSeen: Date.now() - 3600000
    },
    dev_user_002: {
      nickname: 'Коля_9Б',
      candies: 38,
      attempts: { t1: [{ score: 8, maxScore: 10, ts: Date.now() }] },
      lessonDone: {},
      lastSeen: Date.now() - 7200000
    },
    dev_user_003: {
      nickname: 'Даша_8В',
      candies: 71,
      attempts: { t2: [{ score: 7, maxScore: 8, ts: Date.now() }] },
      lessonDone: { l1: { ts: Date.now() } },
      lastSeen: Date.now() - 172800000
    }
  }
  Object.entries(fake).forEach(([uid, data]) => {
    const k = key('user', uid)
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(data))
  })
}

export function resetCurrentProgress(uid) {
  localStorage.removeItem(key('user', uid))
}
