import { readFile, writeFile } from 'node:fs/promises'

const encoded = await readFile(new URL('../assets-src/dayly-logo.jpg.b64', import.meta.url), 'utf8')
await writeFile(new URL('../public/logo.jpg', import.meta.url), Buffer.from(encoded.trim(), 'base64'))
