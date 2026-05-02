# 🌿 Il Mio Giardino

Dashboard self-hosted per la gestione di un giardino domestico: 26 schede pianta,
calcolatori di acqua/fertilizzante/fertirrigazione, calendario annaffiature
predittive con simulazione FAO-56, integrazione sensori Ecowitt e PWA installabile.

## Caratteristiche

- **26 schede pianta** con dettagli completi su luce, irrigazione, concimazione,
  potatura, parassiti
- **Inventario vasi** con dimensioni reali, substrato personalizzabile e
  parametri di simulazione persistenti per vaso
- **Calcolatori** acqua, fertilizzante e fertirrigazione con WHC reale del
  substrato
- **Simulatore bilancio idrico FAO-56** (Penman-Monteith) con TAW/RAW per
  prevedere consumo idrico e annaffiature
- **Calendario predittivo** che genera annaffiature personalizzate per ogni
  vaso basate su simulazione e meteo previsto
- **Integrazione Ecowitt**: dati live da gateway GW2000, sensori WH51/WH52
  (umidità, temperatura, EC del terreno) e WN31 (temperatura/umidità ambiente
  interno per piante indoor)
- **Previsioni 7 giorni** via Open-Meteo (gratuito, senza API key)
- **Allerte predittive**: gelo, ondate di calore, gelate tardive, pioggia
  intensa, settimana piovosa, vento forte
- **Notifier Android** via Termux:API (riepiloghi giornalieri + allerte critiche)
- **PWA installabile** con service worker e cache offline
- **Diario** con autocompilazione dagli eventi spuntati nel calendario

## Requisiti

- Python 3.6+ (solo stdlib, **nessun pip install necessario**)
- Browser moderno (Chrome, Firefox, Safari)
- (Opzionale) Account Ecowitt + gateway GW2000 con sensori
- (Opzionale) Termux:API su Android per le notifiche

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

Il database SQLite (`giardino.sqlite`) viene creato automaticamente al primo
avvio e migrato in modo incrementale a ogni nuova versione.

## Struttura del progetto

```
il-mio-giardino/
├── giardino_app.html    # Frontend single-file (HTML+CSS+JS, ~7000 righe)
├── server.py            # Backend HTTP + SQLite + proxy Ecowitt/Open-Meteo
├── notifier.py          # Notifiche Android via Termux:API (esecuzione cron)
├── config.json          # Credenziali Ecowitt + posizione + soglie
├── manifest.json        # PWA manifest
├── sw.js                # Service worker (cache offline)
├── icons/               # Icone PWA in tutte le dimensioni
└── giardino.sqlite      # Database (creato al primo avvio)
```

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

## Accesso remoto

Per accedere alla dashboard da fuori casa, opzioni consigliate:

- **Tailscale** (raccomandato): VPN privata, zero configurazione, gratuito
  fino a 100 device. Installa Tailscale sul dispositivo che ospita il server e
  sul telefono — accedi via `http://<tailscale-ip>:8765`.
- **Cloudflare Tunnel**: espone il server pubblicamente con HTTPS, dominio
  custom, autenticazione opzionale.

## Docker

Comandi principali per la creazione di una immagine Docker

Apri un terminale nella cartella del repository e digita

``` bash
docker compose up -d
```

Se vuoi vedere i log dell'app digita

``` bash
docker compose logs -f
```

Per ricostruire l'immagine dopo una modifica per eseguire l'update digita

``` bash
docker compose up -d --build
```

## Licenza

MIT — vedi `LICENSE`.
