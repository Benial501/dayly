<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, Clock3, CloudOff, Compass, Download, Flag, Heart, Lightbulb, ListTodo, Menu, MessageCircle, Moon, MoreHorizontal, Plus, Send, Settings2, Sparkles, Sun, Target, Trash2, Upload, X } from 'lucide-vue-next'
import { readAll, put, remove, replaceAll } from './db'

const nav = [
  { id: 'today', label: 'Oggi', icon: Sun }, { id: 'calendar', label: 'Calendario', icon: CalendarDays },
  { id: 'projects', label: 'Progetti', icon: Target }, { id: 'ideas', label: 'Idee', icon: Lightbulb },
  { id: 'review', label: 'Riepiloghi', icon: Moon }, { id: 'assistant', label: 'Assistente', icon: MessageCircle },
]
const section = ref('today')
const state = ref({ tasks: [], projects: [], ideas: [], reviews: [], settings: [] })
const loading = ref(true)
const modal = ref(null)
const form = ref({})
const toast = ref('')
const showMobileNav = ref(false)
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
function switchTo(id) { section.value = id; showMobileNav.value = false }
function ping(message) { toast.value = message; window.setTimeout(() => { toast.value = '' }, 2600) }
function beginAdd(type, extra = {}) {
  form.value = { title: '', date: todayKey, time: '', priority: false, done: false, progress: 0, color: '#bdebf0', notes: '', ...extra }
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
function sectionTitle(id = section.value) { return nav.find(item => item.id === id)?.label || 'Oggi' }
function shortDate(date) { return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' }).format(date) }
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
function dateTasks(d) { return tasksOn(d).length ? tasksOn(d).map(t => `${t.time ? `${t.time} · ` : ''}${t.title}`).join('\n') : 'Nessun impegno per ora' }

const todayReview = computed(() => state.value.reviews.find(item => item.id === `day-${todayKey}`))
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="switchTo('today')"><img class="brand-mark" src="/logo.jpg" alt="" /><span>dayly<span class="brand-dot">.</span></span></a>
      <div class="side-caption">IL TUO SPAZIO</div>
      <nav class="nav-list" aria-label="Navigazione principale">
        <button v-for="item in nav" :key="item.id" class="nav-item" :class="{ active: section === item.id }" @click="switchTo(item.id)">
          <component :is="item.icon" :size="18" :stroke-width="1.8" /><span>{{ item.label }}</span><span v-if="item.id === 'today' && priorities.length" class="nav-count">{{ priorities.length }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="week-card"><div class="week-card-icon"><Compass :size="17" /></div><div><strong>Un passo alla volta</strong><span>La tua settimana, con calma</span></div><ArrowUpRight :size="15" /></div>
        <div class="local-note"><span class="online-dot"></span><span>{{ syncLabel }}</span></div>
        <button class="nav-item settings-link" @click="beginAdd('backup')"><Settings2 :size="18" /><span>Impostazioni e backup</span></button>
        <div class="profile"><div class="avatar">C</div><div class="profile-text"><strong>Il mio spazio</strong><span>Solo per te</span></div><MoreHorizontal :size="18" /></div>
      </div>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <button class="mobile-menu" aria-label="Apri menu" @click="showMobileNav = !showMobileNav"><Menu :size="20" /></button>
        <div class="breadcrumb">I miei spazi <span>/</span> <strong>{{ sectionTitle() }}</strong></div>
        <div class="top-actions"><span class="offline-pill"><CloudOff :size="14" /> Offline pronto</span><button class="top-add" @click="beginAdd('task')"><Plus :size="16" /><span>Nuova attività</span></button></div>
      </header>
      <div v-if="showMobileNav" class="mobile-nav">
        <button v-for="item in nav" :key="item.id" @click="switchTo(item.id)"><component :is="item.icon" :size="17" /> {{ item.label }}</button>
      </div>

      <div v-if="loading" class="loading-state">Un momento…</div>
      <template v-else>
        <section v-if="section === 'today'" class="page today-page">
          <div class="page-heading"><div><div class="date-kicker">{{ dateLabel }}</div><h1>{{ greeting }}, <em>Christian.</em></h1><p class="subheading">Tutto quello che ti serve, per oggi.</p></div><div class="heading-art"><div class="art-sun"></div><span>✳</span></div></div>
          <div class="dashboard-grid">
            <div class="main-column">
              <section class="panel priorities-panel">
                <div class="section-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> IL TUO GIORNO</div><h2>Le tre cose importanti</h2></div><button class="icon-button" aria-label="Aggiungi priorità" @click="beginAdd('task', { priority: true })"><Plus :size="18" /></button></div>
                <div v-if="priorities.length" class="priority-list">
                  <button v-for="(task, i) in priorities" :key="task.id" class="priority-row" @click="toggleTask(task)"><span class="priority-number">0{{ i + 1 }}</span><span class="task-check" :class="{ checked: task.done }"><Check v-if="task.done" :size="14" /></span><span class="task-copy" :class="{ completed: task.done }"><strong>{{ task.title }}</strong><small v-if="task.time">{{ formatTime(task.time) }}<template v-if="projectName(task.projectId)"> · {{ projectName(task.projectId) }}</template></small></span><ChevronDown :size="15" class="row-chevron" /></button>
                </div>
                <div v-else class="empty-priorities"><div class="empty-star">✳</div><div><strong>Una giornata tutta da scrivere</strong><span>Scegli la prima cosa che conta per te.</span></div><button class="text-button" @click="beginAdd('task', { priority: true })">Aggiungi una priorità <ArrowRight :size="14" /></button></div>
                <button class="add-line" @click="beginAdd('task', { priority: true })"><Plus :size="16" /> Aggiungi una priorità</button>
              </section>
              <section class="panel schedule-panel">
                <div class="section-head"><div><div class="eyebrow"><Clock3 :size="13" /> IN AGENDA</div><h2>Il ritmo di oggi</h2></div><button class="inline-link" @click="switchTo('calendar')">Apri calendario <ArrowRight :size="14" /></button></div>
                <div v-if="appointments.length" class="timeline">
                  <div v-for="task in appointments" :key="task.id" class="timeline-row"><div class="timeline-time">{{ formatTime(task.time) }}</div><div class="timeline-track"><span :class="{ filled: task.done }"></span></div><button class="timeline-card" :class="{ done: task.done }" @click="toggleTask(task)"><span class="timeline-title">{{ task.title }}</span><span v-if="projectName(task.projectId)" class="tag">{{ projectName(task.projectId) }}</span><CheckCircle2 v-if="task.done" :size="16" class="timeline-done" /></button></div>
                </div>
                <div v-else class="empty-schedule"><div class="empty-clock"><Clock3 :size="19" /></div><div><strong>Nessun appuntamento in agenda</strong><span>Lascia spazio anche alle pause.</span></div></div>
                <div v-if="untimedTasks.length" class="unscheduled"><span class="unscheduled-label">SENZA ORARIO</span><button v-for="task in untimedTasks" :key="task.id" class="unscheduled-task" @click="toggleTask(task)"><span class="task-check small" :class="{ checked: task.done }"><Check v-if="task.done" :size="12" /></span><span :class="{ completed: task.done }">{{ task.title }}</span><span v-if="task.priority" class="priority-tag">Priorità</span></button></div>
                <button class="add-line" @click="beginAdd('task', { date: todayKey })"><Plus :size="16" /> Aggiungi un impegno</button>
              </section>
              <section class="gentle-card"><div class="gentle-icon"><Heart :size="17" /></div><p>Non serve fare tutto.<br /><strong>Serve fare il prossimo passo.</strong></p><span>✳</span></section>
            </div>
            <div class="side-column">
              <section class="panel progress-panel"><div class="section-head compact"><div><div class="eyebrow">IL TUO PASSO</div><h2>Oggi, fin qui</h2></div><div class="ring" :style="{ '--progress': `${progressToday}%` }"><span>{{ progressToday }}<small>%</small></span></div></div><div class="progress-caption"><strong>{{ doneToday }} di {{ todayTasks.length }}</strong> cose completate</div><div class="progress-track"><span :style="{ width: `${progressToday}%` }"></span></div><div class="progress-foot"><span>Vai al tuo ritmo</span><span v-if="progressToday === 100">🌿</span></div></section>
              <section class="panel focus-panel"><div class="section-head compact"><div><div class="eyebrow"><Target :size="13" /> FOCUS SETTIMANALE</div><h2>Il tuo filo conduttore</h2></div></div><p class="focus-quote">“{{ lastReview?.focus || 'Qual è la cosa che vuoi portare con te in questa settimana?' }}”</p><button class="inline-link" @click="switchTo('review')">{{ lastReview?.focus ? 'Rivedi il tuo focus' : 'Scegli il tuo focus' }} <ArrowRight :size="14" /></button></section>
              <section class="panel mini-projects"><div class="section-head compact"><div><div class="eyebrow"><Flag :size="13" /> IN MOVIMENTO</div><h2>I tuoi progetti</h2></div><button class="icon-button small-icon" aria-label="Aggiungi progetto" @click="beginAdd('project')"><Plus :size="16" /></button></div><div v-if="state.projects.length" class="mini-project-list"><div v-for="project in state.projects.slice(0,3)" :key="project.id" class="mini-project"><div class="project-line"><span class="project-dot" :style="{ background: project.color }"></span><strong>{{ project.title }}</strong><span>{{ project.progress }}%</span></div><div class="progress-track mini-track"><span :style="{ width: `${project.progress}%`, background: project.color }"></span></div></div></div><div v-else class="mini-empty">I tuoi progetti appariranno qui.<button class="text-button" @click="beginAdd('project')">Crea un progetto <ArrowRight :size="14" /></button></div><button class="inline-link" @click="switchTo('projects')">Tutti i progetti <ArrowRight :size="14" /></button></section>
              <section class="panel daily-thought"><div class="eyebrow"><Sparkles :size="13" /> UNA NOTA PER TE</div><p>La produttività non è fare di più. È fare spazio a quello che conta.</p><span>DAYLY, per le tue giornate migliori.</span></section>
            </div>
          </div>
        </section>

        <section v-else-if="section === 'calendar'" class="page">
          <div class="page-heading plain-heading"><div><div class="date-kicker">SPAZIO ALLE TUE IDEE</div><h1>Il tuo <em>calendario.</em></h1><p class="subheading">Impegni fissi e cose da fare, insieme.</p></div><button class="primary-button" @click="beginAdd('task')"><Plus :size="16" /> Nuovo impegno</button></div>
          <section class="panel calendar-panel"><div class="calendar-toolbar"><div><div class="eyebrow">VISTA SETTIMANALE</div><h2>{{ weekRange }}</h2></div><div class="calendar-controls"><button class="icon-button" aria-label="Settimana precedente" @click="calendarOffset--"><ArrowLeft :size="17" /></button><button class="today-button" @click="calendarOffset = 0">Oggi</button><button class="icon-button" aria-label="Settimana successiva" @click="calendarOffset++"><ArrowRight :size="17" /></button></div></div>
            <div class="week-grid"><article v-for="day in weekDays" :key="keyDate(day)" class="day-column" :class="{ 'is-today': keyDate(day) === todayKey }"><div class="day-heading"><span>{{ new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(day) }}</span><strong>{{ day.getDate() }}</strong></div><div class="day-events"><div v-for="task in tasksOn(day)" :key="task.id" class="event-card" :class="{ 'event-done': task.done, 'event-fixed': task.time }" @click="toggleTask(task)"><span v-if="task.time">{{ task.time }}</span><strong>{{ task.title }}</strong><small v-if="!task.time">Senza orario</small></div><button class="day-add" :aria-label="`Aggiungi a ${shortDate(day)}`" @click="beginAdd('task', { date: keyDate(day) })"><Plus :size="15" /></button></div></article></div>
            <div class="calendar-legend"><span><i></i> Impegno fisso</span><span><i></i> Attività flessibile</span><span class="calendar-tip">Tocca un’attività per segnarla come completata</span></div>
          </section>
          <div class="calendar-bottom"><div><CalendarDays :size="19" /><div><strong>La flessibilità è parte del piano.</strong><span>Le attività senza orario restano libere: sistemale quando vuoi.</span></div></div><button class="inline-link" @click="switchTo('today')">Torna a oggi <ArrowRight :size="14" /></button></div>
        </section>

        <section v-else-if="section === 'projects'" class="page">
          <div class="page-heading plain-heading"><div><div class="date-kicker">PICCOLI PASSI, GRANDI DIREZIONI</div><h1>Le cose che <em>crescono.</em></h1><p class="subheading">Progetti e obiettivi, al tuo ritmo.</p></div><button class="primary-button" @click="beginAdd('project')"><Plus :size="16" /> Nuovo progetto</button></div>
          <div class="projects-overview"><div class="overview-copy"><span class="eyebrow">IL QUADRO GENERALE</span><h2>Stai andando avanti,<br /><em>un giorno alla volta.</em></h2><p>Il progresso non è una linea retta. Ogni passo conta.</p></div><div class="overview-number"><strong>{{ projectProgress }}<small>%</small></strong><span>progresso medio</span><div class="progress-track"><span :style="{ width: `${projectProgress}%` }"></span></div></div><div class="overview-flower">✳</div></div>
          <div v-if="state.projects.length" class="project-grid"><article v-for="project in state.projects" :key="project.id" class="panel project-card"><div class="project-card-top"><span class="project-icon" :style="{ background: project.color }"><Target :size="19" /></span><button class="icon-button delete-icon" aria-label="Elimina progetto" @click="deleteItem('projects', project)"><Trash2 :size="16" /></button></div><div class="eyebrow">{{ project.kind || 'PROGETTO PERSONALE' }}</div><h2>{{ project.title }}</h2><p>{{ project.notes || 'Un passo alla volta: scegli tu il ritmo.' }}</p><div class="project-progress-label"><span>Progresso</span><strong>{{ project.progress }}%</strong></div><input class="range" type="range" min="0" max="100" step="5" :value="project.progress" :style="{ '--accent': project.color }" :aria-label="`Progresso ${project.title}`" @input="setProgress(project, $event.target.value)" /><div class="range-scale"><span>Appena iniziato</span><span>Traguardo</span></div></article><button class="panel add-project-card" @click="beginAdd('project')"><span class="add-circle"><Plus :size="20" /></span><strong>C’è altro che ti sta a cuore?</strong><span>Apri uno spazio per un nuovo progetto.</span></button></div>
          <div v-else class="empty-large"><div class="empty-star">✳</div><h2>Ogni progetto inizia con un’intenzione.</h2><p>Crea il tuo primo spazio e tieni traccia dei progressi, senza fretta.</p><button class="primary-button" @click="beginAdd('project')"><Plus :size="16" /> Crea il primo progetto</button></div>
        </section>

        <section v-else-if="section === 'ideas'" class="page">
          <div class="page-heading plain-heading"><div><div class="date-kicker">UNO SPAZIO PER LE COSE CHE TI VENGONO IN MENTE</div><h1>Le tue <em>idee.</em></h1><p class="subheading">Appunti veloci, senza dover decidere subito.</p></div><button class="primary-button" @click="beginAdd('idea')"><Plus :size="16" /> Nuova idea</button></div>
          <div class="idea-intro"><Lightbulb :size="20" /><span>Un posto tranquillo dove lasciare le idee, prima che scappino.</span></div>
          <div v-if="state.ideas.length" class="idea-grid"><article v-for="(idea, i) in state.ideas" :key="idea.id" class="idea-card" :class="`idea-tone-${i % 4}`"><div class="idea-card-top"><span class="idea-date">{{ new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' }).format(new Date(idea.createdAt || Date.now())) }}</span><button class="icon-button" aria-label="Elimina idea" @click="deleteItem('ideas', idea)"><X :size="15" /></button></div><h2>{{ idea.title }}</h2><p>{{ idea.notes || 'Salvata per quando sarà il momento giusto.' }}</p><span class="idea-spark">✳</span></article><button class="idea-add-card" @click="beginAdd('idea')"><Plus :size="19" /><span>Lascia spazio a una nuova idea</span></button></div>
          <div v-else class="empty-large ideas-empty"><div class="empty-star">✳</div><h2>Le idee non hanno bisogno di un piano.</h2><p>Segnale da qualche parte. Potrai tornarci quando vuoi.</p><button class="primary-button" @click="beginAdd('idea')"><Plus :size="16" /> Annota un’idea</button></div>
        </section>

        <section v-else-if="section === 'review'" class="page">
          <div class="page-heading plain-heading"><div><div class="date-kicker">FARE SPAZIO, RIGUARDARE, RIPARTIRE</div><h1>Un momento per <em>te.</em></h1><p class="subheading">Piccole riflessioni, senza giudizio.</p></div></div>
          <div class="review-grid"><section class="panel review-card daily-review"><div class="review-icon"><Moon :size="20" /></div><div class="eyebrow">STASERA · {{ new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' }).format(today) }}</div><h2>Com’è andata, davvero?</h2><p>Non serve scrivere tanto. Anche una parola può bastare.</p><label for="daily-notes">Cosa vuoi ricordare di oggi?</label><textarea id="daily-notes" class="notes-area" :value="todayReview?.notes || ''" placeholder="Una cosa che è andata bene…"></textarea><div class="review-foot"><span>{{ doneToday }} cose portate a termine oggi</span><button class="primary-button" @click="saveDailyReview">Salva il riepilogo <ArrowRight :size="15" /></button></div></section>
            <section class="panel review-card weekly-review"><div class="review-icon"><Compass :size="20" /></div><div class="eyebrow">LA TUA SETTIMANA</div><h2>Qual è il tuo filo conduttore?</h2><p>Una parola o un’intenzione a cui tornare, quando serve.</p><label for="weekly-focus">Il mio focus della settimana</label><textarea id="weekly-focus" class="notes-area focus-area" :value="lastReview?.focus || ''" placeholder="Per questa settimana, vorrei…"></textarea><div class="review-foot"><span>Un promemoria gentile per te.</span><button class="primary-button" @click="saveWeeklyFocus">Salva il focus <ArrowRight :size="15" /></button></div></section></div>
          <section class="panel week-summary"><div><div class="eyebrow">GUARDA QUANTO HAI FATTO</div><h2>Questa settimana</h2><p>{{ weekTasks.filter(task => task.done).length }} attività completate su {{ weekTasks.length }}. Ogni passo ha il suo valore.</p></div><div class="week-big-number">{{ weekTasks.length ? Math.round(weekTasks.filter(task => task.done).length / weekTasks.length * 100) : 0 }}<small>%</small><span>del programmato</span></div></section>
        </section>

        <section v-else-if="section === 'assistant'" class="page assistant-page">
          <div class="page-heading plain-heading"><div><div class="date-kicker">UN PENSIERO IN PIÙ, QUANDO SERVE</div><h1>Facciamo ordine <em>insieme.</em></h1><p class="subheading">Un assistente gentile per aiutarti a fare spazio.</p></div></div>
          <div class="assistant-layout"><section class="panel claude-connect"><div class="claude-mark"><img src="/logo.jpg" alt="" /></div><div class="eyebrow">CLAUDE · COLLEGAMENTO PERSONALE</div><h2>Usa Claude con il tuo piano</h2><p>DAYLY prepara un collegamento sicuro. Poi puoi chiedere a Claude di leggere agenda, progetti e idee, e proporre modifiche. I dati restano cifrati nel cloud; le funzioni locali continuano a funzionare offline.</p><div v-if="cloudSettings()" class="sync-status"><CheckCircle2 :size="16" /> {{ syncLabel }}</div><div class="claude-actions"><button class="primary-button" :disabled="cloudBusy" @click="connectClaude">{{ cloudBusy ? 'Preparo il collegamento…' : cloudSettings() ? 'Genera codice temporaneo per Claude' : 'Attiva la sincronizzazione protetta' }}</button><button v-if="cloudSettings()" class="text-button" @click="disconnectClaude">Revoca Claude e rinnova il codice segreto</button><button v-if="cloudSettings()" class="text-button danger-link" @click="deleteCloudCopy">Elimina anche la copia online</button><button v-if="cloudSettings()" class="secondary-button" @click="copyRecoveryCode">Copia codice di recupero per un altro iPhone</button></div><div v-if="!cloudSettings()" class="recovery-panel"><label for="recovery-code">Hai già un codice di recupero?</label><div><input id="recovery-code" v-model="recoveryInput" placeholder="ID.chiave personale" /><button class="secondary-button" @click="restoreCloudConnection">Ripristina</button></div></div><div v-if="pairingCode" class="pair-code"><span>CODICE TEMPORANEO · 5 MINUTI</span><code>{{ pairingCode }}</code><button class="secondary-button" @click="copyPairingCode">Copia il codice</button></div><ol class="connector-steps"><li>In Claude apri <strong>Impostazioni → Connettori → Aggiungi connettore personalizzato</strong>.</li><li>Inserisci <code>https://dayly-delta.vercel.app/api/mcp</code> e avvia la connessione.</li><li>Quando si apre la pagina DAYLY, incolla il codice temporaneo e autorizza.</li><li>In Claude chiedi di consultare DAYLY. Le modifiche richiedono una tua conferma esplicita.</li></ol><div class="cloud-cost-note"><strong>Privacy e costi.</strong> Il contenuto viene cifrato prima dell’invio; il codice temporaneo scade e puoi revocare Claude qui. Lo spazio Vercel Blob include quote mensili e può avere costi se superate, secondo il piano Vercel.</div></section>
            <aside class="assistant-side"><section class="panel privacy-card"><div class="privacy-icon"><Heart :size="18" /></div><div class="eyebrow">UN AIUTO CON DELICATEZZA</div><h3>Le scelte restano tue.</h3><p>Claude legge i dati che hai scelto di sincronizzare. Può solo applicare modifiche dopo una tua conferma esplicita nella chat.</p><div class="privacy-rule"><CheckCircle2 :size="15" /> Dati cifrati prima della sincronizzazione</div><div class="privacy-rule"><CheckCircle2 :size="15" /> Nessuna chiave API AI nell’app</div><div class="privacy-rule"><CheckCircle2 :size="15" /> Revoca disponibile da DAYLY</div></section><section class="panel context-card"><div class="eyebrow">NELLA TUA GIORNATA</div><div class="context-row"><ListTodo :size="16" /><span>Attività</span><strong>{{ state.tasks.length }}</strong></div><div class="context-row"><Target :size="16" /><span>Progetti</span><strong>{{ state.projects.length }}</strong></div><div class="context-row"><Lightbulb :size="16" /><span>Idee</span><strong>{{ state.ideas.length }}</strong></div></section></aside></div>
        </section>
      </template>
      <footer class="footer"><span>DAYLY <i>·</i> uno spazio tutto tuo</span><span>{{ cloudSettings() ? 'Locale · copia cifrata online' : 'Dati salvati in locale' }} <span class="footer-dot">●</span></span></footer>
    </main>

    <nav class="bottom-nav" aria-label="Navigazione mobile"><button v-for="item in nav.slice(0, 5)" :key="item.id" :class="{ active: section === item.id }" @click="switchTo(item.id)"><component :is="item.icon" :size="19" /><span>{{ item.label }}</span></button><button :class="{ active: section === 'assistant' }" @click="switchTo('assistant')"><MessageCircle :size="19" /><span>AI</span></button></nav>
    <div v-if="toast" class="toast"><CheckCircle2 :size="17" /> {{ toast }}</div>

    <div v-if="modal && modal !== 'backup'" class="modal-backdrop" @click.self="modal = null"><section class="modal-card"><div class="modal-head"><div><span class="eyebrow">{{ modal === 'task' ? 'IL TUO TEMPO' : modal === 'project' ? 'QUALCOSA CHE TI STA A CUORE' : 'TUTTE LE IDEE COMINCIANO DA QUI' }}</span><h2>{{ modal === 'task' ? 'Aggiungi un impegno' : modal === 'project' ? 'Apri un nuovo progetto' : 'Annota un’idea' }}</h2></div><button class="icon-button" aria-label="Chiudi" @click="modal = null"><X :size="19" /></button></div><form class="entry-form" @submit.prevent="saveForm"><label for="entry-title">{{ modal === 'task' ? 'Cosa vuoi ricordarti?' : 'Dagli un nome' }}</label><input id="entry-title" v-model="form.title" autofocus required :placeholder="modal === 'task' ? 'Es. Preparare la presentazione' : modal === 'project' ? 'Es. Imparare qualcosa di nuovo' : 'Es. Un’idea per il weekend'" /><label v-if="modal === 'task'" for="entry-date">Quando?</label><div v-if="modal === 'task'" class="date-time-row"><input id="entry-date" v-model="form.date" type="date" /><input v-model="form.time" type="time" aria-label="Orario facoltativo" /><span>Senza orario va benissimo</span></div><label v-if="modal === 'task'" class="check-label"><input v-model="form.priority" type="checkbox" /> È una delle mie tre priorità</label><label v-if="modal === 'task' && state.projects.length" for="entry-project">Collega a un progetto</label><select v-if="modal === 'task' && state.projects.length" id="entry-project" v-model="form.projectId"><option value="">Nessun progetto</option><option v-for="project in state.projects" :key="project.id" :value="project.id">{{ project.title }}</option></select><label v-if="modal !== 'task'" for="entry-notes">Una nota (facoltativa)</label><textarea v-if="modal !== 'task'" id="entry-notes" v-model="form.notes" rows="3" placeholder="Aggiungi un piccolo dettaglio…"></textarea><template v-if="modal === 'project'"><label for="entry-progress">Il tuo progresso iniziale</label><div class="progress-input-row"><input id="entry-progress" v-model="form.progress" type="range" min="0" max="100" step="5" /><strong>{{ form.progress }}%</strong></div><label for="entry-kind">Tipo</label><select id="entry-kind" v-model="form.kind"><option>PROGETTO PERSONALE</option><option>OBIETTIVO</option></select></template><div class="modal-actions"><button type="button" class="secondary-button" @click="modal = null">Annulla</button><button type="submit" class="primary-button"><Check :size="15" /> Salva</button></div></form></section></div>
    <div v-if="modal === 'backup'" class="modal-backdrop" @click.self="modal = null"><section class="modal-card backup-modal"><div class="modal-head"><div><span class="eyebrow">I TUOI DATI, SEMPRE TUOI</span><h2>Impostazioni e backup</h2></div><button class="icon-button" aria-label="Chiudi" @click="modal = null"><X :size="19" /></button></div><p>Le tue attività, i progetti, le idee e le riflessioni sono salvate sul dispositivo. Crea una copia ogni tanto per tenerle al sicuro.</p><div class="backup-actions"><button class="backup-action" @click="exportBackup"><span><ArrowDownToLine :size="18" /></span><div><strong>Esporta una copia</strong><small>Salva tutti i dati in un file JSON.</small></div><ArrowRight :size="16" /></button><button class="backup-action" @click="importInput?.click()"><span><Upload :size="18" /></span><div><strong>Ripristina una copia</strong><small>Importa un backup DAYLY già salvato.</small></div><ArrowRight :size="16" /></button><input ref="importInput" type="file" accept="application/json,.json" hidden @change="importBackup" /></div><div class="backup-warning"><CloudOff :size="17" /><span>Su iPhone, i dati del sito possono essere rimossi da iOS se lo spazio è limitato o se elimini i dati di navigazione. Conserva una copia in File o iCloud Drive.</span></div><div class="backup-meta"><span>Progetti <strong>{{ state.projects.length }}</strong></span><span>Attività <strong>{{ state.tasks.length }}</strong></span><span>Idee <strong>{{ state.ideas.length }}</strong></span></div></section></div>
  </div>
</template>
