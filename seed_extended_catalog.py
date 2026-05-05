#!/usr/bin/env python3
"""
seed_extended_catalog.py — Importa il catalogo esteso di piante nel database
di "Il Mio Giardino".

Questo script è il complemento esteso di seed_native_plants.py: invece di
avere i dati delle piante hard-coded nel codice Python, li legge dal file
extended_catalog.json (170 piante coprendo aromatiche, mediterranee,
succulente, tropicali, orchidee, bonsai, agrumi, fiorite, arbusti, alberi
latifoglie e caducifoglie, conifere, rampicanti).

Lo script è idempotente: se rilanciato, salta le piante che esistono già
con lo stesso nome (a meno che non gli passi --force, che le sovrascrive).
Coerente con la filosofia di seed_native_plants.py.

================================================================
USO
================================================================

  python3 seed_extended_catalog.py
      Importa il catalogo nel database di default. Salta piante già esistenti.

  python3 seed_extended_catalog.py --catalog /path/to/extended_catalog.json
      Specifica un file JSON di catalogo diverso.

  python3 seed_extended_catalog.py --db /path/to/giardino.sqlite
      Specifica un database diverso da quello di default.

  python3 seed_extended_catalog.py --force
      Cancella e reinserisce le piante che esistono già (es. dopo aver
      modificato il file JSON e voler propagare le modifiche).

  python3 seed_extended_catalog.py --dry-run
      Simula senza scrivere nel database. Utile per verificare prima di
      eseguire davvero.

  python3 seed_extended_catalog.py --filter-group bonsai
      Importa SOLO le piante del gruppo specificato. Utile per importi
      parziali. Gruppi disponibili: aromatica, mediterranea, succulenta,
      orchidea, tropicale, agrume, bonsai, arbusto, albero, conifera,
      fiorita.

================================================================
DIPENDENZE
================================================================

Solo Python 3.6+ e sqlite3 della stdlib. Coerente con la filosofia
"zero dipendenze esterne" del resto del progetto.

================================================================
NOTA SUI Kc
================================================================

Tutte le 170 piante hanno i kc per stadio fenologico (kc_initial, kc_dev,
kc_mid, kc_late, kc_dormant) lasciati a NULL. Questo è una scelta
deliberata: il frontend, quando trova questi campi NULL, usa
automaticamente i default del gruppo simulazione (definiti nella costante
SIM_KC_BY_GROUP del file giardino.js). Essere precisi sui kc per ogni
specie richiede una ricerca agronomica specifica per pianta che, per le
ornamentali e d'appartamento, non esiste in letteratura — i valori
"inventati" sarebbero peggio dei default per gruppo.

Quando avrai calibrato una pianta sul tuo balcone con il modulo
science/calibration di fitosim, potrai aggiornare manualmente i kc per
quella specifica specie.
"""

import sqlite3
import json
import os
import sys
import argparse


# ════════════════════════════════════════════════════════════════════════
# CONFIGURAZIONE
# ════════════════════════════════════════════════════════════════════════

def default_db_path():
    """Replica la logica di server.py per trovare il database di default."""
    if os.environ.get("DATA_DIR"):
        return os.path.join(os.environ["DATA_DIR"], "giardino.sqlite")
    here = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(here, "data")
    if os.path.isdir(data_dir):
        return os.path.join(data_dir, "giardino.sqlite")
    return os.path.join(here, "giardino.sqlite")


def default_catalog_path():
    """File JSON del catalogo, di default accanto allo script."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "extended_catalog.json")


# ════════════════════════════════════════════════════════════════════════
# LOGICA DI INSERIMENTO
# ════════════════════════════════════════════════════════════════════════

def insert_plant(conn, plant):
    """Inserisce una pianta nel database. Restituisce il plant_id appena
    creato. La logica replica quella di seed_native_plants.py per garantire
    compatibilità totale dello schema."""
    plant_fields = {
        "name": plant["name"],
        "latin": plant.get("latin", ""),
        "icon": plant.get("icon", "🌱"),
        "sim_group": plant.get("sim_group", "arbusto"),
        "sensor_cat": plant.get("sensor_cat", "universale"),
        "card_data": json.dumps(plant.get("card_data", {}), ensure_ascii=False),
        "fert_months": plant.get("fert_months", "3,4,5,6,7,8,9,10"),
        "fert_interval": plant.get("fert_interval", 21),
        "fert_product": plant.get("fert_product", ""),
        "fert_note": plant.get("fert_note", ""),
        "monthly_states": ",".join(str(s) for s in plant.get("monthly_states", [])),
        "monthly_notes": json.dumps(plant.get("monthly_notes", {}), ensure_ascii=False),
        "root_depth_cm": plant.get("root_depth_cm"),
        "p_coef": plant.get("p_coef"),
        # I Kc per stadio fenologico sono lasciati a NULL deliberatamente:
        # il frontend usa i default del gruppo simulazione quando li trova
        # NULL. Vedi nota in cima a questo file.
        "kc_initial": plant.get("kc_initial"),
        "kc_dev": plant.get("kc_dev"),
        "kc_mid": plant.get("kc_mid"),
        "kc_late": plant.get("kc_late"),
        "kc_dormant": plant.get("kc_dormant"),
    }

    cols = ", ".join(plant_fields.keys())
    placeholders = ", ".join(["?"] * len(plant_fields))
    cur = conn.execute(
        f"INSERT INTO custom_plants ({cols}) VALUES ({placeholders})",
        list(plant_fields.values())
    )
    plant_id = cur.lastrowid

    # Schedule BioBizz (vuote per il catalogo esteso, ma manteniamo la
    # logica per coerenza con seed_native_plants.py).
    for sched in plant.get("bb_schedules", []):
        conn.execute("""
            INSERT INTO plant_biobizz
              (plant_id, prod, months, interval_days, start_date, dose, note, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            plant_id,
            sched["prod"],
            sched["months"],
            sched["interval_days"],
            sched.get("start_date"),
            sched.get("dose", ""),
            sched.get("note", ""),
            sched.get("sort_order", 0),
        ))

    # Schedule trattamenti
    for sched in plant.get("tr_schedules", []):
        conn.execute("""
            INSERT INTO plant_treatments
              (plant_id, prod, months, interval_days, start_date, dose, note, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            plant_id,
            sched["prod"],
            sched["months"],
            sched["interval_days"],
            sched.get("start_date"),
            sched.get("dose", ""),
            sched.get("note", ""),
            sched.get("sort_order", 0),
        ))

    return plant_id


def seed_database(db_path, catalog_path, force=False, dry_run=False, filter_group=None):
    """Funzione principale: legge il catalogo, apre il database, e per
    ogni pianta verifica esistenza e inserisce o salta. Restituisce True
    se tutto è andato bene, False altrimenti."""

    # Verifica esistenza file
    if not os.path.exists(db_path):
        print(f"❌ Database non trovato: {db_path}")
        print(f"   Avvia prima il server.py una volta per crearlo.")
        return False

    if not os.path.exists(catalog_path):
        print(f"❌ File catalogo non trovato: {catalog_path}")
        return False

    # Carica catalogo
    with open(catalog_path, "r", encoding="utf-8") as f:
        plants = json.load(f)
    print(f"📚 Catalogo caricato: {len(plants)} piante")

    # Filtro per gruppo se richiesto
    if filter_group:
        before = len(plants)
        plants = [p for p in plants if p.get("sim_group") == filter_group]
        print(f"🔍 Filtro gruppo='{filter_group}': {before} → {len(plants)} piante")
        if not plants:
            print(f"   Nessuna pianta del gruppo '{filter_group}' nel catalogo.")
            print(f"   Gruppi disponibili: aromatica, mediterranea, succulenta, orchidea,")
            print(f"   tropicale, agrume, bonsai, arbusto, albero, conifera, fiorita")
            return False

    # Apri database
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # Verifica schema
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    if "custom_plants" not in tables:
        print(f"❌ La tabella custom_plants non esiste nel database.")
        print(f"   Avvia prima il server.py per creare lo schema.")
        return False
    if "plant_biobizz" not in tables or "plant_treatments" not in tables:
        print(f"⚠ Tabelle plant_biobizz e/o plant_treatments mancanti.")
        print(f"   Le schedule non verranno inserite.")

    # Statistiche
    stats = {"inseriti": 0, "saltati": 0, "sovrascritti": 0, "errori": 0}

    try:
        for plant in plants:
            name = plant["name"]
            existing = conn.execute(
                "SELECT id FROM custom_plants WHERE name = ?", (name,)
            ).fetchone()

            if existing:
                if force:
                    if dry_run:
                        print(f"  [dry-run] sovrascriverei: {name}")
                        stats["sovrascritti"] += 1
                    else:
                        # ON DELETE CASCADE delle foreign key cancella anche
                        # le schedule correlate. Foreign key sono ON.
                        conn.execute("DELETE FROM custom_plants WHERE id = ?",
                                     (existing["id"],))
                        try:
                            insert_plant(conn, plant)
                            print(f"  ↻ sovrascritto: {name}")
                            stats["sovrascritti"] += 1
                        except Exception as e:
                            print(f"  ❌ errore inserendo {name}: {e}")
                            stats["errori"] += 1
                else:
                    # Pianta esiste e force=False: salta silenziosamente
                    stats["saltati"] += 1
                    continue
            else:
                if dry_run:
                    print(f"  [dry-run] inserirei: {name}")
                    stats["inseriti"] += 1
                else:
                    try:
                        insert_plant(conn, plant)
                        stats["inseriti"] += 1
                    except Exception as e:
                        print(f"  ❌ errore inserendo {name}: {e}")
                        stats["errori"] += 1

        if not dry_run:
            conn.commit()

    finally:
        conn.close()

    # Resoconto
    print()
    print(f"📊 Resoconto:")
    print(f"   Inseriti:     {stats['inseriti']}")
    print(f"   Saltati:      {stats['saltati']} (già esistenti)")
    if force:
        print(f"   Sovrascritti: {stats['sovrascritti']}")
    if stats['errori'] > 0:
        print(f"   ❌ Errori:    {stats['errori']}")
    if dry_run:
        print(f"   ⚠ DRY-RUN: nessuna modifica scritta nel database.")
    else:
        print(f"   ✓ Database aggiornato.")

    return stats['errori'] == 0


# ════════════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Importa il catalogo esteso di piante nel database di Il Mio Giardino.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--db", default=default_db_path(),
                        help="Percorso al database SQLite (default: %(default)s)")
    parser.add_argument("--catalog", default=default_catalog_path(),
                        help="Percorso al file JSON del catalogo (default: %(default)s)")
    parser.add_argument("--force", action="store_true",
                        help="Sovrascrive piante esistenti invece di saltarle")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simula senza scrivere nel database")
    parser.add_argument("--filter-group", type=str, default=None,
                        help="Importa solo le piante di un gruppo specifico")

    args = parser.parse_args()

    print(f"🌱 seed_extended_catalog.py")
    print(f"   Database: {args.db}")
    print(f"   Catalogo: {args.catalog}")
    if args.force:
        print(f"   Modalità: FORCE (sovrascrive esistenti)")
    if args.dry_run:
        print(f"   Modalità: DRY-RUN (no write)")
    print()

    ok = seed_database(
        db_path=args.db,
        catalog_path=args.catalog,
        force=args.force,
        dry_run=args.dry_run,
        filter_group=args.filter_group,
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
