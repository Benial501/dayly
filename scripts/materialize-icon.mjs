import { readFile, writeFile } from 'node:fs/promises'

const source = new URL('../assets-src/dayly-icon.png.b64', import.meta.url)
const target = new URL('../public/app-icon.png', import.meta.url)

// un sorgente che manca non deve tirare giù tutta la build: avviso e tiro
// avanti, perché l'icona è un asset e non una ragione per non pubblicare
let encoded
try {
  encoded = await readFile(source, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  console.warn('[icona] assets-src/dayly-icon.png.b64 non trovato: salto la generazione di public/app-icon.png')
}

if (encoded) await writeFile(target, Buffer.from(encoded.trim(), 'base64'))
