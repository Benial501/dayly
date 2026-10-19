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
const assistantText = ref('')
const assistantBusy = ref(false)
const assistantMessages = ref([])
const proposal = ref(null)
const importInput = ref(null)
const syncLabel = ref('Salvato su questo iPhone')

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

onMounted(async () => { state.value = await readAll(); loading.value = false })

function keyDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function newId() { return crypto.randomUUID() }
function switchTo(id) { section.value = id; showMobileNav.value = false }
function ping(message) { toast.value = message; window.setTimeout(() => { toast.value = '' }, 2600) }
function beginAdd(type, extra = {}) {
  form.value = { title: '', date: todayKey, time: '', priority: false, done: false, progress: 0, color: '#dbe8c7', notes: '', ...extra }
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
  state.value = await readAll(); modal.value = null; ping('Aggiunto ai tuoi spazi')
}
async function toggleTask(task) { await put('tasks', { ...task, done: !task.done }); state.value = await readAll() }
async function deleteItem(store, item) { await remove(store, item.id); state.value = await readAll(); ping('Elemento eliminato') }
async function setProgress(project, value) { await put('projects', { ...project, progress: Number(value) }); state.value = await readAll() }
function sectionTitle(id = section.value) { return nav.find(item => item.id === id)?.label || 'Oggi' }
function shortDate(date) { return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' }).format(date) }
function tasksOn(date) { return state.value.tasks.filter(task => task.date === keyDate(date)).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')) }
function formatTime(value) { return value ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(`2000-01-01T${value}:00`)) : '' }
function projectName(id) { return state.value.projects.find(project => project.id === id)?.title || '' }
function saveFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}
function exportBackup() {
  const backup = { app: 'DAYLY', formatVersion: 1, exportedAt: new Date().toISOString(), data: state.value }
  saveFile(`dayly-backup-${todayKey}.json`, JSON.stringify(backup, null, 2), 'application/json')
  ping('Backup esportato')
}
async function importBackup(event) {
  const file = event.target.files?.[0]; if (!file) return
  try {
    const parsed = JSON.parse(await file.text()); const data = parsed.data || parsed
    const stores = ['tasks', 'projects', 'ideas', 'reviews', 'settings']
    if (!data || !stores.every(name => Array.isArray(data[name]))) throw new Error('Formato non valido')
    await replaceAll(data); state.value = await readAll(); ping('Backup ripristinato')
  } catch { ping('Il file selezionato non è un backup DAYLY valido') }
  event.target.value = ''
}
async function saveDailyReview() {
  const notes = document.querySelector('#daily-notes')?.value ?? ''
  await put('reviews', { id: `day-${todayKey}`, period: 'day', date: todayKey, notes, completedCount: doneToday.value, updatedAt: Date.now() })
  state.value = await readAll(); ping('Riflessione salvata')
}
async function saveWeeklyFocus() {
  const focus = document.querySelector('#weekly-focus')?.value ?? ''
  await put('reviews', { id: 'week', period: 'week', focus, updatedAt: Date.now() })
  state.value = await readAll(); ping('Focus della settimana salvato')
}
function dateTasks(d) { return tasksOn(d).length ? tasksOn(d).map(t => `${t.time ? `${t.time} · ` : ''}${t.title}`).join('\n') : 'Nessun impegno per ora' }

async function askAssistant() {
  const message = assistantText.value.trim(); if (!message || assistantBusy.value) return
  assistantMessages.value.push({ role: 'user', text: message }); assistantText.value = ''; assistantBusy.value = true
  try {
    const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, data: { tasks: state.value.tasks, projects: state.value.projects, ideas: state.value.ideas, reviews: state.value.reviews } }) })
    const result = await response.json()
    if (response.status === 503 && result.code === 'AI_KEY_MISSING') {
      assistantMessages.value.push({ role: 'assistant', text: 'La chiave AI non è ancora configurata. Puoi già usare tutte le funzioni locali di DAYLY. Quando vuoi attivare l’assistente, aggiungi OPENAI_API_KEY nelle variabili ambiente del progetto Vercel e ridistribuisci.' })
    } else if (!response.ok) throw new Error(result.error || 'Servizio momentaneamente non disponibile.')
    else {
      assistantMessages.value.push({ role: 'assistant', text: result.message || 'Ecco una proposta per la tua giornata.' })
      if (Array.isArray(result.actions) && result.actions.length) proposal.value = result
    }
  } catch (error) { assistantMessages.value.push({ role: 'assistant', text: `${error.message || 'Non riesco a raggiungere il servizio.'} Le tue attività restano salvate sul dispositivo.` }) }
  finally { assistantBusy.value = false }
}
async function applyProposal() {
  if (!proposal.value) return
  const priorityCounts = new Map()
  for (const task of state.value.tasks) {
    if (task.priority) priorityCounts.set(task.date, (priorityCounts.get(task.date) || 0) + 1)
  }
  for (const action of proposal.value.actions) {
    if (action.type === 'create_task' && typeof action.title === 'string') {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(action.date) ? action.date : todayKey
      const projectId = state.value.projects.find(project => project.title.toLowerCase() === String(action.project || '').toLowerCase())?.id || ''
      const priority = Boolean(action.priority) && (priorityCounts.get(date) || 0) < 3
      if (priority) priorityCounts.set(date, (priorityCounts.get(date) || 0) + 1)
      await put('tasks', { id: newId(), title: action.title, date, time: /^\d{2}:\d{2}$/.test(action.time) ? action.time : '', done: false, priority, projectId, createdAt: Date.now() })
    }
    if (action.type === 'update_progress') {
      const project = state.value.projects.find(item => item.id === action.projectId || item.title.toLowerCase() === String(action.project || '').toLowerCase())
      if (project && Number.isFinite(Number(action.progress))) await put('projects', { ...project, progress: Math.max(0, Math.min(100, Number(action.progress))) })
    }
    if (action.type === 'complete_task') {
      const task = state.value.tasks.find(item => item.id === action.taskId || item.title.toLowerCase() === String(action.title || '').toLowerCase())
      if (task) await put('tasks', { ...task, done: true })
    }
    if (action.type === 'reschedule_task') {
      const task = state.value.tasks.find(item => item.id === action.taskId || item.title.toLowerCase() === String(action.title || '').toLowerCase())
      if (task) await put('tasks', {
        ...task,
        date: /^\d{4}-\d{2}-\d{2}$/.test(action.date) ? action.date : task.date,
        time: action.time === '' || /^\d{2}:\d{2}$/.test(action.time) ? action.time : task.time,
      })
    }
  }
  proposal.value = null; state.value = await readAll(); ping('Proposta applicata')
}

const todayReview = computed(() => state.value.reviews.find(item => item.id === `day-${todayKey}`))
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="switchTo('today')"><span class="brand-mark">d</span><span>dayly<span class="brand-dot">.</span></span></a>
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
          <div class="assistant-layout"><section class="panel chat-panel"><div class="chat-header"><div class="assistant-avatar"><Sparkles :size="19" /></div><div><strong>DAYLY assistant</strong><span><i></i> pronto ad ascoltarti</span></div><button class="icon-button" aria-label="Cancella conversazione" @click="assistantMessages = []; proposal = null"><Trash2 :size="16" /></button></div><div class="chat-body"><div v-if="!assistantMessages.length" class="chat-welcome"><div class="welcome-spark">✳</div><h2>Da dove vuoi cominciare?</h2><p>Possiamo guardare insieme i tuoi impegni, trovare un ritmo più leggero o fare spazio a una nuova idea.</p><div class="suggestion-chips"><button @click="assistantText = 'Aiutami a organizzare la giornata'; askAssistant()">Organizziamo la giornata <ArrowUpRight :size="13" /></button><button @click="assistantText = 'Riorganizza i miei impegni in modo realistico'; askAssistant()">Rendiamo la settimana più leggera <ArrowUpRight :size="13" /></button><button @click="assistantText = 'Fammi un riepilogo dei miei progetti'; askAssistant()">Guardiamo i miei progressi <ArrowUpRight :size="13" /></button></div></div><div v-else class="message-list"><div v-for="(msg, i) in assistantMessages" :key="i" class="chat-message" :class="msg.role"><div v-if="msg.role === 'assistant'" class="message-mark"><Sparkles :size="14" /></div><p>{{ msg.text }}</p></div><div v-if="assistantBusy" class="chat-message assistant"><div class="message-mark"><Sparkles :size="14" /></div><p class="typing">Sto pensando<span>…</span></p></div><div v-if="proposal" class="proposal-card"><div class="proposal-heading"><CheckCircle2 :size="17" /><strong>Una proposta, da rivedere insieme</strong></div><p>{{ proposal.actions.length }} modifiche suggerite. Nulla cambia finché non confermi.</p><ul><li v-for="(action, i) in proposal.actions" :key="i">{{ action.type === 'create_task' ? `Aggiungi: ${action.title}${action.date ? ` · ${action.date}` : ''}${action.time ? ` alle ${action.time}` : ''}` : action.type === 'update_progress' ? `Aggiorna il progresso di ${action.project || 'un progetto'} al ${action.progress}%` : action.type === 'reschedule_task' ? `Sposta ${action.title} a ${action.date || 'una nuova data'}${action.time ? ` · ${action.time}` : ''}` : action.type === 'complete_task' ? `Segna come completata: ${action.title}` : 'Proposta da verificare' }}</li></ul><div class="proposal-actions"><button class="text-button" @click="proposal = null">Ignora</button><button class="primary-button" @click="applyProposal"><Check :size="15" /> Conferma le modifiche</button></div></div></div></div>
            <div class="chat-input-wrap"><form class="chat-input" @submit.prevent="askAssistant"><textarea v-model="assistantText" rows="1" placeholder="Scrivi quello che hai in mente…" aria-label="Messaggio per l’assistente" @keydown.enter.exact.prevent="askAssistant"></textarea><button type="submit" :disabled="assistantBusy || !assistantText.trim()" aria-label="Invia messaggio"><Send :size="17" /></button></form><div class="chat-foot"><span><Sparkles :size="12" /> Le proposte chiedono sempre la tua conferma</span><span>I dati vengono inviati al servizio AI quando scrivi</span></div></div></section>
            <aside class="assistant-side"><section class="panel privacy-card"><div class="privacy-icon"><Heart :size="18" /></div><div class="eyebrow">UN AIUTO CON DELICATEZZA</div><h3>Le scelte restano tue.</h3><p>L’assistente legge i dati che hai salvato qui per darti suggerimenti più utili. Prima di inviare, puoi vedere il messaggio che hai scritto.</p><div class="privacy-rule"><CheckCircle2 :size="15" /> Non applica modifiche senza il tuo consenso</div><div class="privacy-rule"><CheckCircle2 :size="15" /> I tuoi dati restano salvati su questo dispositivo</div></section><section class="panel context-card"><div class="eyebrow">NELLA TUA GIORNATA</div><div class="context-row"><ListTodo :size="16" /><span>Attività</span><strong>{{ state.tasks.length }}</strong></div><div class="context-row"><Target :size="16" /><span>Progetti</span><strong>{{ state.projects.length }}</strong></div><div class="context-row"><Lightbulb :size="16" /><span>Idee</span><strong>{{ state.ideas.length }}</strong></div><button class="inline-link" @click="assistantMessages = []; proposal = null">Nuova conversazione <ArrowRight :size="14" /></button></section></aside></div>
        </section>
      </template>
      <footer class="footer"><span>DAYLY <i>·</i> uno spazio tutto tuo</span><span>Dati salvati in locale <span class="footer-dot">●</span></span></footer>
    </main>

    <nav class="bottom-nav" aria-label="Navigazione mobile"><button v-for="item in nav.slice(0, 5)" :key="item.id" :class="{ active: section === item.id }" @click="switchTo(item.id)"><component :is="item.icon" :size="19" /><span>{{ item.label }}</span></button><button :class="{ active: section === 'assistant' }" @click="switchTo('assistant')"><MessageCircle :size="19" /><span>AI</span></button></nav>
    <div v-if="toast" class="toast"><CheckCircle2 :size="17" /> {{ toast }}</div>

    <div v-if="modal && modal !== 'backup'" class="modal-backdrop" @click.self="modal = null"><section class="modal-card"><div class="modal-head"><div><span class="eyebrow">{{ modal === 'task' ? 'IL TUO TEMPO' : modal === 'project' ? 'QUALCOSA CHE TI STA A CUORE' : 'TUTTE LE IDEE COMINCIANO DA QUI' }}</span><h2>{{ modal === 'task' ? 'Aggiungi un impegno' : modal === 'project' ? 'Apri un nuovo progetto' : 'Annota un’idea' }}</h2></div><button class="icon-button" aria-label="Chiudi" @click="modal = null"><X :size="19" /></button></div><form class="entry-form" @submit.prevent="saveForm"><label for="entry-title">{{ modal === 'task' ? 'Cosa vuoi ricordarti?' : 'Dagli un nome' }}</label><input id="entry-title" v-model="form.title" autofocus required :placeholder="modal === 'task' ? 'Es. Preparare la presentazione' : modal === 'project' ? 'Es. Imparare qualcosa di nuovo' : 'Es. Un’idea per il weekend'" /><label v-if="modal === 'task'" for="entry-date">Quando?</label><div v-if="modal === 'task'" class="date-time-row"><input id="entry-date" v-model="form.date" type="date" /><input v-model="form.time" type="time" aria-label="Orario facoltativo" /><span>Senza orario va benissimo</span></div><label v-if="modal === 'task'" class="check-label"><input v-model="form.priority" type="checkbox" /> È una delle mie tre priorità</label><label v-if="modal === 'task' && state.projects.length" for="entry-project">Collega a un progetto</label><select v-if="modal === 'task' && state.projects.length" id="entry-project" v-model="form.projectId"><option value="">Nessun progetto</option><option v-for="project in state.projects" :key="project.id" :value="project.id">{{ project.title }}</option></select><label v-if="modal !== 'task'" for="entry-notes">Una nota (facoltativa)</label><textarea v-if="modal !== 'task'" id="entry-notes" v-model="form.notes" rows="3" placeholder="Aggiungi un piccolo dettaglio…"></textarea><template v-if="modal === 'project'"><label for="entry-progress">Il tuo progresso iniziale</label><div class="progress-input-row"><input id="entry-progress" v-model="form.progress" type="range" min="0" max="100" step="5" /><strong>{{ form.progress }}%</strong></div><label for="entry-kind">Tipo</label><select id="entry-kind" v-model="form.kind"><option>PROGETTO PERSONALE</option><option>OBIETTIVO</option></select></template><div class="modal-actions"><button type="button" class="secondary-button" @click="modal = null">Annulla</button><button type="submit" class="primary-button"><Check :size="15" /> Salva</button></div></form></section></div>
    <div v-if="modal === 'backup'" class="modal-backdrop" @click.self="modal = null"><section class="modal-card backup-modal"><div class="modal-head"><div><span class="eyebrow">I TUOI DATI, SEMPRE TUOI</span><h2>Impostazioni e backup</h2></div><button class="icon-button" aria-label="Chiudi" @click="modal = null"><X :size="19" /></button></div><p>Le tue attività, i progetti, le idee e le riflessioni sono salvate sul dispositivo. Crea una copia ogni tanto per tenerle al sicuro.</p><div class="backup-actions"><button class="backup-action" @click="exportBackup"><span><ArrowDownToLine :size="18" /></span><div><strong>Esporta una copia</strong><small>Salva tutti i dati in un file JSON.</small></div><ArrowRight :size="16" /></button><button class="backup-action" @click="importInput?.click()"><span><Upload :size="18" /></span><div><strong>Ripristina una copia</strong><small>Importa un backup DAYLY già salvato.</small></div><ArrowRight :size="16" /></button><input ref="importInput" type="file" accept="application/json,.json" hidden @change="importBackup" /></div><div class="backup-warning"><CloudOff :size="17" /><span>Su iPhone, i dati del sito possono essere rimossi da iOS se lo spazio è limitato o se elimini i dati di navigazione. Conserva una copia in File o iCloud Drive.</span></div><div class="backup-meta"><span>Progetti <strong>{{ state.projects.length }}</strong></span><span>Attività <strong>{{ state.tasks.length }}</strong></span><span>Idee <strong>{{ state.ideas.length }}</strong></span></div></section></div>
  </div>
</template>
