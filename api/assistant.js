const requests = new Map()

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Vary', 'Origin')
  const origin = request.headers.origin
  const host = request.headers['x-forwarded-host'] || request.headers.host
  if (origin && host && new URL(origin).host !== host) return response.status(403).json({ error: 'Origine non consentita.' })
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (request.method === 'OPTIONS') return response.status(204).end()
  if (request.method !== 'POST') return response.status(405).json({ error: 'Metodo non supportato.' })
  if (!process.env.OPENAI_API_KEY) return response.status(503).json({ code: 'AI_KEY_MISSING', error: 'La chiave AI non è configurata.' })
  const now = Date.now()
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
  const recent = (requests.get(ip) || []).filter(timestamp => now - timestamp < 10 * 60 * 1000)
  if (recent.length >= 20) return response.status(429).json({ error: 'Hai inviato molti messaggi in poco tempo. Riprova tra qualche minuto.' })
  recent.push(now)
  requests.set(ip, recent)
  const { message, data } = request.body || {}
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) return response.status(400).json({ error: 'Scrivi un messaggio breve (massimo 4.000 caratteri).' })
  const safeData = {
    tasks: Array.isArray(data?.tasks) ? data.tasks.slice(0, 300) : [],
    projects: Array.isArray(data?.projects) ? data.projects.slice(0, 100) : [],
    ideas: Array.isArray(data?.ideas) ? data.ideas.slice(0, 200) : [],
    reviews: Array.isArray(data?.reviews) ? data.reviews.slice(0, 100) : [],
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.4, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Sei l'assistente personale di DAYLY, gentile, conciso e in italiano. Aiuta a pianificare con realismo e senza giudicare. Usa soltanto i dati forniti. Rispondi sempre in JSON con {"message":"testo","actions":[]}. Proponi azioni solo se l'utente lo chiede o le approva chiaramente. Non affermare mai di aver modificato dati. Ogni azione resta una proposta da confermare dall'utente. Formati azioni: {"type":"create_task","title":"...","date":"YYYY-MM-DD","time":"HH:MM oppure stringa vuota","priority":false,"project":"nome oppure stringa vuota"}; {"type":"reschedule_task","title":"titolo attività esistente","date":"YYYY-MM-DD","time":"HH:MM oppure stringa vuota"}; {"type":"update_progress","project":"nome","progress":numero}; {"type":"complete_task","title":"titolo attività"}. Non inventare attività esistenti. Le date devono essere attuali o future e coerenti con la richiesta.` },
          { role: 'user', content: JSON.stringify({ richiesta: message.trim(), datiDAYLY: safeData }) },
        ],
      }),
    })
    if (!upstream.ok) return response.status(502).json({ error: 'Il servizio AI non ha risposto. Riprova tra poco.' })
    const completion = await upstream.json()
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}')
    return response.status(200).json({ message: String(parsed.message || '' ).slice(0, 6000), actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 20) : [] })
  } catch {
    return response.status(502).json({ error: 'Non riesco a raggiungere il servizio AI in questo momento.' })
  }
}
