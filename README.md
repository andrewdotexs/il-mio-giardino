# 🌿 The Pot

> ⚠️ **Stato: prototipo personale.** Questo progetto è un prototipo sviluppato per uso domestico privato, non un prodotto pronto al deployment generalista. Funziona, ma porta con sé i compromessi tipici di un prototipo (architettura monolitica, niente test automatici, niente autenticazione multi-utente). Vedi la sezione "Limiti noti" del manuale per i dettagli.

Dashboard self-hosted per la gestione di un giardino domestico: catalogo di **263 specie pre-configurate** con autocompletamento, creazione piante personalizzate, calcolatori di acqua/fertilizzante/fertirrigazione, calendario annaffiature predittive con simulazione FAO-56, integrazione sensori Ecowitt e PWA installabile.

## Caratteristiche

- **Dashboard come homepage** con due viste (vasi/meteo), eventi imminenti dei prossimi 7 giorni, allerte attive, refresh automatico ogni 5 minuti
- **Catalogo di 263 specie** pre-configurate (mediterranee, tropicali, bonsai, succulente, alberi, conifere, aromatiche, fiorite) con sistema di autocompletamento del nome quando si crea una nuova pianta
- **Piante personalizzate** create dall'utente: 26 native pre-popolate al primo avvio (Sanseviera, Phalaenopsis, Ficus, Oleandro, Limone, Rosmarino, Salvia, ecc.) più tutte quelle aggiunte successivamente
- **Inventario vasi** con dimensioni reali, 12 materiali con fattori agronomici differenziati (terracotta, ceramica, geotessile, fibra di cocco, ecc.), substrato personalizzabile e parametri di simulazione persistenti per vaso
- **Calcolatori unificati** (acqua, fertilizzante, fertirrigazione) con switch di modalità, WHC reale del substrato e formula fertirrigazione corretta agronomicamente (WHC × volume_radici × fattore_pianta × 70%)
- **Simulatore bilancio idrico FAO-56** (Penman-Monteith) con TAW/RAW per prevedere consumo idrico e annaffiature, 11 gruppi vegetativi con Kc per stadio fenologico
- **Calendario predittivo** che genera annaffiature personalizzate per ogni vaso basate su simulazione e meteo previsto
- **Trattamenti curativi automatici**: registrando una malattia su un vaso, il sistema genera in calendario il protocollo di cura corrispondente (11 protocolli predefiniti per cocciniglia, ragnetto, afidi, oidio, alternaria, marciume radicale, ecc.)
- **Integrazione Ecowitt**: dati live da gateway GW2000/GW3000, sensori WH51/WH52 (umidità, temperatura, EC del terreno) e WN31 (temperatura/umidità ambiente interno per piante indoor); supporto payload v3 con fallback v1/v2
- **Previsioni 7 giorni** via Open-Meteo (gratuito, senza API key)
- **Allerte predittive**: gelo, ondate di calore, gelate tardive, pioggia intensa, settimana piovosa, vento forte, accumulo sali nei sensori WH52
- **Notifier Android** via Termux:API (riepiloghi giornalieri + allerte critiche)
- **PWA installabile** con service worker e cache offline (versione v10)
- **HTTPS opzionale** fornendo certificati cert.pem e key.pem (utile con Tailscale o reti pubbliche)
- **Diario** con autocompilazione dagli eventi spuntati nel calendario

## Requisiti

- Python 3.6+ (solo stdlib, nessun `pip install` necessario)
- Browser moderno (Chrome, Firefox, Safari)
- (Opzionale) Account Ecowitt + gateway GW2000/GW3000 con sensori
- (Opzionale) Termux:API su Android per le notifiche
- (Opzionale) Certificati SSL per HTTPS — generabili con `openssl` o automaticamente con `tailscale cert`

## Avvio rapido

```bash
# 1) Configura le credenziali Ecowitt (facoltativo)
nano config.json
# Inserisci application_key, api_key, mac del tuo gateway
# Modifica posizione (latitudine/longitudine) per Open-Meteo

# 2) Avvia il server
python3 server.py

# 3) Apri il browser
# Dalla stessa macchina:    http://localhost:8765
# Da altri device in LAN:   http://<ip-dispositivo>:8765
```

Il database SQLite (`giardino.sqlite`) viene creato automaticamente al primo avvio e migrato in modo incrementale a ogni nuova versione. Le 26 piante native vengono inserite al primo boot dal seed `seed_native_plants.py`. Il catalogo esteso di 263 specie viene caricato in memoria all'avvio del server da `extended_catalog.json` e serve all'autocompletamento del nome pianta.

### HTTPS opzionale

Se nella stessa cartella di `server.py` sono presenti i file `cert.pem` e `key.pem`, il server passa automaticamente in HTTPS sulla stessa porta 8765. Per generare un certificato self-signed:

```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -sha256 -days 365 -nodes
```

Per HTTPS con certificati firmati (raccomandato con Tailscale):

```bash
tailscale cert <hostname>.<tailnet>.ts.net
```

## Struttura del progetto

```
il-mio-giardino/
├── giardino_app.html        # Frontend single-page (~9000 righe HTML+inline CSS/JS)
├── static/
│   ├── css/giardino.css     # CSS estratto (caricato via <link>)
│   └── js/giardino.js       # JavaScript estratto (caricato via <script src>)
├── server.py                # Backend HTTP/HTTPS + SQLite + proxy Ecowitt/Open-Meteo
├── seed_native_plants.py    # Seed delle 26 piante native (eseguito al primo boot)
├── extended_catalog.json    # Catalogo di 263 specie per autocompletamento
├── build_catalog.py         # Script di generazione del catalogo
├── seed_extended_catalog.py # Importer idempotente del catalogo nel database (opzionale)
├── notifier.py              # Notifiche Android via Termux:API (esecuzione cron)
├── config.json              # Credenziali Ecowitt + posizione + soglie
├── manifest.json            # PWA manifest
├── sw.js                    # Service worker (cache offline, versione v10)
├── icons/                   # Icone PWA (192×192 e 512×512)
├── cert.pem, key.pem        # Certificati HTTPS (opzionali, non versionati)
└── giardino.sqlite          # Database (creato al primo avvio, non versionato)
```

Il backend usa `http.server.ThreadingHTTPServer` per gestire richieste concorrenti senza framework esterni. Lo schema database evolve in modo additive-only: ogni avvio applica le migrazioni mancanti senza distruggere dati.

## Notifiche Android (opzionale)

Se hai installato Termux:API:

```bash
# Riepilogo giornaliero ogni mattina alle 8:00
python3 notifier.py --summary

# Controllo allerte (gelo, terreno secco, pioggia)
python3 notifier.py --alerts

# Installa come cron:
python3 notifier.py --cron
```

Il riepilogo include temperatura attuale, umidità, pioggia notturna, attività di calendario di oggi, allerte predittive per i prossimi giorni, eventuali sensori in zona di stress. Il controllo allerte è silenzioso al 99% e ha protezione anti-spam (la stessa allerta non viene rinotificata per almeno 6 ore).

## Accesso remoto

Per accedere alla dashboard da fuori casa, opzioni consigliate:

- **Tailscale** (raccomandato): VPN privata, zero configurazione, gratuito fino a 100 device. Installa Tailscale sul dispositivo che ospita il server e sul telefono — accedi via `http://<tailscale-ip>:8765` o, con HTTPS, `https://<hostname>.<tailnet>.ts.net:8765`.
- **Cloudflare Tunnel**: espone il server pubblicamente con HTTPS, dominio custom, autenticazione opzionale.

## Docker

Comandi principali per la creazione di una immagine Docker. Apri un terminale nella cartella del repository e digita:

```bash
# Avvia il container in background
docker compose up -d

# Vedi i log dell'app
docker compose logs -f

# Ricostruisci l'immagine dopo una modifica
docker compose up -d --build
```

## Personalizzazione del catalogo

Il catalogo di 263 specie è generato dallo script `build_catalog.py` che usa template per gruppo (mediterranea, aromatica, succulenta, orchidea, tropicale, agrume, bonsai, arbusto, albero, conifera, fiorita). Per aggiungere una pianta:

1. Aggiungi una riga `make_plant("Nome", "Nomus latinus", "🌿", "gruppo")` in `build_catalog.py`
2. Esegui `python3 build_catalog.py` per rigenerare `extended_catalog.json`
3. Riavvia `server.py` (ricarica il catalogo in memoria al boot)

Il catalogo non popola il database: serve solo da suggerimento al form di creazione pianta. Le piante che effettivamente compaiono nell'app sono solo quelle che l'utente crea esplicitamente.

## Documentazione

Per la guida d'uso completa e la documentazione tecnica: vedi `Manuale_ThePot.docx` (~30 pagine, struttura tripartita: Introduzione, Manuale Utente, Documentazione Tecnica + Appendice).

## Licenza

MIT — vedi `LICENSE`.
