/* Suoni generati al volo con Web Audio: nessun file da scaricare,
   quindi funzionano anche offline e non pesano sul bundle. */

const KEY = 'dayly-suoni'
let context = null
let on = localStorage.getItem(KEY) !== 'off'

function audio() {
  if (!context) {
    const Engine = window.AudioContext || window.webkitAudioContext
    if (!Engine) return null
    context = new Engine()
  }
  // su iPhone il contesto parte sospeso: si sblocca dentro un tocco
  if (context.state === 'suspended') context.resume()
  return context
}

function note(frequency, { at = 0, length = 0.09, volume = 0.05, shape = 'sine', slideTo = 0 } = {}) {
  const engine = audio()
  if (!engine) return
  const start = engine.currentTime + at
  const oscillator = engine.createOscillator()
  const gain = engine.createGain()

  oscillator.type = shape
  oscillator.frequency.setValueAtTime(frequency, start)
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + length)

  // attacco e rilascio morbidi: senza, si sente un clic secco
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)

  oscillator.connect(gain).connect(engine.destination)
  oscillator.start(start)
  oscillator.stop(start + length + 0.02)
}

export const sound = {
  get enabled() { return on },
  set enabled(value) {
    on = !!value
    localStorage.setItem(KEY, on ? 'on' : 'off')
    if (on) sound.tap()
  },

  /* tocco qualsiasi: appena percettibile */
  tap() { if (on) note(1180, { length: 0.045, volume: 0.022, shape: 'triangle' }) },

  /* qualcosa è stato salvato */
  saved() {
    if (!on) return
    note(587.33, { length: 0.1, volume: 0.045 })
    note(880, { at: 0.075, length: 0.14, volume: 0.04 })
  },

  /* attività completata: tre note che salgono */
  done() {
    if (!on) return
    note(659.25, { length: 0.09, volume: 0.042 })
    note(830.61, { at: 0.07, length: 0.09, volume: 0.04 })
    note(1046.5, { at: 0.14, length: 0.18, volume: 0.038 })
  },

  /* qualcosa è stato tolto */
  removed() { if (on) note(420, { length: 0.14, volume: 0.04, shape: 'triangle', slideTo: 240 }) },
}
