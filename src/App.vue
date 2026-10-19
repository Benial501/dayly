<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowDownToLine, ArrowLeft, ArrowRight, PenLine, RefreshCw, Sparkles, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, CloudOff, Compass, Flag, Heart, Lightbulb, ListTodo, MessageCircle, Moon, MoreHorizontal, Plus, Settings2, Sun, Target, Trash2, Upload, X } from 'lucide-vue-next'
import { readAll, put, remove, replaceAll } from './db'

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

onMounted(async () => { await loadInitialState(); loading.value = false })

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
function switchTo(id) { section.value = id; showSheet.value = false }
function ping(message) { toast.value = message; window.setTimeout(() => { toast.value = '' }, 2600) }
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
async function toggleTask(task) { await put('tasks', { ...task, done: !task.done }); await refreshAndSync() }
async function deleteItem(store, item) { await remove(store, item.id); await refreshAndSync(); ping('Elemento eliminato') }
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
const showSheet = ref(false)
const selectedDate = ref(selectedDateDefault())
const projectFilter = ref('all')
const isOnline = ref(navigator.onLine)

window.addEventListener('online', () => { isOnline.value = true })
window.addEventListener('offline', () => { isOnline.value = false })

const openFree = computed(() => untimedTasks.value.filter(task => !task.done))
const prioritySlots = computed(() => [0, 1, 2].map(index => priorities.value[index] || null))
const nextAppointment = computed(() => {
  const now = new Date()
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const open = appointments.value.filter(task => !task.done)
  return open.find(task => task.time >= clock) || open[0] || null
})
const syncState = computed(() => {
  if (proposalCount.value) return { label: `Claude ha ${proposalCount.value} ${proposalCount.value === 1 ? 'proposta' : 'proposte'} per te`, tone: 'violet', icon: Sparkles }
  if (!isOnline.value) return { label: 'Offline · le funzioni locali restano attive', tone: 'peach', icon: CloudOff }
  if (/ricarica|verificare/i.test(syncLabel.value)) return { label: 'Dati cambiati altrove · ricarica prima di modificare', tone: 'peach', icon: CloudOff }
  if (cloudSettings()) return { label: syncLabel.value, tone: 'mint', icon: CheckCircle2 }
  return { label: 'Salvato solo su questo iPhone', tone: 'violet', icon: CloudOff }
})

const filteredProjects = computed(() => {
  if (projectFilter.value === 'open') return state.value.projects.filter(p => Number(p.progress) < 100)
  if (projectFilter.value === 'done') return state.value.projects.filter(p => Number(p.progress) >= 100)
  return state.value.projects
})
const selectedTasks = computed(() => state.value.tasks.filter(task => task.date === selectedDate.value).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')))
const selectedDayLabel = computed(() => selectedDate.value === todayKey ? 'Oggi' : longDate(new Date(`${selectedDate.value}T12:00:00`)))
const monthLabel = computed(() => new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(weekDays.value[3]))
const quickAddLabel = computed(() => section.value === 'projects' ? 'Nuovo progetto' : section.value === 'ideas' ? 'Nuova idea' : 'Nuovo impegno')

const appointmentGroup = {
  id: 'time',
  title: 'Appuntamenti',
  sub: 'Impegni con un orario fisso',
  cta: 'Aggiungi un appuntamento',
  emptyTitle: 'Nessun appuntamento',
  emptyText: 'Qui finisce tutto ciò che ha un’ora precisa. Va bene anche lasciare spazio vuoto.',
  tone: 'sky',
  icon: Clock3,
}
const freeGroup = {
  id: 'free',
  title: 'Quando vuoi',
  sub: 'Attività senza orario, le sposti come viene',
  cta: 'Aggiungi un’attività',
  emptyTitle: 'Nessuna attività senza orario',
  emptyText: 'Le attività senza orario restano libere: le fai quando capita, senza sentirti in ritardo.',
  tone: 'violet',
  icon: ListTodo,
}
const todayGroups = computed(() => [
  { ...appointmentGroup, items: appointments.value, add: { date: todayKey, time: '09:00' } },
  { ...freeGroup, items: untimedTasks.value, add: { date: todayKey } },
])
const selectedGroups = computed(() => [
  { ...appointmentGroup, items: selectedTasks.value.filter(task => task.time), add: { date: selectedDate.value, time: '09:00' } },
  { ...freeGroup, items: selectedTasks.value.filter(task => !task.time), add: { date: selectedDate.value } },
])

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
function slotLabel(index) { return ['Scegli la prima priorità', 'Scegli la seconda', 'Scegli la terza'][index] }
function completedWord(count) { return Number(count) === 1 ? 'completata' : 'completate' }

/* ───────────────────────────────────────────────────────────
   Cattura veloce: scrivi in italiano, DAYLY riconosce da sola
   data, orario, priorità e progetti. Nessuna rete, nessun costo.
   ─────────────────────────────────────────────────────────── */
const captureInput = ref('')
const pending = ref([])
const captureNotes = ref([])
const captureExamples = [
  'domani alle 15 dentista',
  '! chiamare Marco',
  'giovedì 9:30 presentazione per il cliente',
]

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
    .split(/\n|;|,?\s+(?:e\s+)?poi\s+|,\s*(?:e\s+)?poi\s+/i)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function parseCaptureLine(line) {
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

  let date = ''
  const flat = plain(rest)
  const dayMonth = rest.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/)
  const writtenDate = flat.match(/\b(?:il\s+)?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/)
  const weekday = flat.match(/\b(?:il\s+|di\s+)?(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato)\b/)

  if (/\bdopodomani\b/.test(flat)) { date = dayAfter(2); rest = rest.replace(/\bdopodomani\b/gi, ' ') }
  else if (/\bdomani\b/.test(flat)) { date = dayAfter(1); rest = rest.replace(/\bdomani\b/gi, ' ') }
  else if (/\boggi\b/.test(flat)) { date = todayKey; rest = rest.replace(/\boggi\b/gi, ' ') }
  else if (writtenDate) { date = monthDay(Number(writtenDate[1]), MONTHS[writtenDate[2]]); rest = rest.replace(new RegExp(`\\b(?:il\\s+)?${writtenDate[1]}\\s+\\S+`, 'i'), ' ') }
  else if (dayMonth) { date = monthDay(Number(dayMonth[1]), Number(dayMonth[2]) - 1); rest = rest.replace(dayMonth[0], ' ') }
  else if (weekday) {
    date = nextWeekday(WEEKDAYS[weekday[1]])
    rest = rest.replace(new RegExp(`(?:\\b(?:il|di)\\s+)?${WEEKDAY_PATTERNS[weekday[1]]}(?:\\s+prossim[oa])?`, 'i'), ' ')
  }
  else {
    const bareDay = flat.match(/\bil\s+(\d{1,2})\b/)
    if (bareDay) { date = monthDay(Number(bareDay[1])); rest = rest.replace(/\bil\s+\d{1,2}\b/i, ' ') }
  }

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
  if (!/[a-z\u00e0-\u00ff]{2}/i.test(title)) return null
  title = title.charAt(0).toUpperCase() + title.slice(1)

  return {
    tipo: 'aggiungi_attivita',
    titolo: title.slice(0, 160),
    data: date || todayKey,
    ora: time,
    priorita: priority,
    progetto: project?.title || '',
    progresso: 0,
  }
}

function runCapture() {
  const lines = splitCapture(captureInput.value)
  if (!lines.length) return
  const parsed = []
  const skipped = []
  for (const line of lines) {
    const change = parseCaptureLine(line)
    if (change) parsed.push({ ...change, id: newId(), origine: 'locale' })
    else skipped.push(line)
  }
  pending.value = parsed
  captureNotes.value = skipped
  if (parsed.length) captureInput.value = ''
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
  if (sources.length) { await clearProposals(sources); ping('Proposte rifiutate') }
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
  pending.value = []
  pendingSource.value = []
  if (sources.length) await clearProposals(sources)
  await refreshAndSync()
  ping(applied ? `${applied} ${applied === 1 ? 'cosa aggiunta' : 'cose aggiunte'}` : 'Non sono riuscito ad aggiungere nulla')
}
function quickAdd() {
  if (section.value === 'projects') return beginAdd('project')
  if (section.value === 'ideas') return beginAdd('idea')
  if (section.value === 'calendar') return beginAdd('task', { date: selectedDate.value })
  beginAdd('task', { date: todayKey })
}
</script>


<template>
  <div class="app">
    <div class="phone">
      <header class="appbar">
        <div class="appbar-id">
          <img class="avatar" src="/logo.jpg" alt="" />
          <div>
            <span class="appbar-kicker">{{ greeting }}</span>
            <strong>Christian</strong>
          </div>
        </div>
        <button class="round-btn" aria-label="Impostazioni e backup" @click="beginAdd('backup')">
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

          <button class="status-row" :class="`status-${syncState.tone}`" @click="proposalCount ? openClaudeProposals() : beginAdd('backup')">
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

          <button class="capture-shortcut" @click="switchTo('capture')">
            <span class="row-icon tone-violet"><PenLine :size="18" /></span>
            <span>
              <strong>Scrivi più cose insieme</strong>
              <small>«domani alle 15 dentista» e le metto in agenda</small>
            </span>
            <ChevronRight :size="18" />
          </button>

          <section class="card status-card">
            <div class="ring" :style="{ '--p': `${progressToday}%` }"><span>{{ progressToday }}<small>%</small></span></div>
            <div class="status-lines">
              <strong>{{ doneToday }} di {{ todayTasks.length }} {{ completedWord(doneToday) }}</strong>
              <div class="status-line">
                <Clock3 :size="15" />
                <span v-if="nextAppointment">Il prossimo alle <strong>{{ formatTime(nextAppointment.time) }}</strong>, {{ nextAppointment.title }}</span>
                <span v-else>Nessun appuntamento in agenda</span>
              </div>
              <div class="status-line">
                <ListTodo :size="15" />
                <span><strong>{{ openFree.length }}</strong> {{ openFree.length === 1 ? 'cosa' : 'cose' }} da fare quando vuoi</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Le tre priorità<span class="head-sub">Le poche cose che vuoi portare a casa oggi</span></h2>
            </div>
            <div class="list">
              <template v-for="(task, index) in prioritySlots" :key="index">
                <button v-if="task" class="row" :class="{ 'is-done': task.done }" @click="toggleTask(task)">
                  <span class="row-rank">0{{ index + 1 }}</span>
                  <span class="row-body">
                    <span class="type-label" :class="`label-${taskKind(task).tone}`">{{ taskKind(task).label }}</span>
                    <span class="row-title">{{ task.title }}</span>
                    <span class="row-meta">{{ [formatTime(task.time) || 'Senza orario', projectName(task.projectId)].filter(Boolean).join(' · ') }}</span>
                  </span>
                  <span class="check" :class="{ on: task.done }"><Check :size="14" /></span>
                </button>
                <button v-else class="row row-slot" @click="beginAdd('task', { priority: true })">
                  <span class="row-rank">0{{ index + 1 }}</span>
                  <span class="row-body"><span class="row-title slot-title">{{ slotLabel(index) }}</span></span>
                  <span class="slot-plus"><Plus :size="15" /></span>
                </button>
              </template>
            </div>
          </section>

          <section v-for="group in todayGroups" :key="group.id" class="card">
            <div class="card-head">
              <h2>{{ group.title }}<span class="head-sub">{{ group.sub }}</span></h2>
              <button class="add-round" :aria-label="group.cta" @click="beginAdd('task', group.add)"><Plus :size="17" /></button>
            </div>
            <div v-if="group.items.length" class="list">
              <button v-for="task in group.items" :key="task.id" class="row" :class="{ 'is-done': task.done }" @click="toggleTask(task)">
                <span class="row-icon" :class="`tone-${taskKind(task).tone}`"><component :is="taskKind(task).icon" :size="18" /></span>
                <span class="row-body">
                  <span v-if="task.priority" class="type-line"><span class="pill-priority"><Flag :size="10" /> Priorità</span></span>
                  <span class="row-title">{{ task.title }}</span>
                  <span v-if="rowMeta(task)" class="row-meta">{{ rowMeta(task) }}</span>
                </span>
                <span class="check" :class="{ on: task.done }"><Check :size="14" /></span>
              </button>
            </div>
            <div v-else class="empty">
              <span class="empty-art" :class="`tone-${group.tone}`"><component :is="group.icon" :size="22" /></span>
              <strong>{{ group.emptyTitle }}</strong>
              <p>{{ group.emptyText }}</p>
              <button class="btn" @click="beginAdd('task', group.add)"><Plus :size="16" /> {{ group.cta }}</button>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Il focus della settimana<span class="head-sub">L’intenzione a cui tornare quando la giornata si affolla</span></h2>
              <button class="ghost-round" aria-label="Apri i riepiloghi" @click="switchTo('review')"><ChevronRight :size="18" /></button>
            </div>
            <p class="project-note">{{ lastReview?.focus || 'Non ne hai ancora scelto uno. Basta una parola: la ritrovi qui ogni giorno.' }}</p>
            <button class="add-line" @click="switchTo('review')">{{ lastReview?.focus ? 'Rivedi il focus' : 'Scegli il tuo focus' }}</button>
          </section>

          <section class="quote-card">
            <Heart :size="20" style="flex:none;margin-top:2px" />
            <p>Non serve fare tutto.<br /><strong>Serve fare il prossimo passo.</strong></p>
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
            <p class="cal-caption">{{ selectedDayLabel }} · {{ selectedTasks.length ? `${selectedTasks.filter(t => t.done).length} di ${selectedTasks.length} ${completedWord(selectedTasks.filter(t => t.done).length)}` : 'giornata libera' }}</p>
          </section>

          <section v-for="group in selectedGroups" :key="group.id" class="card">
            <div class="card-head">
              <h2>{{ group.title }}<span class="head-sub">{{ group.sub }}</span></h2>
              <button class="add-round" :aria-label="group.cta" @click="beginAdd('task', group.add)"><Plus :size="17" /></button>
            </div>
            <div v-if="group.items.length" class="list">
              <button v-for="task in group.items" :key="task.id" class="row" :class="{ 'is-done': task.done }" @click="toggleTask(task)">
                <span class="row-icon" :class="`tone-${taskKind(task).tone}`"><component :is="taskKind(task).icon" :size="18" /></span>
                <span class="row-body">
                  <span v-if="task.priority" class="type-line"><span class="pill-priority"><Flag :size="10" /> Priorità</span></span>
                  <span class="row-title">{{ task.title }}</span>
                  <span v-if="rowMeta(task)" class="row-meta">{{ rowMeta(task) }}</span>
                </span>
                <span class="check" :class="{ on: task.done }"><Check :size="14" /></span>
              </button>
            </div>
            <div v-else class="empty">
              <span class="empty-art" :class="`tone-${group.tone}`"><component :is="group.icon" :size="22" /></span>
              <strong>{{ group.emptyTitle }}</strong>
              <p>{{ group.emptyText }}</p>
              <button class="btn" @click="beginAdd('task', group.add)"><Plus :size="16" /> {{ group.cta }}</button>
            </div>
          </section>
        </section>

        <section v-else-if="section === 'capture'" class="page">
          <div class="page-head">
            <p class="date-line">Una riga per cosa</p>
            <h1 class="page-title">Cattura veloce</h1>
            <p class="page-sub">Scrivi come viene. DAYLY riconosce data, orario e priorità, poi confermi tu.</p>
          </div>

          <section class="card">
            <textarea v-model="captureInput" rows="5" class="composer-input" placeholder="domani alle 15 dentista&#10;! chiamare Marco&#10;giovedì 9:30 presentazione"></textarea>
            <button class="btn btn-block" style="margin-top:14px" :disabled="!captureInput.trim()" @click="runCapture">Leggi quello che ho scritto</button>
          </section>

          <section v-if="captureNotes.length" class="card">
            <div class="card-head"><h2>Non ho capito queste righe<span class="head-sub">Riscrivile o aggiungile a mano</span></h2></div>
            <p v-for="note in captureNotes" :key="note" class="unread-line">{{ note }}</p>
          </section>

          <section class="card">
            <div class="card-head"><h2>Cosa riconosce<span class="head-sub">Una riga per cosa, oppure separa con «poi»</span></h2></div>
            <div class="legend"><span class="legend-key">oggi · domani · dopodomani</span><span>la data</span></div>
            <div class="legend"><span class="legend-key">giovedì · 24 ottobre · 24/10</span><span>il giorno preciso</span></div>
            <div class="legend"><span class="legend-key">alle 15 · 9:30 · ore 18</span><span>l’orario, che la rende un appuntamento</span></div>
            <div class="legend"><span class="legend-key">! all’inizio · priorità</span><span>una delle tre del giorno</span></div>
            <div class="legend"><span class="legend-key">il nome di un progetto</span><span>la collega a quel progetto</span></div>
            <div class="legend"><span class="legend-key">tedesco al 60%</span><span>aggiorna la percentuale, senza creare attività</span></div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Prova così</h2></div>
            <div class="chat-hint">
              <button v-for="example in captureExamples" :key="example" class="chat-example" @click="captureInput = captureInput.trim() ? `${captureInput.trim()}\n${example}` : example">{{ example }}</button>
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
        <section v-else-if="section === 'ideas'" class="page">
          <div class="page-head">
            <p class="date-line">Prima che scappino</p>
            <h1 class="page-title">Idee</h1>
            <p class="page-sub">Appunti veloci, senza dover decidere subito cosa farne.</p>
          </div>

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
        </section>

        <!-- ─────────── RIEPILOGHI ─────────── -->
        <section v-else-if="section === 'review'" class="page">
          <div class="page-head">
            <p class="date-line">Un momento per te</p>
            <h1 class="page-title">Riepiloghi</h1>
            <p class="page-sub">Piccole riflessioni, senza giudizio.</p>
          </div>

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
        </section>

        <!-- ─────────── ASSISTENTE ─────────── -->
        <section v-else-if="section === 'assistant'" class="page">
          <div class="page-head">
            <p class="date-line">Un pensiero in più</p>
            <h1 class="page-title">Claude</h1>
            <p class="page-sub">Collega DAYLY a Claude per farti aiutare con agenda, progetti e idee.</p>
          </div>

          <section class="card">
            <div class="card-head">
              <h2>Collegamento personale<span class="head-sub">{{ cloudSettings() ? syncLabel : 'Non ancora attivo' }}</span></h2>
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

            <button class="btn btn-soft btn-block" style="margin-top:14px" :disabled="proposalsBusy || !cloudSettings()" @click="fetchProposals(true)">
              <RefreshCw :size="16" /> {{ proposalsBusy ? 'Controllo…' : 'Controlla se ci sono proposte' }}
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
          </section>

          <section class="card">
            <div class="card-head"><h2>Le scelte restano tue</h2></div>
            <div class="note-line"><CheckCircle2 :size="16" /><span>I dati vengono cifrati prima della sincronizzazione.</span></div>
            <div class="note-line"><CheckCircle2 :size="16" /><span>Nessuna chiave API a pagamento dentro l’app.</span></div>
            <div class="note-line"><CheckCircle2 :size="16" /><span>Puoi revocare il collegamento da qui, quando vuoi.</span></div>
            <div class="warn-box"><CloudOff :size="16" /><span>Il backup JSON è in chiaro e non contiene la chiave di sincronizzazione: conservalo con cura. Lo spazio Vercel Blob ha quote mensili incluse e può avere costi se le superi.</span></div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Nella tua giornata</h2></div>
            <div class="stat-row"><ListTodo :size="17" /><span>Attività</span><strong>{{ state.tasks.length }}</strong></div>
            <div class="stat-row"><Target :size="17" /><span>Progetti</span><strong>{{ state.projects.length }}</strong></div>
            <div class="stat-row"><Lightbulb :size="17" /><span>Idee</span><strong>{{ state.ideas.length }}</strong></div>
          </section>
        </section>
      </main>

      <nav class="tabbar" aria-label="Navigazione principale">
        <button class="tab" :class="{ on: section === 'today' }" @click="switchTo('today')"><Sun :size="20" /><span>Oggi</span><i class="tab-dot"></i></button>
        <button class="tab" :class="{ on: section === 'calendar' }" @click="switchTo('calendar')"><CalendarDays :size="20" /><span>Calendario</span><i class="tab-dot"></i></button>
        <button class="tab-add" :aria-label="quickAddLabel" @click="quickAdd"><Plus :size="26" /></button>
        <button class="tab" :class="{ on: section === 'projects' }" @click="switchTo('projects')"><Target :size="20" /><span>Progetti</span><i class="tab-dot"></i></button>
        <button class="tab" :class="{ on: ['ideas', 'review', 'assistant'].includes(section) }" @click="showSheet = true"><MoreHorizontal :size="20" /><span>Altro</span><i class="tab-dot"></i></button>
      </nav>
    </div>

    <!-- foglio «Altro» -->
    <div v-if="showSheet" class="backdrop" @click.self="showSheet = false">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h2>Altro</h2>
            <p>Il resto del tuo spazio.</p>
          </div>
          <button class="ghost-round" aria-label="Chiudi" @click="showSheet = false"><X :size="18" /></button>
        </div>
        <button class="sheet-link" @click="switchTo('capture')">
          <span class="row-icon tone-violet"><PenLine :size="18" /></span>
          <div><strong>Cattura veloce</strong><small>Scrivi più cose insieme, le metto in agenda</small></div>
          <ChevronRight class="go" :size="18" />
        </button>
        <button class="sheet-link" @click="switchTo('ideas')">
          <span class="row-icon tone-mint"><Lightbulb :size="18" /></span>
          <div><strong>Idee</strong><small>Appunti veloci da riprendere con calma</small></div>
          <ChevronRight class="go" :size="18" />
        </button>
        <button class="sheet-link" @click="switchTo('review')">
          <span class="row-icon tone-violet"><Moon :size="18" /></span>
          <div><strong>Riepiloghi</strong><small>La riflessione di oggi e il focus della settimana</small></div>
          <ChevronRight class="go" :size="18" />
        </button>
        <button class="sheet-link" @click="switchTo('assistant')">
          <span class="row-icon tone-sky"><MessageCircle :size="18" /></span>
          <div><strong>Claude</strong><small>Collega l’assistente ai tuoi dati cifrati</small></div>
          <ChevronRight class="go" :size="18" />
        </button>
        <button class="sheet-link" @click="showSheet = false; beginAdd('backup')">
          <span class="row-icon tone-peach"><Settings2 :size="18" /></span>
          <div><strong>Impostazioni e backup</strong><small>{{ cloudSettings() ? 'Locale · copia cifrata online' : 'Dati salvati solo su questo iPhone' }}</small></div>
          <ChevronRight class="go" :size="18" />
        </button>
      </section>
    </div>

    <!-- anteprima: cattura veloce e proposte di Claude -->
    <div v-if="pending.length" class="backdrop" @click.self="dismissPending">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h2>{{ pendingSource.length ? 'Claude propone' : 'Sto per inserire' }}</h2>
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
    <div v-if="modal === 'backup'" class="backdrop" @click.self="modal = null">
      <section class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h2>Impostazioni e backup</h2>
            <p>Attività, progetti, idee e riflessioni sono salvati su questo dispositivo.</p>
          </div>
          <button class="ghost-round" aria-label="Chiudi" @click="modal = null"><X :size="18" /></button>
        </div>

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
        <button class="backup-row" @click="modal = null; switchTo('assistant')">
          <span><MessageCircle :size="18" /></span>
          <div><strong>Collegamento Claude</strong><small>{{ cloudSettings() ? syncLabel : 'Non ancora attivo' }}</small></div>
          <ChevronRight :size="17" />
        </button>

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
    </div>

    <div v-if="toast" class="toast"><CheckCircle2 :size="17" /> {{ toast }}</div>
  </div>
</template>
