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
from urllib.parse import urlparse, parse_qs
from datetime import datetime

# ── Configurazione ────────────────────────────────────────────────────
PORT = 8765
DB_FILE = os.path.join(os.path.dirname(__file__), "giardino.sqlite")
HTML_FILE = os.path.join(os.path.dirname(__file__), "giardino_app.html")


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

        self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        if self.path != "/api/diary":
            self.send_json({"error": "Not found"}, 404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
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

        print(f"  ➕ Nuova voce: {plant} — {op} — {date}")
        self.send_json({"entry": dict(row)}, 201)

    def do_PUT(self):
        # PUT /api/diary/123
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api" or parts[1] != "diary":
            self.send_json({"error": "Not found"}, 404)
            return
        try:
            entry_id = int(parts[2])
        except ValueError:
            self.send_json({"error": "ID non valido"}, 400)
            return

        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "JSON non valido"}, 400)
            return

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

        print(f"  ✏️  Voce modificata: id={entry_id} — {plant} — {op} — {date}")
        self.send_json({"entry": dict(updated)})

    def do_DELETE(self):
        # DELETE /api/diary/123
        parts = self.path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api" or parts[1] != "diary":
            self.send_json({"error": "Not found"}, 404)
            return
        try:
            entry_id = int(parts[2])
        except ValueError:
            self.send_json({"error": "ID non valido"}, 400)
            return

        with get_db() as conn:
            row = conn.execute("SELECT id FROM diary WHERE id = ?", (entry_id,)).fetchone()
            if not row:
                self.send_json({"error": "Voce non trovata"}, 404)
                return
            conn.execute("DELETE FROM diary WHERE id = ?", (entry_id,))
            conn.commit()

        print(f"  🗑️  Voce eliminata: id={entry_id}")
        self.send_json({"deleted": entry_id})


# ── Avvio ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"\n🌿 Giardino App Server avviato")
    print(f"   Apri il browser su:  http://localhost:{PORT}")
    print(f"   Database:            {DB_FILE}")
    print(f"   Premi Ctrl+C per fermare il server\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Server fermato.")
        server.server_close()
