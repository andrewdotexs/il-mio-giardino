#!/usr/bin/env python3
"""
Giardino App — Sistema Notifiche
=================================
Controlla il calendario e i sensori, invia notifiche/SMS con allerte e eventi del giorno.

Modalità:
  python notifier.py              →  Controlla e invia allerte se necessario
  python notifier.py --test       →  Invia una notifica di prova
  python notifier.py --cron       →  Installa il job cron in Termux
  python notifier.py --summary    →  Forza l'invio del riepilogo giornaliero

Metodo di invio (configurabile in config.json → sms → metodo):
  "notifica"  →  Notifica Android via termux-notification (default, consigliato)
                  Non richiede permesso SMS, funziona subito
  "sms"       →  SMS via termux-sms-send
                  Richiede permesso SMS su Termux:API + numero in config.json

Setup Termux:
  pkg install termux-api
  + installare l'app Termux:API da F-Droid
"""

import json
import os
import sys
import subprocess
import sqlite3
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

# ── Configurazione ────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
DB_FILE = os.path.join(SCRIPT_DIR, "giardino.sqlite")
LOG_FILE = os.path.join(SCRIPT_DIR, "notifications.log")

def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

CFG = load_config()
SMS_NUMBER = CFG.get("sms", {}).get("telefono", "")
NOTIFY_METHOD = CFG.get("sms", {}).get("metodo", "notifica")  # "notifica" o "sms"
SMS_ENABLED = bool(SMS_NUMBER and not SMS_NUMBER.startswith("INSERISCI")) if NOTIFY_METHOD == "sms" else True
ECOWITT_ENABLED = all(
    CFG.get("ecowitt", {}).get(k, "").strip() and not CFG.get("ecowitt", {}).get(k, "").startswith("INSERISCI")
    for k in ["application_key", "api_key", "mac"]
)

SOGLIE = CFG.get("soglie_umidita", {
    "succulente": {"secco": 10, "ok_max": 35, "umido": 40},
    "tropicali": {"secco": 25, "ok_max": 55, "umido": 65},
    "mediterranee": {"secco": 15, "ok_max": 40, "umido": 50},
    "agrumi": {"secco": 20, "ok_max": 50, "umido": 60},
    "bonsai": {"secco": 20, "ok_max": 50, "umido": 60},
    "orchidee": {"secco": 15, "ok_max": 40, "umido": 50},
    "aromatiche": {"secco": 8, "ok_max": 30, "umido": 35},
    "universale": {"secco": 20, "ok_max": 50, "umido": 60},
})

SOGLIE_EC = CFG.get("soglie_ec", {
    "succulente":   {"min":200,  "target":500,  "max":1500},
    "tropicali":    {"min":500,  "target":1000, "max":2500},
    "mediterranee": {"min":300,  "target":700,  "max":1800},
    "agrumi":       {"min":600,  "target":1100, "max":2200},
    "bonsai":       {"min":400,  "target":800,  "max":1800},
    "orchidee":     {"min":300,  "target":600,  "max":1200},
    "aromatiche":   {"min":200,  "target":500,  "max":1400},
    "universale":   {"min":400,  "target":800,  "max":2000},
})

TEMP_RADICI_MIN = CFG.get("temp_radici_min", 12)
TEMP_RADICI_MAX = CFG.get("temp_radici_max", 30)
EC_MOISTURE_MIN = CFG.get("ec_moisture_min", 30)


# ── Notifiche ─────────────────────────────────────────────────────────
def is_termux():
    """Controlla se siamo in Termux"""
    return os.path.exists("/data/data/com.termux") or "TERMUX" in os.environ.get("PREFIX", "")

def send_notification(title, message, priority="high"):
    """Invia una notifica Android via termux-notification"""
    if not is_termux():
        log(f"[NON TERMUX] Notifica salvata nel log")
        log(f"  Titolo: {title}")
        log(f"  Messaggio: {message}")
        return False

    try:
        cmd = [
            "termux-notification",
            "--title", title,
            "--content", message[:4000],
            "--priority", priority,
            "--vibrate", "500,200,500",
            "--led-color", "00ff00",
            "--group", "giardino",
            "--id", "giardino_" + str(hash(title) % 10000),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            log(f"[NOTIFICA OK] {title} ({len(message)} car.)")
            return True
        else:
            log(f"[NOTIFICA ERRORE] {result.stderr}")
            return False
    except FileNotFoundError:
        log("[NOTIFICA ERRORE] termux-notification non trovato. Installa: pkg install termux-api")
        return False
    except Exception as e:
        log(f"[NOTIFICA ERRORE] {e}")
        return False

def send_sms(number, message):
    """Invia SMS via Termux:API"""
    if not number:
        log(f"[SKIP] Nessun numero configurato")
        return False
    if len(message) > 1600:
        message = message[:1597] + "..."
    if not is_termux():
        log(f"[NON TERMUX] SMS salvato nel log")
        log(f"  Destinatario: {number}")
        log(f"  Messaggio: {message}")
        return False
    try:
        result = subprocess.run(
            ["termux-sms-send", "-n", number, message],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            log(f"[SMS OK] Inviato a {number} ({len(message)} car.)")
            return True
        else:
            log(f"[SMS ERRORE] {result.stderr}")
            return False
    except FileNotFoundError:
        log("[SMS ERRORE] termux-sms-send non trovato. Installa: pkg install termux-api")
        return False
    except Exception as e:
        log(f"[SMS ERRORE] {e}")
        return False

def notify(message, title="🌿 Giardino", priority="high"):
    """Dispatcher: invia tramite il metodo configurato (notifica o sms)"""
    if NOTIFY_METHOD == "sms":
        return send_sms(SMS_NUMBER, f"{title}\n\n{message}")
    else:
        return send_notification(title, message, priority)

def log(msg):
    """Log su file e console"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except:
        pass


# ── Database ──────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def get_inventory():
    """Carica l'inventario vasi dal DB"""
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT * FROM inventory").fetchall()
        items = []
        for r in rows:
            item = dict(r)
            for jf in ('fertilizers', 'diseases', 'custom_substrate'):
                if item.get(jf):
                    try: item[jf] = json.loads(item[jf])
                    except: pass
            items.append(item)
        return items
    except:
        return []

# Nomi piante (corrispondono agli indici di sPlants nel frontend)
PLANT_NAMES = [
    "Sanseviera","Orchidea","Ficus Benjamina","Ficus Elastica","Oleandro",
    "Glicine Bonsai","Limone","Moneta Cinese","Vinca","Mimosa",
    "Melograno","Stella di Natale","Aloe Vera","Liquidambar","Ippocastano",
    "Betulla","Acero Campestre","Pitosforo","Spino di Giuda","Gelso Bonsai",
    "Tradescantia","Rosmarino","Salvia","Paulownia","Crassula Ovata","Carmona Bonsai"
]


# ── Ecowitt ───────────────────────────────────────────────────────────
def fetch_ecowitt_realtime():
    """Recupera dati in tempo reale dalla stazione meteo"""
    if not ECOWITT_ENABLED:
        return None
    try:
        ew = CFG["ecowitt"]
        url = (
            f"https://api.ecowitt.net/api/v3/device/real_time?"
            f"application_key={ew['application_key']}&api_key={ew['api_key']}"
            f"&mac={ew['mac']}&call_back=all"
            f"&temp_unitid=1&pressure_unitid=3&wind_speed_unitid=6&rainfall_unitid=12"
        )
        req = Request(url, headers={"User-Agent": "GiardinoNotifier/1.0"})
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("code") == 0:
            return data.get("data", {})
        return None
    except Exception as e:
        log(f"[ECOWITT ERRORE] {e}")
        return None

def get_ecowitt_value(data, section, key):
    try:
        s = data.get(section, {})
        item = s.get(key, {})
        return item.get("value") if isinstance(item, dict) else item
    except:
        return None

def get_soil_data(data, ch):
    """Legge moisture + temp + EC per canale WH51/WH52"""
    result = {"moisture": None, "temp": None, "ec": None}
    def gv(sec, key):
        v = get_ecowitt_value(data, sec, key)
        if v is None or v == "" or v == "--": return None
        try: return float(v)
        except: return None
    result["moisture"] = gv("soil", f"soilmoisture{ch}") or gv("soil", f"soil_ch{ch}")
    result["temp"] = gv("soil", f"soiltemp{ch}") or gv("soil", f"tf_ch{ch}") or gv(f"temp_and_humidity_ch{ch}", "temperature")
    result["ec"] = gv("soil", f"soilad{ch}") or gv("soil", f"ec_ch{ch}") or gv("soil", f"soilec{ch}")
    return result


# ── Generatore messaggi ──────────────────────────────────────────────
def build_daily_summary():
    """Costruisce il riepilogo giornaliero"""
    today = datetime.now()
    parts = []
    parts.append(f"🌿 GIARDINO — {today.strftime('%d/%m/%Y')}")
    parts.append("")

    alerts = []

    # ── Meteo
    ew_data = fetch_ecowitt_realtime()
    if ew_data:
        temp = get_ecowitt_value(ew_data, "outdoor", "temperature")
        hum = get_ecowitt_value(ew_data, "outdoor", "humidity")
        rain = get_ecowitt_value(ew_data, "rainfall", "daily")

        meteo_line = "🌤️ "
        if temp: meteo_line += f"{float(temp):.1f}°C "
        if hum: meteo_line += f"💧{hum}% "
        if rain and float(rain) > 0: meteo_line += f"🌧️{float(rain):.1f}mm"
        parts.append(meteo_line)

        # Allerte meteo
        if temp and float(temp) < 5:
            alerts.append(f"🥶 GELO {float(temp):.0f}°C! Proteggi Carmona, Limone, Stella di Natale")
        elif temp and float(temp) < 10:
            alerts.append(f"❄️ Freddo {float(temp):.0f}°C — Carmona e tropicali al riparo")
        if temp and float(temp) > 35:
            alerts.append(f"🔥 Caldo {float(temp):.0f}°C — ombreggia e annaffia di più")
        if rain and float(rain) > 5:
            alerts.append(f"🌧️ Pioggia {float(rain):.1f}mm — salta annaffiatura esterne")

        # ── Umidità terreno / EC / temperatura radici
        inv = get_inventory()
        dry_plants = []
        wet_plants = []
        ec_issues = []
        temp_issues = []
        for item in inv:
            ch = item.get("wh51_ch")
            if not ch: continue
            ch = int(ch)
            sd = get_soil_data(ew_data, ch)
            idx = item.get("plant_type_idx", 0)
            name = item.get("nickname") or (PLANT_NAMES[idx] if idx < len(PLANT_NAMES) else f"Pianta #{idx}")
            cat = item.get("wh51_cat", "universale")
            thresh = SOGLIE.get(cat, SOGLIE["universale"])
            ec_thresh = SOGLIE_EC.get(cat, SOGLIE_EC["universale"])
            is_wh52 = item.get("sensor_type") == "wh52"

            # Moisture
            if sd["moisture"] is not None:
                m = sd["moisture"]
                if m < thresh.get("secco", 20):
                    dry_plants.append(f"{name} ({m:.0f}%)")
                elif m > thresh.get("umido", 60):
                    wet_plants.append(f"{name} ({m:.0f}%)")

            # EC (WH52)
            if is_wh52 and sd["ec"] is not None:
                reliable = sd["moisture"] is not None and sd["moisture"] >= EC_MOISTURE_MIN
                if reliable:
                    if sd["ec"] > ec_thresh["max"]:
                        ec_issues.append(f"⚡ {name}: EC {sd['ec']:.0f} (alto)")
                    elif sd["ec"] < ec_thresh["min"]:
                        ec_issues.append(f"📉 {name}: EC {sd['ec']:.0f} (basso)")

            # Temperatura radici (WH52)
            if is_wh52 and sd["temp"] is not None:
                if sd["temp"] < TEMP_RADICI_MIN:
                    temp_issues.append(f"❄️ {name}: {sd['temp']:.1f}°C radici")
                elif sd["temp"] > TEMP_RADICI_MAX:
                    temp_issues.append(f"🔥 {name}: {sd['temp']:.1f}°C radici")

        if dry_plants:
            alerts.append("🏜️ SECCO: " + ", ".join(dry_plants))
        if wet_plants:
            alerts.append("💦 Umido: " + ", ".join(wet_plants))
        if ec_issues:
            alerts.append("⚡ EC: " + ", ".join(ec_issues))
        if temp_issues:
            alerts.append("🌡️ Radici: " + ", ".join(temp_issues))

    # ── Calendario (eventi del giorno)
    # Nota: gli eventi sono generati dal JS nel frontend, qui facciamo un check semplificato
    month = today.month
    day_of_year = today.timetuple().tm_yday

    # Fertilizzazioni (basate sugli intervalli approssimati)
    fert_today = []
    # Semplificato: controlla se oggi è un giorno di concimazione per le piante principali
    # (il calendario preciso è nel frontend, qui notifichiamo in modo approssimato)

    # ── Assembla messaggio
    if alerts:
        parts.append("")
        parts.append("⚠️ ALLERTE:")
        parts.extend(alerts)

    # ── Previsioni
    fc_alerts = build_forecast_alerts()
    if fc_alerts:
        parts.append("")
        parts.append("🔮 PREVISIONI:")
        parts.extend(fc_alerts)

    # Nota sul calendario
    parts.append("")
    parts.append("📆 Controlla il calendario nell'app per le attività di oggi")
    parts.append(f"🔗 http://localhost:8765")

    return "\n".join(parts)


def build_soil_alert():
    """Costruisce allerta per terreno secco, EC estremo o temperatura radici anomala"""
    ew_data = fetch_ecowitt_realtime()
    if not ew_data:
        return None

    inv = get_inventory()
    dry_plants = []
    ec_high = []
    ec_low = []
    temp_cold = []
    temp_hot = []

    for item in inv:
        ch = item.get("wh51_ch")
        if not ch: continue
        ch = int(ch)
        sd = get_soil_data(ew_data, ch)
        if sd["moisture"] is None and sd["ec"] is None and sd["temp"] is None:
            continue

        idx = item.get("plant_type_idx", 0)
        name = item.get("nickname") or (PLANT_NAMES[idx] if idx < len(PLANT_NAMES) else f"Pianta #{idx}")
        cat = item.get("wh51_cat", "universale")
        thresh = SOGLIE.get(cat, SOGLIE["universale"])
        ec_thresh = SOGLIE_EC.get(cat, SOGLIE_EC["universale"])
        is_wh52 = item.get("sensor_type") == "wh52"
        secco = thresh.get("secco", 20)

        # Umidità
        if sd["moisture"] is not None:
            m = sd["moisture"]
            if m < secco * 0.5:
                dry_plants.append(f"🔴 {name}: {m:.0f}% (critico!)")
            elif m < secco:
                dry_plants.append(f"🟡 {name}: {m:.0f}%")

        # EC (solo WH52, affidabile se moisture ≥ EC_MOISTURE_MIN)
        if is_wh52 and sd["ec"] is not None:
            reliable = sd["moisture"] is not None and sd["moisture"] >= EC_MOISTURE_MIN
            if reliable:
                if sd["ec"] > ec_thresh["max"]:
                    ec_high.append(f"🔴 {name}: {sd['ec']:.0f} µS/cm — lavaggio substrato!")
                elif sd["ec"] < ec_thresh["min"]:
                    ec_low.append(f"🟡 {name}: {sd['ec']:.0f} µS/cm — serve concime")

        # Temperatura radici (solo WH52)
        if is_wh52 and sd["temp"] is not None:
            if sd["temp"] < TEMP_RADICI_MIN:
                temp_cold.append(f"❄️ {name}: radici {sd['temp']:.1f}°C")
            elif sd["temp"] > TEMP_RADICI_MAX:
                temp_hot.append(f"🔥 {name}: radici {sd['temp']:.1f}°C")

    if not (dry_plants or ec_high or temp_cold or temp_hot):
        return None

    parts = []
    if dry_plants:
        parts.append("🚨 TERRENO SECCO")
        parts.extend(dry_plants)
    if ec_high:
        parts.append("")
        parts.append("⚡ ACCUMULO SALI (EC alto)")
        parts.extend(ec_high)
        parts.append("💧 Lavaggio: 2× acqua senza fertilizzante")
    if temp_cold:
        parts.append("")
        parts.append("❄️ RADICI FREDDE")
        parts.extend(temp_cold)
        parts.append("Riduci annaffiature — radici non assorbono bene")
    if temp_hot:
        parts.append("")
        parts.append("🔥 RADICI CALDE")
        parts.extend(temp_hot)
        parts.append("Pacciamatura consigliata")

    # Suggerimenti EC basso solo se non ci sono problemi più urgenti
    if ec_low and not (dry_plants or ec_high):
        parts.append("")
        parts.append("📉 Nutrienti scarsi (EC basso)")
        parts.extend(ec_low)

    return "🌿 GIARDINO\n\n" + "\n".join(parts)


def build_frost_alert():
    """Allerta gelo immediata"""
    ew_data = fetch_ecowitt_realtime()
    if not ew_data:
        return None
    temp = get_ecowitt_value(ew_data, "outdoor", "temperature")
    if temp is None:
        return None
    t = float(temp)
    if t >= 5:
        return None

    msg = f"🥶 ALLERTA GELO — {t:.1f}°C!\n\n"
    if t < 0:
        msg += "❄️ SOTTO ZERO — rischio danni immediati\n\n"
    msg += "Porta al riparo:\n"
    msg += "• Carmona Bonsai (max 12°C)\n"
    msg += "• Stella di Natale (max 12°C)\n"
    msg += "• Limone (max 5°C)\n"
    msg += "• Tradescantia (max 10°C)\n"
    msg += "• Aloe Vera / Crassula (max 2°C)\n"
    msg += "\nProteggi con tessuto non tessuto le piante in esterno"
    return msg


# ── Cron Setup ────────────────────────────────────────────────────────
def install_cron():
    """Installa il job cron in Termux per le 8:00 di mattina"""
    if not is_termux():
        print("⚠️  Questa funzione è disponibile solo in Termux su Android")
        print("   Su PC puoi usare il Task Scheduler di Windows o crontab su Linux")
        return

    script_path = os.path.abspath(__file__)
    cron_line = f'0 8 * * * cd {SCRIPT_DIR} && python {script_path} --summary 2>&1 >> {LOG_FILE}'
    cron_line_check = f'*/30 * * * * cd {SCRIPT_DIR} && python {script_path} 2>&1 >> {LOG_FILE}'

    try:
        # Leggi crontab attuale
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = result.stdout if result.returncode == 0 else ""

        # Aggiungi solo se non presente
        new_lines = []
        if "notifier.py --summary" not in existing:
            new_lines.append(f"# Giardino — riepilogo mattutino ore 8:00")
            new_lines.append(cron_line)
        if "notifier.py\n" not in existing and "notifier.py 2>&1" not in existing:
            new_lines.append(f"# Giardino — controllo allerte ogni 30 min")
            new_lines.append(cron_line_check)

        if not new_lines:
            print("✅ Cron già configurato")
            return

        new_crontab = existing.rstrip() + "\n" + "\n".join(new_lines) + "\n"
        proc = subprocess.run(["crontab", "-"], input=new_crontab, capture_output=True, text=True)
        if proc.returncode == 0:
            print("✅ Cron installato:")
            print(f"   📋 Riepilogo giornaliero: ogni giorno alle 8:00")
            print(f"   🔍 Controllo allerte: ogni 30 minuti")
            print(f"   📄 Log: {LOG_FILE}")
        else:
            print(f"❌ Errore: {proc.stderr}")
    except FileNotFoundError:
        print("⚠️  crontab non trovato. Installa: pkg install cronie && sv-enable crond")


# ── Previsioni Open-Meteo ─────────────────────────────────────────────
def fetch_forecast():
    """Recupera previsioni 7 giorni da Open-Meteo (gratis, no API key)"""
    pos = CFG.get("posizione", {})
    lat = pos.get("latitudine", 41.9028)
    lon = pos.get("longitudine", 12.4964)
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}"
            f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max,weather_code"
            f"&timezone=auto&forecast_days=7"
        )
        req = Request(url, headers={"User-Agent": "GiardinoNotifier/1.0"})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("daily")
    except Exception as e:
        log(f"[FORECAST ERRORE] {e}")
        return None


def build_forecast_alerts():
    """Genera allerte predittive dalla previsione 7 giorni"""
    daily = fetch_forecast()
    if not daily or not daily.get("time"):
        return None

    DAYS_IT = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab']
    alerts = []

    for i in range(len(daily["time"])):
        d = datetime.strptime(daily["time"][i], "%Y-%m-%d")
        day_label = DAYS_IT[d.weekday()] + " " + str(d.day) + "/" + str(d.month)
        if i == 0: day_label = "Oggi"
        elif i == 1: day_label = "Domani"

        t_min = daily["temperature_2m_min"][i]
        t_max = daily["temperature_2m_max"][i]
        rain = daily["precipitation_sum"][i]

        # Gelo
        if t_min < 0:
            alerts.append(f"🥶 GELO {day_label}: {t_min:.0f}°C! Porta dentro le tropicali")
        elif t_min < 5:
            alerts.append(f"❄️ Freddo {day_label}: min {t_min:.0f}°C — proteggi Carmona e Limone")

        # Caldo
        if t_max > 35:
            alerts.append(f"🔥 Caldo {day_label}: max {t_max:.0f}°C — aumenta annaffiature")

        # Pioggia forte
        if rain > 30:
            alerts.append(f"⛈️ Pioggia intensa {day_label}: {rain:.0f}mm — verifica drenaggio")

    # Gelata tardiva/precoce (primavera/autunno)
    month = datetime.now().month
    if month in (3,4,5,9,10,11):
        for i in range(len(daily["time"])):
            t_min = daily["temperature_2m_min"][i]
            if 0 <= t_min < 2:
                tipo = "tardiva" if month <= 5 else "precoce"
                d = datetime.strptime(daily["time"][i], "%Y-%m-%d")
                alerts.append(f"🌡️ Gelata {tipo} possibile: {t_min:.1f}°C — proteggi talee e rinvasi recenti")
                break

    return alerts if alerts else None


# ── Main ──────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]

    if NOTIFY_METHOD == "sms" and not SMS_ENABLED:
        print("⚠️  SMS configurato ma numero mancante!")
        print(f'   Aggiungi il tuo numero in config.json: "sms": {{"telefono": "+393331234567"}}')
        print(f'   Oppure usa le notifiche Android: "sms": {{"metodo": "notifica"}}')
        if "--test" not in args:
            return

    if "--test" in args:
        msg = "🌿 Test Giardino App — se ricevi questo messaggio, le notifiche funzionano! ✅"
        if NOTIFY_METHOD == "sms":
            number = SMS_NUMBER or input("Inserisci il numero (+39...): ").strip()
            print(f"\nInvio SMS di test a {number}...")
            send_sms(number, msg)
        else:
            print(f"\nInvio notifica di test...")
            send_notification("🌿 Test Giardino", msg)
        return

    if "--cron" in args:
        install_cron()
        return

    if "--summary" in args:
        log("=== Riepilogo giornaliero ===")
        msg = build_daily_summary()
        log(f"Messaggio ({len(msg)} car.):\n{msg}")
        notify(msg, "🌿 Riepilogo Giardino")
        return

    # Modalità default: controlla allerte critiche
    log("--- Controllo allerte ---")

    # Check gelo
    frost_msg = build_frost_alert()
    if frost_msg:
        last_frost = _last_alert_time("GELO")
        if not last_frost or (datetime.now() - last_frost).total_seconds() > 3600:
            log("⚠️  Allerta gelo rilevata!")
            notify(frost_msg, "🥶 Allerta Gelo!")
            _save_alert_time("GELO")
        else:
            log("Allerta gelo già inviata nell'ultima ora, skip")

    # Check terreno (secco / EC alto / temp radici)
    soil_msg = build_soil_alert()
    if soil_msg:
        last_soil = _last_alert_time("TERRENO")
        if not last_soil or (datetime.now() - last_soil).total_seconds() > 7200:
            log("⚠️  Allerta terreno rilevata!")
            # Determina titolo in base al contenuto
            if "ACCUMULO SALI" in soil_msg:
                title = "⚡ EC alto — Lavaggio!"
            elif "RADICI FREDDE" in soil_msg:
                title = "❄️ Radici fredde"
            elif "RADICI CALDE" in soil_msg:
                title = "🔥 Radici calde"
            else:
                title = "🏜️ Terreno secco"
            notify(soil_msg, title)
            _save_alert_time("TERRENO")
        else:
            log("Allerta terreno già inviata nelle ultime 2 ore, skip")

    if not frost_msg and not soil_msg:
        log("✅ Nessuna allerta critica")


def _last_alert_time(alert_type):
    """Controlla quando è stata inviata l'ultima allerta di questo tipo"""
    try:
        with open(LOG_FILE, "r") as f:
            lines = f.readlines()
        for line in reversed(lines):
            if f"allerta {alert_type.lower()}" in line.lower() and ("[SMS OK]" in line or "[NOTIFICA OK]" in line):
                ts = line[1:20]
                return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
    except:
        pass
    return None

def _save_alert_time(alert_type):
    """Registra l'invio dell'allerta nel log"""
    log(f"Allerta {alert_type} inviata via SMS")


if __name__ == "__main__":
    main()
