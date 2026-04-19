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
DB_FILE = os.path.join(os.path.dirname(__file__), "giardino.sqlite")
HTML_FILE = os.path.join(os.path.dirname(__file__), "giardino_app.html")
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

# ── Ecowitt Config ────────────────────────────────────────────────────
def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print("⚠️  config.json non trovato — Ecowitt disabilitato")
        return {}

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
        return {
            "plant_type_idx": data.get("plantTypeIdx", 0),
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

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

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
            fields = self._inv_fields(data)
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
                fields = self._inv_fields(data)
                sets = ", ".join(f"{k}=?" for k in fields)
                conn.execute(f"UPDATE inventory SET {sets} WHERE id=?", list(fields.values()) + [entry_id])
                conn.commit()
                updated = conn.execute("SELECT * FROM inventory WHERE id = ?", (entry_id,)).fetchone()
            print(f"  ✏️  Vaso modificato: id={entry_id}")
            self.send_json({"item": self._inv_row_to_dict(updated)})
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
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"\n🌿 Giardino App Server avviato")
    print(f"   Apri il browser su:  http://localhost:{PORT}")
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
