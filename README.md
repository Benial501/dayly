# DAYLY

DAYLY è un’agenda personale in italiano, pensata prima di tutto per iPhone. Si installa da Safari come PWA e conserva i dati di lavoro in IndexedDB. Se attivi il collegamento Claude, sincronizza una copia cifrata su Vercel Blob e permette a Claude di leggere e aggiornare i dati tramite un connettore MCP remoto.

## Cosa trovi nell’app

- **Oggi:** la lista della giornata in un’unica schermata, con le priorità in cima e l’avanzamento.
- **Calendario:** settimana flessibile, impegni fissi e attività libere.
- **Progetti e obiettivi:** percentuale di completamento aggiornata manualmente.
- **Idee, riepiloghi e focus settimanale.**
- **Offline:** le funzioni locali continuano a funzionare senza rete.
- **Backup:** esportazione e ripristino di un file JSON.
- **Scrivere la giornata:** il pulsante centrale con la matita apre un foglio dove si scrive in italiano, anche più cose insieme («oggi la spesa, chiamare Marco, domani alle 15 il dentista»). DAYLY riconosce date, orari, priorità e progetti, e la data citata vale anche per le cose che la seguono. Mostra l’anteprima e inserisce solo dopo conferma. Funziona offline e non chiama nessun servizio.
- **Toccare una voce** apre le sue azioni: segnarla fatta, renderla una priorità, spostarla a domani, eliminarla. Il cerchio a destra la spunta direttamente.
- **Claude:** collegamento OAuth a un MCP remoto. Claude usa il piano dell’utente nell’app Claude; DAYLY non invia chiamate a un’API AI a pagamento. Le modifiche che Claude propone arrivano in DAYLY come schede da accettare o rifiutare una per una.

## Tecnologie

- Vue 3, Vite e Tailwind CSS 4.
- IndexedDB tramite `idb` per l’archivio locale.
- Vercel Functions per sincronizzazione, OAuth, server MCP e proposte in attesa.
- Vercel Blob **privato** per la copia remota cifrata.
- Cifratura AES-GCM nel browser prima del trasferimento. Il server memorizza il contenuto cifrato; il connettore lo decifra solo durante una richiesta autenticata.

```text
DAYLY su iPhone
  ├─ IndexedDB ─────────────── uso locale/offline
  ├─ AES-GCM ─ Vercel Function ─ private Vercel Blob
  └─ OAuth ─ Claude ─ MCP /api/mcp ─ dati cifrati decifrati per la richiesta
```

Non si usa Supabase. DAYLY non ha un login con email/password: genera un codice segreto personale sul dispositivo. Chiunque ottenga quel codice può accedere alla copia remota e collegare Claude; proteggilo come una password.

## Avvio e sviluppo

Requisiti: Node.js 20+ e npm.

```bash
npm install
npm run dev
```

La modalità Vite locale copre interfaccia, IndexedDB, funzioni offline e backup. Le funzioni Vercel e il collegamento Claude richiedono un ambiente Vercel configurato.

Per eseguire anche le funzioni in locale, collega il progetto e recupera le variabili con gli strumenti Vercel. Non incollare token nel sorgente o in variabili `VITE_*`.

```bash
npx vercel link
npx vercel env pull .env.local
npx vercel dev
```

`BLOB_READ_WRITE_TOKEN` è fornito dal Blob store collegato. `DAYLY_AUTH_SECRET` è un segreto server-side necessario per firmare i codici OAuth. Non condividerlo e non committare `.env.local`.

## Build e pubblicazione

```bash
npm run build
npx vercel deploy
npx vercel deploy --prod
```

Il progetto usa `npm run build`, output `dist` e le funzioni in `api/`. La repository GitHub è collegata a Vercel: i push al branch di produzione avviano il deployment automatico. L’app si può aggiungere alla schermata Home aprendo l’URL in Safari e scegliendo **Condividi → Aggiungi alla schermata Home**.

## Collegare Claude

1. Apri **Altro → Claude** in DAYLY e scegli **Attiva la sincronizzazione protetta**. DAYLY crea un identificativo e una chiave casuale, salva la chiave in IndexedDB e carica una copia cifrata.
2. Premi **Genera codice temporaneo per Claude**. Il codice dura cinque minuti.
3. In Claude apri **Impostazioni → Connettori → Aggiungi connettore personalizzato**, inserisci `https://dayly-delta.vercel.app/api/mcp` e avvia la connessione.
4. Nella pagina di autorizzazione DAYLY incolla il codice temporaneo. Claude riceve permessi di lettura e scrittura; la pagina mostra i permessi prima di completare l’accesso.
5. Chiedi a Claude di leggere o organizzare i tuoi dati. Le modifiche che propone arrivano in DAYLY come schede: le trovi su **Oggi**, con la riga di stato che segnala quante ne sono in attesa, e le accetti o le rifiuti una per una. Claude può anche applicarle dalla conversazione, ma solo dopo una tua conferma esplicita.

DAYLY fornisce tre strumenti MCP: lettura dei dati, invio di proposte da confermare nell’app e applicazione diretta dopo conferma in chat. Se Claude modifica dati mentre DAYLY è chiusa, l’app li recupera alla successiva apertura online. Se rileva una modifica concorrente, evita di sovrascrivere la copia remota e segnala di ricaricare.

Per revocare Claude e invalidare i token già emessi, usa **Revoca il collegamento** in DAYLY. Questa operazione rinnova la chiave; la copia cifrata resta nel private Blob e la sincronizzazione continua con la nuova chiave.

### ChatGPT e Claude: abbonamento e API

Questo progetto integra Claude tramite il connettore MCP, quindi non richiede una chiave Anthropic API. L’uso rientra nelle condizioni e nei limiti del piano Claude dell’utente. Un abbonamento Claude.ai, da solo, non comprende le chiamate alla API Console. OpenAI ha iniziato a consentire in alcune app partner l’uso del piano ChatGPT, ma l’integrazione è disponibile solo per partner ammessi; DAYLY al momento non implementa né dichiara di avere tale approvazione. Perciò l’assistente AI attuale è Claude via connettore.

## Dati, privacy e sicurezza

- **Offline:** l’app legge e modifica IndexedDB sul dispositivo. Senza collegamento Claude non invia i dati a un server.
- **Sincronizzazione:** se la attivi, DAYLY cifra lo snapshot nel browser con AES-GCM prima di inviarlo a una funzione Vercel. La copia viene conservata in uno storage Blob privato nella regione UE `fra1`.
- **Claude:** quando chiedi di usare il connettore, i dati necessari vengono decifrati lato server e restituiti a Claude. Si applicano le impostazioni e le condizioni privacy del tuo account Claude. Non inviare dati che non vuoi condividere con Claude.
- **Credenziali:** la chiave personale resta in IndexedDB e non viene inclusa nel backup JSON. Il codice di collegamento temporaneo è valido per cinque minuti. I token Claude sono firmati lato server e possono essere revocati ruotando la chiave personale.
- **Repository pubblica:** codice, documentazione e logo sono pubblici; dati, chiavi e token non vanno mai salvati nel repository. `.gitignore` esclude `.env.local` e `.vercel/`.
- **Proposte in attesa:** le modifiche che Claude propone restano sul server **in chiaro** in `users/<hash>/proposals.json` — Claude non ha la chiave personale e non può cifrarle. Vengono cancellate appena le accetti o le rifiuti nell’app, e scadono comunque dopo sette giorni.
- **Conflitti:** la sincronizzazione usa una revisione; se Claude e DAYLY modificano lo stesso archivio in contemporanea, la nuova scrittura si ferma per non sovrascrivere dati.

Il backup esportato è JSON in chiaro e non include la chiave cloud. Conservalo in un luogo privato. Tieni una copia periodica anche se hai attivato la sincronizzazione.

## Costi

- **Claude:** nessun costo API Anthropic separato per il connettore MCP. L’uso è soggetto ai limiti e alle condizioni del piano Claude.
- **Vercel Blob:** il piano Hobby include attualmente 1 GB di spazio, 10.000 operazioni semplici, 2.000 avanzate e 10 GB di trasferimento Blob al mese; sul piano Hobby si applicano limiti di utilizzo. Il piano Pro applica le tariffe indicate da Vercel oltre le quote incluse. Le tariffe possono cambiare; controlla il pannello e la [pagina prezzi Vercel](https://vercel.com/pricing).
- **Vercel Functions:** rientrano nelle quote del piano e possono generare costi secondo il piano e il volume d’uso.

Per una sola persona, con uno snapshot piccolo e un uso contenuto, i limiti inclusi possono essere sufficienti; non è una garanzia di costo zero. Configura un limite di spesa quando il tuo piano lo consente.

## Backup e limiti iOS

Apri **Impostazioni e backup** per esportare o importare l’archivio JSON. L’importazione sostituisce i dati locali, preservando il collegamento cloud attivo.

IndexedDB rimane associato al browser/app sul dispositivo. iOS può rimuovere dati del sito o dell’app se vengono cancellati i dati di navigazione o in condizioni di spazio; non è un backup garantito. La copia Blob è opzionale e richiede internet. Per trasferire il collegamento su un altro iPhone serve il segreto personale, che non è incluso nell’esportazione JSON: conserva una copia sicura separata.

## Struttura del progetto

```text
api/_lib/blob-store.js       Lettura/scrittura private Blob
api/_lib/security.js         Hash credenziali e token firmati
api/oauth/[...path].js       OAuth 2.1 per il connettore Claude
api/pair.js                  Codice di collegamento temporaneo DAYLY
api/sync.js                  Snapshot cifrati, revisione e revoca
api/mcp.js                   Strumenti MCP DAYLY
public/logo.jpg              Logo fornito per DAYLY
assets-src/dayly-logo.jpg.b64 Sorgente del logo per la build su Vercel
public/manifest.webmanifest  Manifest PWA
public/sw.js                 Cache offline dell’application shell
src/App.vue                  Interfaccia e flussi utente
src/db.js                    Accesso a IndexedDB
src/main.js                  Avvio Vue e service worker
src/style.css                Palette e layout responsive
vercel.json                  Build, rewrites OAuth e asset
```

## Limiti e note operative

- Il connettore richiede rete; il resto dell’app locale funziona offline.
- DAYLY è progettata per uso personale. La chiave generata è una credenziale al portatore: chi la copia ottiene accesso allo snapshot. Non condividerla e proteggi il dispositivo.
- La revoca invalida Claude ma mantiene la copia cloud cifrata per poter continuare la sincronizzazione.
- Gli strumenti di scrittura sono limitati ad aggiunta/spostamento attività, avanzamento progetto e completamento attività. L’utente deve chiedere una modifica e confermarla nella chat Claude.
- Il repository è richiesto pubblico; la pubblicazione della visibilità GitHub deve essere confermata dal proprietario al momento del cambio, perché renderà accessibili a chiunque file, cronologia e logo.
