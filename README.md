# DAYLY

DAYLY è uno spazio personale in italiano per organizzare la giornata, i progetti, gli obiettivi e le idee. È una PWA mobile-first pensata per essere aggiunta alla schermata Home di iPhone. Non richiede account e non usa Supabase: le funzionalità locali sono disponibili anche offline.

## Funzioni

- **Oggi:** tre priorità, appuntamenti con orario, attività flessibili, progresso giornaliero e focus della settimana.
- **Calendario:** vista settimanale con impegni fissi e attività senza orario; spostamento fra settimane e completamento con un tocco.
- **Progetti e obiettivi:** progresso percentuale manuale, aggiornabile con il cursore.
- **Idee:** spazio rapido per appunti da riprendere in seguito.
- **Riepiloghi:** riflessione serale e intenzione settimanale salvate sul dispositivo.
- **Backup:** esportazione e ripristino dell’intero archivio in JSON.
- **Assistente:** legge i dati locali inviati con il messaggio, suggerisce organizzazioni e propone modifiche. Le modifiche si applicano solo dopo la conferma esplicita.
- **Offline:** interfaccia installabile e cache dell’app tramite service worker; agenda, progetti, idee e riepiloghi non richiedono rete.

## Stack e architettura

- Vue 3 e Vite per l’interfaccia.
- Tailwind CSS 4 è incluso nella configurazione; lo stile DAYLY è definito in `src/style.css`.
- IndexedDB tramite `idb` per attività, progetti, idee, riepiloghi e impostazioni. Nessun dato applicativo è scritto su un database remoto.
- Service worker in `public/sw.js` e manifest PWA in `public/manifest.webmanifest`.
- Funzione serverless Vercel in `api/assistant.js`. Il browser invia il messaggio e una copia dei dati selezionati; il server chiama l’API OpenAI. La chiave non viene inclusa nel bundle client.

```text
src/App.vue ── src/db.js ── IndexedDB del browser
     │
     └── POST /api/assistant ── Vercel Function ── OpenAI API
```

La funzione AI non conserva conversazioni né dati applicativi. La richiesta viene inoltrata a OpenAI e soggetta alle condizioni di trattamento e conservazione del fornitore. Non inviare informazioni particolarmente sensibili. Le proposte AI sono dati non attendibili: l’app riconosce un insieme limitato di azioni, le mostra e richiede conferma prima di applicarle.

## Requisiti

- Node.js 20 o superiore (verificato con Node.js 24).
- npm.
- Account Vercel per pubblicare.
- Facoltativo: account OpenAI e API key per attivare la chat. La chiave API non è inclusa nel repository.

## Avvio in locale

```bash
npm install
npm run dev
```

Apri l’indirizzo locale stampato da Vite. Le funzioni locali, il salvataggio e i backup sono operativi da subito. Vite non esegue la funzione serverless `/api/assistant`: per provare la chat in locale usa `vercel dev` dopo aver configurato le variabili ambiente.

```bash
cp .env.example .env.local
# Inserisci la chiave solo in .env.local, mai nel codice o in una variabile VITE_*
npx vercel dev
```

L’API restituisce un messaggio esplicito quando `OPENAI_API_KEY` manca.

## Build e deployment Vercel

La configurazione usa `npm run build` e la cartella `dist`; le funzioni sotto `api/` sono distribuite come Vercel Functions.

```bash
npm run build
npx vercel link
npx vercel deploy
npx vercel deploy --prod
```

Per collegare GitHub in Vercel: importa la repository, seleziona Vite, imposta `npm run build` come build command e `dist` come output directory. I push al branch di produzione pubblicheranno gli aggiornamenti.

## Attivare l’assistente AI

1. Crea una chiave API nel tuo account OpenAI.
2. In Vercel apri il progetto DAYLY e aggiungi `OPENAI_API_KEY` come variabile ambiente per gli ambienti desiderati. Aggiungi `OPENAI_MODEL` facoltativamente; il valore predefinito è `gpt-4o-mini`.
3. Ridistribuisci il progetto per applicare la variabile.

Non committare `.env.local`, chiavi o file Vercel locali. `.gitignore` esclude i file ambiente e `.vercel/`. La chiave resta lato server: non usare il prefisso `VITE_`.

### Costi AI

DAYLY non addebita un costo AI proprio. L’uso dell’API è fatturato dal fornitore in base al modello, ai token elaborati e alle tariffe in vigore nel tuo account; può quindi comportare costi variabili. Imposta budget o limiti di spesa nel pannello del fornitore e controlla i prezzi correnti prima di attivare la chiave. Senza chiave, tutte le altre funzioni restano utilizzabili gratuitamente (salvo costi del piano hosting eventualmente scelto).

## Dati, privacy e sicurezza

- I dati personali restano in IndexedDB sul browser del dispositivo, senza sincronizzazione automatica fra iPhone e computer.
- L’assistente invia a OpenAI il testo del messaggio e le attività, i progetti, le idee e i riepiloghi per generare un suggerimento contestuale. L’app mostra questa informazione accanto alla chat.
- La chiave API è letta esclusivamente dalla funzione Vercel. La funzione limita dimensione del messaggio e quantità di record e applica un limite di richieste in memoria per indirizzo IP. Il limite in memoria è opportunistico e non sostituisce un servizio di rate limiting condiviso.
- Non c’è login, coerentemente con l’uso personale e senza account richiesto. Chi conosce l’URL può aprire l’interfaccia; ogni browser conserva però il proprio archivio locale. Se si configura una chiave AI su un deployment pubblico, il solo controllo dell’origine e il limite in memoria non costituiscono un’autenticazione forte: per un deployment privato con AI attiva, abilita la protezione del deployment Vercel o aggiungi un meccanismo di accesso prima di condividere l’URL.
- Il backup JSON contiene tutti i dati dell’app in chiaro. Conservalo in uno spazio privato.

### Limiti IndexedDB su iOS

IndexedDB è locale al browser e può essere rimosso da iOS quando elimini i dati del sito o l’app, e in alcune condizioni di gestione dello spazio. La persistenza non è una garanzia di backup. Esporta periodicamente un JSON e salvalo in File/iCloud Drive. Aggiungendo DAYLY alla schermata Home usa l’esperienza PWA; i dati del browser e quelli della web app possono dipendere dalle regole di conservazione di iOS. Non è attiva alcuna sincronizzazione automatica.

## Backup e ripristino

Apri **Impostazioni e backup** dalla barra laterale (su mobile, apri il menu) per esportare o ripristinare un file JSON. L’esportazione comprende attività, progetti, idee, riepiloghi e impostazioni. Il ripristino sostituisce l’archivio esistente: esporta prima i dati attuali se vuoi conservarli. Il file non è cifrato.

## Installare su iPhone

1. Pubblica DAYLY su un indirizzo HTTPS.
2. Apri l’URL in Safari su iPhone.
3. Tocca **Condividi → Aggiungi alla schermata Home**.
4. Apri DAYLY dalla schermata Home. Dopo il primo caricamento online, l’interfaccia e i dati locali sono disponibili offline.

## Struttura principale

```text
api/assistant.js              Endpoint AI server-side
public/manifest.webmanifest   Manifest PWA
public/sw.js                  Cache offline dell’application shell
src/App.vue                   Interfaccia e flussi DAYLY
src/db.js                     Accesso a IndexedDB
src/main.js                   Avvio Vue e registrazione service worker
src/style.css                 Design responsive
vercel.json                   Build e output Vercel
```

## Note operative

- Non c’è sincronizzazione cloud, account o database remoto.
- Le tre priorità sono rappresentate da un massimo di tre elementi in evidenza nell’elenco di oggi; le altre attività restano in agenda.
- Il calendario è una vista settimanale flessibile; lo spostamento di una settimana non cambia le date delle attività.
- I progressi di progetto si aggiornano manualmente dall’utente. L’assistente può proporre un valore, mai applicarlo senza conferma.
- Il backend dell’assistente usa OpenAI Chat Completions in formato JSON; eventuali modifiche del provider o del modello si gestiscono nel codice server e nelle variabili ambiente.
