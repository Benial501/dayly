<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Archive, ArrowDownToLine, ArrowLeft, Compass, NotebookPen, ArrowRight, ExternalLink, Mail, PenLine, RefreshCw, Sparkles, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, CloudOff, Flag, Lightbulb, ListTodo, MessageCircle, Moon, Plus, Settings2, Sun, Target, Trash2, Upload, X } from 'lucide-vue-next'
import { readAll, put, remove, replaceAll } from './db'
import { sound } from './sound'

const section = ref('today')
const state = ref({ tasks: [], projects: [], ideas: [], reviews: [], settings: [] })
const loading = ref(true)
const modal = ref(null)
const form = ref({})
const toast = ref('')
const calendarOffset = ref(0)
const importInput = ref(null)
const syncLabel = ref('Salvato su questo iPhone')
const pairingCode = ref('')
const cloudBusy = ref(false)
const recoveryInput = ref('')

const today = new Date()
const todayKey = keyDate(today)
const dateLabel = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(today)
const greeting = computed(() => { const h = today.getHours(); return h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buona sera' })
const todayTasks = computed(() => state.value.tasks.filter(task => task.date === todayKey).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')))
const priorities = computed(() => todayTasks.value.filter(task => task.priority).slice(0, 3))
const appointments = computed(() => todayTasks.value.filter(task => task.time))
const untimedTasks = computed(() => todayTasks.value.filter(task => !task.time))
const doneToday = computed(() => todayTasks.value.filter(task => task.done).length)
const progressToday = computed(() => todayTasks.value.length ? Math.round(doneToday.value / todayTasks.value.length * 100) : 0)
const weekDays = computed(() => {
  const start = new Date(today); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + calendarOffset.value * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
})
const weekRange = computed(() => {
  const fmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
  return `${fmt.format(weekDays.value[0])} – ${fmt.format(weekDays.value[6])}`
})
const lastReview = computed(() => state.value.reviews.find(item => item.period === 'week') || null)
const weekTasks = computed(() => state.value.tasks.filter(task => weekDays.value.some(day => keyDate(day) === task.date)))
const projectProgress = computed(() => state.value.projects.length ? Math.round(state.value.projects.reduce((sum, p) => sum + Number(p.progress || 0), 0) / state.value.projects.length) : 0)

/* quanto resta la schermata d'apertura, in millisecondi */
const SPLASH_MS = 3000

// il logo lo genera prebuild: riferito a runtime, così se manca la build
// passa comunque e l'immagine resta semplicemente vuota
const logoUrl = '/logo.jpg'
const soundOn = ref(sound.enabled)
function switchSound() { sound.enabled = !soundOn.value; soundOn.value = sound.enabled }

onMounted(async () => {
  // un tocco qualsiasi fa un suono: così non devo toccare ogni singolo pulsante
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) sound.tap()
  }, { capture: true, passive: true })

  await loadInitialState()
  watchMailbox()
  loading.value = false
  const splash = document.getElementById('splash')
  if (splash) {
    // i cinque secondi si contano da quando apri l'app, non da quando
    // l'app è pronta: altrimenti il caricamento si somma all'attesa
    window.setTimeout(() => {
      splash.classList.add('is-gone')
      window.setTimeout(() => splash.remove(), 500)
    }, Math.max(0, SPLASH_MS - performance.now()))
  }
})

function keyDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function newId() { return crypto.randomUUID() }
function cloudSettings() { return state.value.settings.find(item => item.id === 'cloud-account') || null }
function bytesToBase64Url(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') }
function base64UrlToBytes(value) { const padded = value.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4 - value.length % 4) % 4); return Uint8Array.from(atob(padded), char => char.charCodeAt(0)) }
async function encryptSnapshot(data, keyText) {
  const key = await crypto.subtle.importKey('raw', base64UrlToBytes(keyText), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)))
  return { version: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) }
}
async function decryptSnapshot(snapshot, keyText) {
  const key = await crypto.subtle.importKey('raw', base64UrlToBytes(keyText), 'AES-GCM', false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(snapshot.iv) }, key, base64UrlToBytes(snapshot.data))
  return JSON.parse(new TextDecoder().decode(decrypted))
}
async function cloudRequest(method, account, body = null) {
  const url = method === 'GET' ? `/api/sync?accountId=${encodeURIComponent(account.accountId)}` : '/api/sync'
  return fetch(url, { method, headers: { Authorization: `Bearer ${account.credential}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify({ accountId: account.accountId, ...body }) } : {}) })
}
async function hydrateCloud(account) {
  const response = await cloudRequest('GET', account)
  if (!response.ok) return false
  const remote = await response.json()
  if (!remote.snapshot) return true
  const data = await decryptSnapshot(remote.snapshot, account.credential)
  await replaceAll(data)
  await put('settings', { ...account, revision: remote.revision, dirty: false, updatedAt: Date.now() })
  state.value = await readAll()
  syncLabel.value = 'Sincronizzato con Claude'
  return true
}
async function loadInitialState() {
  state.value = await readAll()
  const account = cloudSettings()
  if (account && navigator.onLine) {
    try { if (account.dirty) await syncLocal(true); else await hydrateCloud(account) } catch { syncLabel.value = 'Dati locali · sincronizzazione da verificare' }
    fetchProposals()
    fetchMailbox()
  }
}
async function syncLocal(showError = false) {
  const account = cloudSettings()
  if (!account || !navigator.onLine) return
  try {
    let remoteRevision = null
    const remoteResponse = await cloudRequest('GET', account)
    if (remoteResponse.ok) remoteRevision = (await remoteResponse.json()).revision || null
    else if (remoteResponse.status !== 401) throw new Error('Il cloud DAYLY non risponde.')
    if (remoteRevision !== (account.revision || null)) {
      if (account.revision || remoteRevision) { syncLabel.value = 'Dati online aggiornati · ricarica DAYLY'; if (showError) ping('Claude ha aggiornato i dati online. Ricarica DAYLY prima di modificarli.'); return }
    }
    const dataToSync = { ...state.value, settings: state.value.settings.map(item => item.id === 'cloud-account' ? { ...item, dirty: false } : item) }
    const snapshot = await encryptSnapshot(dataToSync, account.credential)
    const upload = await cloudRequest('PUT', account, { snapshot, revision: remoteRevision })
    const result = await upload.json()
    if (!upload.ok) throw new Error(result.error || 'Non riesco a sincronizzare i dati.')
    const updated = { ...account, revision: result.revision, dirty: false, updatedAt: Date.now() }
    await put('settings', updated)
    state.value.settings = state.value.settings.filter(item => item.id !== updated.id).concat(updated)
    syncLabel.value = 'Sincronizzato con Claude'
  } catch (error) { syncLabel.value = 'Solo su questo iPhone'; if (showError) ping(error.message || 'Sincronizzazione non riuscita') }
}
async function refreshAndSync() {
  state.value = await readAll()
  const account = cloudSettings()
  if (account) { await put('settings', { ...account, dirty: true }); state.value = await readAll(); await syncLocal(true) }
}
async function connectClaude() {
  if (cloudBusy.value) return
  cloudBusy.value = true
  try {
    let account = cloudSettings()
    if (!account) {
      const credential = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
      account = { id: 'cloud-account', accountId: crypto.randomUUID(), credential, revision: null, createdAt: Date.now() }
      await put('settings', account)
      state.value = await readAll()
    }
    await syncLocal(true)
    const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.credential}` }, body: JSON.stringify({ accountId: account.accountId }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Non riesco a preparare il collegamento.')
    pairingCode.value = result.code
    ping('Codice Claude pronto · valido per 5 minuti')
  } catch (error) { ping(error.message || 'Collegamento non disponibile') }
  finally { cloudBusy.value = false }
}
async function copyPairingCode() { await navigator.clipboard?.writeText(pairingCode.value); ping('Codice copiato') }
async function copyRecoveryCode() {
  const account = cloudSettings()
  if (!account) return
  await navigator.clipboard?.writeText(`${account.accountId}.${account.credential}`)
  ping('Codice di recupero copiato · conservalo in un luogo privato')
}
async function restoreCloudConnection() {
  const [accountId, credential] = recoveryInput.value.trim().split('.')
  if (!/^[0-9a-f-]{36}$/i.test(accountId || '') || !/^[A-Za-z0-9_-]{40,60}$/.test(credential || '')) { ping('Il codice di recupero non è valido'); return }
  const account = { id: 'cloud-account', accountId, credential, revision: null, dirty: false, restoredAt: Date.now() }
  await put('settings', account); state.value = await readAll()
  try {
    const response = await cloudRequest('GET', account)
    if (!response.ok) throw new Error('Il codice non è valido o la copia online non è disponibile.')
    const remote = await response.json()
    if (remote.snapshot) {
      const data = await decryptSnapshot(remote.snapshot, credential)
      await replaceAll(data)
      await put('settings', { ...account, revision: remote.revision })
    }
    state.value = await readAll(); recoveryInput.value = ''; syncLabel.value = 'Sincronizzato con Claude'; ping('Archivio cloud collegato')
  } catch (error) { await remove('settings', account.id); state.value = await readAll(); ping(error.message) }
}
async function deleteCloudCopy() {
  const account = cloudSettings()
  if (!account || !window.confirm('Eliminare la copia cifrata online e revocare Claude? I dati locali resteranno su questo iPhone.')) return
  const response = await cloudRequest('DELETE', account, { accountId: account.accountId })
  if (!response.ok) { ping('Non riesco a eliminare la copia online'); return }
  await remove('settings', account.id); state.value = await readAll(); pairingCode.value = ''; syncLabel.value = 'Salvato su questo iPhone'; ping('Copia online eliminata')
}
async function disconnectClaude() {
  const account = cloudSettings()
  if (!account) return
  const credential = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const response = await cloudRequest('POST', account, { newCredential: credential })
  if (!response.ok) { ping('Non riesco a revocare il collegamento online'); return }
  await put('settings', { ...account, credential, revision: account.revision || null })
  pairingCode.value = ''
  state.value = await readAll()
  await syncLocal()
  ping('Collegamento Claude revocato')
}
function switchTo(id) { section.value = id }
function ping(message, tone = 'saved') {
  toast.value = message
  if (tone === 'saved') sound.saved()
  else if (tone === 'removed') sound.removed()
  window.setTimeout(() => { toast.value = '' }, 2600)
}
function beginAdd(type, extra = {}) {
  form.value = { title: '', date: todayKey, time: '', priority: false, done: false, progress: 0, color: '#E8E5FF', notes: '', ...extra }
  modal.value = type
}
async function saveForm() {
  const type = modal.value
  if (!form.value.title?.trim()) return
  if (type === 'task' && form.value.priority && state.value.tasks.filter(task => task.date === form.value.date && task.priority).length >= 3) {
    ping('Per ogni giorno puoi scegliere al massimo tre priorità')
    return
  }
  if (type === 'task') await put('tasks', { ...form.value, id: newId(), title: form.value.title.trim(), updatedAt: Date.now() })
  if (type === 'project') await put('projects', { ...form.value, id: newId(), title: form.value.title.trim(), progress: Number(form.value.progress) })
  if (type === 'idea') await put('ideas', { ...form.value, id: newId(), title: form.value.title.trim(), createdAt: Date.now() })
  await refreshAndSync(); modal.value = null; ping('Aggiunto ai tuoi spazi')
}
async function toggleTask(task) {
  if (!task.done) sound.done()
  await put('tasks', { ...task, done: !task.done })
  await refreshAndSync()
}
async function deleteItem(store, item) { await remove(store, item.id); await refreshAndSync(); ping('Elemento eliminato', 'removed') }
async function setProgress(project, value) { await put('projects', { ...project, progress: Number(value) }); await refreshAndSync() }
function tasksOn(date) { return state.value.tasks.filter(task => task.date === keyDate(date)).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')) }
function formatTime(value) { return value ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(`2000-01-01T${value}:00`)) : '' }
function projectName(id) { return state.value.projects.find(project => project.id === id)?.title || '' }
function saveFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}
function exportBackup() {
  const backup = { app: 'DAYLY', formatVersion: 1, exportedAt: new Date().toISOString(), data: { ...state.value, settings: state.value.settings.filter(item => item.id !== 'cloud-account') } }
  saveFile(`dayly-backup-${todayKey}.json`, JSON.stringify(backup, null, 2), 'application/json')
  ping('Backup esportato')
}
async function importBackup(event) {
  const file = event.target.files?.[0]; if (!file) return
  try {
    const parsed = JSON.parse(await file.text()); const data = parsed.data || parsed
    const stores = ['tasks', 'projects', 'ideas', 'reviews', 'settings']
    if (!data || !stores.every(name => Array.isArray(data[name]))) throw new Error('Formato non valido')
    const account = cloudSettings()
    const restored = { ...data, settings: account ? [...data.settings.filter(item => item.id !== 'cloud-account'), account] : data.settings }
    await replaceAll(restored); await refreshAndSync(); ping('Backup ripristinato')
  } catch { ping('Il file selezionato non è un backup DAYLY valido') }
  event.target.value = ''
}
async function saveDailyReview() {
  const notes = document.querySelector('#daily-notes')?.value ?? ''
  await put('reviews', { id: `day-${todayKey}`, period: 'day', date: todayKey, notes, completedCount: doneToday.value, updatedAt: Date.now() })
  await refreshAndSync(); ping('Riflessione salvata')
}
async function saveWeeklyFocus() {
  const focus = document.querySelector('#weekly-focus')?.value ?? ''
  await put('reviews', { id: 'week', period: 'week', focus, updatedAt: Date.now() })
  await refreshAndSync(); ping('Focus della settimana salvato')
}

const todayReview = computed(() => state.value.reviews.find(item => item.id === `day-${todayKey}`))

/* ── stato e helper della nuova interfaccia mobile ── */
const selectedDate = ref(selectedDateDefault())
const projectFilter = ref('all')
const notesTab = ref('ideas')
const isOnline = ref(navigator.onLine)

window.addEventListener('online', () => { isOnline.value = true })
window.addEventListener('offline', () => { isOnline.value = false })

const statusAlert = computed(() => proposalCount.value > 0 || mailCount.value > 0 || !isOnline.value || !!mailboxError.value || !cloudSettings() || /ricarica|verificare/i.test(syncLabel.value))
const syncState = computed(() => {
  if (proposalCount.value) return { label: `Claude ha ${proposalCount.value} ${proposalCount.value === 1 ? 'proposta' : 'proposte'} per te`, tone: 'violet', icon: Sparkles }
  if (mailCount.value) return { label: `Claude ti segnala ${mailCount.value} email da vedere`, tone: 'sky', icon: Mail }
  if (!isOnline.value) return { label: 'Offline · le funzioni locali restano attive', tone: 'peach', icon: CloudOff }
  // senza collegamento Claude non può consegnare niente: meglio dirlo in home
  // che lasciare la giornata muta come se non ci fosse nulla da vedere
  if (!cloudSettings()) return { label: 'Claude non è collegato · tocca per attivarlo', tone: 'violet', icon: CloudOff }
  if (mailboxError.value) return { label: 'Non riesco a leggere le email · tocca per riprovare', tone: 'peach', icon: CloudOff }
  if (/ricarica|verificare/i.test(syncLabel.value)) return { label: 'Dati cambiati altrove · ricarica prima di modificare', tone: 'peach', icon: CloudOff }
  return { label: syncLabel.value, tone: 'mint', icon: CheckCircle2 }
})

function tapStatus() {
  if (proposalCount.value) return openClaudeProposals()
  if (mailCount.value) return openMailbox()
  // la riga promette di riprovare: che riprovi davvero, invece di scaricarti
  // in impostazioni a cercare il pulsante giusto
  if (mailboxError.value && cloudSettings()) return fetchMailbox(true)
  switchTo('settings')
}

const filteredProjects = computed(() => {
  if (projectFilter.value === 'open') return state.value.projects.filter(p => Number(p.progress) < 100)
  if (projectFilter.value === 'done') return state.value.projects.filter(p => Number(p.progress) >= 100)
  return state.value.projects
})
const selectedTasks = computed(() => state.value.tasks.filter(task => task.date === selectedDate.value).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')))
const selectedDayLabel = computed(() => selectedDate.value === todayKey ? 'Oggi' : longDate(new Date(`${selectedDate.value}T12:00:00`)))
const monthLabel = computed(() => new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(weekDays.value[3]))

function daySorted(tasks) {
  return [...tasks].sort((a, b) =>
    (b.priority ? 1 : 0) - (a.priority ? 1 : 0) ||
    (a.time || '99:99').localeCompare(b.time || '99:99'))
}
const todayList = computed(() => daySorted(todayTasks.value))
const selectedList = computed(() => daySorted(selectedTasks.value))

function selectedDateDefault() { return todayKey }
function weekdayShort(date) { return new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(date).slice(0, 3) }
function longDate(date) { return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(date) }
function shortMonth(value) { return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(new Date(value || Date.now())) }
function goToday() { calendarOffset.value = 0; selectedDate.value = todayKey }
function shiftWeek(step) {
  calendarOffset.value += step
  selectedDate.value = weekDays.value.some(day => keyDate(day) === todayKey) ? todayKey : keyDate(weekDays.value[0])
}
function taskKind(task) {
  return task.time
    ? { label: 'Appuntamento', icon: Clock3, tone: 'sky' }
    : { label: 'Quando vuoi', icon: ListTodo, tone: 'violet' }
}
function rowMeta(task) { return [formatTime(task.time), projectName(task.projectId)].filter(Boolean).join(' · ') }
function completedWord(count) { return Number(count) === 1 ? 'completata' : 'completate' }

/* ───────────────────────────────────────────────────────────
   Cattura veloce: scrivi in italiano, DAYLY riconosce da sola
   data, orario, priorità e progetti. Nessuna rete, nessun costo.
   ─────────────────────────────────────────────────────────── */
const captureInput = ref('')
const pending = ref([])
const captureNotes = ref([])

const WEEKDAYS = { domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6 }
const WEEKDAY_PATTERNS = { domenica: 'domenica', lunedi: 'luned[\u00eci]', martedi: 'marted[\u00eci]', mercoledi: 'mercoled[\u00eci]', giovedi: 'gioved[\u00eci]', venerdi: 'venerd[\u00eci]', sabato: 'sabato' }
const MONTHS = { gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11 }

function plain(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }
function dayAfter(days) { const date = new Date(today); date.setDate(date.getDate() + days); return keyDate(date) }
function nextWeekday(target) {
  const date = new Date(today)
  const ahead = (target - date.getDay() + 7) % 7
  date.setDate(date.getDate() + (ahead === 0 ? 7 : ahead))
  return keyDate(date)
}
function monthDay(day, month) {
  const date = new Date(today.getFullYear(), month ?? today.getMonth(), day)
  if (keyDate(date) < todayKey) date.setFullYear(date.getFullYear() + (month === undefined ? 0 : 1), month === undefined ? date.getMonth() + 1 : month, day)
  return keyDate(date)
}

function projectByWords(text) {
  const words = plain(text).replace(/\d+\s*%/g, ' ').split(/[^a-z]+/).filter(word => word.length >= 4)
  if (!words.length) return null
  return state.value.projects.find(project => words.some(word => plain(project.title).includes(word))) || null
}

function splitCapture(text) {
  return text
    .split(/\n|;|,|\s+(?:e\s+)?poi\s+/i)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 30)
}

/* Estrae la prima data citata nel testo. «Prima» conta: in «oggi la spesa,
   domani il dentista» deve vincere quella che compare per prima, non quella
   che capita prima nel codice. */
function extractDate(text) {
  const flat = plain(text)
  const found = []

  const relative = [['dopodomani', () => dayAfter(2)], ['domani', () => dayAfter(1)], ['oggi', () => todayKey]]
  for (const [word, resolve] of relative) {
    const at = flat.indexOf(word)
    if (at >= 0 && !(word === 'domani' && flat.slice(0, at).endsWith('dopo'))) {
      found.push({ at, date: resolve(), pattern: new RegExp(`\\b${word}\\b`, 'i') })
    }
  }

  const written = flat.match(/\b(?:il\s+)?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/)
  if (written) found.push({ at: written.index, date: monthDay(Number(written[1]), MONTHS[written[2]]), pattern: new RegExp(`\\b(?:il\\s+)?${written[1]}\\s+${written[2]}`, 'i') })

  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/)
  if (numeric) found.push({ at: numeric.index, date: monthDay(Number(numeric[1]), Number(numeric[2]) - 1), pattern: new RegExp(numeric[0].replace(/\//g, '\\/')) })

  const weekday = flat.match(/\b(?:il\s+|di\s+)?(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato)\b/)
  if (weekday) found.push({ at: weekday.index, date: nextWeekday(WEEKDAYS[weekday[1]]), pattern: new RegExp(`(?:\\b(?:il|di)\\s+)?${WEEKDAY_PATTERNS[weekday[1]]}(?:\\s+prossim[oa])?`, 'i') })

  const bareDay = flat.match(/\bil\s+(\d{1,2})\b/)
  if (bareDay) found.push({ at: bareDay.index, date: monthDay(Number(bareDay[1])), pattern: /\bil\s+\d{1,2}\b/i })

  if (!found.length) return null
  found.sort((a, b) => a.at - b.at)
  const first = found[0]
  return { date: first.date, rest: text.replace(first.pattern, ' ') }
}

function parseCaptureLine(line, defaultDate) {
  let rest = ` ${line} `
  let priority = false

  if (/^\s*!/.test(rest)) { priority = true; rest = rest.replace(/^\s*!\s*/, ' ') }
  if (/\b(priorita|importante)\b/.test(plain(rest))) {
    priority = true
    rest = rest.replace(/\b(priorit[àa]|important\w*)/gi, ' ')
  }

  const progressMatch = rest.match(/(\d{1,3})\s*%/)
  let project = state.value.projects.find(item => item.title && plain(rest).includes(plain(item.title))) || null
  if (!project && progressMatch) project = projectByWords(rest)
  if (project && progressMatch) {
    return { tipo: 'aggiorna_progresso', titolo: '', data: '', ora: '', priorita: false, progetto: project.title, progresso: Math.max(0, Math.min(100, Number(progressMatch[1]))) }
  }

  const dated = extractDate(rest)
  if (dated) rest = dated.rest

  let time = ''
  const spoken = rest.match(/\b(?:alle|alle\s+ore|ore|h)\s*(\d{1,2})(?:[:.](\d{2}))?\b/i)
  const digits = rest.match(/\b(\d{1,2})[:.](\d{2})\b/)
  if (spoken) { time = `${String(spoken[1]).padStart(2, '0')}:${spoken[2] || '00'}`; rest = rest.replace(spoken[0], ' ') }
  else if (digits) { time = `${String(digits[1]).padStart(2, '0')}:${digits[2]}`; rest = rest.replace(digits[0], ' ') }
  if (time && Number(time.slice(0, 2)) > 23) time = ''

  let title = rest
    .replace(/\b(devo|ho da|ricordarmi di|ricordati di|bisogna)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')

  // niente lettere: era solo una data o un frammento vuoto, non un'attività
  if (!/[a-zà-ÿ]{2}/i.test(title)) return dated ? { soloData: dated.date } : null
  title = title.replace(/^(?:l'|il|lo|la|i|gli|le)\s+/i, '')
  title = title.charAt(0).toUpperCase() + title.slice(1)

  return {
    tipo: 'aggiungi_attivita',
    titolo: title.slice(0, 160),
    data: dated?.date || defaultDate,
    ora: time,
    priorita: priority,
    progetto: project?.title || '',
    progresso: 0,
    nuovaData: dated ? dated.date : '',
  }
}

/* La data citata vale anche per quello che viene dopo: in «domani il dentista,
   la spesa, chiamare Marco» finiscono tutte e tre domani. */
function runCapture() {
  const fragments = splitCapture(captureInput.value)
  if (!fragments.length) return
  const parsed = []
  const skipped = []
  let context = todayKey
  for (const fragment of fragments) {
    const change = parseCaptureLine(fragment, context)
    if (!change) { skipped.push(fragment); continue }
    if (change.soloData) { context = change.soloData; continue }
    if (change.nuovaData) context = change.nuovaData
    delete change.nuovaData
    parsed.push({ ...change, id: newId(), origine: 'locale' })
  }
  pending.value = parsed
  pendingSource.value = []
  captureNotes.value = skipped
  if (parsed.length) { captureInput.value = ''; showCapture.value = false }
}

/* ── foglio di una singola attività ── */
const taskSheet = ref(null)

function openTask(task) { taskSheet.value = task }
async function updateTask(task, patch, message) {
  await put('tasks', { ...task, ...patch, updatedAt: Date.now() })
  taskSheet.value = null
  await refreshAndSync()
  if (message) ping(message)
}
async function moveToTomorrow(task) {
  const tomorrow = new Date(`${task.date}T12:00:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  await updateTask(task, { date: keyDate(tomorrow) }, 'Spostata a domani')
}
async function switchPriority(task) {
  if (!task.priority && state.value.tasks.filter(item => item.date === task.date && item.priority && item.id !== task.id).length >= 3) {
    ping('Per ogni giorno puoi scegliere al massimo tre priorità')
    return
  }
  await updateTask(task, { priority: !task.priority }, task.priority ? 'Non è più una priorità' : 'Segnata come priorità')
}
async function deleteTask(task) {
  await remove('tasks', task.id)
  taskSheet.value = null
  await refreshAndSync()
  ping('Attività eliminata', 'removed')
}

/* ── proposte arrivate da Claude tramite il connettore ── */
const claudeProposals = ref([])
const proposalsBusy = ref(false)
const pendingSource = ref([])

const proposalCount = computed(() => claudeProposals.value.reduce((total, proposal) => total + (proposal.modifiche?.length || 0), 0))
const proposalNote = computed(() => claudeProposals.value.map(proposal => proposal.nota).filter(Boolean).join(' ') )

async function fetchProposals(showError = false) {
  const account = cloudSettings()
  if (!account || !navigator.onLine || proposalsBusy.value) return
  proposalsBusy.value = true
  try {
    const response = await fetch(`/api/proposals?accountId=${encodeURIComponent(account.accountId)}`, { headers: { Authorization: `Bearer ${account.credential}` } })
    if (!response.ok) throw new Error('Non riesco a leggere le proposte.')
    claudeProposals.value = (await response.json()).proposte || []
  } catch (error) {
    if (showError) ping(error.message)
  } finally {
    proposalsBusy.value = false
  }
}

async function clearProposals(ids) {
  const account = cloudSettings()
  if (!account || !ids.length) return
  for (const id of ids) {
    try {
      await fetch('/api/proposals', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${account.credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.accountId, id }),
      })
    } catch { /* la proposta scade da sola dopo sette giorni */ }
  }
  claudeProposals.value = claudeProposals.value.filter(proposal => !ids.includes(proposal.id))
}

function openClaudeProposals() {
  pendingSource.value = claudeProposals.value.map(proposal => proposal.id)
  pending.value = claudeProposals.value.flatMap(proposal => (proposal.modifiche || []).map(change => ({
    tipo: change.tipo,
    titolo: change.titolo || '',
    data: change.data || '',
    ora: change.ora || '',
    priorita: !!change.priorita,
    progetto: change.progetto || '',
    progresso: Number(change.progresso) || 0,
    id: newId(),
    origine: 'claude',
  })))
}

async function dismissPending() {
  const sources = pendingSource.value.slice()
  pending.value = []
  pendingSource.value = []
  pendingMail.value = ''
  if (sources.length) { await clearProposals(sources); ping('Proposte rifiutate', 'removed') }
}

/* ── riassunti delle email importanti segnalate da Claude ── */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MAIL_IN_VIEW = 20
const MAIL_ARCHIVED = 100
const MAIL_POLL_MS = 30_000
const mailbox = ref([])
const mailboxRevision = ref(null)
const mailboxBusy = ref(false)
const showMailbox = ref(false)
const showArchive = ref(false)
const confirmArchiveWipe = ref(false)
const mailboxError = ref('')
const MAIL_READ_FAULT = 'Non riesco a leggere i riassunti delle email.'
// marco gli errori scritti da noi, così un errore di rete o di parsing non
// finisce mai davanti agli occhi dell'utente con le sue parole tecniche
const mailFault = (message) => Object.assign(new Error(message), { friendly: true })
const mailMessage = (error, fallback) => error?.friendly ? error.message : fallback
const pendingMail = ref('')
let mailPoll = null

const mailLive = computed(() => mailbox.value.filter(mail => mail.stato !== 'archiviata'))
const mailArchived = computed(() => mailbox.value.filter(mail => mail.stato === 'archiviata'))
const mailCount = computed(() => mailLive.value.length)
const archiveCount = computed(() => mailArchived.value.length)
const mailNote = computed(() => [...new Set(mailLive.value.map(mail => mail.nota).filter(Boolean))].join(' '))

function mailDay(mail) {
  return /^\d{4}-\d{2}-\d{2}$/.test(mail.ricevuta || '') ? mail.ricevuta : keyDate(new Date(Number(mail.createdAt) || Date.now()))
}

// le due informazioni di contorno diventano pastiglie: su iPhone una riga
// sola di testo andava a capo male e si leggeva peggio
function mailChips(mail) {
  const day = mailDay(mail)
  const chips = [{ text: day === todayKey ? 'arrivata oggi' : `arrivata ${longDate(new Date(`${day}T12:00:00`))}`, urgent: false }]
  if (/^\d{4}-\d{2}-\d{2}$/.test(mail.scadenza || '')) {
    chips.push({
      text: mail.scadenza === todayKey ? 'da gestire oggi' : `entro ${longDate(new Date(`${mail.scadenza}T12:00:00`))}`,
      urgent: mail.scadenza <= todayKey,
    })
  }
  return chips
}

const byNewest = (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)

// a ogni lettura i riassunti dei giorni passati scalano in archivio da soli:
// in vista resta la giornata di oggi, l'archivio lo svuoti tu quando vuoi
function tidyMailbox(list) {
  const now = Date.now()
  return list
    .filter(mail => mail.stato === 'archiviata' || now - Number(mail.createdAt || 0) < WEEK_MS)
    .map(mail => {
      if (mail.stato === 'archiviata') return mail
      if (mailDay(mail) < todayKey) return { ...mail, stato: 'archiviata', archivedAt: now }
      return mail.stato === 'nuova' ? mail : { ...mail, stato: 'nuova' }
    })
    .sort(byNewest)
}

async function fetchMailbox(showError = false) {
  const account = cloudSettings()
  if (!account || !navigator.onLine || mailboxBusy.value) return
  mailboxBusy.value = true
  try {
    const response = await fetch(`/api/mailbox?accountId=${encodeURIComponent(account.accountId)}`, { headers: { Authorization: `Bearer ${account.credential}` } })
    if (response.status === 401) throw mailFault('Il collegamento DAYLY non è più valido: ricollegalo dalle impostazioni.')
    if (!response.ok) throw mailFault(MAIL_READ_FAULT)
    const remote = await response.json()
    mailboxRevision.value = remote.revision || null
    const list = remote.casella ? await decryptSnapshot(remote.casella, account.credential) : []
    const stored = (Array.isArray(list) ? list : []).slice().sort(byNewest)
    const tidy = tidyMailbox(stored)
    mailbox.value = tidy
    mailboxError.value = ''
    mailboxBusy.value = false
    // l'archiviazione automatica va rimandata su, altrimenti domani ricompare
    if (JSON.stringify(tidy) !== JSON.stringify(stored)) await saveMailbox(tidy)
  } catch (error) {
    // un guasto vero non deve restare invisibile: lo dico una volta e poi lo
    // lascio nella riga di stato, senza ripeterlo a ogni controllo dei 30s
    const message = mailMessage(error, MAIL_READ_FAULT)
    if (showError || !mailboxError.value) ping(message)
    mailboxError.value = message
  } finally {
    mailboxBusy.value = false
  }
}

async function saveMailbox(list) {
  const account = cloudSettings()
  if (!account) return false
  const sorted = list.slice().sort(byNewest)
  const trimmed = [
    ...sorted.filter(mail => mail.stato !== 'archiviata').slice(0, MAIL_IN_VIEW),
    ...sorted.filter(mail => mail.stato === 'archiviata').slice(0, MAIL_ARCHIVED),
  ].sort(byNewest)
  try {
    const casella = trimmed.length ? await encryptSnapshot(trimmed, account.credential) : null
    const response = await fetch('/api/mailbox', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.accountId, casella, revision: mailboxRevision.value }),
    })
    const result = await response.json()
    if (response.status === 409) { await fetchMailbox(); ping('Claude ha segnalato altre email: ricontrolla la casella'); return false }
    if (!response.ok) throw mailFault(result.error || 'Non riesco ad aggiornare la casella.')
    mailboxRevision.value = result.revision || null
    mailbox.value = trimmed
    return true
  } catch (error) { ping(mailMessage(error, 'Non riesco ad aggiornare la casella.')); return false }
}

async function removeMail(id) {
  const now = Date.now()
  return saveMailbox(mailbox.value.map(mail => mail.id === id ? { ...mail, stato: 'archiviata', archivedAt: now } : mail))
}

async function archiveMail(id) {
  if (!await removeMail(id)) return
  ping('Email archiviata', 'removed')
  if (!mailCount.value && !showArchive.value) showMailbox.value = false
}

async function archiveAllMails() {
  const now = Date.now()
  const archived = mailbox.value.map(mail => mail.stato === 'archiviata' ? mail : { ...mail, stato: 'archiviata', archivedAt: now })
  if (await saveMailbox(archived)) { showMailbox.value = false; showArchive.value = false; ping('Riassunti archiviati', 'removed') }
}

async function deleteArchive() {
  if (!confirmArchiveWipe.value) { confirmArchiveWipe.value = true; return }
  confirmArchiveWipe.value = false
  const remaining = mailbox.value.filter(mail => mail.stato !== 'archiviata')
  if (!await saveMailbox(remaining)) return
  showArchive.value = false
  if (!remaining.length) showMailbox.value = false
  ping('Archivio eliminato', 'removed')
}

function openMailbox(archive = false) {
  showArchive.value = archive || !mailCount.value
  confirmArchiveWipe.value = false
  showMailbox.value = true
  fetchMailbox()
}

// cambiare pagina: la nuova entra dal lato da cui arriva, così si capisce
// di essere passati all'altra metà della casella
const mailSlide = ref('')
function openArchive(open) {
  if (showArchive.value !== open) mailSlide.value = open ? 'slide-left' : 'slide-right'
  showArchive.value = open
  confirmArchiveWipe.value = false
}

// il trascinamento di lato sfoglia le pagine, come ci si aspetta sul telefono
let mailTouch = null
function mailTouchStart(event) {
  mailTouch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null
}
function mailTouchEnd(event) {
  const start = mailTouch
  mailTouch = null
  if (!start) return
  const touch = event.changedTouches[0]
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  // solo i gesti chiaramente orizzontali: altrimenti rubo lo scorrimento
  if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return
  if (dx < 0) openArchive(true)
  else openArchive(false)
}

// le email compaiono quando Claude le deposita: ricontrollo da solo mentre
// DAYLY è davanti agli occhi, così non devo riaprirla per vederle
function watchMailbox() {
  mailPoll = window.setInterval(() => { if (document.visibilityState === 'visible') fetchMailbox() }, MAIL_POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { fetchProposals(); fetchMailbox() }
  })
}
onUnmounted(() => { if (mailPoll) window.clearInterval(mailPoll) })

function mailToTask(mail) {
  pendingMail.value = mail.id
  pendingSource.value = []
  pending.value = [{
    tipo: 'aggiungi_attivita',
    titolo: mail.oggetto.slice(0, 160),
    data: /^\d{4}-\d{2}-\d{2}$/.test(mail.scadenza || '') ? mail.scadenza : todayKey,
    ora: '',
    priorita: false,
    progetto: '',
    progresso: 0,
    id: newId(),
    origine: 'email',
  }]
  showMailbox.value = false
}

/* ── anteprima condivisa: cattura veloce e proposte di Claude ── */
function discardPending(id) { pending.value = pending.value.filter(change => change.id !== id) }

function pendingKind(change) {
  if (change.tipo === 'aggiungi_attivita') return change.ora ? 'Appuntamento' : 'Quando vuoi'
  if (change.tipo === 'sposta_attivita') return 'Da spostare'
  if (change.tipo === 'completa_attivita') return 'Da completare'
  return 'Progresso progetto'
}
function pendingTone(change) {
  if (change.tipo === 'aggiungi_attivita') return change.ora ? 'sky' : 'violet'
  if (change.tipo === 'sposta_attivita') return 'peach'
  if (change.tipo === 'completa_attivita') return 'mint'
  return 'sky'
}
function pendingIcon(change) {
  if (change.tipo === 'aggiungi_attivita') return change.ora ? Clock3 : ListTodo
  if (change.tipo === 'sposta_attivita') return ArrowRight
  if (change.tipo === 'completa_attivita') return Check
  return Target
}
function pendingTitle(change) { return change.tipo === 'aggiorna_progresso' ? change.progetto : change.titolo }
function pendingMeta(change) {
  if (change.tipo === 'aggiorna_progresso') return `Al ${Math.max(0, Math.min(100, Number(change.progresso) || 0))}%`
  if (change.tipo === 'completa_attivita') return 'Segnata come fatta'
  const parts = []
  if (/^\d{4}-\d{2}-\d{2}$/.test(change.data || '')) parts.push(change.data === todayKey ? 'Oggi' : longDate(new Date(`${change.data}T12:00:00`)))
  parts.push(change.ora || 'quando vuoi')
  if (change.priorita) parts.push('priorità')
  if (change.progetto && change.tipo === 'aggiungi_attivita') parts.push(change.progetto)
  return parts.join(' · ')
}

function findTaskByTitle(title) {
  const wanted = plain(String(title || '').trim())
  return state.value.tasks.find(task => plain(task.title.trim()) === wanted) || null
}
function findProjectByTitle(title) {
  const wanted = plain(String(title || '').trim())
  if (!wanted) return null
  return state.value.projects.find(project => plain(project.title.trim()) === wanted) || null
}

async function applyPending() {
  const changes = pending.value.slice()
  if (!changes.length) return
  let applied = 0
  for (const change of changes) {
    if (change.tipo === 'aggiungi_attivita') {
      if (!String(change.titolo || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(change.data || '')) continue
      const alreadyThree = state.value.tasks.filter(task => task.date === change.data && task.priority).length >= 3
      await put('tasks', {
        id: newId(),
        title: String(change.titolo).trim().slice(0, 160),
        date: change.data,
        time: /^\d{2}:\d{2}$/.test(change.ora || '') ? change.ora : '',
        priority: !!change.priorita && !alreadyThree,
        done: false,
        projectId: findProjectByTitle(change.progetto)?.id || '',
        updatedAt: Date.now(),
      })
      applied++
    } else if (change.tipo === 'sposta_attivita') {
      const task = findTaskByTitle(change.titolo)
      if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(change.data || '')) continue
      await put('tasks', { ...task, date: change.data, time: /^\d{2}:\d{2}$/.test(change.ora || '') ? change.ora : task.time, updatedAt: Date.now() })
      applied++
    } else if (change.tipo === 'completa_attivita') {
      const task = findTaskByTitle(change.titolo)
      if (!task) continue
      await put('tasks', { ...task, done: true, updatedAt: Date.now() })
      applied++
    } else if (change.tipo === 'aggiorna_progresso') {
      const project = findProjectByTitle(change.progetto)
      if (!project) continue
      await put('projects', { ...project, progress: Math.max(0, Math.min(100, Number(change.progresso) || 0)) })
      applied++
    }
  }
  const sources = pendingSource.value.slice()
  const fromMail = pendingMail.value
  pending.value = []
  pendingSource.value = []
  pendingMail.value = ''
  if (sources.length) await clearProposals(sources)
  if (fromMail && applied) await removeMail(fromMail)
  await refreshAndSync()
  // dopo aver scritto, mostro il risultato invece di lasciarti dov'eri
  if (!['today', 'calendar'].includes(section.value)) switchTo('today')
  ping(applied ? `${applied} ${applied === 1 ? 'cosa aggiunta' : 'cose aggiunte'}` : 'Non sono riuscito ad aggiungere nulla')
}
const showCapture = ref(false)
function openCapture() {
  captureNotes.value = []
  showCapture.value = true
}
</script>


<template>
  <div class="app">
    <div class="phone">
      <header class="appbar">
        <div class="appbar-id">
          <img class="avatar" :src="logoUrl" alt="" />
          <div>
            <span class="appbar-kicker">{{ greeting }}</span>
            <strong>Christian</strong>
          </div>
        </div>
        <button class="round-btn" aria-label="Impostazioni" @click="switchTo('settings')">
          <Settings2 :size="19" />
          <span v-if="!cloudSettings()" class="badge"></span>
        </button>
      </header>

      <div v-if="loading" class="loading">Un momento…</div>

      <main v-else class="scroll">
        <!-- ─────────── OGGI ─────────── -->
        <section v-if="section === 'today'" class="page">
          <div class="page-head">
            <p class="date-line">{{ dateLabel }}</p>
            <h1 class="page-title">La tua giornata</h1>
          </div>

          <button v-if="statusAlert" class="status-row" :class="`status-${syncState.tone}`" @click="tapStatus()">
            <component :is="syncState.icon" :size="15" />
            <span>{{ syncState.label }}</span>
            <ChevronRight :size="15" />
          </button>

          <section v-if="proposalCount" class="card proposal-card">
            <div class="card-head">
              <h2>Claude ha lavorato per te<span class="head-sub">{{ proposalCount }} {{ proposalCount === 1 ? 'proposta' : 'proposte' }} in attesa</span></h2>
              <span class="row-icon tone-violet"><Sparkles :size="18" /></span>
            </div>
            <p v-if="proposalNote" class="project-note">{{ proposalNote }}</p>
            <button class="btn btn-block" style="margin-top:14px" @click="openClaudeProposals">Guarda cosa propone</button>
          </section>

          <section v-if="mailCount || archiveCount" class="card">
            <div class="card-head">
              <h2>{{ mailCount ? 'Email di oggi' : 'Email archiviate' }}<span class="head-sub">{{ mailCount ? `${mailCount} ${mailCount === 1 ? 'riassunto' : 'riassunti'} di Claude` : `${archiveCount} nell’archivio` }}</span></h2>
              <span class="row-icon tone-sky"><Mail :size="18" /></span>
            </div>
            <p v-if="mailCount && mailNote" class="project-note">{{ mailNote }}</p>
            <button class="btn btn-block" style="margin-top:14px" @click="openMailbox(!mailCount)">{{ mailCount ? 'Leggi i riassunti' : 'Apri l’archivio' }}</button>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Oggi<span class="head-sub">{{ todayTasks.length ? `${doneToday} di ${todayTasks.length} ${completedWord(doneToday)}` : 'Niente in programma' }}</span></h2>
              <button class="add-round" aria-label="Aggiungi una cosa" @click="beginAdd('task', { date: todayKey })"><Plus :size="17" /></button>
            </div>
            <div v-if="todayTasks.length" class="bar bar-head"><span :style="{ width: `${progressToday}%` }"></span></div>
            <div v-if="todayList.length" class="list">
              <div v-for="task in todayList" :key="task.id" class="row" :class="{ 'is-done': task.done }">
                <button class="row-main" @click="openTask(task)">
                  <span class="row-icon" :class="`tone-${taskKind(task).tone}`"><component :is="taskKind(task).icon" :size="18" /></span>
                  <span class="row-body">
                    <span v-if="task.priority" class="type-line"><span class="pill-priority"><Flag :size="10" /> Priorità</span></span>
                    <span class="row-title">{{ task.title }}</span>
                    <span v-if="rowMeta(task)" class="row-meta">{{ rowMeta(task) }}</span>
                  </span>
                </button>
                <button class="check" :class="{ on: task.done }" :aria-label="task.done ? `Riapri ${task.title}` : `Segna fatta ${task.title}`" @click="toggleTask(task)"><Check :size="14" /></button>
              </div>
            </div>
            <div v-else class="empty">
              <span class="empty-art tone-violet"><PenLine :size="22" /></span>
              <strong>La giornata è ancora bianca</strong>
              <p>Tocca la matita qui sotto e scrivi quello che devi fare, come viene. Ci penso io a metterlo in ordine.</p>
              <button class="btn" @click="openCapture"><PenLine :size="16" /> Scrivi la giornata</button>
            </div>
          </section>
        </section>

        <section v-else-if="section === 'calendar'" class="page">
          <div class="page-head">
            <p class="date-line">{{ monthLabel }}</p>
            <h1 class="page-title">Calendario</h1>
          </div>

          <section class="card">
            <div class="cal-head">
              <strong>{{ weekRange }}</strong>
              <div class="cal-nav">
                <button aria-label="Settimana precedente" @click="shiftWeek(-1)"><ArrowLeft :size="16" /></button>
                <button class="today-chip" @click="goToday">Oggi</button>
                <button aria-label="Settimana successiva" @click="shiftWeek(1)"><ArrowRight :size="16" /></button>
              </div>
            </div>
            <div class="strip">
              <button v-for="day in weekDays" :key="keyDate(day)" class="strip-day" :class="{ sel: keyDate(day) === selectedDate, 'is-today': keyDate(day) === todayKey }" @click="selectedDate = keyDate(day)">
                <span>{{ weekdayShort(day) }}</span>
                <strong>{{ day.getDate() }}</strong>
                <i class="dot" :class="{ 'dot-hidden': !tasksOn(day).length }"></i>
              </button>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>{{ selectedDayLabel }}<span class="head-sub">{{ selectedTasks.length ? `${selectedTasks.filter(t => t.done).length} di ${selectedTasks.length} ${completedWord(selectedTasks.filter(t => t.done).length)}` : 'Giornata libera' }}</span></h2>
              <button class="add-round" aria-label="Aggiungi in questo giorno" @click="beginAdd('task', { date: selectedDate })"><Plus :size="17" /></button>
            </div>
            <div v-if="selectedList.length" class="list">
              <div v-for="task in selectedList" :key="task.id" class="row" :class="{ 'is-done': task.done }">
                <button class="row-main" @click="openTask(task)">
                  <span class="row-icon" :class="`tone-${taskKind(task).tone}`"><component :is="taskKind(task).icon" :size="18" /></span>
                  <span class="row-body">
                    <span v-if="task.priority" class="type-line"><span class="pill-priority"><Flag :size="10" /> Priorità</span></span>
                    <span class="row-title">{{ task.title }}</span>
                    <span v-if="rowMeta(task)" class="row-meta">{{ rowMeta(task) }}</span>
                  </span>
                </button>
                <button class="check" :class="{ on: task.done }" :aria-label="task.done ? `Riapri ${task.title}` : `Segna fatta ${task.title}`" @click="toggleTask(task)"><Check :size="14" /></button>
              </div>
            </div>
            <div v-else class="empty">
              <span class="empty-art tone-sky"><CalendarDays :size="22" /></span>
              <strong>Niente in questo giorno</strong>
              <p>Gli impegni con un orario finiscono in agenda; quelli senza restano flessibili.</p>
              <button class="btn" @click="beginAdd('task', { date: selectedDate })"><Plus :size="16" /> Aggiungi</button>
            </div>
          </section>
        </section>

        <section v-else-if="section === 'projects'" class="page">
          <div class="page-head">
            <p class="date-line">Un passo alla volta</p>
            <h1 class="page-title">Progetti</h1>
            <p class="page-sub">Le cose che crescono nel tempo. La percentuale la aggiorni tu, con il cursore.</p>
          </div>

          <div v-if="state.projects.length" class="chips">
            <button class="chip" :class="{ on: projectFilter === 'all' }" @click="projectFilter = 'all'">Tutti <span class="chip-count">{{ state.projects.length }}</span></button>
            <button class="chip" :class="{ on: projectFilter === 'open' }" @click="projectFilter = 'open'">In corso <span class="chip-count">{{ state.projects.filter(p => Number(p.progress) < 100).length }}</span></button>
            <button class="chip" :class="{ on: projectFilter === 'done' }" @click="projectFilter = 'done'">Completati <span class="chip-count">{{ state.projects.filter(p => Number(p.progress) >= 100).length }}</span></button>
          </div>

          <section v-if="state.projects.length" class="card progress-card">
            <div class="row-between">
              <div>
                <span class="eyebrow">Progresso medio</span>
                <strong>Stai andando avanti</strong>
              </div>
              <div class="pct">{{ projectProgress }}<small>%</small></div>
            </div>
            <div class="bar"><span :style="{ width: `${projectProgress}%` }"></span></div>
          </section>

          <section v-for="project in filteredProjects" :key="project.id" class="card project-card">
            <div class="project-top">
              <span class="project-icon" :style="{ background: project.color || '#E8E5FF' }"><Target :size="20" /></span>
              <div style="flex:1;min-width:0">
                <span class="type-label label-sky">{{ project.kind || 'Progetto personale' }}</span>
                <h2>{{ project.title }}</h2>
              </div>
              <button class="ghost-round" :aria-label="`Elimina ${project.title}`" @click="deleteItem('projects', project)"><Trash2 :size="16" /></button>
            </div>
            <p v-if="project.notes" class="project-note">{{ project.notes }}</p>
            <div class="row-between">
              <span class="eyebrow">Progresso</span>
              <strong style="font-family:Manrope,sans-serif;font-size:16px">{{ project.progress }}%</strong>
            </div>
            <input class="range" type="range" min="0" max="100" step="5" :value="project.progress" :style="{ background: `linear-gradient(90deg, var(--pill) ${project.progress}%, var(--line) ${project.progress}%)` }" :aria-label="`Progresso di ${project.title}`" @input="setProgress(project, $event.target.value)" />
            <div class="range-scale"><span>Appena iniziato</span><span>Traguardo</span></div>
          </section>

          <div v-if="state.projects.length && !filteredProjects.length" class="card">
            <div class="empty">
              <span class="empty-art tone-sky"><Target :size="22" /></span>
              <strong>Niente in questo filtro</strong>
              <p>Cambia filtro qui sopra per vedere gli altri progetti.</p>
            </div>
          </div>

          <div v-if="!state.projects.length" class="card">
            <div class="empty">
              <span class="empty-art tone-sky"><Target :size="22" /></span>
              <strong>Nessun progetto, per ora</strong>
              <p>Un progetto è una cosa che ti sta a cuore e richiede più di un giorno: un corso, un viaggio, un’abitudine. Qui tieni traccia di quanto sei avanti.</p>
              <button class="btn" @click="beginAdd('project')"><Plus :size="16" /> Crea il primo progetto</button>
            </div>
          </div>
        </section>

        <!-- ─────────── IDEE ─────────── -->
        <section v-else-if="section === 'notes'" class="page">
          <div class="page-head">
            <p class="date-line">Quello che non è un impegno</p>
            <h1 class="page-title">Note</h1>
          </div>

          <div class="chips">
            <button class="chip" :class="{ on: notesTab === 'ideas' }" @click="notesTab = 'ideas'">Idee <span class="chip-count">{{ state.ideas.length }}</span></button>
            <button class="chip" :class="{ on: notesTab === 'review' }" @click="notesTab = 'review'">Riepiloghi</button>
          </div>

          <template v-if="notesTab === 'ideas'">
          <div v-if="state.ideas.length" class="idea-grid">
            <article v-for="(idea, i) in state.ideas" :key="idea.id" class="idea-card" :class="`idea-tone-${i % 4}`">
              <div class="idea-top">
                <span class="idea-date">{{ shortMonth(idea.createdAt) }}</span>
                <button :aria-label="`Elimina ${idea.title}`" @click="deleteItem('ideas', idea)"><X :size="15" /></button>
              </div>
              <h2>{{ idea.title }}</h2>
              <p>{{ idea.notes || 'Salvata per quando sarà il momento giusto.' }}</p>
            </article>
          </div>

          <div v-else class="card">
            <div class="empty">
              <span class="empty-art tone-mint"><Lightbulb :size="22" /></span>
              <strong>Nessuna idea annotata</strong>
              <p>Un posto tranquillo dove lasciare quello che ti passa per la testa. Nessuna scadenza, nessun piano: ci torni quando vuoi.</p>
              <button class="btn" @click="beginAdd('idea')"><Plus :size="16" /> Annota un’idea</button>
            </div>
          </div>
          </template>

          <template v-else>
          <section class="summary-card">
            <div>
              <h2>Questa settimana</h2>
              <p>{{ weekTasks.filter(task => task.done).length }} attività {{ completedWord(weekTasks.filter(task => task.done).length) }} su {{ weekTasks.length }}. Ogni passo ha il suo valore.</p>
            </div>
            <div class="summary-big">{{ weekTasks.length ? Math.round(weekTasks.filter(task => task.done).length / weekTasks.length * 100) : 0 }}<small>%</small></div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Il bilancio di stasera<span class="head-sub">{{ longDate(today) }} · {{ doneToday }} {{ doneToday === 1 ? 'cosa portata' : 'cose portate' }} a termine</span></h2>
              <span class="row-icon tone-violet"><Moon :size="18" /></span>
            </div>
            <label class="field-label" for="daily-notes">Cosa vuoi ricordare di oggi? Anche una parola basta.</label>
            <textarea id="daily-notes" class="notes" :value="todayReview?.notes || ''" placeholder="Una cosa che è andata bene…"></textarea>
            <button class="btn btn-block" style="margin-top:14px" @click="saveDailyReview">Salva il riepilogo</button>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Il focus della settimana<span class="head-sub">Una parola o un’intenzione a cui tornare</span></h2>
              <span class="row-icon tone-mint"><Compass :size="18" /></span>
            </div>
            <label class="field-label" for="weekly-focus">Il mio focus della settimana</label>
            <textarea id="weekly-focus" class="notes" :value="lastReview?.focus || ''" placeholder="Per questa settimana, vorrei…"></textarea>
            <button class="btn btn-block" style="margin-top:14px" @click="saveWeeklyFocus">Salva il focus</button>
          </section>
          </template>
        </section>

        <section v-else-if="section === 'settings'" class="page">
          <div class="page-head">
            <p class="date-line">I tuoi dati, sempre tuoi</p>
            <h1 class="page-title">Impostazioni</h1>
          </div>

          <section class="card">
            <div class="card-head">
              <h2>Suoni<span class="head-sub">{{ soundOn ? 'Un tocco e una conferma li senti' : 'Tutto in silenzio' }}</span></h2>
              <button class="switch" :class="{ on: soundOn }" role="switch" :aria-checked="soundOn" aria-label="Suoni" @click="switchSound"><i></i></button>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Backup<span class="head-sub">Attività, progetti, idee e riflessioni stanno su questo dispositivo</span></h2></div>
            <button class="backup-row" @click="exportBackup">
              <span><ArrowDownToLine :size="18" /></span>
              <div><strong>Esporta una copia</strong><small>Salva tutti i dati in un file JSON</small></div>
              <ChevronRight :size="17" />
            </button>
            <button class="backup-row" @click="importInput?.click()">
              <span><Upload :size="18" /></span>
              <div><strong>Ripristina una copia</strong><small>Importa un backup DAYLY già salvato</small></div>
              <ChevronRight :size="17" />
            </button>
            <input ref="importInput" type="file" accept="application/json,.json" hidden @change="importBackup" />

            <div class="warn-box">
              <CloudOff :size="16" />
              <span>Su iPhone iOS può rimuovere i dati del sito se lo spazio è poco o se cancelli i dati di navigazione. Tieni una copia in File o iCloud Drive.</span>
            </div>

            <div class="meta-row">
              <span>Attività<strong>{{ state.tasks.length }}</strong></span>
              <span>Progetti<strong>{{ state.projects.length }}</strong></span>
              <span>Idee<strong>{{ state.ideas.length }}</strong></span>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Claude<span class="head-sub">{{ cloudSettings() ? syncLabel : 'Collegamento non ancora attivo' }}</span></h2>
              <span class="row-icon tone-violet"><MessageCircle :size="18" /></span>
            </div>
            <p class="project-note">DAYLY prepara un collegamento sicuro. I dati vengono cifrati prima di partire e le funzioni locali continuano a funzionare offline.</p>
            <div class="flow">
              <div class="flow-step"><span class="flow-num">1</span><div><strong>Legge</strong><small>Agenda, progetti e idee che hai sincronizzato</small></div></div>
              <div class="flow-step"><span class="flow-num">2</span><div><strong>Propone</strong><small>Ti mostra l’elenco preciso delle modifiche</small></div></div>
              <div class="flow-step"><span class="flow-num">3</span><div><strong>Applica</strong><small>Solo dopo che hai detto di procedere</small></div></div>
            </div>

            <button class="btn btn-block" style="margin-top:16px" :disabled="cloudBusy" @click="connectClaude">
              {{ cloudBusy ? 'Preparo il collegamento…' : cloudSettings() ? 'Genera codice temporaneo' : 'Attiva la sincronizzazione protetta' }}
            </button>

            <div v-if="pairingCode" class="pair-code">
              <span class="eyebrow">Codice temporaneo · 5 minuti</span>
              <code>{{ pairingCode }}</code>
              <button class="btn btn-soft" @click="copyPairingCode">Copia il codice</button>
            </div>

            <button class="btn btn-soft btn-block" style="margin-top:14px" :disabled="proposalsBusy || mailboxBusy || !cloudSettings()" @click="fetchProposals(true); fetchMailbox(true)">
              <RefreshCw :size="16" /> {{ proposalsBusy || mailboxBusy ? 'Controllo…' : 'Controlla proposte ed email' }}
            </button>

            <ol class="steps">
              <li>In Claude apri <strong>Impostazioni → Connettori → Aggiungi connettore personalizzato</strong>.</li>
              <li>Inserisci <code>https://dayly-delta.vercel.app/api/mcp</code> e avvia la connessione.</li>
              <li>Quando si apre la pagina DAYLY, incolla il codice temporaneo e autorizza.</li>
              <li>Chiedi a Claude di organizzarti la settimana. Le sue proposte arrivano qui in DAYLY, dove le accetti o le rifiuti una per una.</li>
            </ol>

            <div v-if="!cloudSettings()">
              <label class="field-label" for="recovery-code">Hai già un codice di recupero?</label>
              <input id="recovery-code" class="input" v-model="recoveryInput" placeholder="ID.chiave personale" />
              <button class="btn btn-soft btn-block" style="margin-top:10px" @click="restoreCloudConnection">Ripristina il collegamento</button>
            </div>

            <div v-else class="sheet-actions" style="flex-direction:column;gap:12px">
              <button class="btn btn-soft btn-block" @click="copyRecoveryCode">Copia codice di recupero</button>
              <button class="btn-ghost" @click="disconnectClaude">Revoca Claude e rinnova il codice segreto</button>
              <button class="btn-ghost btn-danger" @click="deleteCloudCopy">Elimina la copia online</button>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Cosa può cambiare<span class="head-sub">Tutto il resto si fa qui dentro, a mano</span></h2></div>
            <div class="note-line"><Check :size="16" /><span>Aggiungere un’attività o spostarla a un altro giorno.</span></div>
            <div class="note-line"><Check :size="16" /><span>Segnare un’attività come completata.</span></div>
            <div class="note-line"><Check :size="16" /><span>Aggiornare la percentuale di un progetto.</span></div>
            <div class="note-line"><Check :size="16" /><span>Riassumerti le email importanti: leggi cosa dicono, apri quella vera in Gmail o la trasformi in attività.</span></div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Le scelte restano tue</h2></div>
            <div class="note-line"><CheckCircle2 :size="16" /><span>I dati vengono cifrati prima della sincronizzazione.</span></div>
            <div class="note-line"><CheckCircle2 :size="16" /><span>Nessuna chiave API a pagamento dentro l’app.</span></div>
            <div class="note-line"><CheckCircle2 :size="16" /><span>Puoi revocare il collegamento da qui, quando vuoi.</span></div>
            <div class="warn-box"><CloudOff :size="16" /><span>Il backup JSON è in chiaro e non contiene la chiave di sincronizzazione: conservalo con cura. Lo spazio Vercel Blob ha quote mensili incluse e può avere costi se le superi.</span></div>
          </section>

        </section>

      </main>

      <nav class="tabbar" aria-label="Navigazione principale">
        <button class="tab" :class="{ on: section === 'today' }" @click="switchTo('today')"><Sun :size="20" /><span>Oggi</span><i class="tab-dot"></i></button>
        <button class="tab" :class="{ on: section === 'calendar' }" @click="switchTo('calendar')"><CalendarDays :size="20" /><span>Calendario</span><i class="tab-dot"></i></button>
        <button class="tab-add" aria-label="Scrivi quello che devi fare" @click="openCapture"><PenLine :size="24" /></button>
        <button class="tab" :class="{ on: section === 'projects' }" @click="switchTo('projects')"><Target :size="20" /><span>Progetti</span><i class="tab-dot"></i></button>
        <button class="tab" :class="{ on: section === 'notes' }" @click="switchTo('notes')"><NotebookPen :size="20" /><span>Note</span><i class="tab-dot"></i></button>
      </nav>
    </div>

    <!-- scrivere quello che c'è da fare -->
    <div v-if="showCapture" class="backdrop" @click.self="showCapture = false">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h2>Scrivi la giornata</h2>
            <p>Come viene. Riconosco date, orari e priorità.</p>
          </div>
          <button class="ghost-round" aria-label="Chiudi" @click="showCapture = false"><X :size="18" /></button>
        </div>
        <textarea v-model="captureInput" rows="5" class="composer-input" autofocus placeholder="oggi la spesa e chiamare Marco&#10;domani alle 15 il dentista&#10;! finire la presentazione"></textarea>
        <p class="capture-tip">Una cosa per riga, oppure separale con una virgola. La data vale anche per quelle che seguono.</p>
        <div v-if="captureNotes.length" class="capture-unread">
          <strong>Queste non le ho capite</strong>
          <span v-for="note in captureNotes" :key="note">{{ note }}</span>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-soft" @click="showCapture = false">Chiudi</button>
          <button class="btn" :disabled="!captureInput.trim()" @click="runCapture">Leggi</button>
        </div>
      </section>
    </div>

    <!-- cosa fare con una singola attività -->
    <div v-if="taskSheet" class="backdrop" @click.self="taskSheet = null">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h2>{{ taskSheet.title }}</h2>
            <p>{{ [taskSheet.date === todayKey ? 'Oggi' : longDate(new Date(`${taskSheet.date}T12:00:00`)), formatTime(taskSheet.time) || 'quando vuoi'].join(' · ') }}</p>
          </div>
          <button class="ghost-round" aria-label="Chiudi" @click="taskSheet = null"><X :size="18" /></button>
        </div>
        <button class="sheet-link" @click="updateTask(taskSheet, { done: !taskSheet.done }, taskSheet.done ? 'Riaperta' : 'Fatta!')">
          <span class="row-icon tone-mint"><Check :size="18" /></span>
          <div><strong>{{ taskSheet.done ? 'Riapri' : 'Segna come fatta' }}</strong></div>
        </button>
        <button class="sheet-link" @click="switchPriority(taskSheet)">
          <span class="row-icon tone-peach"><Flag :size="18" /></span>
          <div><strong>{{ taskSheet.priority ? 'Togli dalle priorità' : 'Rendila una priorità' }}</strong><small>Al massimo tre al giorno</small></div>
        </button>
        <button class="sheet-link" @click="moveToTomorrow(taskSheet)">
          <span class="row-icon tone-sky"><ArrowRight :size="18" /></span>
          <div><strong>Sposta a domani</strong></div>
        </button>
        <button class="sheet-link danger-link" @click="deleteTask(taskSheet)">
          <span class="row-icon tone-rose"><Trash2 :size="18" /></span>
          <div><strong>Elimina</strong><small>Sparisce dall’agenda</small></div>
        </button>
      </section>
    </div>

    <!-- riassunti delle email importanti segnalate da Claude -->
    <div v-if="showMailbox" class="backdrop" @click.self="showMailbox = false">
      <section class="sheet mail-sheet">
        <div class="sheet-grip"></div>
        <div class="mail-head">
          <div>
            <h2>{{ showArchive ? 'Archivio email' : 'Email di oggi' }}</h2>
            <p>{{ showArchive ? 'Le email già passate. Se elimini l’archivio non le rivedi più da qui.' : 'Cosa dicono le email che Claude ti segnala. A fine giornata finiscono in archivio da sole.' }}</p>
          </div>
          <button class="ghost-round" aria-label="Chiudi" @click="showMailbox = false"><X :size="18" /></button>
        </div>

        <!-- due pagine: si cambia toccando o trascinando di lato -->
        <div class="seg" role="tablist">
          <button class="seg-btn" :class="{ on: !showArchive }" role="tab" :aria-selected="!showArchive" @click="openArchive(false)">
            Oggi<i v-if="mailCount">{{ mailCount }}</i>
          </button>
          <button class="seg-btn" :class="{ on: showArchive }" role="tab" :aria-selected="showArchive" @click="openArchive(true)">
            Archivio<i v-if="archiveCount">{{ archiveCount }}</i>
          </button>
        </div>

        <div
          class="mail-scroll"
          :class="mailSlide"
          :key="showArchive ? 'archivio' : 'oggi'"
          @touchstart.passive="mailTouchStart"
          @touchend.passive="mailTouchEnd"
        >
          <template v-if="!showArchive">
            <p v-if="mailNote" class="mail-note">{{ mailNote }}</p>
            <article v-for="mail in mailLive" :key="mail.id" class="mail-card">
              <div class="mail-card-top">
                <span class="row-icon tone-sky"><Mail :size="16" /></span>
                <span class="mail-chips">
                  <span v-for="chip in mailChips(mail)" :key="chip.text" class="mail-chip" :class="{ 'is-urgent': chip.urgent }">{{ chip.text }}</span>
                </span>
              </div>
              <p class="mail-summary">{{ mail.riassunto || mail.motivo }}</p>
              <p v-if="mail.riassunto && mail.motivo" class="mail-why">{{ mail.motivo }}</p>
              <div class="mail-actions">
                <a v-if="mail.link" class="mail-act is-open" :href="mail.link" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" /> Vedi email</a>
                <button class="mail-act" @click="mailToTask(mail)"><ListTodo :size="15" /> Fanne un’attività</button>
                <button class="mail-act" @click="archiveMail(mail.id)"><Archive :size="15" /> Archivia</button>
              </div>
            </article>
            <div v-if="!mailLive.length" class="empty">
              <strong>Niente di nuovo oggi</strong>
              <p>Quando chiedi a Claude di guardare la posta, qui trovi il riassunto di cosa dicono le email.</p>
            </div>
          </template>
          <template v-else>
            <article v-for="mail in mailArchived" :key="mail.id" class="mail-card">
              <div class="mail-card-top">
                <span class="row-icon tone-sky"><Archive :size="16" /></span>
                <span class="mail-chips">
                  <span v-for="chip in mailChips(mail)" :key="chip.text" class="mail-chip">{{ chip.text }}</span>
                </span>
              </div>
              <p class="mail-summary">{{ mail.riassunto || mail.motivo }}</p>
              <div v-if="mail.link" class="mail-actions">
                <a class="mail-act is-open" :href="mail.link" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" /> Vedi email</a>
              </div>
            </article>
            <div v-if="!mailArchived.length" class="empty">
              <strong>Archivio vuoto</strong>
              <p>Qui finiscono i riassunti delle giornate passate e quelli che archivi tu.</p>
            </div>
          </template>
        </div>

        <p v-if="confirmArchiveWipe" class="mail-warn">Elimino {{ archiveCount }} {{ archiveCount === 1 ? 'email archiviata' : 'email archiviate' }}: da DAYLY non le rivedi più. Tocca di nuovo per confermare.</p>
        <div class="mail-foot">
          <button v-if="!showArchive" class="btn btn-soft" :disabled="!mailLive.length" @click="archiveAllMails"><Archive :size="16" /> Archivia tutte</button>
          <button v-else class="btn btn-soft" :disabled="!mailArchived.length" @click="deleteArchive"><Trash2 :size="16" /> {{ confirmArchiveWipe ? 'Confermo' : 'Elimina' }}</button>
          <button class="btn" @click="showMailbox = false"><Check :size="16" /> Chiudi</button>
        </div>
      </section>
    </div>

    <!-- anteprima: cattura veloce e proposte di Claude -->
    <div v-if="pending.length" class="backdrop" @click.self="dismissPending">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h2>{{ pendingSource.length ? 'Claude propone' : pendingMail ? 'Dall’email' : 'Sto per inserire' }}</h2>
            <p>Togli quello che non ti serve, poi conferma.</p>
          </div>
          <button class="ghost-round" aria-label="Chiudi" @click="dismissPending"><X :size="18" /></button>
        </div>
        <div class="list">
          <div v-for="change in pending" :key="change.id" class="row">
            <span class="row-icon" :class="`tone-${pendingTone(change)}`"><component :is="pendingIcon(change)" :size="18" /></span>
            <span class="row-body">
              <span class="type-label" :class="`label-${pendingTone(change)}`">{{ pendingKind(change) }}</span>
              <span class="row-title">{{ pendingTitle(change) }}</span>
              <span class="row-meta">{{ pendingMeta(change) }}</span>
            </span>
            <button class="ghost-round" :aria-label="`Togli ${pendingTitle(change)}`" @click="discardPending(change.id)"><X :size="16" /></button>
          </div>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-soft" @click="dismissPending">{{ pendingSource.length ? 'Rifiuta' : 'Annulla' }}</button>
          <button class="btn" @click="applyPending"><Check :size="16" /> Conferma {{ pending.length }}</button>
        </div>
      </section>
    </div>

    <!-- foglio di inserimento -->
    <div v-if="modal && modal !== 'backup'" class="backdrop" @click.self="modal = null">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <form @submit.prevent="saveForm">
          <div class="sheet-head">
            <div>
              <h2>{{ modal === 'task' ? 'Nuovo impegno' : modal === 'project' ? 'Nuovo progetto' : 'Nuova idea' }}</h2>
              <p>{{ modal === 'task' ? 'Con un orario diventa un appuntamento, senza resta flessibile.' : modal === 'project' ? 'Qualcosa che cresce nel tempo, con una percentuale di avanzamento.' : 'Un appunto veloce, senza doverci pensare adesso.' }}</p>
            </div>
            <button type="button" class="ghost-round" aria-label="Chiudi" @click="modal = null"><X :size="18" /></button>
          </div>

          <label class="field-label" for="entry-title">{{ modal === 'task' ? 'Cosa vuoi ricordarti?' : 'Dagli un nome' }}</label>
          <input id="entry-title" class="input" v-model="form.title" autofocus required
            :placeholder="modal === 'task' ? 'Es. Preparare la presentazione' : modal === 'project' ? 'Es. Imparare qualcosa di nuovo' : 'Es. Un’idea per il weekend'" />

          <template v-if="modal === 'task'">
            <label class="field-label" for="entry-date">Quando?</label>
            <div class="date-time-row">
              <input id="entry-date" class="input" v-model="form.date" type="date" />
              <input class="input" v-model="form.time" type="time" aria-label="Orario (facoltativo)" />
            </div>
            <label class="check-label"><input v-model="form.priority" type="checkbox" /> È una delle mie tre priorità</label>
            <template v-if="state.projects.length">
              <label class="field-label" for="entry-project">Collega a un progetto</label>
              <select id="entry-project" class="input" v-model="form.projectId">
                <option value="">Nessun progetto</option>
                <option v-for="project in state.projects" :key="project.id" :value="project.id">{{ project.title }}</option>
              </select>
            </template>
          </template>

          <template v-else>
            <label class="field-label" for="entry-notes">Una nota (facoltativa)</label>
            <textarea id="entry-notes" class="notes" v-model="form.notes" placeholder="Aggiungi un piccolo dettaglio…"></textarea>
          </template>

          <template v-if="modal === 'project'">
            <label class="field-label" for="entry-progress">Progresso iniziale · {{ form.progress }}%</label>
            <input id="entry-progress" class="range" v-model="form.progress" type="range" min="0" max="100" step="5" :style="{ background: `linear-gradient(90deg, var(--pill) ${form.progress}%, var(--line) ${form.progress}%)` }" />
            <label class="field-label" for="entry-kind">Tipo</label>
            <select id="entry-kind" class="input" v-model="form.kind">
              <option>Progetto personale</option>
              <option>Obiettivo</option>
            </select>
          </template>

          <div class="sheet-actions">
            <button type="button" class="btn btn-soft" @click="modal = null">Annulla</button>
            <button type="submit" class="btn"><Check :size="16" /> Salva</button>
          </div>
        </form>
      </section>
    </div>

    <!-- foglio impostazioni e backup -->
    <div v-if="toast" class="toast"><CheckCircle2 :size="17" /> {{ toast }}</div>
  </div>
</template>
