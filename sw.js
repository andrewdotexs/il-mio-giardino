// ══════════════════════════════════════════════════════════════════════
// Il Mio Giardino — Service Worker (PWA)
// ══════════════════════════════════════════════════════════════════════
// Bump del numero di versione: ogni volta che cambia,
// il listener "activate" più sotto cancella tutte le cache con un nome
// diverso, forzando il browser a scaricare di nuovo le risorse. È
// importante bumpare la versione quando si modifica la lista dei file
// precachati o quando si rilascia una modifica strutturale del codice
// (come la separazione di CSS e JS in file dedicati introdotta in v2,
// la rimozione delle 26 piante native introdotta in v3, la pulizia
// delle ultime strutture native + dropdown del diario popolati a runtime
// introdotta in v4, l'introduzione del sistema di immagini stagionali
// per lo sfondo della sezione Schede e per la splash screen v5,
// l'estensione delle splash a quattro varianti stagionali invece di una
// sola statica introdotta in v6, oppure il fix critico del fetch handler
// per filtrare le richieste con schemi non supportati come
// chrome-extension:// — bug che faceva andare in errore tutto il fetch
// handler e bloccava il caricamento delle immagini stagionali — che è
// l'oggetto di questa v7).
//
// Le immagini stagionali in /static/images/ NON sono in PRECACHE_URLS:
// sarebbero 27 MB di download al primo install per asset di cui solo
// uno è utile alla volta (l'utente vede una sola stagione per volta).
// La strategia network-first del fetch handler le caccia comunque al
// primo accesso, così la stagione corrente diventa disponibile offline
// dopo il primo utilizzo, e le altre stagioni si aggiungeranno alla
// cache man mano che arriveranno i loro mesi nel calendario.
const CACHE_NAME = 'giardino-v7';

// File da precaricare nella cache.
// L'inserimento di /static/css/giardino.css, /static/js/splash.js e
// /static/js/giardino.js qui garantisce che siano disponibili offline
// anche al primo avvio successivo all'installazione del service worker,
// senza dover prima visitare la pagina HTML che li referenzia.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/static/css/giardino.css',
  '/static/js/splash.js',
  '/static/js/giardino.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Install: precache risorse essenziali ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: pulisci vecchie cache + forza reload delle tab aperte ──
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Primo passaggio: cancello le cache di tutte le versioni precedenti.
      // Per ogni chiave di cache esistente nel browser, controllo se è quella
      // attuale (CACHE_NAME) e in caso contrario la elimino. Questo è il
      // meccanismo standard di invalidazione versionata.
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));

      // Secondo passaggio: prendo il controllo immediato di tutte le tab
      // che già hanno questa app aperta. Senza clients.claim(), il nuovo
      // service worker controllerebbe solo le tab aperte DOPO la sua
      // attivazione — le tab già aperte continuerebbero a essere servite
      // dal vecchio SW fino al loro prossimo refresh manuale.
      await self.clients.claim();

      // Terzo passaggio (cintura di sicurezza): per ogni tab già aperta che
      // adesso è sotto il controllo del nuovo SW, le chiedo di ricaricarsi.
      // Questo è il pezzo che risolve davvero il caso in cui l'utente abbia
      // tenuto la pagina aperta durante l'aggiornamento: senza questo, la
      // tab continuerebbe a mostrare l'HTML vecchio e i moduli JS vecchi
      // cachati in memoria della pagina, anche se il nuovo SW è già in
      // controllo. Il navigate() forza il browser a ri-fetchare la pagina
      // passando per il nuovo SW, che a sua volta serve la versione nuova
      // dei file. È un refresh trasparente che l'utente percepisce solo
      // come un piccolo "blink" della pagina.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        // Uso navigate sull'url corrente del client; fallback a un postMessage
        // se navigate non è disponibile (browser più vecchi). Il postMessage
        // non fa direttamente il reload ma può essere ascoltato dal frontend
        // se in futuro vorremo aggiungere una notifica "aggiornamento
        // disponibile" prima del reload automatico.
        if ('navigate' in client) {
          try { await client.navigate(client.url); } catch (e) {
            // Alcuni browser rifiutano navigate() su client cross-origin o
            // in stati particolari. Nel dubbio, ignoro l'errore: è una
            // pessima esperienza utente perdere comunque i dati per via
            // di un'eccezione di un meccanismo di refresh "best-effort".
          }
        }
      }
    })()
  );
});

// ── Fetch: Network-first per API, Cache-first per risorse statiche ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── PRIMA DIFESA: filtra gli schemi non supportati ──────────────
  // L'API standard Cache.put() rifiuta esplicitamente le richieste
  // con schema diverso da http/https sollevando un'eccezione. Questo
  // è un problema concreto perché il browser (specialmente Edge e
  // Chrome con estensioni installate) genera molte richieste con
  // schema chrome-extension://, edge-extension://, moz-extension://,
  // about:, blob:, data:. Tutte queste richieste vengono intercettate
  // dal nostro fetch handler e, se proviamo a metterle in cache,
  // sollevano un TypeError che propaga lungo la catena di Promise
  // fino a far rifiutare l'event.respondWith(). Quando il fetch
  // handler rifiuta, il browser segna TUTTE le richieste correnti
  // come ERR_FAILED, anche quelle legittime alle nostre immagini —
  // sintomo classico è "le immagini non si caricano e in console
  // vedo errori di tipo Failed to convert value to Response".
  //
  // La difesa è semplice: se lo schema non è http o https, lasciamo
  // che il browser gestisca la richiesta direttamente senza il nostro
  // intervento, restituendo prematuramente dal listener. event.respondWith()
  // non viene chiamato e quindi il browser fa il default routing.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // ── SECONDA DIFESA: ignora i metodi non-GET ─────────────────────
  // Cache.put() supporta solo richieste GET. POST, PUT, DELETE ecc.
  // (le richieste verso /api/ che modificano dati) non andrebbero
  // mai cachate, quindi le lasciamo passare al network direttamente.
  if (event.request.method !== 'GET') {
    return;
  }

  // API: sempre network, non cachare
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({error: 'Offline — server non raggiungibile'}), {
          headers: {'Content-Type': 'application/json'}
        })
      )
    );
    return;
  }

  // Helper: scrive in cache in modo robusto. Avvolge cache.put in un
  // try/catch (anzi, in un .catch sulla Promise) così qualunque errore
  // imprevisto non fa fallire il fetch handler. Esempi di errori che
  // potrebbero capitare anche dopo il filtro schemi: quota di storage
  // esaurita, file troppo grande per la cache, request non clonabile.
  // La funzione è "fire and forget": non aspettiamo che la cache
  // venga aggiornata prima di rispondere all'utente, perché la
  // risposta vera la abbiamo già in mano.
  function safeCachePut(request, response) {
    caches.open(CACHE_NAME)
      .then(cache => cache.put(request, response))
      .catch(err => console.warn('Cache put failed (non-fatale):', err.message));
  }

  // Font Google: cache-first (raramente cambiano)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            safeCachePut(event.request, response.clone());
          }
          return response;
        });
      })
    );
    return;
  }

  // Tutto il resto: network-first con fallback cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Aggiorna la cache con la versione nuova solo se la risposta
        // è OK (status 200-299). Risposte d'errore (404, 500) non
        // vanno cachate perché bloccherebbero il prossimo accesso.
        if (response.ok) {
          safeCachePut(event.request, response.clone());
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
