export function nowMs() {
  return Date.now()
}

export function parseDateMs(iso) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

export function fmtDate(iso) {
  try {
    const d = new Date(parseDateMs(iso))
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  } catch {
    return iso
  }
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

export function uid() {
  // короткий UID для DEV (не крипто!)
  return 'u_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}

export function bestAttempt(attempts = []) {
  if (!attempts.length) return null
  return attempts.reduce((best, cur) => (cur.score > best.score ? cur : best), attempts[0])
}

export function sum(arr) {
  return arr.reduce((a, b) => a + b, 0)
}
