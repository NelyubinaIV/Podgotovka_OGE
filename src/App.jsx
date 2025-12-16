import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DEV_MODE, ADMIN_CODE } from './config.js'
import { lessons, tests, materials, videos } from './data.js'
import { bestAttempt, clamp, fmtDate, nowMs, parseDateMs } from './utils.js'
import * as Local from './storage.js'
import * as Fb from './firebaseStore.js'

function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0] || '')
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean)
    if (!els.length) return
    const obs = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible?.target?.id) setActive(visible.target.id)
    }, { rootMargin: '-30% 0px -60% 0px', threshold: [0.05, 0.1, 0.2, 0.35] })
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [ids.join('|')])
  return active
}

function scrollToId(id) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Toasts({ toasts, onRemove }) {
  return (
    <div className="toastWrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <div className="toastIcon">{t.icon}</div>
          <div>
            <b>{t.title}</b>
            <span>{t.text}</span>
          </div>
          <button className="x" onClick={() => onRemove(t.id)} title="Закрыть">✕</button>
        </div>
      ))}
    </div>
  )
}

function Confetti({ bursts }) {
  return (
    <div className="confettiLayer">
      {bursts.flatMap((b) => b.items.map((it) => (
        <span
          key={it.key}
          className="conf"
          style={{
            left: it.left + '%',
            top: '-10px',
            background: it.color,
            animationDuration: it.dur + 'ms',
            transform: `translateY(-30px) rotate(${it.rot}deg)`,
            width: it.w + 'px',
            height: it.h + 'px',
            borderRadius: it.r + 'px',
            opacity: it.o
          }}
        />
      )))}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modalOverlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalIn">
          <div className="modalTop">
            <h3>{title}</h3>
            <button className="x" onClick={onClose}>✕</button>
          </div>
          <div className="divider" />
          {children}
        </div>
      </div>
    </div>
  )
}

function TestRunner({ test, onFinish }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState(() => Array(test.questions.length).fill(null))
  const q = test.questions[step]

  const picked = answers[step]
  const progress = Math.round((step / test.questions.length) * 100)

  function choose(idx) {
    const next = answers.slice()
    next[step] = idx
    setAnswers(next)
  }

  function next() {
    setStep((s) => clamp(s + 1, 0, test.questions.length - 1))
  }
  function prev() {
    setStep((s) => clamp(s - 1, 0, test.questions.length - 1))
  }

  function finish() {
    const maxScore = test.questions.length
    let score = 0
    test.questions.forEach((qq, i) => {
      if (answers[i] === qq.answerIndex) score += 1
    })
    onFinish({ score, maxScore })
  }

  const canFinish = answers.every((a) => a !== null)

  return (
    <div className="form">
      <div>
        <div className="progressBar" title="Прогресс">
          <div className="progressFill" style={{ width: `${progress}%` }} />
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Вопрос {step + 1} из {test.questions.length}
        </p>
      </div>

      <div>
        <div className="label">{q.q}</div>
        <div className="tags" style={{ marginTop: 8 }}>
          {q.options.map((opt, i) => (
            <button
              key={i}
              className={'chip ' + (picked === i ? 'chipActive' : '')}
              onClick={() => choose(i)}
              type="button"
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className="ctaRow" style={{ justifyContent: 'space-between' }}>
        <div className="ctaRow">
          <button className="btn btn2 btnSm" onClick={prev} disabled={step === 0} type="button">← Назад</button>
          <button className="btn btn2 btnSm" onClick={next} disabled={step === test.questions.length - 1} type="button">Далее →</button>
        </div>
        <button className="btn btnSm" onClick={finish} disabled={!canFinish} type="button">Завершить</button>
      </div>

      {!canFinish && (
        <p className="hint">Выберите вариант ответа в каждом вопросе, чтобы завершить тест.</p>
      )}
    </div>
  )
}

export default function App() {
  const sectionIds = ['lessons', 'tests', 'materials', 'videos', 'admin']
  const activeSection = useActiveSection(sectionIds)

  const [uid, setUid] = useState(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminCodeInput, setAdminCodeInput] = useState('')

  const [allUsers, setAllUsers] = useState({})
  const [modal, setModal] = useState(null) // {type, payload}
  const [toasts, setToasts] = useState([])
  const [bursts, setBursts] = useState([])

  // Firebase handles
  const fbRef = useRef({ ready: false, auth: null, db: null, offUser: null, offAll: null })

  const now = nowMs()

  const releasedLessons = useMemo(
    () => lessons.filter((l) => parseDateMs(l.releaseAt) <= now),
    [now]
  )

  const totalReward = useMemo(() => releasedLessons.reduce((s, l) => s + (l.rewardCandies || 0), 0), [releasedLessons])

  const doneCount = useMemo(() => {
    if (!user) return 0
    return Object.keys(user.lessonDone || {}).length
  }, [user])

  const releasedDoneCount = useMemo(() => {
    if (!user) return 0
    return releasedLessons.filter((l) => user.lessonDone?.[l.id]).length
  }, [user, releasedLessons])

  const progressPct = useMemo(() => {
    if (!releasedLessons.length) return 0
    return Math.round((releasedDoneCount / releasedLessons.length) * 100)
  }, [releasedDoneCount, releasedLessons.length])

  function pushToast({ icon = '✨', title, text }) {
    const id = Math.random().toString(36).slice(2)
    const t = { id, icon, title, text }
    setToasts((x) => [t, ...x].slice(0, 4))
    setTimeout(() => setToasts((x) => x.filter((i) => i.id !== id)), 5200)
  }

  function confetti() {
    const items = Array.from({ length: 26 }).map((_, i) => {
      const colors = ['#2EF0D2', '#FF3BA7', '#FFB020', '#67F08B', '#ffffff']
      const color = colors[Math.floor(Math.random() * colors.length)]
      return {
        key: Math.random().toString(36).slice(2) + '_' + i,
        left: Math.random() * 100,
        dur: 800 + Math.random() * 700,
        rot: Math.random() * 360,
        w: 6 + Math.random() * 10,
        h: 10 + Math.random() * 14,
        r: 3 + Math.random() * 6,
        o: 0.75 + Math.random() * 0.25,
        color
      }
    })
    const burst = { id: Math.random().toString(36).slice(2), items }
    setBursts((b) => [burst, ...b].slice(0, 3))
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== burst.id)), 1800)
  }

  function setBodyAdmin(flag) {
    document.body.classList.toggle('admin', !!flag)
  }

  // Init user (DEV: localStorage, PROD: Firebase)
  useEffect(() => {
    let unsubLocal = null

    async function init() {
      if (DEV_MODE) {
        Local.seedFakeUsers()
        const myUid = Local.getOrCreateUid()
        setUid(myUid)
        const data = Local.touchUser(myUid)
        setUser(data)
        unsubLocal = Local.listenUser(myUid, (d) => setUser(d))
        pushToast({ icon: '🧪', title: 'DEV-режим', text: 'Прогресс хранится в браузере (localStorage).' })
        return
      }

      // Firebase mode
      try {
        const { auth, db } = Fb.initFirebaseFromEnv()
        fbRef.current.auth = auth
        fbRef.current.db = db
        const u = await Fb.ensureAnonAuth(auth)
        setUid(u.uid)

        const stop = Fb.listenUser(db, u.uid, (remote) => {
          if (remote) setUser(remote)
        })
        fbRef.current.offUser = stop

        pushToast({ icon: '☁️', title: 'Firebase', text: 'Прогресс синхронизируется между устройствами.' })
      } catch (e) {
        console.error(e)
        pushToast({ icon: '⚠️', title: 'Ошибка Firebase', text: 'Не удалось подключиться. Проверьте .env. Переключаемся на DEV.' })
        // аварийный fallback
        const myUid = Local.getOrCreateUid()
        setUid(myUid)
        const data = Local.touchUser(myUid)
        setUser(data)
        unsubLocal = Local.listenUser(myUid, (d) => setUser(d))
      }
    }

    init()
    return () => {
      if (unsubLocal) unsubLocal()
      if (fbRef.current.offUser) fbRef.current.offUser()
      if (fbRef.current.offAll) fbRef.current.offAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Admin list
  useEffect(() => {
    setBodyAdmin(isAdmin)
    if (!isAdmin) return

    if (DEV_MODE || !fbRef.current.db) {
      setAllUsers(Local.listAllUsers())
      const interval = setInterval(() => setAllUsers(Local.listAllUsers()), 1500)
      return () => clearInterval(interval)
    }

    const off = Fb.listenAllUsers(fbRef.current.db, (users) => setAllUsers(users))
    fbRef.current.offAll = off
    return () => {}
  }, [isAdmin])

  async function persist(next) {
    if (!uid) return
    if (DEV_MODE || !fbRef.current.db) {
      Local.saveUser(uid, next)
      return
    }
    await Fb.saveUser(fbRef.current.db, uid, next)
  }

  function updateUser(patchFn) {
    setUser((prev) => {
      const base = prev || Local.defaultUserData()
      const next = patchFn({ ...base })
      next.lastSeen = Date.now()
      persist(next)
      return next
    })
  }

  function enterAdmin() {
    const code = (adminCodeInput || '').trim()
    if (code && code === ADMIN_CODE) {
      setIsAdmin(true)
      pushToast({ icon: '🛠️', title: 'Админ‑режим', text: 'Доступ к статистике открыт.' })
    } else {
      pushToast({ icon: '⛔', title: 'Неверный код', text: 'Проверьте код админа.' })
    }
  }

  function exitAdmin() {
    setIsAdmin(false)
    setAdminCodeInput('')
    pushToast({ icon: '👋', title: 'Админ‑режим', text: 'Вы вышли из админки.' })
  }

  function saveNickname(v) {
    updateUser((u) => {
      u.nickname = v
      return u
    })
  }

  function openTest(testId) {
    const test = tests.find((t) => t.id === testId)
    if (!test) return
    setModal({ type: 'test', payload: { test } })
  }

  function isTestPassed(testId) {
    const t = tests.find((x) => x.id === testId)
    const attempts = user?.attempts?.[testId] || []
    const best = bestAttempt(attempts)
    if (!t || !best) return false
    const need = Number.isFinite(t.passScore) ? t.passScore : t.questions.length
    return best.score >= need
  }

  function recomputeLessonRewards(nextUser) {
    // Если открытые уроки выполнены (все нужные тесты зачтены) — начисляем конфеты один раз.
    let gained = 0
    const done = { ...(nextUser.lessonDone || {}) }

    lessons.forEach((l) => {
      const released = parseDateMs(l.releaseAt) <= Date.now()
      if (!released) return
      if (done[l.id]) return
      const req = l.requiredTests || []
      if (!req.length) return
      const ok = req.every((tid) => {
        const t = tests.find((x) => x.id === tid)
        const attempts = nextUser.attempts?.[tid] || []
        const best = bestAttempt(attempts)
        if (!t || !best) return false
        const need = Number.isFinite(t.passScore) ? t.passScore : t.questions.length
        return best.score >= need
      })
      if (ok) {
        done[l.id] = { ts: Date.now() }
        gained += (l.rewardCandies || 0)
      }
    })

    if (gained > 0) {
      nextUser.lessonDone = done
      nextUser.candies = (nextUser.candies || 0) + gained
    }
    return gained
  }

  function onTestFinish({ testId, score, maxScore }) {
    updateUser((u) => {
      const list = u.attempts?.[testId] ? [...u.attempts[testId]] : []
      list.unshift({ score, maxScore, ts: Date.now() })
      u.attempts = { ...(u.attempts || {}), [testId]: list.slice(0, 20) }

      const gained = recomputeLessonRewards(u)

      const t = tests.find((x) => x.id === testId)
      const need = Number.isFinite(t?.passScore) ? t.passScore : maxScore
      const passed = score >= need

      if (passed) {
        pushToast({ icon: '✅', title: 'Тест зачтён', text: `Результат: ${score}/${maxScore}.` })
      } else {
        pushToast({ icon: '🧩', title: 'Можно лучше', text: `Результат: ${score}/${maxScore}. Для зачёта нужно: ${need}.` })
      }

      if (gained > 0) {
        confetti()
        pushToast({ icon: '🍬', title: 'Награда!', text: `Начислено конфет: ${gained}.` })
      }
      return u
    })
  }

  function resetMyProgress() {
    if (!uid) return
    if (!confirm('Сбросить прогресс на этом устройстве?')) return
    if (DEV_MODE || !fbRef.current.db) {
      Local.resetCurrentProgress(uid)
      const data = Local.touchUser(uid)
      setUser(data)
      pushToast({ icon: '🧹', title: 'Сброшено', text: 'Прогресс очищен.' })
      return
    }
    updateUser((u) => {
      const clean = Local.defaultUserData()
      clean.nickname = u.nickname || ''
      return clean
    })
    pushToast({ icon: '🧹', title: 'Сброшено', text: 'Прогресс очищен.' })
  }

  const nickname = user?.nickname || ''

  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <div className="topbarInner">
            <div className="brand" onClick={() => scrollToId('lessons')} style={{ cursor: 'pointer' }}>
              <div className="logo" />
              <div className="brandTitle">
                <b>ОГЭ • Штаб подготовки</b>
                <span>{DEV_MODE ? 'DEV (localStorage)' : 'PROD (Firebase)'}</span>
              </div>
            </div>

            <div className="nav">
              {sectionIds.map((id) => (
                <div
                  key={id}
                  className={'chip ' + (activeSection === id ? 'chipActive' : '')}
                  onClick={() => scrollToId(id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && scrollToId(id)}
                >
                  {id === 'lessons' && '📚 Уроки'}
                  {id === 'tests' && '🧪 Тесты'}
                  {id === 'materials' && '📎 Материалы'}
                  {id === 'videos' && '🎬 Видео'}
                  {id === 'admin' && '🛠️ Админ'}
                </div>
              ))}

              <div className="hud">
                <div className="hudBadge" title="Прогресс по опубликованным урокам">
                  <span>Прогресс:</span> <b>{progressPct}%</b>
                </div>
                <div className="hudBadge" title="Конфеты — условная награда">
                  <span>🍬</span> <b>{user?.candies ?? 0}</b>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="hero">
          <div className="heroGrid">
            <div className="panel">
              <div className="panelIn">
                <h1 className="heroTitle">Учимся спокойно, но системно ✨</h1>
                <p className="heroSub">
                  Уроки открываются по датам. После прохождения тестов — фиксируется прогресс.
                  В DEV-режиме всё хранится на устройстве ученика. В Firebase — синхронизируется.
                </p>

                <div className="ctaRow">
                  <button className="btn" onClick={() => scrollToId('lessons')}>Открыть уроки</button>
                  <button className="btn btn2" onClick={() => scrollToId('tests')}>Перейти к тестам</button>
                  <button className="btn btn2 btnDanger" onClick={resetMyProgress}>Сбросить прогресс</button>
                </div>

                <div className="stats">
                  <div className="stat">
                    <b>{releasedLessons.length}/{lessons.length}</b>
                    <span>уроков опубликовано</span>
                  </div>
                  <div className="stat">
                    <b>{releasedDoneCount}/{releasedLessons.length || 0}</b>
                    <span>выполнено (из опубликованных)</span>
                  </div>
                  <div className="stat">
                    <b>{totalReward}</b>
                    <span>макс. конфет за опубликованные</span>
                  </div>
                </div>

                <div className="divider" />

                <div className="twoCol">
                  <div>
                    <div className="label">Ник ученика (виден в админке)</div>
                    <div className="nicknameRow">
                      <input
                        className="input"
                        value={nickname}
                        onChange={(e) => saveNickname(e.target.value)}
                        placeholder="Например: Ира_9А"
                      />
                      <span className="badge" title="Ваш UID">{uid ? uid.slice(0, 8) + '…' : '…'}</span>
                    </div>
                    <p className="hint" style={{ marginTop: 8 }}>
                      Совет: попросите учеников написать ник в формате <b>Имя_Класс</b>.
                    </p>
                  </div>

                  <div className="list">
                    <div className="row">
                      <div>
                        <b>Последняя активность</b>
                        <small>{user?.lastSeen ? new Date(user.lastSeen).toLocaleString('ru-RU') : '—'}</small>
                      </div>
                      <span className="badge">в этом браузере</span>
                    </div>
                    <div className="row">
                      <div>
                        <b>Уроков выполнено</b>
                        <small>всего: {doneCount}</small>
                      </div>
                      <span className="badge">{doneCount}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel sideCard">
              <div className="panelIn">
                <div className="sectionTitle" style={{ marginTop: 0 }}>
                  <h2>Админ‑вход</h2>
                  <p>для репетитора</p>
                </div>

                {!isAdmin ? (
                  <>
                    <p className="note">
                      Введите код, чтобы увидеть статистику по ученикам (в DEV — по этому устройству и его данным).
                    </p>
                    <div className="divider" />
                    <div className="form">
                      <div>
                        <div className="label">Код админа</div>
                        <input
                          className="input"
                          value={adminCodeInput}
                          onChange={(e) => setAdminCodeInput(e.target.value)}
                          placeholder="Введите код"
                        />
                      </div>
                      <button className="btn" onClick={enterAdmin}>Войти</button>
                      <p className="hint">
                        Код хранится в переменной <b>VITE_ADMIN_CODE</b> (файл <code>.env</code>).
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="note">
                      Админ‑режим включён. Внизу страницы есть таблица учеников.
                    </p>
                    <div className="divider" />
                    <button className="btn btn2" onClick={exitAdmin}>Выйти из админки</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <section className="section" id="lessons">
          <div className="sectionTitle">
            <div>
              <h2>📚 Уроки</h2>
              <p>Открываются по датам</p>
            </div>
            <div className="filters">
              <span className="badge">{releasedLessons.length} открыто</span>
              <span className="badge">{lessons.length - releasedLessons.length} закрыто</span>
            </div>
          </div>

          <div className="grid">
            {lessons.map((l) => {
              const released = parseDateMs(l.releaseAt) <= now
              const done = !!user?.lessonDone?.[l.id]
              const req = l.requiredTests || []
              const reqOk = req.length ? req.every((tid) => isTestPassed(tid)) : false

              const tag = !released ? { cls: 'tagBad', text: 'Закрыто' }
                : done ? { cls: 'tagOk', text: 'Готово' }
                : reqOk ? { cls: 'tagOk', text: 'Можно закрыть' }
                : { cls: 'tagHot', text: 'В процессе' }

              return (
                <div className="card" key={l.id}>
                  <div className="cardIn">
                    <div className="cardTop">
                      <div>
                        <h3>{l.title}</h3>
                        <p>{l.blurb}</p>
                      </div>
                      <span className="badge">{done ? '✅' : released ? '🟢' : '🔒'}</span>
                    </div>

                    <div className="tags">
                      <span className={'tag ' + tag.cls}>{tag.text}</span>
                      <span className="tag">🍬 {l.rewardCandies || 0}</span>
                      <span className="tag">⏰ {fmtDate(l.releaseAt)}</span>
                    </div>

                    {req.length > 0 && (
                      <p className="hint">
                        Для зачёта: {req.map((tid) => {
                          const t = tests.find((x) => x.id === tid)
                          const ok = isTestPassed(tid)
                          return <span key={tid} className="badge" style={{ marginRight: 8 }}>{ok ? '✅' : '⬜'} {t?.title || tid}</span>
                        })}
                      </p>
                    )}

                    <div className="cardActions">
                      <button
                        className={'btn btnSm ' + (released ? '' : 'btn2')}
                        disabled={!released}
                        onClick={() => {
                          // быстро: открываем первый линк урока, если есть
                          const url = l.links?.[0]?.url
                          if (url && url !== '#') window.open(url, '_blank')
                          else pushToast({ icon: '📎', title: 'Ссылки', text: 'Добавьте ссылки урока в src/data.js → lessons[].links' })
                        }}
                      >
                        Открыть урок
                      </button>

                      {req.map((tid) => (
                        <button
                          key={tid}
                          className="btn btn2 btnSm btnLink"
                          disabled={!released}
                          onClick={() => openTest(tid)}
                        >
                          Пройти тест
                        </button>
                      ))}
                    </div>

                    {!released && (
                      <p className="hint">Этот урок ещё не открылся. Дата релиза: {fmtDate(l.releaseAt)}.</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="section" id="tests">
          <div className="sectionTitle">
            <div>
              <h2>🧪 Тесты</h2>
              <p>Результаты сохраняются</p>
            </div>
          </div>

          <div className="grid">
            {tests.map((t) => {
              const attempts = user?.attempts?.[t.id] || []
              const best = bestAttempt(attempts)
              const need = Number.isFinite(t.passScore) ? t.passScore : t.questions.length
              const passed = best ? best.score >= need : false

              return (
                <div className="card" key={t.id}>
                  <div className="cardIn">
                    <div className="cardTop">
                      <div>
                        <h3>{t.title}</h3>
                        <p>Вопросов: {t.questions.length}. Для зачёта: {need}/{t.questions.length}.</p>
                      </div>
                      <span className="badge">{passed ? '✅' : '🧩'}</span>
                    </div>

                    <div className="tags">
                      <span className={'tag ' + (passed ? 'tagOk' : 'tagHot')}>{passed ? 'Зачтено' : 'Не зачтено'}</span>
                      <span className="tag">Попыток: {attempts.length}</span>
                      <span className="tag">Лучший: {best ? `${best.score}/${best.maxScore}` : '—'}</span>
                    </div>

                    <div className="cardActions">
                      <button className="btn btnSm" onClick={() => openTest(t.id)}>Начать</button>
                      <button className="btn btn2 btnSm btnLink" onClick={() => setModal({ type: 'attempts', payload: { test: t } })}>
                        История
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="section" id="materials">
          <div className="sectionTitle">
            <div>
              <h2>📎 Материалы</h2>
              <p>Ссылки на ваши файлы/игры</p>
            </div>
          </div>

          <div className="grid">
            {materials.map((m) => (
              <div className="card" key={m.id}>
                <div className="cardIn">
                  <div className="cardTop">
                    <div>
                      <h3>{m.title}</h3>
                      <p>Тип: {m.type}</p>
                    </div>
                    <span className="badge">📄</span>
                  </div>

                  <div className="tags">
                    {(m.tags || []).map((tg) => <span key={tg} className="tag">{tg}</span>)}
                  </div>

                  <div className="cardActions">
                    <button className="btn btn2 btnSm btnLink" onClick={() => {
                      if (m.url && m.url !== '#') window.open(m.url, '_blank')
                      else pushToast({ icon: '🔗', title: 'Ссылка не задана', text: 'Укажите url в src/data.js → materials.' })
                    }}>Открыть</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="videos">
          <div className="sectionTitle">
            <div>
              <h2>🎬 Видео</h2>
              <p>Можно вставлять YouTube/Рутуб/Genially</p>
            </div>
          </div>

          <div className="grid">
            {videos.map((v) => (
              <div className="card" key={v.id}>
                <div className="cardIn">
                  <div className="cardTop">
                    <div>
                      <h3>{v.title}</h3>
                      <p>Ссылка откроется в новой вкладке.</p>
                    </div>
                    <span className="badge">▶️</span>
                  </div>

                  <div className="tags">
                    {(v.tags || []).map((tg) => <span key={tg} className="tag">{tg}</span>)}
                  </div>

                  <div className="cardActions">
                    <button className="btn btn2 btnSm btnLink" onClick={() => {
                      if (v.url && v.url !== '#') window.open(v.url, '_blank')
                      else pushToast({ icon: '🔗', title: 'Ссылка не задана', text: 'Укажите url в src/data.js → videos.' })
                    }}>Смотреть</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section adminOnly" id="admin">
          <div className="sectionTitle">
            <div>
              <h2>🛠️ Админка</h2>
              <p>Статистика по ученикам</p>
            </div>
            <div className="filters">
              <span className="badge">учеников: {Object.keys(allUsers || {}).length}</span>
            </div>
          </div>

          <div className="list">
            {Object.entries(allUsers || {}).sort((a, b) => (b[1]?.lastSeen || 0) - (a[1]?.lastSeen || 0)).map(([uId, u]) => {
              const done = Object.keys(u.lessonDone || {}).length
              const candies = u.candies || 0
              const name = (u.nickname || '').trim() || '(без ника)'
              return (
                <div className="row" key={uId}>
                  <div>
                    <b>{name}</b>
                    <small>UID: {uId}</small>
                    <small>Последний вход: {u.lastSeen ? new Date(u.lastSeen).toLocaleString('ru-RU') : '—'}</small>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="badge">🍬 {candies}</span>
                    <span className="badge">✅ уроков: {done}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {DEV_MODE && (
            <p className="hint" style={{ marginTop: 10 }}>
              DEV‑режим: это список пользователей, которые «накопились» в localStorage на этом компьютере.
              Для настоящей статистики по всем устройствам включайте Firebase.
            </p>
          )}
        </section>

        <footer>
          <div className="footerRow">
            <div className="footerText">
              Сделано на React + Vite. Прогресс хранится {DEV_MODE ? 'в localStorage (DEV).' : 'в Firebase (PROD).'}
            </div>
            <div className="footerText">
              Нажмите на «Уроки/Тесты» сверху — навигация подсвечивается автоматически.
            </div>
          </div>
        </footer>
      </div>

      {modal?.type === 'test' && (
        <Modal title={modal.payload.test.title} onClose={() => setModal(null)}>
          <TestRunner
            test={modal.payload.test}
            onFinish={({ score, maxScore }) => {
              const id = modal.payload.test.id
              setModal(null)
              onTestFinish({ testId: id, score, maxScore })
            }}
          />
        </Modal>
      )}

      {modal?.type === 'attempts' && (
        <Modal title={'История попыток: ' + modal.payload.test.title} onClose={() => setModal(null)}>
          <div className="list">
            {(user?.attempts?.[modal.payload.test.id] || []).map((a, i) => (
              <div className="row" key={i}>
                <div>
                  <b>Результат: {a.score}/{a.maxScore}</b>
                  <small>{new Date(a.ts).toLocaleString('ru-RU')}</small>
                </div>
                <span className="badge">{i === 0 ? 'последняя' : ' '}</span>
              </div>
            ))}
            {(!user?.attempts?.[modal.payload.test.id] || user.attempts[modal.payload.test.id].length === 0) && (
              <div className="row">
                <div>
                  <b>Пока нет попыток</b>
                  <small>Нажмите «Начать» в карточке теста.</small>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      <Toasts toasts={toasts} onRemove={(id) => setToasts((x) => x.filter((t) => t.id !== id))} />
      <Confetti bursts={bursts} />
    </>
  )
}
