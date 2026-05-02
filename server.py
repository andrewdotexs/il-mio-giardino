"""
Giardino App — Server locale SQLite
====================================
Avvio:  python server.py
Poi apri il browser su:  http://localhost:8765

Requisiti: solo Python 3.6+ (nessun pip install necessario)
"""

import sqlite3
import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError
from datetime import datetime

# ── Configurazione ────────────────────────────────────────────────────
PORT = 8765

# Cartella dei dati persistenti (database SQLite e config Ecowitt).
# Comportamento:
#   - Se la variabile d'ambiente DATA_DIR è impostata, uso quella cartella.
#     Tipicamente "/app/data" quando l'app gira in container Docker, dove
#     un volume monta una cartella host esterna per la persistenza.
#   - Altrimenti uso la stessa cartella dello script, mantenendo il
#     comportamento storico: chi gira "python server.py" come ha sempre
#     fatto vedrà il database creato accanto al server.py come prima.
# Se DATA_DIR è impostata ma la cartella non esiste, la creo
# automaticamente con makedirs (evita errori al primo avvio).
DATA_DIR = os.environ.get("DATA_DIR") or os.path.dirname(__file__)
if DATA_DIR != os.path.dirname(__file__):
    os.makedirs(DATA_DIR, exist_ok=True)

DB_FILE = os.path.join(DATA_DIR, "giardino.sqlite")
HTML_FILE = os.path.join(os.path.dirname(__file__), "giardino_app.html")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")

# ── Ecowitt Config ────────────────────────────────────────────────────
# Template del config.json di default. Viene scritto dal server al primo
# avvio se il file non esiste, così l'utente trova subito un file pronto
# da modificare con le proprie credenziali e coordinate invece di doverlo
# creare manualmente. Le chiavi vuote sono "self-documenting": basta
# aprire il file (oppure la sezione Parametri della dashboard) per capire
# quali campi vanno compilati..
DEFAULT_CONFIG = {
    "ecowitt": {
        "application_key": "",
        "api_key": "",
        "mac": ""
    },
    "posizione": {
        "latitudine": 0.0,
        "longitudine": 0.0,
        "nome": ""
    }
}

def load_config():
    # Se il file non esiste, lo creo con la struttura di default. Questo
    # accade tipicamente al primo avvio del container Docker, dove il
    # volume monta una cartella data/ vuota. Sul Termux l'utente potrebbe
    # comunque arrivare qui se ha cancellato il file per qualche motivo.
    if not os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
            print(f"📝 config.json non trovato — creato file vuoto in {CONFIG_FILE}")
            print(f"   Modifica il file per inserire le credenziali Ecowitt")
        except OSError as e:
            # Caso raro: la cartella non è scrivibile. Non blocco l'avvio,
            # mostro solo un avviso e procedo con config vuoto in memoria.
            print(f"⚠️  Impossibile creare config.json ({e}) — Ecowitt disabilitato")
            return DEFAULT_CONFIG.copy()

    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        # Se il file esiste ma è malformato (per esempio l'utente l'ha
        # editato male), ritorno i default in memoria senza sovrascrivere
        # quello su disco — l'utente potrebbe voler recuperare il suo
        # contenuto guardando il file.
        print(f"⚠️  config.json non leggibile ({e}) — Ecowitt disabilitato")
        return DEFAULT_CONFIG.copy()


def save_config(new_config):
    """
    Salva la configurazione su disco in modo atomico e aggiorna le
    variabili globali in memoria così le modifiche hanno effetto
    immediato senza richiedere il riavvio del server.

    Uso il pattern "scrivi su file temporaneo, poi rinomina" perché
    rename è un'operazione atomica sui filesystem moderni: o il file
    finale è quello vecchio, o è quello nuovo, mai una via di mezzo
    corrotta. Senza questo pattern, un'interruzione del server durante
    la scrittura lascerebbe un config.json troncato e illeggibile.
    """
    global CFG, ECOWITT_APP_KEY, ECOWITT_API_KEY, ECOWITT_MAC, ECOWITT_ENABLED

    # Validazione minima: deve essere un dict, non null o array
    if not isinstance(new_config, dict):
        raise ValueError("La configurazione deve essere un oggetto JSON")

    # Scrivo prima su file temporaneo nella stessa cartella
    # (importante perché os.replace è atomico solo se i due file sono
    # sullo stesso filesystem, e cartelle diverse potrebbero non esserlo)
    tmp_file = CONFIG_FILE + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(new_config, f, indent=2, ensure_ascii=False)

    # Rinomina atomica: sostituisce config.json con config.json.tmp
    os.replace(tmp_file, CONFIG_FILE)

    # Aggiorno le variabili globali in memoria con i nuovi valori
    CFG = new_config
    ECOWITT_APP_KEY = CFG.get("ecowitt", {}).get("application_key", "")
    ECOWITT_API_KEY = CFG.get("ecowitt", {}).get("api_key", "")
    ECOWITT_MAC     = CFG.get("ecowitt", {}).get("mac", "")
    ECOWITT_ENABLED = all(k and not k.startswith("INSERISCI") for k in [ECOWITT_APP_KEY, ECOWITT_API_KEY, ECOWITT_MAC])
    print(f"💾 Configurazione aggiornata e salvata in {CONFIG_FILE}")

CFG = load_config()
ECOWITT_APP_KEY = CFG.get("ecowitt", {}).get("application_key", "")
ECOWITT_API_KEY = CFG.get("ecowitt", {}).get("api_key", "")
ECOWITT_MAC     = CFG.get("ecowitt", {}).get("mac", "")
ECOWITT_ENABLED = all(k and not k.startswith("INSERISCI") for k in [ECOWITT_APP_KEY, ECOWITT_API_KEY, ECOWITT_MAC])
ECOWITT_BASE    = "https://api.ecowitt.net/api/v3"


# ── Database ──────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS diary (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                date      TEXT    NOT NULL,
                plant     TEXT    NOT NULL,
                op        TEXT    NOT NULL,
                note      TEXT    DEFAULT '',
                created   TEXT    DEFAULT (datetime('now','localtime'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS inventory (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_type_idx  INTEGER NOT NULL,
                qty             INTEGER DEFAULT 1,
                nickname        TEXT    DEFAULT '',
                location        TEXT    DEFAULT 'indoor',
                pot_shape       TEXT    DEFAULT 'cylinder',
                pot_mat         TEXT    DEFAULT 'plastica',
                pot_diam        REAL    DEFAULT 25,
                pot_h           REAL    DEFAULT 22,
                pot_vol         REAL,
                pot_diam_top    REAL,
                pot_diam_bot    REAL,
                pot_h_trunc     REAL,
                pot_vol_trunc   REAL,
                pot_w           REAL,
                pot_d           REAL,
                pot_h_sq        REAL,
                pot_vol_sq      REAL,
                substrate       TEXT    DEFAULT 'universale_mix',
                custom_substrate TEXT,
                wh51_ch         TEXT,
                wh51_cat        TEXT    DEFAULT 'universale',
                sensor_type     TEXT    DEFAULT 'wh51',
                sim_params      TEXT    DEFAULT '{}',
                has_mulch       INTEGER DEFAULT 0,
                has_saucer      INTEGER DEFAULT 0,
                last_watered    TEXT,
                fertilizers     TEXT    DEFAULT '[]',
                diseases        TEXT    DEFAULT '[]',
                created         TEXT    DEFAULT (datetime('now','localtime'))
            )
        """)
        # Migrazione incrementale: aggiunge colonne mancanti su DB esistenti
        cols = [r[1] for r in conn.execute("PRAGMA table_info(inventory)").fetchall()]
        migrations = [
            ('sensor_type',  "ALTER TABLE inventory ADD COLUMN sensor_type TEXT DEFAULT 'wh51'"),
            ('sim_params',   "ALTER TABLE inventory ADD COLUMN sim_params TEXT DEFAULT '{}'"),
            ('has_mulch',    "ALTER TABLE inventory ADD COLUMN has_mulch INTEGER DEFAULT 0"),
            ('has_saucer',   "ALTER TABLE inventory ADD COLUMN has_saucer INTEGER DEFAULT 0"),
            ('last_watered', "ALTER TABLE inventory ADD COLUMN last_watered TEXT"),
        ]
        for col, sql in migrations:
            if col not in cols:
                conn.execute(sql)
                print(f"  🔄 Migrazione: aggiunta colonna {col}")

        # Indici per query frequenti (idempotenti, costo zero se già esistono)
        # Il diario può crescere a centinaia di righe; senza indici le query
        # "ultimi 30 giorni" e "tutto su Carmona" fanno full scan
        conn.execute("CREATE INDEX IF NOT EXISTS idx_diary_date ON diary(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_diary_plant ON diary(plant)")
        # Inventario: query frequente per plant_type_idx (calendario, simulazione)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_inventory_plant ON inventory(plant_type_idx)")

        # ────────────────────────────────────────────────────────────────
        # Tabella custom_plants: piante aggiunte dall'utente a runtime.
        # Le 26 piante native restano hard-coded nel file HTML; le custom
        # vivono qui e vengono fuse con le native al caricamento dell'app.
        #
        # Gli ID partono da 26 (PRIMARY KEY AUTOINCREMENT con seed iniziale)
        # per non collidere con le 26 native (id 0-25).
        # ────────────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS custom_plants (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                -- Identificazione e classificazione
                name            TEXT    NOT NULL,
                latin           TEXT    DEFAULT '',
                icon            TEXT    DEFAULT '🌱',
                sim_group       TEXT    DEFAULT 'arbusto',
                sensor_cat      TEXT    DEFAULT 'universale',
                -- Contenuti scheda colturale (tutti opzionali)
                description     TEXT    DEFAULT '',
                exposure        TEXT    DEFAULT '',
                watering        TEXT    DEFAULT '',
                substrate       TEXT    DEFAULT '',
                temperature     TEXT    DEFAULT '',
                fertilization   TEXT    DEFAULT '',
                pruning         TEXT    DEFAULT '',
                pests           TEXT    DEFAULT '',
                -- Parametri calendario fertilizzazione
                fert_months     TEXT    DEFAULT '3,4,5,6,7,8,9,10',
                fert_interval   INTEGER DEFAULT 21,
                fert_product    TEXT    DEFAULT '',
                fert_note       TEXT    DEFAULT '',
                -- Calendario annuale per la sezione Mensile.
                -- monthly_states: stringa CSV di 12 valori (0=riposo, 1=attivo,
                -- 2=dose ridotta, 3=attenzione speciale). Coerente col formato
                -- usato dalla struttura cPlants nel frontend.
                -- monthly_notes: JSON dict {mese: nota}, popolato solo per i mesi
                -- dove l'utente ha scritto qualcosa. Vuoto se non personalizzato.
                monthly_states  TEXT    DEFAULT '',
                monthly_notes   TEXT    DEFAULT '{}',
                -- Parametri simulazione esperti (vuoti = usa default del gruppo)
                root_depth_cm   REAL,
                p_coef          REAL,
                kc_initial      REAL,
                kc_dev          REAL,
                kc_mid          REAL,
                kc_late         REAL,
                kc_dormant      REAL,
                created         TEXT    DEFAULT (datetime('now','localtime')),
                updated         TEXT    DEFAULT (datetime('now','localtime'))
            )
        """)
        # Migrazioni incrementali per database esistenti che potrebbero non
        # avere le ultime colonne. Idempotenti: ALTER TABLE viene eseguito
        # solo se la colonna manca davvero.
        cp_cols = [r[1] for r in conn.execute("PRAGMA table_info(custom_plants)").fetchall()]
        cp_migrations = [
            ('monthly_states', "ALTER TABLE custom_plants ADD COLUMN monthly_states TEXT DEFAULT ''"),
            ('monthly_notes',  "ALTER TABLE custom_plants ADD COLUMN monthly_notes TEXT DEFAULT '{}'"),
        ]
        for col, sql in cp_migrations:
            if col not in cp_cols:
                conn.execute(sql)
                print(f"  🔄 Migrazione custom_plants: aggiunta colonna {col}")
        # Seed iniziale dell'AUTOINCREMENT a 26 (id 0-25 sono le native).
        # sqlite_sequence è la tabella interna di SQLite per AUTOINCREMENT;
        # se la tabella custom_plants è appena stata creata, ci scriviamo 25
        # così il prossimo INSERT genera id=26.
        already_seeded = conn.execute(
            "SELECT 1 FROM sqlite_sequence WHERE name='custom_plants'"
        ).fetchone()
        if not already_seeded:
            conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('custom_plants', 25)")
            print("  🌱 Tabella custom_plants creata (ID custom partono da 26)")

        conn.commit()
    print(f"✅ Database pronto: {DB_FILE}")


# ── HTTP Handler ──────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # Silenzia i log di ogni richiesta (troppo rumorosi)
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self):
        try:
            with open(HTML_FILE, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"giardino_app.html non trovato")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Servi il file HTML alla radice
        if path in ("/", "/index.html", "/giardino_app.html"):
            self.send_html()
            return

        # ── File statici PWA ──────────────────────────────────────────
        STATIC_FILES = {
            "/manifest.json":  ("manifest.json",  "application/manifest+json"),
            "/sw.js":          ("sw.js",           "application/javascript"),
            "/favicon.ico":    ("icons/favicon.ico","image/x-icon"),
        }
        if path in STATIC_FILES:
            fname, ctype = STATIC_FILES[path]
            fpath = os.path.join(os.path.dirname(__file__), fname)
            try:
                with open(fpath, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", len(body))
                if path == "/sw.js":
                    self.send_header("Service-Worker-Allowed", "/")
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
            return

        # Icone PWA: /icons/icon-192x192.png ecc.
        if path.startswith("/icons/") and path.endswith(".png"):
            fpath = os.path.join(os.path.dirname(__file__), path.lstrip("/"))
            try:
                with open(fpath, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", len(body))
                self.send_header("Cache-Control", "public, max-age=604800")
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
            return

        # GET /api/diary — restituisce tutte le voci (opzionale: ?plant=X&op=Y)
        if path == "/api/diary":
            params = parse_qs(parsed.query)
            plant = params.get("plant", [None])[0]
            op    = params.get("op",    [None])[0]

            query = "SELECT * FROM diary WHERE 1=1"
            args  = []
            if plant:
                query += " AND plant = ?"
                args.append(plant)
            if op:
                query += " AND op = ?"
                args.append(op)
            query += " ORDER BY date DESC, id DESC"

            with get_db() as conn:
                rows = conn.execute(query, args).fetchall()
            entries = [dict(r) for r in rows]
            self.send_json({"entries": entries})
            return

        # GET /api/diary/stats — conteggi rapidi per pianta e operazione
        if path == "/api/diary/stats":
            with get_db() as conn:
                by_plant = conn.execute(
                    "SELECT plant, COUNT(*) as count FROM diary GROUP BY plant ORDER BY count DESC"
                ).fetchall()
                by_op = conn.execute(
                    "SELECT op, COUNT(*) as count FROM diary GROUP BY op ORDER BY count DESC"
                ).fetchall()
                total = conn.execute("SELECT COUNT(*) as n FROM diary").fetchone()["n"]
            self.send_json({
                "total": total,
                "by_plant": [dict(r) for r in by_plant],
                "by_op": [dict(r) for r in by_op]
            })
            return

        # GET /api/inventory — restituisce tutti i vasi
        if path == "/api/inventory":
            with get_db() as conn:
                rows = conn.execute("SELECT * FROM inventory ORDER BY id").fetchall()
            # Usa il metodo unificato per deserializzare (include sim_params)
            items = [self._inv_row_to_dict(r) for r in rows]
            self.send_json({"items": items})
            return

        # GET /api/plants — restituisce le piante personalizzate (custom)
        # Le 26 native restano hard-coded nel frontend; qui ci sono solo le aggiunte
        if path == "/api/plants":
            with get_db() as conn:
                rows = conn.execute("SELECT * FROM custom_plants ORDER BY name").fetchall()
            items = [self._plant_row_to_dict(r) for r in rows]
            self.send_json({"items": items})
            return

        # GET /api/ecowitt/realtime — dati in tempo reale dalla stazione meteo
        if path == "/api/ecowitt/realtime":
            if not ECOWITT_ENABLED:
                self.send_json({"error": "Ecowitt non configurato. Inserisci le chiavi in config.json", "configured": False})
                return
            try:
                params = urlencode({
                    "application_key": ECOWITT_APP_KEY,
                    "api_key": ECOWITT_API_KEY,
                    "mac": ECOWITT_MAC,
                    "call_back": "all",
                    "temp_unitid": "1",
                    "pressure_unitid": "3",
                    "wind_speed_unitid": "6",
                    "rainfall_unitid": "12",
                })
                url = f"{ECOWITT_BASE}/device/real_time?{params}"
                req = Request(url, headers={"User-Agent": "GiardinoApp/1.0"})
                with urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                data["configured"] = True
                self.send_json(data)
            except URLError as e:
                self.send_json({"error": f"Errore connessione Ecowitt: {e}", "configured": True}, 502)
            except Exception as e:
                self.send_json({"error": str(e), "configured": True}, 500)
            return

        # GET /api/ecowitt/history?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
        if path == "/api/ecowitt/history":
            if not ECOWITT_ENABLED:
                self.send_json({"error": "Ecowitt non configurato", "configured": False})
                return
            try:
                qp = parse_qs(parsed.query)
                start = qp.get("start_date", [datetime.now().strftime("%Y-%m-%d")])[0]
                end = qp.get("end_date", [datetime.now().strftime("%Y-%m-%d")])[0]
                cb = qp.get("call_back", ["outdoor,indoor,soil"])[0]
                params = urlencode({
                    "application_key": ECOWITT_APP_KEY,
                    "api_key": ECOWITT_API_KEY,
                    "mac": ECOWITT_MAC,
                    "start_date": start + " 00:00:00",
                    "end_date": end + " 23:59:59",
                    "call_back": cb,
                    "temp_unitid": "1",
                    "pressure_unitid": "3",
                    "wind_speed_unitid": "6",
                    "rainfall_unitid": "12",
                    "cycle_type": "auto",
                })
                url = f"{ECOWITT_BASE}/device/history?{params}"
                req = Request(url, headers={"User-Agent": "GiardinoApp/1.0"})
                with urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                data["configured"] = True
                self.send_json(data)
            except URLError as e:
                self.send_json({"error": f"Errore connessione: {e}", "configured": True}, 502)
            except Exception as e:
                self.send_json({"error": str(e), "configured": True}, 500)
            return

        # GET /api/ecowitt/config — restituisce soglie e stato configurazione
        if path == "/api/ecowitt/config":
            self.send_json({
                "configured": ECOWITT_ENABLED,
                "soglie": CFG.get("soglie_umidita", {}),
                "mac": ECOWITT_MAC[:8] + "..." if ECOWITT_ENABLED else "",
                "posizione": CFG.get("posizione", {})
            })
            return

        # GET /api/config — restituisce la configurazione completa per la
        # sezione Parametri della dashboard. Diversamente da /api/ecowitt/config
        # qui restituiamo i valori reali (non mascherati) perché l'utente
        # deve poterli vedere e modificare. Questo endpoint dovrebbe essere
        # usato solo da contesti fidati (LAN locale, Tailscale, ecc.) perché
        # espone le credenziali Ecowitt in chiaro.
        if path == "/api/config":
            self.send_json({
                "ecowitt": {
                    "application_key": ECOWITT_APP_KEY,
                    "api_key": ECOWITT_API_KEY,
                    "mac": ECOWITT_MAC,
                },
                "posizione": CFG.get("posizione", {
                    "latitudine": 0.0,
                    "longitudine": 0.0,
                    "nome": ""
                })
            })
            return

        # GET /api/forecast — previsioni meteo 7 giorni via Open-Meteo (gratis, no API key)
        if path == "/api/forecast":
            pos = CFG.get("posizione", {})
            lat = pos.get("latitudine", 41.9028)
            lon = pos.get("longitudine", 12.4964)
            try:
                params = urlencode({
                    "latitude": lat,
                    "longitude": lon,
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code",
                    "hourly": "temperature_2m,precipitation,wind_speed_10m",
                    "timezone": "auto",
                    "forecast_days": "7",
                })
                url = f"https://api.open-meteo.com/v1/forecast?{params}"
                req = Request(url, headers={"User-Agent": "GiardinoApp/1.0"})
                with urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                data["posizione"] = pos.get("nome", "")
                self.send_json(data)
            except URLError as e:
                self.send_json({"error": f"Errore Open-Meteo: {e}"}, 502)
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return

        self.send_json({"error": "Not found"}, 404)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return None

    def _inv_row_to_dict(self, row):
        item = dict(row)
        # Deserializza i campi che sono JSON serializzati in SQLite
        for jf in ('fertilizers', 'diseases', 'custom_substrate', 'sim_params'):
            if item.get(jf):
                try: item[jf] = json.loads(item[jf])
                except: pass
        return item

    def _inv_fields(self, data):
        # Validazione del campo plant_type_idx: deve sempre essere un numero
        # valido perché è la chiave che collega il vaso alla sua pianta.
        # Storicamente ho avuto un bug dove la dropdown salvava "undefined"
        # per le custom (mancava il campo id nelle builder), e una difesa
        # silenziosa che convertiva null→0 mascherava il problema facendo
        # apparire la prima pianta dell'array (Sanseviera) al posto della
        # pianta scelta. Adesso preferisco un errore esplicito che faccia
        # emergere subito eventuali bug futuri simili.
        plant_idx = data.get("plantTypeIdx")
        if plant_idx is None or plant_idx == "":
            raise ValueError("plantTypeIdx mancante o nullo nel payload")
        return {
            "plant_type_idx": plant_idx,
            "qty": data.get("qty", 1),
            "nickname": data.get("nickname", ""),
            "location": data.get("location", "indoor"),
            "pot_shape": data.get("potShape", "cylinder"),
            "pot_mat": data.get("potMat", "plastica"),
            "pot_diam": data.get("potDiam", 25),
            "pot_h": data.get("potH", 22),
            "pot_vol": data.get("potVol"),
            "pot_diam_top": data.get("potDiamTop"),
            "pot_diam_bot": data.get("potDiamBot"),
            "pot_h_trunc": data.get("potHTrunc"),
            "pot_vol_trunc": data.get("potVolTrunc"),
            "pot_w": data.get("potW"),
            "pot_d": data.get("potD"),
            "pot_h_sq": data.get("potHSq"),
            "pot_vol_sq": data.get("potVolSq"),
            "substrate": data.get("substrate", "universale_mix"),
            "custom_substrate": json.dumps(data["customSubstrate"]) if data.get("customSubstrate") else None,
            "wh51_ch": data.get("wh51Ch"),
            "wh51_cat": data.get("wh51Cat", "universale"),
            "sensor_type": data.get("sensorType", "wh51"),
            "sim_params": json.dumps(data.get("simParams", {})),
            "has_mulch": 1 if data.get("hasMulch") else 0,
            "has_saucer": 1 if data.get("hasSaucer") else 0,
            "last_watered": data.get("lastWatered"),
            "fertilizers": json.dumps(data.get("fertilizers", [])),
            "diseases": json.dumps(data.get("diseases", [])),
        }

    # ── Helpers per custom_plants ─────────────────────────────────────
    # Stesso pattern di _inv_*: row_to_dict per leggere, _fields per scrivere.
    # I campi numerici opzionali (Kc, p, profondità radici) restano None se vuoti
    # per indicare al frontend "usa il default del gruppo". Il frontend mappa
    # snake_case → camelCase nella sua funzione plantDbToJs equivalente.
    def _plant_row_to_dict(self, row):
        item = dict(row)
        # Le note mensili sono salvate come JSON serializzato. Le deserializzo
        # qui così il frontend riceve direttamente un oggetto. Se il JSON è
        # malformato (improbabile ma possibile) o vuoto, restituisco un dict vuoto
        # invece di lasciare la stringa raw.
        if item.get('monthly_notes'):
            try:
                item['monthly_notes'] = json.loads(item['monthly_notes'])
            except (json.JSONDecodeError, TypeError):
                item['monthly_notes'] = {}
        else:
            item['monthly_notes'] = {}
        return item

    def _plant_fields(self, data):
        # Helper per parsare numeri opzionali: stringa vuota o None → None,
        # altrimenti float. Questo permette al frontend di mandare campi vuoti
        # senza dover fare distinzioni nel form.
        def opt_num(key):
            v = data.get(key)
            if v is None or v == "" or v == "null":
                return None
            try: return float(v)
            except (TypeError, ValueError): return None

        # I mesi di fertilizzazione possono arrivare come array [3,4,5] o come
        # stringa già formattata "3,4,5". Normalizzo sempre a stringa CSV.
        fert_months = data.get("fertMonths", "3,4,5,6,7,8,9,10")
        if isinstance(fert_months, list):
            fert_months = ",".join(str(m) for m in fert_months)

        # Gli stati mensili arrivano come array di 12 numeri [0,0,1,1,...] dal
        # frontend, oppure come stringa CSV già formattata. Stringa o array vuoti
        # significano "nessun calendario manuale, deduci dai fert_months".
        monthly_states = data.get("monthlyStates", "")
        if isinstance(monthly_states, list):
            if len(monthly_states) == 0:
                # Array vuoto = intento "deduci automaticamente". Salvo
                # stringa vuota, non "0,0,...,0" che semanticamente significa
                # "calendario manuale con tutto a riposo" (significato diverso).
                monthly_states = ""
            else:
                # Array non vuoto: validazione difensiva e normalizzazione a CSV.
                # Tengo solo valori 0-3 e padding/troncamento a 12.
                cleaned = [int(v) if isinstance(v, (int, float)) and 0 <= v <= 3 else 0 for v in monthly_states]
                cleaned = (cleaned + [0]*12)[:12]
                monthly_states = ",".join(str(v) for v in cleaned)

        # Le note mensili arrivano come oggetto {mese: nota} dove mese è
        # una chiave 1-12. Le serializzo a JSON per salvarle in SQLite.
        # Filtro le note vuote per non occupare spazio inutilmente.
        monthly_notes = data.get("monthlyNotes", {})
        if isinstance(monthly_notes, dict):
            cleaned_notes = {str(k): str(v).strip() for k, v in monthly_notes.items()
                            if v and str(v).strip()}
            monthly_notes = json.dumps(cleaned_notes, ensure_ascii=False)
        elif not isinstance(monthly_notes, str):
            monthly_notes = "{}"

        return {
            "name": data.get("name", "").strip(),
            "latin": data.get("latin", "").strip(),
            "icon": data.get("icon", "🌱"),
            "sim_group": data.get("simGroup", "arbusto"),
            "sensor_cat": data.get("sensorCat", "universale"),
            "description": data.get("description", ""),
            "exposure": data.get("exposure", ""),
            "watering": data.get("watering", ""),
            "substrate": data.get("substrate", ""),
            "temperature": data.get("temperature", ""),
            "fertilization": data.get("fertilization", ""),
            "pruning": data.get("pruning", ""),
            "pests": data.get("pests", ""),
            "fert_months": fert_months,
            "fert_interval": int(data.get("fertInterval", 21)),
            "fert_product": data.get("fertProduct", ""),
            "fert_note": data.get("fertNote", ""),
            "monthly_states": monthly_states,
            "monthly_notes": monthly_notes,
            "root_depth_cm": opt_num("rootDepthCm"),
            "p_coef": opt_num("pCoef"),
            "kc_initial": opt_num("kcInitial"),
            "kc_dev": opt_num("kcDev"),
            "kc_mid": opt_num("kcMid"),
            "kc_late": opt_num("kcLate"),
            "kc_dormant": opt_num("kcDormant"),
        }

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # POST /api/config — salva la configurazione (Ecowitt + posizione)
        # dalla sezione Parametri della dashboard. Il payload deve essere
        # un oggetto JSON con la stessa struttura che GET /api/config
        # restituisce. La modifica ha effetto immediato in memoria, e il
        # file su disco viene aggiornato in modo atomico.
        if path == "/api/config":
            data = self._read_json_body()
            if data is None:
                self.send_json({"error": "JSON non valido"}, 400)
                return
            try:
                # Costruisco il nuovo config preservando eventuali sezioni
                # esistenti che la dashboard non gestisce (per esempio
                # soglie_umidita o altre estensioni future). In pratica:
                # parto dal CFG attuale e sovrascrivo solo le sezioni
                # ecowitt e posizione che la dashboard ha modificato.
                new_config = dict(CFG) if isinstance(CFG, dict) else {}
                if "ecowitt" in data:
                    eco = data["ecowitt"]
                    new_config["ecowitt"] = {
                        "application_key": str(eco.get("application_key", "")).strip(),
                        "api_key":         str(eco.get("api_key", "")).strip(),
                        "mac":             str(eco.get("mac", "")).strip(),
                    }
                if "posizione" in data:
                    pos = data["posizione"]
                    # Le coordinate possono arrivare come numeri o stringhe
                    # (i form HTML inviano tutto come stringa). Le converto
                    # in float, e in caso di errore uso 0.0 come fallback.
                    def to_float(v):
                        try: return float(v)
                        except (TypeError, ValueError): return 0.0
                    new_config["posizione"] = {
                        "latitudine":  to_float(pos.get("latitudine")),
                        "longitudine": to_float(pos.get("longitudine")),
                        "nome":        str(pos.get("nome", "")).strip(),
                    }
                save_config(new_config)
                self.send_json({"ok": True, "ecowitt_enabled": ECOWITT_ENABLED})
            except (ValueError, OSError) as e:
                self.send_json({"error": str(e)}, 400)
            return

        # POST /api/diary
        if path == "/api/diary":
            data = self._read_json_body()
            if data is None:
                self.send_json({"error": "JSON non valido"}, 400)
                return
            date  = data.get("date", "").strip()
            plant = data.get("plant", "").strip()
            op    = data.get("op", "").strip()
            note  = data.get("note", "").strip()
            if not date or not plant or not op:
                self.send_json({"error": "Campi obbligatori: date, plant, op"}, 400)
                return
            with get_db() as conn:
                cur = conn.execute(
                    "INSERT INTO diary (date, plant, op, note) VALUES (?, ?, ?, ?)",
                    (date, plant, op, note)
                )
                conn.commit()
                new_id = cur.lastrowid
                row = conn.execute("SELECT * FROM diary WHERE id = ?", (new_id,)).fetchone()
            print(f"  ➕ Nuova voce diario: {plant} — {op} — {date}")
            self.send_json({"entry": dict(row)}, 201)
            return

        # POST /api/inventory
        if path == "/api/inventory":
            data = self._read_json_body()
            if data is None:
                self.send_json({"error": "JSON non valido"}, 400)
                return
            try:
                fields = self._inv_fields(data)
            except ValueError as e:
                # _inv_fields lancia ValueError se plant_type_idx è null o vuoto.
                # Questo è un errore di validazione del payload, non un bug del
                # database, quindi rispondo 400 Bad Request con messaggio chiaro.
                self.send_json({"error": str(e)}, 400)
                return
            cols = ", ".join(fields.keys())
            placeholders = ", ".join(["?"] * len(fields))
            with get_db() as conn:
                cur = conn.execute(
                    f"INSERT INTO inventory ({cols}) VALUES ({placeholders})",
                    list(fields.values())
                )
                conn.commit()
                new_id = cur.lastrowid
                row = conn.execute("SELECT * FROM inventory WHERE id = ?", (new_id,)).fetchone()
            print(f"  ➕ Nuovo vaso: idx={fields['plant_type_idx']} — {fields['nickname'] or 'senza nome'}")
            self.send_json({"item": self._inv_row_to_dict(row)}, 201)
            return

        # POST /api/plants — crea una nuova pianta custom.
        # L'id viene assegnato automaticamente da SQLite (>= 26 grazie al seed).
        if path == "/api/plants":
            data = self._read_json_body()
            if data is None:
                self.send_json({"error": "JSON non valido"}, 400)
                return
            fields = self._plant_fields(data)
            # Validazione minima: il nome è l'unico campo obbligatorio
            if not fields["name"]:
                self.send_json({"error": "Il nome è obbligatorio"}, 400)
                return
            cols = ", ".join(fields.keys())
            placeholders = ", ".join(["?"] * len(fields))
            with get_db() as conn:
                cur = conn.execute(
                    f"INSERT INTO custom_plants ({cols}) VALUES ({placeholders})",
                    list(fields.values())
                )
                conn.commit()
                new_id = cur.lastrowid
                row = conn.execute("SELECT * FROM custom_plants WHERE id = ?", (new_id,)).fetchone()
            print(f"  🌱 Nuova pianta custom: id={new_id} — {fields['name']}")
            self.send_json({"item": self._plant_row_to_dict(row)}, 201)
            return

        self.send_json({"error": "Not found"}, 404)

    def do_PUT(self):
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api":
            self.send_json({"error": "Not found"}, 404)
            return
        table = parts[1]
        try:
            entry_id = int(parts[2])
        except ValueError:
            self.send_json({"error": "ID non valido"}, 400)
            return

        data = self._read_json_body()
        if data is None:
            self.send_json({"error": "JSON non valido"}, 400)
            return

        # PUT /api/diary/:id
        if table == "diary":
            with get_db() as conn:
                row = conn.execute("SELECT * FROM diary WHERE id = ?", (entry_id,)).fetchone()
                if not row:
                    self.send_json({"error": "Voce non trovata"}, 404)
                    return
                date  = data.get("date",  row["date"]).strip()
                plant = data.get("plant", row["plant"]).strip()
                op    = data.get("op",    row["op"]).strip()
                note  = data.get("note",  row["note"]).strip()
                if not date or not plant or not op:
                    self.send_json({"error": "Campi obbligatori: date, plant, op"}, 400)
                    return
                conn.execute(
                    "UPDATE diary SET date=?, plant=?, op=?, note=? WHERE id=?",
                    (date, plant, op, note, entry_id)
                )
                conn.commit()
                updated = conn.execute("SELECT * FROM diary WHERE id = ?", (entry_id,)).fetchone()
            print(f"  ✏️  Diario modificato: id={entry_id}")
            self.send_json({"entry": dict(updated)})
            return

        # PUT /api/inventory/:id
        if table == "inventory":
            with get_db() as conn:
                row = conn.execute("SELECT * FROM inventory WHERE id = ?", (entry_id,)).fetchone()
                if not row:
                    self.send_json({"error": "Vaso non trovato"}, 404)
                    return
                try:
                    fields = self._inv_fields(data)
                except ValueError as e:
                    # Stessa logica del POST: errore esplicito invece di silent fallback
                    self.send_json({"error": str(e)}, 400)
                    return
                sets = ", ".join(f"{k}=?" for k in fields)
                conn.execute(f"UPDATE inventory SET {sets} WHERE id=?", list(fields.values()) + [entry_id])
                conn.commit()
                updated = conn.execute("SELECT * FROM inventory WHERE id = ?", (entry_id,)).fetchone()
            print(f"  ✏️  Vaso modificato: id={entry_id}")
            self.send_json({"item": self._inv_row_to_dict(updated)})
            return

        # PUT /api/plants/:id — modifica una pianta custom esistente.
        # Le 26 native (id 0-25) non sono modificabili: per design vivono
        # nel codice statico. Tentativi di edit su id < 26 vengono respinti.
        if table == "plants":
            if entry_id < 26:
                self.send_json({"error": "Le piante predefinite non sono modificabili"}, 403)
                return
            with get_db() as conn:
                row = conn.execute("SELECT * FROM custom_plants WHERE id = ?", (entry_id,)).fetchone()
                if not row:
                    self.send_json({"error": "Pianta non trovata"}, 404)
                    return
                fields = self._plant_fields(data)
                if not fields["name"]:
                    self.send_json({"error": "Il nome è obbligatorio"}, 400)
                    return
                # Aggiorna anche il timestamp di ultima modifica
                fields["updated"] = "datetime('now','localtime')"
                # Per il timestamp uso un placeholder SQL diretto, non un parametro
                sets = ", ".join(f"{k}=?" for k in fields if k != "updated")
                values = [v for k, v in fields.items() if k != "updated"]
                conn.execute(
                    f"UPDATE custom_plants SET {sets}, updated=datetime('now','localtime') WHERE id=?",
                    values + [entry_id]
                )
                conn.commit()
                updated_row = conn.execute("SELECT * FROM custom_plants WHERE id = ?", (entry_id,)).fetchone()
            print(f"  ✏️  Pianta custom modificata: id={entry_id} — {fields['name']}")
            self.send_json({"item": self._plant_row_to_dict(updated_row)})
            return

        self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api":
            self.send_json({"error": "Not found"}, 404)
            return
        table = parts[1]
        try:
            entry_id = int(parts[2])
        except ValueError:
            self.send_json({"error": "ID non valido"}, 400)
            return

        # Le piante custom hanno una logica DELETE speciale: verifica delle
        # dipendenze (vasi e voci diario) prima di eliminare.
        if table == "plants":
            if entry_id < 26:
                self.send_json({"error": "Le piante predefinite non sono eliminabili"}, 403)
                return
            with get_db() as conn:
                row = conn.execute("SELECT * FROM custom_plants WHERE id = ?", (entry_id,)).fetchone()
                if not row:
                    self.send_json({"error": "Pianta non trovata"}, 404)
                    return
                plant_name = row["name"]
                # Verifica vasi associati (l'inventario usa plant_type_idx)
                pots = conn.execute(
                    "SELECT id, nickname FROM inventory WHERE plant_type_idx = ?",
                    (entry_id,)
                ).fetchall()
                # Verifica voci diario (il diario usa il NOME della pianta come stringa)
                diary_count = conn.execute(
                    "SELECT COUNT(*) FROM diary WHERE plant = ?",
                    (plant_name,)
                ).fetchone()[0]

                if pots or diary_count > 0:
                    # Conflitto: ci sono dipendenze, blocca l'eliminazione
                    pot_list = [{"id": p["id"], "nickname": p["nickname"] or "senza nome"} for p in pots]
                    self.send_json({
                        "error": "Eliminazione bloccata: la pianta è in uso",
                        "blocking": {
                            "pots": pot_list,
                            "diary_entries": diary_count
                        }
                    }, 409)
                    return
                # Nessuna dipendenza, procedi con l'eliminazione
                conn.execute("DELETE FROM custom_plants WHERE id = ?", (entry_id,))
                conn.commit()
            print(f"  🗑️  Pianta custom eliminata: id={entry_id} — {plant_name}")
            self.send_json({"deleted": entry_id, "name": plant_name})
            return

        if table not in ("diary", "inventory"):
            self.send_json({"error": "Not found"}, 404)
            return

        with get_db() as conn:
            row = conn.execute(f"SELECT id FROM {table} WHERE id = ?", (entry_id,)).fetchone()
            if not row:
                self.send_json({"error": "Elemento non trovato"}, 404)
                return
            conn.execute(f"DELETE FROM {table} WHERE id = ?", (entry_id,))
            conn.commit()

        label = "Voce diario" if table == "diary" else "Vaso"
        print(f"  🗑️  {label} eliminato: id={entry_id}")
        self.send_json({"deleted": entry_id})


# ── Avvio ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    # Bind su 0.0.0.0 = raggiungibile da tutta la LAN (necessario per
    # Tailscale, Cloudflare Tunnel, accesso da altri device). Se preferisci
    # limitare al solo localhost per ragioni di sicurezza, cambia in "localhost".
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"\n🌿 Giardino App Server avviato")
    print(f"   Locale:              http://localhost:{PORT}")
    print(f"   LAN:                 http://<ip-del-dispositivo>:{PORT}")
    print(f"   Database:            {DB_FILE}")
    if ECOWITT_ENABLED:
        print(f"   🌤️  Ecowitt:          Attivo (MAC: {ECOWITT_MAC[:8]}...)")
    else:
        print(f"   ⚠️  Ecowitt:          Non configurato (modifica config.json)")
    print(f"   Premi Ctrl+C per fermare il server\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Server fermato.")
        server.server_close()
