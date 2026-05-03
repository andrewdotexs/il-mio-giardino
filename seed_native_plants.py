#!/usr/bin/env python3
"""
seed_native_plants.py — Reimporta le 26 piante native originali nel
database di "Il Mio Giardino".

Le piante che inserisce sono quelle che vivevano cablate nel codice
JavaScript prima del refactor verso il sistema "tutte le piante sono
custom". Per ognuna popola:

  - I cinque blocchi della scheda colturale (concimazione, substrato,
    esposizione, cure, BioBizz) come JSON nella colonna card_data
  - I parametri di simulazione FAO-56 (gruppo, profondità radicale,
    coefficiente di stress p)
  - Il calendario fertilizzazione mensile (regime principale, in caso
    di piante con regimi multipli)
  - Il calendario annuale (12 stati + note testuali per i mesi salienti)
  - N schedule BioBizz nella tabella plant_biobizz (per le piante che
    avevano un regime di concimazione liquida programmata)
  - M schedule trattamenti preventivi nella tabella plant_treatments
    (per le piante che avevano un programma di prevenzione fitosanitaria)

I parametri Kc per stadio fenologico vengono lasciati a NULL così il
frontend usa automaticamente i default del gruppo simulazione (definiti
nella costante SIM_KC_BY_GROUP del file giardino.js). Le 26 native
originali avevano lo stesso schema Kc del loro gruppo, quindi non c'è
niente da personalizzare.

================================================================
USO
================================================================

  python3 seed_native_plants.py
      Inserisce le 26 piante nel database di default. Salta quelle che
      esistono già con lo stesso nome.

  python3 seed_native_plants.py --db /percorso/al/giardino.sqlite
      Specifica un percorso database diverso da quello di default.

  python3 seed_native_plants.py --force
      Cancella e reinserisce le piante esistenti. Usalo solo se vuoi
      davvero ripartire da zero — perdi eventuali modifiche fatte dalla
      UI dopo il primo seed.

  python3 seed_native_plants.py --dry-run
      Mostra cosa farebbe senza scrivere nulla nel database. Utile per
      verificare il file prima di lanciarlo.

================================================================
IDEMPOTENZA E SICUREZZA
================================================================

Lo script è idempotente: rilanciarlo non duplica le piante (controllo
sull'esistenza per nome). Se interrompi a metà, al prossimo lancio
riprende dalle piante mancanti.

L'opzione --force usa una transazione: se qualcosa va storto durante
la cancellazione+reinserimento, niente viene salvato (rollback completo).

================================================================
DIPENDENZE
================================================================

Solo Python 3.6+ e sqlite3 della stdlib. Coerente con la filosofia
"zero dipendenze esterne" del resto del progetto.
"""

import sqlite3
import json
import os
import sys
import argparse
from datetime import datetime


# ════════════════════════════════════════════════════════════════════════
# CONFIGURAZIONE
# ════════════════════════════════════════════════════════════════════════

# Percorso database di default. Replica la logica di server.py: prima
# guarda DATA_DIR (impostato in container Docker), poi cade su una
# cartella ./data accanto allo script, infine sulla cartella corrente.
def default_db_path():
    if os.environ.get("DATA_DIR"):
        return os.path.join(os.environ["DATA_DIR"], "giardino.sqlite")
    here = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(here, "data")
    if os.path.isdir(data_dir):
        return os.path.join(data_dir, "giardino.sqlite")
    return os.path.join(here, "giardino.sqlite")


# ════════════════════════════════════════════════════════════════════════
# DATI: 26 PIANTE NATIVE
# ════════════════════════════════════════════════════════════════════════
# Ogni pianta è un dict con queste chiavi (in ordine di apparizione nello
# schema di custom_plants e delle due tabelle figlie):
#
#   name            obbligatorio, nome italiano comune
#   latin           nome scientifico, "" se non noto
#   icon            emoji singolo carattere
#   sim_group       uno tra: succulenta, orchidea, tropicale, agrume,
#                   mediterranea, bonsai, arbusto, albero, aromatica, fiorita
#   sensor_cat      uno tra: universale, succulente, tropicali, mediterranee,
#                   agrumi, bonsai, orchidee, aromatiche
#   card_data       dict con le cinque sezioni con/sub/esp/cur/bio,
#                   ognuna delle quali è un dict di sotto-campi
#   fert_months     CSV dei mesi di fertilizzazione "3,4,5,6,7,8,9"
#   fert_interval   intero, giorni tra fertilizzazioni
#   fert_product    descrizione testuale del prodotto principale
#   fert_note       nota libera (spesso "")
#   monthly_states  lista di 12 interi 0-3 (riposo/attivo/ridotto/speciale)
#   monthly_notes   dict {"1": "nota gennaio", "5": "nota maggio", ...}
#                   con SOLO i mesi che hanno una nota (gli altri assenti)
#   root_depth_cm   profondità radicale in cm (per simulazione)
#   p_coef          coefficiente di stress idrico p (FAO-56)
#   bb_schedules    lista di dict, ognuno con:
#                     prod          chiave del prodotto BB_PRODUCTS
#                     months        CSV dei mesi attivi
#                     interval_days intero
#                     start_date    "YYYY-MM-DD" o None
#                     dose          stringa libera tipo "½ dose" o "5 ml/L"
#                     note          nota libera
#                     sort_order    intero, posizione nell'elenco
#   tr_schedules    stessa struttura, prodotti da TR_PRODUCTS
#
# Le costanti di gruppo simulazione e categoria sensore corrispondono ai
# valori validi nel form della UI; passare un valore diverso non rompe
# nulla ma fa cadere su default generici.
#
# Le date di start sono coerenti con quelle del codice JavaScript
# originale: usavano l'anno 2026 come riferimento per il calendario.
# Il frontend usa quelle date come ancoraggio per generare le ricorrenze.

PLANTS = [
    # ─── id 0: Sanseviera ─────────────────────────────────────────────
    {
        "name": "Sanseviera",
        "latin": "Dracaena trifasciata",
        "icon": "🌿",
        "sim_group": "succulenta",
        "sensor_cat": "succulente",
        "card_data": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "1× al mese",
                "concime": "Liquido succulente, ½ dose",
                "stop": "Stop completo in autunno/inverno",
                "note": "Non concimare mai su terreno secco. Soffre più di eccessi che di carenze.",
            },
            "sub": {
                "terreno": "Substrato per succulente e cactus, ben drenante",
                "ph": "6.0 – 7.0",
                "vaso": "Terracotta con foro di drenaggio, non troppo grande",
                "rinvaso": "Ogni 2-3 anni o quando le radici escono dal vaso",
                "vivo": "Aggiungere 10% di humus di lombrico al substrato. Micorrize universali in polvere al rinvaso. Dose contenuta — la sanseviera preferisce substrati poveri; eccedere con organico rischia il marciume.",
            },
            "esp": {
                "luce": "Luce indiretta brillante; tollera anche poca luce ma cresce più lentamente",
                "sole": "Evitare sole diretto estivo — brucia le foglie",
                "temperatura": "15–30°C; non sotto i 10°C",
                "umidita": "Bassa; non nebulizzare",
            },
            "cur": {
                "acqua": "Annaffiare poco e solo quando il terreno è completamente asciutto; in inverno 1× al mese",
                "potatura": "Rimuovere foglie secche o danneggiate alla base",
                "parassiti": "Cocciniglia e ragnetto rosso; trattare con olio di neem",
                "extra": "Quasi indistruttibile — il nemico principale è l'eccesso d'acqua",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic · Root·Juice",
                "primavera": "Bio·Grow a ¼ dose ogni 4-5 settimane — inizia con cautela",
                "estate": "Bio·Grow a ¼ dose 1× al mese. In alternativa Alg·A·Mic ogni 3 settimane (più delicato)",
                "autunno": "Stop totale da ottobre. Nessun prodotto BioBizz in inverno",
                "rinvaso": "Root·Juice diluito sulle radici al momento del rinvaso",
                "note": "Pianta abituata a terreni poveri — meno è meglio. Mai superare ¼ della dose consigliata. L'Alg·A·Mic è preferibile al Bio·Grow se la pianta è in posizione di scarsa luce.",
            },
        },
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 30,
        "fert_product": "Liquido succulente, ½ dose",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "4": "Riprendi la concimazione — usa metà dose.",
            "5": "Concima regolarmente. Suolo asciutto tra le annaffiature.",
            "6": "Piena stagione. Controlla eventuali cocciniglie.",
            "7": "Continua normalmente.",
            "8": "Ultima parte della stagione attiva.",
            "9": "Ultima concimazione dell'anno. Da ottobre stop totale.",
        },
        "root_depth_cm": 18,
        "p_coef": 0.60,
        "bb_schedules": [
            {
                "prod": "grow", "months": "4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-04-10", "dose": "¼ dose",
                "note": "Molto diluito — pianta abituata a terreni poveri",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "4,5,6,7,8,9", "interval_days": 45,
                "start_date": "2026-04-25", "dose": "¼ dose",
                "note": "Alternativa più delicata al Bio·Grow",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 1: Orchidea ───────────────────────────────────────────────
    {
        "name": "Orchidea",
        "latin": "Phalaenopsis sp.",
        "icon": "🌸",
        "sim_group": "orchidea",
        "sensor_cat": "orchidee",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre (attivo) · Ottobre/Gennaio (semiriposo, dosi minime)",
                "frequenza": "Ogni settimana, ¼ dose; in semiriposo 1× ogni 3 settimane",
                "concime": "Specifico orchidee, ¼ dose",
                "stop": "Sospendi durante la fioritura",
                "note": "Dose pieno = morte assicurata. L'orchidea ama poco e spesso, mai troppo.",
            },
            "sub": {
                "terreno": "Bark (corteccia di pino) di calibro medio, eventualmente miscelata con sfagno",
                "ph": "5.5 – 6.5",
                "vaso": "Trasparente con tanti fori — le radici fanno fotosintesi",
                "rinvaso": "Ogni 2-3 anni dopo la fioritura, quando il bark si decompone",
                "vivo": "Mai humus o terriccio normale — soffocano le radici aeree. Solo bark e sfagno.",
            },
            "esp": {
                "luce": "Indiretta brillante (vicino a finestra a est)",
                "sole": "Mai sole diretto — brucia subito le foglie",
                "temperatura": "18–28°C; ottimo escursione termica giorno/notte di 5°C",
                "umidita": "60-70% — nebulizzare l'aria, non la pianta",
            },
            "cur": {
                "acqua": "Immersione del vaso in acqua per 10 minuti, poi sgocciolare bene. Ogni 7-10 giorni in estate, ogni 14 in inverno",
                "potatura": "Stelo fiorale: tagliare sopra il 2° nodo per stimolare ri-fioritura",
                "parassiti": "Cocciniglia (sapone molle), afidi sui boccioli",
                "extra": "Le radici argentate vogliono diventare verdi quando bagnate — se restano grigie, dose d'acqua insufficiente",
            },
            "bio": {
                "prodotti": "Solo Alg·A·Mic — NIENTE Bio·Grow né Bio·Bloom",
                "primavera": "Alg·A·Mic a ¼ dose ogni 1-2 settimane (con annaffiatura)",
                "estate": "Continua come primavera",
                "autunno": "Riduci a ¼ dose ogni 3 settimane",
                "rinvaso": "Root·Juice in alternativa, sempre molto diluito",
                "note": "Le orchidee non tollerano i sali minerali del Bio·Grow. L'Alg·A·Mic è perfetto perché è 100% organico (alghe).",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 10,
        "fert_product": "Specifico orchidee, ¼ dose",
        "fert_note": "Dose minima in semiriposo (gennaio + ottobre)",
        "monthly_states": [2, 0, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0],
        "monthly_notes": {
            "1": "Riposo. Nessuna concimazione.",
            "3": "Riprendi con dosi molto leggere se emette nuovi germogli.",
            "4": "Stagione attiva. Ogni settimana con dose ¼.",
            "5": "Massima crescita — concima regolarmente.",
            "6": "Se in fioritura, sospendi il concime.",
            "7": "Continua normalmente se non in fioritura.",
            "8": "Inizio riduzione. Scala a ogni 2 settimane.",
            "9": "Dose molto ridotta — 1× al mese.",
            "10": "Stop quasi totale. Solo annaffiatura.",
        },
        "root_depth_cm": 10,
        "p_coef": 0.35,
        "bb_schedules": [
            {
                "prod": "alg", "months": "3,4,5,6,7,8,9", "interval_days": 14,
                "start_date": "2026-03-20", "dose": "¼ dose",
                "note": "Unico prodotto adatto — mai Bio·Grow o Bio·Bloom",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "1,10", "interval_days": 21,
                "start_date": "2026-01-08", "dose": "¼ dose ridotta",
                "note": "Dose minima in semiriposo",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [
            {
                "prod": "sapone", "months": "4,5,6,7", "interval_days": 35,
                "start_date": "2026-04-10", "dose": "8-10 g/L",
                "note": "Cocciniglia — il sapone molle è più delicato del neem sulle orchidee",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 2: Ficus Benjamina ────────────────────────────────────────
    {
        "name": "Ficus Benjamina",
        "latin": "Ficus benjamina",
        "icon": "🌳",
        "sim_group": "tropicale",
        "sensor_cat": "tropicali",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "Ogni 2 settimane",
                "concime": "Liquido azotato NPK 3-1-2 (favorisce le foglie)",
                "stop": "Da ottobre a febbraio",
                "note": "Un improvviso ingiallimento delle foglie nuove indica clorosi ferrica — somministrare ferro chelato",
            },
            "sub": {
                "terreno": "Universale di buona qualità con 20% di perlite",
                "ph": "6.0 – 6.5",
                "vaso": "Plastica o terracotta, drenaggio importante",
                "rinvaso": "Ogni 2-3 anni in primavera",
                "vivo": "Compost maturo 15-20% al rinvaso. Cornunghia in granuli sotto il colletto. Micorrize universali — il ficus ne beneficia molto.",
            },
            "esp": {
                "luce": "Luminosa indiretta — è esigente",
                "sole": "Tollera qualche ora di sole filtrato al mattino",
                "temperatura": "16-24°C — soffre sotto i 13°C",
                "umidita": "50-60% — perde foglie in aria troppo secca",
            },
            "cur": {
                "acqua": "Quando il primo cm di terreno è asciutto. Mai sottovaso pieno",
                "potatura": "Primavera: pota per dare forma. Latte bianco — irritante per la pelle",
                "parassiti": "Cocciniglia, ragnetto rosso (in ambiente secco)",
                "extra": "Soffre i cambi di posizione: perde foglie. Ruotare di poco alla volta.",
            },
            "bio": {
                "prodotti": "Bio·Grow · CalMag · Alg·A·Mic",
                "primavera": "Bio·Grow ½ dose ogni 2 settimane + CalMag",
                "estate": "Continua. CalMag ogni 4 settimane previene clorosi ferrica",
                "autunno": "Riduci progressivamente da settembre",
                "rinvaso": "Root·Juice + micorrize alle radici",
                "note": "Il CalMag è particolarmente importante perché il ficus è sensibile alla clorosi (foglie nuove gialle con venature verdi).",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 14,
        "fert_product": "Liquido azotato NPK 3-1-2",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "3": "Riprendi con la prima concimazione.",
            "4": "Stagione piena. Tieni d'occhio le foglie nuove per clorosi ferrica.",
            "5": "Se foglie nuove gialle con venature verdi → ferro chelato subito.",
            "6": "Non spostare la pianta — perde foglie facilmente.",
            "7": "Continua normalmente.",
            "8": "Inizia a scalare leggermente la frequenza.",
            "9": "Ultima concimazione. Da ottobre stop totale.",
        },
        "root_depth_cm": 25,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6,7,8,9", "interval_days": 14,
                "start_date": "2026-03-20", "dose": "½ dose",
                "note": "Non superare ½ dose — sensibile ai sali",
                "sort_order": 0,
            },
            {
                "prod": "calmag", "months": "4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-04-12", "dose": "dose piena",
                "note": "Previene la clorosi ferrica",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "4,5,6,7,8", "interval_days": 30,
                "start_date": "2026-04-05", "dose": "5 ml/L",
                "note": "Cocciniglia e ragnetto rosso — ambienti secchi lo favoriscono",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 3: Ficus Elastica ─────────────────────────────────────────
    {
        "name": "Ficus Elastica",
        "latin": "Ficus elastica",
        "icon": "🌳",
        "sim_group": "tropicale",
        "sensor_cat": "tropicali",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "Ogni 2 settimane",
                "concime": "Liquido azotato con quota K (per foglie robuste)",
                "stop": "Da ottobre a febbraio",
                "note": "Le foglie grandi accumulano polvere — pulirle con panno umido per consentire la fotosintesi",
            },
            "sub": {
                "terreno": "Universale con 20% perlite + 10% lapillo vulcanico",
                "ph": "6.0 – 6.5",
                "vaso": "Stabile, perché diventa pesante con la crescita",
                "rinvaso": "Ogni 3 anni in primavera",
                "vivo": "Humus di lombrico 10% al rinvaso. Micorrize universali. Cornunghia in superficie 2× l'anno.",
            },
            "esp": {
                "luce": "Luminosa, anche un po' di sole filtrato",
                "sole": "Tollera 2-3 ore di sole diretto al mattino",
                "temperatura": "18-26°C — robusto ma non sotto i 12°C",
                "umidita": "40-60% — più tollerante del Benjamina",
            },
            "cur": {
                "acqua": "Quando il primo strato è asciutto. Tollera meglio piccoli ritardi",
                "potatura": "Primavera: cima per ramificare. Latte bianco abbondante — usa guanti",
                "parassiti": "Ragnetto rosso, cocciniglia",
                "extra": "Cresce molto in altezza. Si può spuntare la cima ogni anno per favorire più rami laterali.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic · Root·Juice",
                "primavera": "Bio·Grow ½ dose ogni 2 settimane",
                "estate": "Continua. Alg·A·Mic come spray fogliare 1× al mese",
                "autunno": "Riduci da settembre, stop a ottobre",
                "rinvaso": "Root·Juice + micorrize",
                "note": "L'Alg·A·Mic spruzzato sulle foglie le mantiene lucide e nutrite anche per via fogliare.",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 14,
        "fert_product": "Liquido azotato con quota K",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione dell'anno. Ideale per il rinvaso.",
            "4": "Stagione attiva. Pulisci le foglie grandi con panno umido.",
            "6": "Controlla ragnetto rosso in estate.",
            "9": "Ultima concimazione. Poi stop totale.",
        },
        "root_depth_cm": 28,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6,7,8,9", "interval_days": 14,
                "start_date": "2026-03-23", "dose": "½ dose",
                "note": "",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-04-20", "dose": "½ dose",
                "note": "Come spray fogliare diluito mantiene le foglie lucide",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "5,6,7,8", "interval_days": 35,
                "start_date": "2026-05-08", "dose": "5 ml/L",
                "note": "Ragnetto rosso — pulire foglie con panno umido dopo il trattamento",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 4: Oleandro ───────────────────────────────────────────────
    {
        "name": "Oleandro",
        "latin": "Nerium oleander",
        "icon": "🌺",
        "sim_group": "mediterranea",
        "sensor_cat": "mediterranee",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "Ogni 2 settimane",
                "concime": "P-K prevalente (5-10-10) per fioritura",
                "stop": "Da ottobre a febbraio",
                "note": "Tutte le parti dell'oleandro sono molto tossiche per ingestione. Lavarsi le mani dopo la potatura.",
            },
            "sub": {
                "terreno": "Universale con 20% sabbia + 10% lapillo per drenaggio",
                "ph": "6.5 – 7.5 (sopporta anche calcareo)",
                "vaso": "Grande e pesante — le piante adulte hanno chioma ampia",
                "rinvaso": "Ogni 3-4 anni in primavera",
                "vivo": "Compost ben maturo 15% al rinvaso. Cornunghia 2× l'anno (marzo, giugno). Cenere di legna leggera in autunno (apporta K).",
            },
            "esp": {
                "luce": "Pieno sole — più sole = più fioritura",
                "sole": "Diretto tutto il giorno",
                "temperatura": "Tollera fino a 35°C; in inverno minimo 5°C (proteggere)",
                "umidita": "Bassa è ok",
            },
            "cur": {
                "acqua": "Abbondante in estate, regolare. Mai sottovaso d'acqua stagnante",
                "potatura": "Fine inverno: pota per forma e per stimolare nuova fioritura",
                "parassiti": "Cocciniglia, afidi (specialmente sui boccioli)",
                "extra": "La fioritura va da maggio a ottobre se ben curato. I fiori secchi possono essere lasciati o rimossi — non disturba.",
            },
            "bio": {
                "prodotti": "Bio·Bloom · Top·Max · Alg·A·Mic",
                "primavera": "Bio·Bloom dose piena ogni 2 settimane (mai Bio·Grow)",
                "estate": "Bio·Bloom + Top·Max 1× al mese per booster fioritura",
                "autunno": "Riduci da settembre",
                "rinvaso": "Root·Juice + cornunghia organica",
                "note": "L'azoto del Bio·Grow farebbe foglie a scapito dei fiori. Usare SOLO Bio·Bloom in fioritura. Top·Max è il bonus per fioritura più abbondante.",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 14,
        "fert_product": "P-K prevalente (5-10-10)",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione. Se in vaso, valuta il rinvaso.",
            "4": "Inizia a comparire la fioritura — concime P-K per sostenerla.",
            "5": "Piena fioritura. Concima ogni 2 settimane.",
            "6": "Estate — massima fioritura.",
            "7": "Continua con P-K. Attento agli afidi.",
            "8": "Dopo la fioritura, pota leggermente.",
            "9": "Ultima concimazione. Stop da ottobre.",
        },
        "root_depth_cm": 30,
        "p_coef": 0.45,
        "bb_schedules": [
            {
                "prod": "bloom", "months": "3,4,5,6,7,8,9", "interval_days": 14,
                "start_date": "2026-03-18", "dose": "dose piena",
                "note": "Mai Bio·Grow — l'azoto blocca la fioritura",
                "sort_order": 0,
            },
            {
                "prod": "topmax", "months": "4,5,6,7,8", "interval_days": 30,
                "start_date": "2026-04-08", "dose": "dose piena",
                "note": "Booster per la fioritura",
                "sort_order": 1,
            },
            {
                "prod": "alg", "months": "3,4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-03-28", "dose": "½ dose",
                "note": "Rinvigorente mensile",
                "sort_order": 2,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "5,6,7", "interval_days": 28,
                "start_date": "2026-05-05", "dose": "5 ml/L",
                "note": "Cocciniglia e afidi estivi",
                "sort_order": 0,
            },
            {
                "prod": "rame", "months": "3,9", "interval_days": 30,
                "start_date": "2026-03-10", "dose": "20 g/10L",
                "note": "Preventivo fungino primavera e fine estate",
                "sort_order": 1,
            },
            {
                "prod": "obianco", "months": "1", "interval_days": 30,
                "start_date": "2026-01-15", "dose": "15 ml/L",
                "note": "Cocciniglie svernanti sui rami lignificati",
                "sort_order": 2,
            },
        ],
    },

    # ─── id 5: Glicine Bonsai ─────────────────────────────────────────
    {
        "name": "Glicine Bonsai",
        "latin": "Wisteria sinensis",
        "icon": "🌸",
        "sim_group": "bonsai",
        "sensor_cat": "bonsai",
        "card_data": {
            "con": {
                "periodo": "Aprile – Agosto (post-fioritura)",
                "frequenza": "Ogni 25 giorni",
                "concime": "P-K zero azoto (3-8-8) — è una leguminosa",
                "stop": "Stop totale durante la fioritura (febbraio-marzo)",
                "note": "Concimare durante la fioritura riduce drasticamente la durata dei fiori. Pazienza e poi P-K.",
            },
            "sub": {
                "terreno": "Akadama 60% + pomice 30% + lapillo 10% (mix bonsai classico)",
                "ph": "6.0 – 7.0",
                "vaso": "Bonsai poco profondo, drenaggio massimo",
                "rinvaso": "Ogni 2-3 anni a fine inverno, prima del risveglio",
                "vivo": "Mai humus né compost — saturano il substrato bonsai. Solo micorrize endo specifiche al rinvaso.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto tutto il giorno",
                "temperatura": "Rustico — tollera anche -10°C in inverno",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Abbondante in estate (anche 2× al giorno con caldo). Substrato bonsai asciuga rapidamente",
                "potatura": "Inverno: rami a 1-2 gemme. Estate: germogli a 2-3 foglie",
                "parassiti": "Afidi sui germogli primaverili",
                "extra": "Le radici tendono a uscire dal vaso. Controllarle ogni anno e potarle al rinvaso.",
            },
            "bio": {
                "prodotti": "Alg·A·Mic · Bio·Bloom (mai Bio·Grow)",
                "primavera": "Solo Alg·A·Mic durante la fioritura, ½ dose",
                "estate": "Bio·Bloom ½ dose ogni 25 giorni post-fioritura",
                "autunno": "Stop da settembre",
                "rinvaso": "Root·Juice + micorrize endo",
                "note": "Il Bio·Grow è proibito perché il glicine, come tutte le leguminose, fissa già azoto autonomamente con i suoi rizobi. Bio·Bloom in P-K fornisce solo quello che serve.",
            },
        },
        "fert_months": "4,5,6,7,8",
        "fert_interval": 25,
        "fert_product": "P-K zero azoto (3-8-8)",
        "fert_note": "",
        "monthly_states": [0, 3, 3, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        "monthly_notes": {
            "2": "Potatura invernale dei rami a 1-2 gemme. Gemme fiorali già formate.",
            "3": "Fioritura! Non concimare — lascia che la pianta usi le riserve.",
            "4": "Dopo la fioritura: prima concimazione con P-K. Zero azoto.",
            "5": "Estate: pota i germogli nuovi a 2-3 foglie per mantenere la forma bonsai.",
            "6": "Concima ogni 3-4 settimane.",
            "7": "Continua con P-K.",
            "8": "Ultima concimazione. Da settembre stop totale.",
        },
        "root_depth_cm": 15,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "alg", "months": "2,3", "interval_days": 21,
                "start_date": "2026-02-10", "dose": "½ dose",
                "note": "Solo durante la fioritura — non stimolare la crescita",
                "sort_order": 0,
            },
            {
                "prod": "bloom", "months": "4,5,6,7,8", "interval_days": 25,
                "start_date": "2026-04-20", "dose": "½ dose",
                "note": "Zero azoto — il glicine è una leguminosa",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [
            {
                "prod": "rame", "months": "2", "interval_days": 30,
                "start_date": "2026-02-10", "dose": "20 g/10L",
                "note": "Dopo potatura invernale — protegge i tagli da infezioni fungine",
                "sort_order": 0,
            },
            {
                "prod": "neem", "months": "4,5", "interval_days": 30,
                "start_date": "2026-04-08", "dose": "5 ml/L",
                "note": "Afidi sui germogli primaverili",
                "sort_order": 1,
            },
        ],
    },

    # ─── id 6: Limone ─────────────────────────────────────────────────
    {
        "name": "Limone",
        "latin": "Citrus limon",
        "icon": "🍋",
        "sim_group": "agrume",
        "sensor_cat": "agrumi",
        "card_data": {
            "con": {
                "periodo": "Tutto l'anno con regimi differenziati",
                "frequenza": "Granulare 3× anno (mar/giu/set) + lupini 2× anno (feb/nov) + CalMag mensile",
                "concime": "Granulare agrumi a lento rilascio + lupini macinati come azoto organico",
                "stop": "Mai stop totale — ridurre solo a CalMag in pieno inverno",
                "note": "Il limone è un'eccezione tra le piante in vaso: produce foglie e frutti tutto l'anno, quindi non ha veri 'stop'. Il regime combinato granulare + lupini garantisce nutrimento continuo.",
            },
            "sub": {
                "terreno": "Specifico agrumi (acido) + 20% sabbia + 10% lapillo",
                "ph": "5.5 – 6.5 — è acidofilo",
                "vaso": "Grande, terracotta possibilmente. Drenaggio fondamentale",
                "rinvaso": "Ogni 3 anni a marzo, prima della ripresa",
                "vivo": "Lupini macinati 2× l'anno. Cornunghia leggera. Compost agrumi specifico al rinvaso. Micorrize ericoidi (specifiche per acidofile).",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto tutto il giorno",
                "temperatura": "Estate fino a 35°C; inverno min 5°C — proteggi sotto i 7°C",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Abbondante in estate, regolare in inverno. Mai sottovaso pieno (radici asfittiche)",
                "potatura": "Marzo: pota rami secchi/incrociati. Mantieni forma a vaso",
                "parassiti": "Cocciniglia (frequente!), afidi, minatore fogliare, ragnetto rosso",
                "extra": "Le foglie gialle uniformi = clorosi ferrica → CalMag o ferro chelato. Foglie ondulate scure = minatore fogliare → trattamento neem.",
            },
            "bio": {
                "prodotti": "CalMag · Alg·A·Mic · Bio·Bloom (per la fruttificazione)",
                "primavera": "Granulare + CalMag mensile + Alg·A·Mic ogni 30 gg",
                "estate": "Continua. Aggiungi Bio·Bloom dose ½ ogni 30 gg da giugno (sostiene fruttificazione)",
                "autunno": "Lupini a novembre. CalMag continua.",
                "rinvaso": "Root·Juice + micorrize ericoidi",
                "note": "Il CalMag è importantissimo: il limone consuma molto ferro/magnesio per produrre clorofilla nelle foglie nuove e frutti. La carenza si manifesta come ingiallimento delle foglie nuove con venature verdi.",
            },
        },
        "fert_months": "3,6,9",
        "fert_interval": 30,
        "fert_product": "Granulare agrumi lento rilascio + lupini macinati",
        "fert_note": "Regime stratificato: granulare nei mesi indicati, lupini in feb/nov, CalMag mensile",
        "monthly_states": [2, 3, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2],
        "monthly_notes": {
            "1": "Lupini di novembre in decomposizione — nutrono lentamente. CalMag mensile. Nessun altro intervento.",
            "2": "Lupini macinati: interrare 100-150g nel terriccio. Acidificano e nutrono per i prossimi 3-4 mesi. CalMag mensile.",
            "3": "Granulare agrumi a lento rilascio: 1ª applicazione dell'anno. Distribuire sulla superficie e annaffiare. CalMag mensile.",
            "4": "Il granulare sta lavorando — nessun intervento aggiuntivo. CalMag mensile. Controlla clorosi ferrica.",
            "5": "Stagione attiva. Il granulare nutre costantemente. CalMag mensile.",
            "6": "Granulare agrumi: 2ª applicazione dell'anno. CalMag mensile. Annaffiatura abbondante con il caldo.",
            "7": "Il granulare di giugno è attivo. Annaffia di più con il caldo estivo. CalMag mensile.",
            "8": "Controlla cocciniglia e minatore fogliare. CalMag mensile.",
            "9": "Granulare agrumi: 3ª e ultima applicazione. CalMag mensile. Il limone fruttifica ancora.",
            "10": "Il granulare di settembre nutre fino a fine anno. CalMag mensile. Riduci le annaffiature.",
            "11": "Lupini macinati: interrare 100-150g. Forniranno azoto organico per tutto l'inverno. CalMag mensile.",
            "12": "I lupini stanno lavorando. CalMag mensile. Annaffiatura ridotta.",
        },
        "root_depth_cm": 32,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "calmag", "months": "1,2,3,4,5,6,7,8,9,10,11,12", "interval_days": 30,
                "start_date": "2026-01-10", "dose": "dose piena",
                "note": "Tutto l'anno — indispensabile anche con granulare (ferro + magnesio)",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "3,4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-03-20", "dose": "½ dose",
                "note": "Rinvigorente mensile — complemento al granulare",
                "sort_order": 1,
            },
            {
                "prod": "bloom", "months": "6,7,8,9", "interval_days": 30,
                "start_date": "2026-06-05", "dose": "½ dose",
                "note": "Supporto alla fruttificazione in aggiunta al granulare",
                "sort_order": 2,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "4,5,6,7,8", "interval_days": 28,
                "start_date": "2026-04-08", "dose": "5 ml/L",
                "note": "Cocciniglia, afidi, minatore fogliare — trattare anche il sotto delle foglie",
                "sort_order": 0,
            },
            {
                "prod": "rame", "months": "2,10", "interval_days": 30,
                "start_date": "2026-02-12", "dose": "20 g/10L",
                "note": "Pre-primavera e post-raccolta — preventivo batteriosi e fumaggine",
                "sort_order": 1,
            },
            {
                "prod": "obianco", "months": "1", "interval_days": 30,
                "start_date": "2026-01-12", "dose": "15 ml/L",
                "note": "Trattamento invernale contro cocciniglie svernanti su rami e tronco",
                "sort_order": 2,
            },
        ],
    },

    # ─── id 7: Moneta Cinese ──────────────────────────────────────────
    {
        "name": "Moneta Cinese",
        "latin": "Pilea peperomioides",
        "icon": "💰",
        "sim_group": "tropicale",
        "sensor_cat": "tropicali",
        "card_data": {
            "con": {
                "periodo": "Aprile – Agosto",
                "frequenza": "Ogni 25 giorni",
                "concime": "Universale bilanciato, ½ dose",
                "stop": "Stop totale settembre-marzo",
                "note": "Pianta sensibile — dose piena causa foglie deformate. Inizia con cautela e osserva la reazione.",
            },
            "sub": {
                "terreno": "Universale leggero con 30% perlite",
                "ph": "6.0 – 7.0",
                "vaso": "Plastica, drenaggio importante",
                "rinvaso": "Ogni anno in primavera (cresce velocemente)",
                "vivo": "Humus di lombrico 5% al rinvaso (poco — la pianta è delicata). Micorrize universali in dose minima.",
            },
            "esp": {
                "luce": "Luminosa indiretta",
                "sole": "Mai diretto — brucia subito",
                "temperatura": "16-24°C",
                "umidita": "50-60%",
            },
            "cur": {
                "acqua": "Quando il primo cm di terreno è asciutto. Foglie cadute = troppa acqua",
                "potatura": "Nessuna — eventualmente staccare i figli alla base",
                "parassiti": "Ragnetto rosso in ambiente secco",
                "extra": "Ruotare il vaso ogni 2 settimane per crescita uniforme. Produce molti figlioletti che si possono separare e regalare.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic",
                "primavera": "Bio·Grow ¼ dose ogni 25 giorni",
                "estate": "Continua. Alg·A·Mic ¼ dose come booster mensile",
                "autunno": "Stop da settembre",
                "rinvaso": "Root·Juice molto diluito",
                "note": "Una delle piante più sensibili agli eccessi di concime. Mai oltre ¼ dose — meglio sotto-concimare che sopra-concimare.",
            },
        },
        "fert_months": "4,5,6,7,8",
        "fert_interval": 25,
        "fert_product": "Universale bilanciato, ½ dose",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        "monthly_notes": {
            "4": "Prima concimazione. Ruota il vaso verso la luce.",
            "5": "Stagione attiva. Separa i figlioletti alla base se presenti.",
            "6": "Continua normalmente.",
            "7": "Controlla ragnetto rosso in ambienti secchi.",
            "8": "Ultima concimazione. Da settembre stop.",
        },
        "root_depth_cm": 12,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "4,5,6,7,8", "interval_days": 25,
                "start_date": "2026-04-07", "dose": "¼ dose",
                "note": "Non esagerare — a dose piena causa foglie deformate",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "4,5,6,7,8", "interval_days": 30,
                "start_date": "2026-04-22", "dose": "¼ dose",
                "note": "Booster mensile leggero",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 8: Vinca ──────────────────────────────────────────────────
    {
        "name": "Vinca",
        "latin": "Vinca major / minor",
        "icon": "💜",
        "sim_group": "fiorita",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Aprile – Agosto",
                "frequenza": "Ogni 25 giorni",
                "concime": "Liquido piante da fiore, P-K",
                "stop": "Da settembre a marzo",
                "note": "Mai concime azotato — produce solo foglie a scapito dei fiori.",
            },
            "sub": {
                "terreno": "Universale, anche poco fertile",
                "ph": "6.0 – 7.5 (poco esigente)",
                "vaso": "Anche grande — tende ad espandersi come tappezzante",
                "rinvaso": "Ogni 2 anni o quando supera il vaso",
                "vivo": "Compost maturo 10% al rinvaso. Cornunghia leggera. Pianta poco esigente, evitare eccessi organici.",
            },
            "esp": {
                "luce": "Mezz'ombra o sole filtrato",
                "sole": "Tollera poche ore al mattino",
                "temperatura": "Rustica — sopporta sia freddo che caldo",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Moderata — tollera anche periodi secchi",
                "potatura": "Inizio primavera: pota i rami legnosi per stimolare crescita compatta",
                "parassiti": "Pochi nemici naturali",
                "extra": "Tappezzante invasiva se in piena terra — controllare l'espansione. In vaso si comporta meglio.",
            },
            "bio": {
                "prodotti": "Bio·Bloom · Alg·A·Mic",
                "primavera": "Bio·Bloom ½ dose ogni 25 giorni",
                "estate": "Continua. Alg·A·Mic come rinvigorente mensile",
                "autunno": "Stop da settembre",
                "rinvaso": "Root·Juice + cornunghia",
                "note": "Solo Bio·Bloom — il Bio·Grow farebbe foglie a scapito dei fiori. La Vinca fiorisce poco se concimata male.",
            },
        },
        "fert_months": "4,5,6,7,8",
        "fert_interval": 25,
        "fert_product": "Liquido piante da fiore, P-K",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        "monthly_notes": {
            "4": "Prima concimazione. Pota i rami legnosi per stimolare crescita compatta.",
            "5": "Stagione di piena fioritura.",
            "6": "Continua con P-K. Evita l'azoto.",
            "7": "Controlla che non si espanda troppo se in piena terra.",
            "8": "Ultima concimazione.",
        },
        "root_depth_cm": 18,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "bloom", "months": "4,5,6,7,8", "interval_days": 25,
                "start_date": "2026-04-10", "dose": "½ dose",
                "note": "Mai Bio·Grow — produce foglie a scapito dei fiori",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 9: Mimosa ─────────────────────────────────────────────────
    {
        "name": "Mimosa",
        "latin": "Acacia dealbata",
        "icon": "💛",
        "sim_group": "arbusto",
        "sensor_cat": "mediterranee",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre (post-fioritura)",
                "frequenza": "Ogni 25 giorni",
                "concime": "Povero di azoto, ricco P-K (tipo azalee)",
                "stop": "Stop totale durante e dopo la fioritura (gennaio-febbraio)",
                "note": "La Mimosa è una leguminosa — fissa già azoto da sola. Aggiungere altro azoto è controproducente.",
            },
            "sub": {
                "terreno": "Universale acidofilo + 20% sabbia per drenaggio",
                "ph": "5.5 – 6.5 — è acidofila",
                "vaso": "Grande — ha radici espansive",
                "rinvaso": "Ogni 3 anni a fine fioritura (marzo)",
                "vivo": "Compost acido al rinvaso. Mai cornunghia (troppo azoto). Micorrize endo specifiche per leguminose.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto",
                "temperatura": "Estate fino a 35°C; inverno minimo 0°C (proteggere sotto -2°C)",
                "umidita": "Normale, anche bassa",
            },
            "cur": {
                "acqua": "Moderata — tollera la siccità. Mai ristagni",
                "potatura": "Subito dopo la fioritura per mantenere forma e vigoria",
                "parassiti": "Pochi nemici",
                "extra": "Vita relativamente breve (10-15 anni). Rifiorisce a gennaio-febbraio con i caratteristici pompon gialli.",
            },
            "bio": {
                "prodotti": "Bio·Bloom · Alg·A·Mic (mai Bio·Grow)",
                "primavera": "Solo Alg·A·Mic durante la fioritura, ½ dose",
                "estate": "Bio·Bloom ½ dose ogni 25 giorni post-fioritura",
                "autunno": "Stop da ottobre",
                "rinvaso": "Root·Juice + micorrize endo",
                "note": "Stesso ragionamento del Glicine: leguminosa, fissa azoto autonomamente. Bio·Grow è proibito.",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 25,
        "fert_product": "Povero N, ricco P-K; tipo azalee",
        "fert_note": "",
        "monthly_states": [0, 3, 3, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "2": "Fioritura spettacolare! Non concimare — pota subito dopo.",
            "3": "Potatura post-fioritura. Prima concimazione P-K dopo la potatura.",
            "4": "Stagione attiva. Ricorda: zero azoto.",
            "5": "Crescita rapida. In vaso, controlla le dimensioni.",
            "6": "Continua con P-K.",
            "7": "Annaffiatura moderata — tollera la siccità.",
            "8": "Ultima concimazione.",
            "9": "Stop concimazione. Le gemme fiorali si stanno formando.",
        },
        "root_depth_cm": 28,
        "p_coef": 0.45,
        "bb_schedules": [
            {
                "prod": "alg", "months": "2,3", "interval_days": 21,
                "start_date": "2026-02-05", "dose": "½ dose",
                "note": "Solo durante la fioritura",
                "sort_order": 0,
            },
            {
                "prod": "bloom", "months": "3,4,5,6,7,8,9", "interval_days": 25,
                "start_date": "2026-03-25", "dose": "½ dose",
                "note": "Solo Bio·Bloom — mai Bio·Grow (leguminosa)",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 10: Melograno ─────────────────────────────────────────────
    {
        "name": "Melograno",
        "latin": "Punica granatum",
        "icon": "🍎",
        "sim_group": "arbusto",
        "sensor_cat": "mediterranee",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "Ogni 25 giorni con regimi differenziati",
                "concime": "Bilanciato in primavera, P-K da maggio per fruttificazione",
                "stop": "Da ottobre a febbraio",
                "note": "Irregolarità idriche durante la fruttificazione causano spaccatura dei frutti. Mantenere costante l'umidità.",
            },
            "sub": {
                "terreno": "Universale + 20% sabbia + 10% lapillo",
                "ph": "6.5 – 7.5 (tollera anche calcareo)",
                "vaso": "Grande, terracotta possibilmente",
                "rinvaso": "Ogni 3-4 anni in primavera",
                "vivo": "Compost maturo 15% al rinvaso. Cornunghia 2× anno. Cenere di legna in autunno (apporto K).",
            },
            "esp": {
                "luce": "Pieno sole — la fioritura e la fruttificazione lo richiedono",
                "sole": "Diretto",
                "temperatura": "Estate fino a 35°C; inverno minimo -5°C",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Regolare in fioritura/fruttificazione, ridotta in inverno",
                "potatura": "Inverno: pota i rami secchi e quelli che si incrociano",
                "parassiti": "Afidi sui germogli, cocciniglia, Alternaria (fungo)",
                "extra": "Fioritura rosso-arancio in maggio-giugno. Frutti maturano in ottobre-novembre. Prima fruttificazione dopo 3-4 anni.",
            },
            "bio": {
                "prodotti": "Bio·Grow (primavera) · Bio·Bloom · Top·Max",
                "primavera": "Bio·Grow dose piena ogni 25 giorni in marzo-aprile",
                "estate": "Bio·Bloom dose piena ogni 25 giorni da maggio. Top·Max ogni 30 giorni in giugno-agosto",
                "autunno": "Stop da ottobre",
                "rinvaso": "Root·Juice + cornunghia",
                "note": "Il Top·Max migliora l'assorbimento di P-K e riduce il rischio di spaccatura dei frutti. Da non sottovalutare.",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 25,
        "fert_product": "Bilanciato → P-K da giugno",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione dell'anno — bilanciata per la ripresa.",
            "4": "Fiori rosso-arancio iniziano ad aprirsi.",
            "5": "Passa a P-K per sostenere la fruttificazione.",
            "6": "Estate — massima attenzione all'irrigazione regolare per evitare la spaccatura dei frutti.",
            "7": "Continua con P-K.",
            "8": "Frutti in crescita. Irregolarità idriche = frutti spaccati.",
            "9": "Ultima concimazione. I frutti maturano in ottobre-novembre.",
        },
        "root_depth_cm": 32,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4", "interval_days": 25,
                "start_date": "2026-03-22", "dose": "dose piena",
                "note": "Ripresa vegetativa primaverile",
                "sort_order": 0,
            },
            {
                "prod": "bloom", "months": "5,6,7,8,9", "interval_days": 25,
                "start_date": "2026-05-05", "dose": "dose piena",
                "note": "Passa a Bio·Bloom non appena compaiono i fiori",
                "sort_order": 1,
            },
            {
                "prod": "topmax", "months": "6,7,8", "interval_days": 30,
                "start_date": "2026-06-10", "dose": "dose piena",
                "note": "Migliora assorbimento e riduce rischio spaccatura frutti",
                "sort_order": 2,
            },
        ],
        "tr_schedules": [
            {
                "prod": "rame", "months": "2,10", "interval_days": 30,
                "start_date": "2026-02-15", "dose": "20 g/10L",
                "note": "Dormant spray pre-primavera + post-raccolta — preventivo Alternaria",
                "sort_order": 0,
            },
            {
                "prod": "obianco", "months": "1", "interval_days": 30,
                "start_date": "2026-01-15", "dose": "15 ml/L",
                "note": "Uova e cocciniglie svernanti — trattare rami e tronco",
                "sort_order": 1,
            },
            {
                "prod": "neem", "months": "5,6", "interval_days": 30,
                "start_date": "2026-05-10", "dose": "5 ml/L",
                "note": "Afidi sui germogli primaverili",
                "sort_order": 2,
            },
        ],
    },

    # ─── id 11: Stella di Natale ──────────────────────────────────────
    {
        "name": "Stella di Natale",
        "latin": "Euphorbia pulcherrima",
        "icon": "🎄",
        "sim_group": "fiorita",
        "sensor_cat": "tropicali",
        "card_data": {
            "con": {
                "periodo": "Aprile – Luglio (vegetativo)",
                "frequenza": "Ogni 18 giorni",
                "concime": "Universale bilanciato",
                "stop": "Stop assoluto da agosto in poi (protocollo fotoperiodico)",
                "note": "Concimare in agosto-settembre rovina il protocollo di colorazione delle brattee. Stop tassativo.",
            },
            "sub": {
                "terreno": "Universale leggero con 20% perlite",
                "ph": "6.0 – 7.0",
                "vaso": "Plastica con buon drenaggio",
                "rinvaso": "Una volta a marzo se la pianta è ripartita",
                "vivo": "Humus di lombrico 10% al rinvaso. Micorrize universali. Compost maturo nel periodo vegetativo.",
            },
            "esp": {
                "luce": "Luminosa indiretta in vegetazione, BUIO totale 14h/giorno da ottobre",
                "sole": "Mai diretto",
                "temperatura": "16-22°C — soffre sotto i 13°C",
                "umidita": "50-60%",
            },
            "cur": {
                "acqua": "Quando il primo cm è asciutto. Mai sottovaso pieno",
                "potatura": "A marzo: tagliare i rami a 10-15 cm dalla base se la pianta riparte",
                "parassiti": "Mosca bianca, cocciniglia",
                "extra": "Per ottenere brattee colorate a Natale, dare 14 ore di buio totale ogni giorno da ottobre a metà novembre. Anche un singolo flash di luce notturna interrompe il processo.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic",
                "primavera": "Bio·Grow dose piena ogni 18 giorni in aprile-luglio",
                "estate": "Continua fino a luglio. Stop ad agosto.",
                "autunno": "Stop totale — non disturbare il protocollo buio",
                "rinvaso": "Root·Juice + humus di lombrico",
                "note": "Il fattore principale per il successo NON è il concime ma il rispetto del protocollo fotoperiodico. Concimare in autunno è inutile e dannoso.",
            },
        },
        "fert_months": "4,5,6,7",
        "fert_interval": 18,
        "fert_product": "Universale bilanciato",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 0, 0, 3, 3, 3],
        "monthly_notes": {
            "1": "Riposo post-decorativo. Nessuna concimazione.",
            "2": "Stop totale. Annaffiatura minima.",
            "3": "Se emette nuovi germogli, inizia con dose leggera.",
            "4": "Stagione di crescita — concima ogni 2-3 settimane.",
            "5": "Crescita vegetativa attiva.",
            "6": "Continua a crescere. Buona luce indiretta.",
            "7": "Ultima concimazione primaverile-estiva.",
            "8": "Stop estivo. Prepara la pianta al trattamento fotoperiodico.",
            "10": "BUIO! Inizia il protocollo: 14 ore di buio totale ogni giorno. Zero concime.",
            "11": "Continua il buio forzato. Le foglie iniziano a colorarsi di rosso.",
            "12": "Fase decorativa. Non concimare. Goditi i colori!",
        },
        "root_depth_cm": 18,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "4,5,6,7", "interval_days": 18,
                "start_date": "2026-04-12", "dose": "dose piena",
                "note": "Stop assoluto da agosto — non disturbare il protocollo buio",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "4,5,6", "interval_days": 28,
                "start_date": "2026-04-10", "dose": "3 ml/L (dose ridotta)",
                "note": "Mosca bianca e cocciniglia — dose ridotta per non stressare la pianta",
                "sort_order": 0,
            },
            {
                "prod": "sapone", "months": "5,6", "interval_days": 35,
                "start_date": "2026-05-05", "dose": "10-15 g/L",
                "note": "Mosca bianca — complemento al neem, alternare i due prodotti",
                "sort_order": 1,
            },
        ],
    },

    # ─── id 12: Aloe Vera ─────────────────────────────────────────────
    {
        "name": "Aloe Vera",
        "latin": "Aloe barbadensis",
        "icon": "🌵",
        "sim_group": "succulenta",
        "sensor_cat": "succulente",
        "card_data": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "Ogni 30 giorni",
                "concime": "Liquido succulente, ½ dose",
                "stop": "Stop totale ottobre-marzo",
                "note": "Dose piena causa marciume delle radici. Sempre meglio sottoconcimare che eccedere.",
            },
            "sub": {
                "terreno": "Substrato per succulente e cactus, drenaggio massimo",
                "ph": "6.5 – 7.5",
                "vaso": "Terracotta con foro di drenaggio. Non troppo profondo (radici superficiali)",
                "rinvaso": "Ogni 2-3 anni in primavera",
                "vivo": "Mai humus o compost — saturano il substrato. Solo micorrize universali al rinvaso, dose minima.",
            },
            "esp": {
                "luce": "Pienissima — più luce = più vigoria",
                "sole": "Diretto, anche in estate (la pianta vive nel deserto)",
                "temperatura": "Estate 25-35°C; inverno minimo 10°C",
                "umidita": "Bassa è ottimale",
            },
            "cur": {
                "acqua": "Quando il substrato è completamente asciutto, anche fino a 3 settimane in inverno",
                "potatura": "Rimuovere foglie esterne secche o danneggiate",
                "parassiti": "Cocciniglia cotonosa",
                "extra": "Si moltiplica facilmente: i figlioletti alla base si separano e si trapiantano. Le foglie contengono il famoso gel curativo.",
            },
            "bio": {
                "prodotti": "Solo Alg·A·Mic — niente Bio·Grow né Bio·Bloom",
                "primavera": "Alg·A·Mic ¼ dose ogni 30 giorni",
                "estate": "Continua come primavera",
                "autunno": "Stop da ottobre",
                "rinvaso": "Root·Juice diluitissimo",
                "note": "Come la Sanseviera, l'Aloe non tollera concimi minerali. L'Alg·A·Mic è perfetto perché 100% organico e molto delicato.",
            },
        },
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 30,
        "fert_product": "Liquido succulente, ½ dose",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "4": "Prima concimazione. Controlla se ci sono figli da separare.",
            "5": "Stagione attiva. Annaffia solo quando il substrato è completamente asciutto.",
            "6": "Se fuori all'aperto, esponi gradualmente al sole diretto.",
            "7": "Mese di massima luce — la pianta è al meglio.",
            "8": "Continua normalmente.",
            "9": "Ultima concimazione. Da ottobre stop totale.",
        },
        "root_depth_cm": 15,
        "p_coef": 0.60,
        "bb_schedules": [
            {
                "prod": "alg", "months": "4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-04-10", "dose": "¼ dose",
                "note": "Unico prodotto adatto — mai Bio·Grow o Bio·Bloom",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 13: Liquidambar ───────────────────────────────────────────
    {
        "name": "Liquidambar",
        "latin": "Liquidambar styraciflua",
        "icon": "🍁",
        "sim_group": "albero",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Marzo – Luglio (solo giovani esemplari)",
                "frequenza": "Ogni 35 giorni",
                "concime": "Acidofile (azalee/rododendri)",
                "stop": "Da agosto in poi — non stimolare crescita tardiva",
                "note": "Per esemplari adulti in piena terra: nessuna concimazione necessaria. Solo i giovani nei primi 3 anni hanno bisogno di sostegno.",
            },
            "sub": {
                "terreno": "Acidofilo, drenante. Mai terreni calcarei",
                "ph": "5.0 – 6.5 — è acidofilo come azalee/rododendri",
                "vaso": "Per giovani: grande, drenaggio importante. Adulti: solo piena terra",
                "rinvaso": "Per giovani: ogni 2 anni",
                "vivo": "Compost ericoidi al trapianto. Pinastro maturo come pacciamatura. Micorrize ericoidi specifiche.",
            },
            "esp": {
                "luce": "Pieno sole — i colori autunnali dipendono dalla luce",
                "sole": "Diretto",
                "temperatura": "Rustico — sopporta -15°C",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Regolare per giovani esemplari. Adulti autonomi",
                "potatura": "Inverno: rimuovere rami secchi o malformati",
                "parassiti": "Pochi nemici, occasionali afidi",
                "extra": "I colori autunnali (rosso, arancio, viola, giallo) sono spettacolari e durano settimane. Pianta amata per questo motivo.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic",
                "primavera": "Bio·Grow dose piena ogni 35 giorni (solo giovani)",
                "estate": "Continua per giovani. Adulti: non concimare",
                "autunno": "Stop da agosto",
                "rinvaso": "Root·Juice + micorrize ericoidi",
                "note": "Adulti in piena terra: niente concime. Il liquidambar adulto trova tutto quello che gli serve dal terreno. Concimare un adulto può addirittura essere dannoso.",
            },
        },
        "fert_months": "3,4,5,6,7",
        "fert_interval": 35,
        "fert_product": "Acidofile (azalee/rododendri)",
        "fert_note": "Solo giovani esemplari (primi 3 anni)",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione. Ideale per il trapianto con micorrize acidofile.",
            "4": "Stagione attiva. Terreno acido fondamentale — no calcare.",
            "5": "Crescita attiva. Mantieni il terreno fresco.",
            "6": "Continua normalmente.",
            "7": "Ultima concimazione. Non stimolare crescita tardiva.",
            "10": "I colori autunnali iniziano — rosso, arancio, viola. Nessun intervento.",
        },
        "root_depth_cm": 40,
        "p_coef": 0.55,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6,7", "interval_days": 35,
                "start_date": "2026-03-18", "dose": "dose piena",
                "note": "Solo giovani piante (primi 3 anni)",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "4,8", "interval_days": 120,
                "start_date": "2026-04-01", "dose": "½ dose",
                "note": "1-2 volte a stagione come rinvigorente",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 14: Ippocastano ───────────────────────────────────────────
    {
        "name": "Ippocastano",
        "latin": "Aesculus hippocastanum",
        "icon": "🌳",
        "sim_group": "albero",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Marzo – Giugno (solo giovani esemplari)",
                "frequenza": "Ogni 45 giorni",
                "concime": "Granulare a lenta cessione (solo giovani)",
                "stop": "Da luglio in poi",
                "note": "Adulti in piena terra: nessuna concimazione necessaria. La concimazione è solo per i primi 2-3 anni dalla messa a dimora.",
            },
            "sub": {
                "terreno": "Profondo e fertile, ben drenato",
                "ph": "6.0 – 7.5",
                "vaso": "Pianta da piena terra — il vaso è solo per esemplari molto giovani",
                "rinvaso": "Trapianto in piena terra entro 2-3 anni",
                "vivo": "Compost ben maturo alla messa a dimora. Cornunghia 1× anno per giovani. Micorrize ectomicorriziche specifiche per Aesculus.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto",
                "temperatura": "Rustico — sopporta -25°C",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Regolare per giovani. Adulti autonomi anche in siccità",
                "potatura": "Inverno: rimuovere rami secchi. Pianta che cresce naturalmente",
                "parassiti": "Cameraria ohridella (minatore fogliare) — gravissimo problema dell'ippocastano",
                "extra": "Fioritura a candelabro bianca (o rosa nelle varietà ornamentali) in maggio. Frutti = castagne d'India non commestibili.",
            },
            "bio": {
                "prodotti": "Bio·Grow",
                "primavera": "Bio·Grow dose piena ogni 45 giorni (solo giovani)",
                "estate": "Una sola applicazione a giugno",
                "autunno": "Stop totale",
                "rinvaso": "Root·Juice + micorrize alla messa a dimora",
                "note": "Adulti: nessun bisogno. La pianta è frugale una volta stabilita.",
            },
        },
        "fert_months": "3,4,5,6",
        "fert_interval": 45,
        "fert_product": "Granulare a lenta cessione (solo giovani)",
        "fert_note": "Solo giovani piante (primi 2-3 anni)",
        "monthly_states": [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Unica concimazione dell'anno per piante adulte.",
            "4": "Fioritura spettacolare bianca/rosa.",
            "5": "Controlla la Cameraria ohridella (minatore fogliare) — trattamento preventivo se presente.",
            "6": "Ultima concimazione per giovani piante. Da luglio stop totale.",
        },
        "root_depth_cm": 45,
        "p_coef": 0.55,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6", "interval_days": 45,
                "start_date": "2026-03-20", "dose": "dose piena",
                "note": "Solo giovani piante (primi 2-3 anni)",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "4,5", "interval_days": 30,
                "start_date": "2026-04-10", "dose": "5 ml/L",
                "note": "Cameraria ohridella (minatore fogliare) — trattamento preventivo fondamentale",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 15: Betulla ───────────────────────────────────────────────
    {
        "name": "Betulla",
        "latin": "Betula pendula",
        "icon": "🌳",
        "sim_group": "albero",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Marzo – Giugno (solo giovani esemplari)",
                "frequenza": "Ogni 35 giorni",
                "concime": "Acidofile o universale a pH basso",
                "stop": "Da luglio in poi",
                "note": "Mai potare in primavera — la betulla 'piange' grandi quantità di linfa che indeboliscono la pianta. Potare in autunno-inverno.",
            },
            "sub": {
                "terreno": "Acidofilo, fresco, ben drenato",
                "ph": "5.0 – 6.5 — soffre i terreni calcarei",
                "vaso": "Solo per giovani esemplari, max 3-4 anni",
                "rinvaso": "Trapianto in piena terra entro 3-4 anni",
                "vivo": "Compost ericoidi alla messa a dimora. Pinastro come pacciamatura. Micorrize ectomicorriziche specifiche per Betula sono fondamentali — la pianta dipende molto da loro.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto",
                "temperatura": "Rustica — sopporta -30°C",
                "umidita": "Tollera anche bassa, preferisce normale",
            },
            "cur": {
                "acqua": "Regolare per giovani. Adulti necessitano di terreno fresco — non eccessiva siccità",
                "potatura": "Solo in autunno-inverno (mai primavera per via del flusso di linfa)",
                "parassiti": "Afidi, processionaria (raramente)",
                "extra": "Corteccia bianca caratteristica decorativa. Foglie giallo dorato in autunno. Vita relativamente breve per un albero (60-80 anni).",
            },
            "bio": {
                "prodotti": "Bio·Grow",
                "primavera": "Bio·Grow ½ dose ogni 35 giorni (solo giovani)",
                "estate": "Una sola applicazione a giugno",
                "autunno": "Stop totale",
                "rinvaso": "Root·Juice + micorrize ectomicorriziche specifiche",
                "note": "Le micorrize sono cruciali per la betulla. Senza le giuste partner fungine, la pianta soffre molto.",
            },
        },
        "fert_months": "3,4,5,6",
        "fert_interval": 35,
        "fert_product": "Acidofile o universale pH basso",
        "fert_note": "Solo giovani piante",
        "monthly_states": [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione. Al trapianto: micorrize ectomicorriziche specifiche per Betula.",
            "4": "Crescita rapida primaverile.",
            "5": "Continua per giovani piante. Adulte: nessun intervento necessario.",
            "6": "Ultima concimazione. Non potare in primavera — 'piange' molta linfa.",
        },
        "root_depth_cm": 40,
        "p_coef": 0.55,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6", "interval_days": 35,
                "start_date": "2026-03-22", "dose": "½ dose",
                "note": "Solo giovani piante",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 16: Acero Campestre ───────────────────────────────────────
    {
        "name": "Acero Campestre",
        "latin": "Acer campestre",
        "icon": "🍁",
        "sim_group": "albero",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Marzo – Maggio (solo giovani o siepi potate)",
                "frequenza": "Ogni 40 giorni",
                "concime": "Granulare universale, basso azoto",
                "stop": "Da giugno in poi",
                "note": "Esemplari adulti in piena terra: nessuna concimazione necessaria. Pianta straordinariamente adattabile e frugale.",
            },
            "sub": {
                "terreno": "Universale, tollera tutto tranne calcari estremi",
                "ph": "6.0 – 7.5",
                "vaso": "Solo per giovani — pianta robusta da piena terra",
                "rinvaso": "Trapianto in piena terra appena possibile",
                "vivo": "Compost maturo alla messa a dimora. Micorrize universali. Pacciamatura organica.",
            },
            "esp": {
                "luce": "Sole o mezz'ombra",
                "sole": "Tollera anche poche ore",
                "temperatura": "Rustico — sopporta -20°C",
                "umidita": "Tollera ogni condizione",
            },
            "cur": {
                "acqua": "Regolare per giovani. Adulti tollerano la siccità",
                "potatura": "Inverno o tardo autunno — molto adatto a forme topiate (siepi)",
                "parassiti": "Afidi (occasionali). Pianta resistente",
                "extra": "Spesso usato come siepe perché tollera potature drastiche. Foglie giallo dorato in autunno. Corteccia ruvida caratteristica.",
            },
            "bio": {
                "prodotti": "Bio·Grow",
                "primavera": "Bio·Grow ½ dose ogni 40 giorni (solo giovani o siepi)",
                "estate": "Stop",
                "autunno": "Stop totale",
                "rinvaso": "Root·Juice + micorrize",
                "note": "Pianta facilissima — non ha quasi mai bisogno di interventi nutrizionali per gli adulti.",
            },
        },
        "fert_months": "3,4,5",
        "fert_interval": 40,
        "fert_product": "Granulare universale, basso azoto",
        "fert_note": "Solo giovani o siepi potate intensivamente",
        "monthly_states": [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Unica concimazione dell'anno se necessaria.",
            "4": "Se usato come siepe potata frequentemente, continua fino a maggio.",
            "5": "Ultima concimazione per siepi. Pianta straordinariamente adattabile.",
            "10": "Foglie giallo dorato in autunno. Nessun intervento.",
        },
        "root_depth_cm": 35,
        "p_coef": 0.55,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5", "interval_days": 40,
                "start_date": "2026-03-15", "dose": "½ dose",
                "note": "Solo giovani piante o siepi potate intensivamente",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 17: Pitosforo ─────────────────────────────────────────────
    {
        "name": "Pitosforo",
        "latin": "Pittosporum tobira",
        "icon": "🌿",
        "sim_group": "arbusto",
        "sensor_cat": "mediterranee",
        "card_data": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "Ogni 35 giorni",
                "concime": "Universale bilanciato o specifico sempreverdi",
                "stop": "Da ottobre a febbraio",
                "note": "Pianta poco esigente, sopporta bene le potature drastiche. Spesso usata come siepe in zone marittime per resistenza alla salsedine.",
            },
            "sub": {
                "terreno": "Universale, tollera anche poco fertile",
                "ph": "6.0 – 7.5",
                "vaso": "Grande, terracotta o plastica robusta",
                "rinvaso": "Ogni 3-4 anni in primavera",
                "vivo": "Compost maturo 15% al rinvaso. Cornunghia 1-2× anno. Micorrize universali.",
            },
            "esp": {
                "luce": "Pieno sole o mezz'ombra",
                "sole": "Diretto, anche in zone calde",
                "temperatura": "Estate fino a 35°C; inverno minimo -5°C (proteggere)",
                "umidita": "Tollera anche aria salina",
            },
            "cur": {
                "acqua": "Regolare in estate, ridotta in inverno",
                "potatura": "Marzo per forma; agosto per siepi (post-fioritura)",
                "parassiti": "Cocciniglia, afidi sui germogli",
                "extra": "Fiori bianco-crema profumatissimi (zagara) in primavera. Pianta perfetta per siepi formali grazie alla densità del fogliame.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Fish·Mix · Alg·A·Mic",
                "primavera": "Bio·Grow dose piena ogni 35 giorni",
                "estate": "Continua. Fish·Mix dopo le potature primaverili e agostane",
                "autunno": "Riduci da settembre",
                "rinvaso": "Root·Juice + cornunghia",
                "note": "Il Fish·Mix dopo le potature è ottimo perché la pianta produce nuovi germogli ed apprezza l'azoto organico immediatamente disponibile.",
            },
        },
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 35,
        "fert_product": "Universale bilanciato o sempreverdi",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione. Ottimo momento per la potatura leggera di forma.",
            "4": "Fioritura profumatissima (zagara).",
            "5": "Stagione attiva. Se usato come siepe, aumenta frequenza dopo ogni potatura.",
            "6": "Continua normalmente.",
            "7": "Estate — tollera bene la siccità.",
            "8": "Potatura estiva di forma se necessaria. Ultima concimazione intensa.",
            "9": "Ultima concimazione leggera. Da ottobre stop.",
        },
        "root_depth_cm": 30,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6,7,8,9", "interval_days": 35,
                "start_date": "2026-03-25", "dose": "dose piena",
                "note": "",
                "sort_order": 0,
            },
            {
                "prod": "fish", "months": "4,8", "interval_days": 120,
                "start_date": "2026-04-05", "dose": "dose piena",
                "note": "Dopo la potatura primaverile e quella estiva di agosto",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "5,6,7", "interval_days": 30,
                "start_date": "2026-05-05", "dose": "5 ml/L",
                "note": "Cocciniglia e afidi sui germogli primaverili",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 18: Spino di Giuda ────────────────────────────────────────
    {
        "name": "Spino di Giuda",
        "latin": "Gleditsia triacanthos",
        "icon": "🌳",
        "sim_group": "arbusto",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Marzo – Luglio (solo giovani)",
                "frequenza": "Ogni 35 giorni",
                "concime": "Universale bilanciato (NB: non fissa azoto come la mimosa)",
                "stop": "Da agosto",
                "note": "Nonostante sia una leguminosa per botanica, lo Spino di Giuda NON fissa azoto autonomamente come la Mimosa o il Glicine. Quindi Bio·Grow è appropriato.",
            },
            "sub": {
                "terreno": "Universale, ben drenato, anche poco fertile",
                "ph": "6.0 – 7.5",
                "vaso": "Pianta da piena terra — il vaso solo per esemplari molto giovani",
                "rinvaso": "Trapianto in piena terra entro 2-3 anni",
                "vivo": "Compost maturo alla messa a dimora. Micorrize endo. Pacciamatura organica.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto",
                "temperatura": "Rustico — sopporta -25°C",
                "umidita": "Tollera ogni condizione",
            },
            "cur": {
                "acqua": "Regolare per giovani. Adulti molto autonomi",
                "potatura": "Inverno: rimuovere rami danneggiati. Pianta vigorosa che ricresce facilmente",
                "parassiti": "Quasi nessuno — pianta resistentissima",
                "extra": "Foglie bipennate finissime, eleganti. Baccelli attorcigliati e contorti caratteristici. Esistono varietà senza spine ('Inermis').",
            },
            "bio": {
                "prodotti": "Bio·Grow",
                "primavera": "Bio·Grow dose piena ogni 35 giorni (solo giovani)",
                "estate": "Continua per giovani fino a luglio",
                "autunno": "Stop",
                "rinvaso": "Root·Juice + micorrize endo",
                "note": "Differenza importante con Mimosa e Glicine: questa pianta accetta normale azoto perché non fissa autonomamente. Bio·Grow è appropriato e benefico.",
            },
        },
        "fert_months": "3,4,5,6,7",
        "fert_interval": 35,
        "fert_product": "Universale bilanciato (non fissa azoto)",
        "fert_note": "Solo giovani esemplari",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione. Al trapianto: buca ricca di compost e micorrize.",
            "4": "Crescita primaverile attiva. Le foglie bipennate finissime si schiudono.",
            "5": "Continua normalmente. Pianta molto vigorosa una volta stabilita.",
            "6": "Continua per giovani esemplari. Adulti in piena terra: quasi nessun intervento.",
            "7": "Ultima concimazione. Da agosto stop totale.",
            "10": "Foglie giallo dorato in autunno. Baccelli attorcigliati caratteristici.",
        },
        "root_depth_cm": 30,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6,7", "interval_days": 35,
                "start_date": "2026-03-28", "dose": "dose piena",
                "note": "Non fissa azoto — Bio·Grow è appropriato (a differenza di Mimosa)",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 19: Gelso Bonsai ──────────────────────────────────────────
    {
        "name": "Gelso Bonsai",
        "latin": "Morus alba",
        "icon": "🌳",
        "sim_group": "bonsai",
        "sensor_cat": "bonsai",
        "card_data": {
            "con": {
                "periodo": "Aprile – Agosto",
                "frequenza": "Ogni 18 giorni in primavera, ogni 28 giorni in estate",
                "concime": "Bilanciato in primavera, basso N + P-K da luglio per lignificazione",
                "stop": "Stop da settembre",
                "note": "La transizione N→PK a luglio è cruciale per ottenere un buon legno e prepararlo al riposo invernale.",
            },
            "sub": {
                "terreno": "Akadama 60% + pomice 30% + lapillo 10% (mix bonsai classico)",
                "ph": "6.0 – 7.0",
                "vaso": "Bonsai classico, drenaggio massimo",
                "rinvaso": "Ogni 2 anni a fine inverno (febbraio)",
                "vivo": "Mai humus o compost. Solo micorrize endo al rinvaso.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto, anche in estate",
                "temperatura": "Rustico — sopporta -10°C",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Abbondante in estate (anche 2× al giorno con caldo). Substrato bonsai asciuga rapidamente",
                "potatura": "Inverno: strutturale (rami principali). Estate: germogli a 2-3 foglie. Eventuale defogliazione parziale a giugno",
                "parassiti": "Cocciniglia, ragnetto rosso in ambiente secco",
                "extra": "Pianta vigorosissima da bonsai — risponde bene a tecniche aggressive di formazione. Le foglie possono essere ridotte di dimensioni con la defogliazione.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Bio·Bloom · Alg·A·Mic",
                "primavera": "Bio·Grow ½ dose ogni 18 giorni",
                "estate": "Da luglio: Bio·Bloom ½ dose ogni 28 giorni (favorisce lignificazione)",
                "autunno": "Stop da settembre",
                "rinvaso": "Root·Juice + micorrize endo",
                "note": "La logica N→PK a luglio è fondamentale: l'azoto stimola crescita morbida, mentre il PK fa lignificare i rami e prepara la pianta al freddo.",
            },
        },
        "fert_months": "4,5,6",
        "fert_interval": 18,
        "fert_product": "Bilanciato NPK → basso N + P-K da luglio",
        "fert_note": "Cambio regime a luglio: bilanciato → P-K",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        "monthly_notes": {
            "2": "Potatura strutturale invernale (prima del risveglio) — con la pianta priva di foglie.",
            "4": "Ripresa vegetativa — prima concimazione bilanciata. Inizia la potatura di mantenimento.",
            "5": "Piena crescita primaverile. Accorcia ogni germoglio a 1-2 foglie appena raggiunge 4-5.",
            "6": "Valuta la defogliazione parziale per ridurre le dimensioni delle foglie.",
            "7": "Passa a concime con meno azoto e più P-K per favorire la lignificazione.",
            "8": "Ultima concimazione. Inizia a ridurre la frequenza delle annaffiature.",
            "9": "Stop concimazione. La pianta si prepara al riposo vegetativo.",
        },
        "root_depth_cm": 15,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "4,5,6", "interval_days": 18,
                "start_date": "2026-04-05", "dose": "½ dose",
                "note": "Sostiene la crescita esplosiva primaverile",
                "sort_order": 0,
            },
            {
                "prod": "bloom", "months": "7,8", "interval_days": 28,
                "start_date": "2026-07-05", "dose": "½ dose",
                "note": "Favorisce la lignificazione — fondamentale da luglio",
                "sort_order": 1,
            },
            {
                "prod": "alg", "months": "8", "interval_days": 60,
                "start_date": "2026-08-25", "dose": "½ dose",
                "note": "Rinvigorente pre-riposo a fine agosto",
                "sort_order": 2,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "5,6,7,8", "interval_days": 30,
                "start_date": "2026-05-08", "dose": "5 ml/L",
                "note": "Cocciniglia e ragnetto rosso in estate — controllare quotidianamente",
                "sort_order": 0,
            },
            {
                "prod": "rame", "months": "2,3", "interval_days": 30,
                "start_date": "2026-02-18", "dose": "20 g/10L",
                "note": "Dopo potatura strutturale invernale — protegge i tagli",
                "sort_order": 1,
            },
        ],
    },

    # ─── id 20: Tradescantia ──────────────────────────────────────────
    {
        "name": "Tradescantia",
        "latin": "Tradescantia zebrina",
        "icon": "💜",
        "sim_group": "tropicale",
        "sensor_cat": "tropicali",
        "card_data": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "Ogni 25 giorni",
                "concime": "Universale bilanciato, ½ dose",
                "stop": "Da ottobre a marzo",
                "note": "Eccesso di concime causa perdita della colorazione viola caratteristica delle foglie. Restare sempre sotto dose piena.",
            },
            "sub": {
                "terreno": "Universale leggero con 20% perlite",
                "ph": "6.0 – 7.0",
                "vaso": "Pendulo o sospeso — la pianta è ricadente",
                "rinvaso": "Ogni anno (cresce velocemente)",
                "vivo": "Humus di lombrico 10% al rinvaso. Micorrize universali in dose minima.",
            },
            "esp": {
                "luce": "Luminosa — più luce = più colore viola intenso",
                "sole": "Filtrato; in pieno sole le foglie possono bruciare",
                "temperatura": "16-26°C — soffre sotto i 13°C",
                "umidita": "50-60% — apprezza nebulizzazioni",
            },
            "cur": {
                "acqua": "Frequente in estate, moderata in inverno",
                "potatura": "Cima i rami allungati per mantenere la pianta compatta",
                "parassiti": "Ragnetto rosso in ambiente secco",
                "extra": "Si propaga facilissimamente: i rami tagliati radicano in acqua in pochi giorni. Pianta perfetta per condividere talee con amici.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic",
                "primavera": "Bio·Grow ¼ dose ogni 25 giorni",
                "estate": "Continua. Alg·A·Mic ¼ dose come booster mensile",
                "autunno": "Stop da ottobre",
                "rinvaso": "Root·Juice diluito",
                "note": "La colorazione viola è un indicatore della salute della pianta: foglie pallide o verdi = problema (luce o eccesso concime).",
            },
        },
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 25,
        "fert_product": "Universale bilanciato, ½ dose",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "4": "Prima concimazione. Taglia i rami allungati per mantenere la pianta compatta.",
            "5": "Stagione attiva. Propaga le talee in acqua.",
            "6": "Continua normalmente.",
            "7": "Piena estate — la pianta cresce rapidamente.",
            "8": "Continua. Rinfresca la pianta con nebulizzazioni.",
            "9": "Ultima concimazione. Da ottobre stop totale.",
        },
        "root_depth_cm": 12,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "4,5,6,7,8,9", "interval_days": 25,
                "start_date": "2026-04-08", "dose": "¼ dose",
                "note": "Dose minima — eccesso causa perdita colorazione viola",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-04-22", "dose": "¼ dose",
                "note": "Rinvigorente mensile leggero",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 21: Rosmarino ─────────────────────────────────────────────
    {
        "name": "Rosmarino",
        "latin": "Salvia rosmarinus",
        "icon": "🌿",
        "sim_group": "aromatica",
        "sensor_cat": "aromatiche",
        "card_data": {
            "con": {
                "periodo": "Marzo – Luglio",
                "frequenza": "Ogni 45 giorni (raramente)",
                "concime": "Leggero P-K, tipo piante fiorite",
                "stop": "Da agosto in poi",
                "note": "L'eccesso di azoto riduce drasticamente l'aroma e causa crescita molle, vulnerabile a malattie. Sempre dosi minime.",
            },
            "sub": {
                "terreno": "Drenante, anche poco fertile (sabbia 30%)",
                "ph": "6.5 – 7.5 — tollera anche calcareo",
                "vaso": "Terracotta è ideale — drenaggio fondamentale",
                "rinvaso": "Ogni 2-3 anni a fine inverno",
                "vivo": "Compost ben maturo dose minima al rinvaso. Niente cornunghia (troppo azoto). Micorrize universali.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto tutto il giorno",
                "temperatura": "Estate fino a 35°C; inverno minimo -5°C (proteggere)",
                "umidita": "Bassa è perfetta — ama il clima mediterraneo",
            },
            "cur": {
                "acqua": "Moderata, sempre attendere terreno asciutto. In inverno quasi nulla",
                "potatura": "Dopo la fioritura primaverile — non potare durante la fioritura",
                "parassiti": "Pochi nemici — al massimo cocciniglia in piante stressate",
                "extra": "Aroma intenso usato in cucina. Fioritura azzurro-viola in primavera. Foglie ago-formi resistenti.",
            },
            "bio": {
                "prodotti": "Bio·Bloom · Alg·A·Mic (mai Bio·Grow)",
                "primavera": "Bio·Bloom ½ dose ogni 45 giorni",
                "estate": "Stop da agosto",
                "autunno": "Stop totale",
                "rinvaso": "Root·Juice molto diluito",
                "note": "Bio·Grow è VIETATO — l'azoto rovina l'aroma e indebolisce la pianta. Solo Bio·Bloom in dose ridotta.",
            },
        },
        "fert_months": "3,4,5,6,7",
        "fert_interval": 45,
        "fert_product": "Leggero P-K, tipo piante fiorite",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione dell'anno se necessaria. Pota dopo la fioritura.",
            "4": "Fioritura azzurro-viola. Non potare durante la fioritura.",
            "5": "Stagione attiva. In piena terra quasi autonomo.",
            "6": "Continua per piante in vaso.",
            "7": "Ultima concimazione leggera. Da agosto stop.",
        },
        "root_depth_cm": 25,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "bloom", "months": "3,4,5,6,7", "interval_days": 45,
                "start_date": "2026-03-18", "dose": "½ dose",
                "note": "Mai Bio·Grow — l'azoto riduce l'aroma e causa crescita molle",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [
            {
                "prod": "zolfo", "months": "4,5", "interval_days": 30,
                "start_date": "2026-04-10", "dose": "3-5 g/L",
                "note": "Preventivo oidio (mal bianco) — non trattare sopra 30°C",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 22: Salvia ────────────────────────────────────────────────
    {
        "name": "Salvia",
        "latin": "Salvia officinalis",
        "icon": "🌿",
        "sim_group": "aromatica",
        "sensor_cat": "aromatiche",
        "card_data": {
            "con": {
                "periodo": "Marzo – Luglio",
                "frequenza": "Ogni 45 giorni (raramente)",
                "concime": "Leggero P-K, tipo piante mediterranee",
                "stop": "Da agosto in poi",
                "note": "Stesso ragionamento del Rosmarino: l'eccesso di azoto diluisce gli oli essenziali e l'aroma. Mai Bio·Grow.",
            },
            "sub": {
                "terreno": "Drenante, anche calcareo",
                "ph": "6.5 – 7.5",
                "vaso": "Terracotta, drenaggio importante",
                "rinvaso": "Ogni 2-3 anni a fine inverno",
                "vivo": "Compost dose minima. Micorrize universali. Cornunghia bandita.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto",
                "temperatura": "Estate fino a 35°C; inverno minimo -10°C (più rustica del rosmarino)",
                "umidita": "Bassa preferita",
            },
            "cur": {
                "acqua": "Moderata, attendere asciutto. Tollera benissimo la siccità",
                "potatura": "Primavera per dare forma, e dopo ogni fioritura",
                "parassiti": "Pochi — eventualmente afidi sui germogli",
                "extra": "Foglie utilizzate fresche o essiccate in cucina. Fioritura viola-blu da maggio. Pianta longeva (oltre 10 anni con cure minime).",
            },
            "bio": {
                "prodotti": "Bio·Bloom · Alg·A·Mic (mai Bio·Grow)",
                "primavera": "Bio·Bloom ½ dose ogni 45 giorni",
                "estate": "Stop da agosto",
                "autunno": "Stop totale",
                "rinvaso": "Root·Juice diluito",
                "note": "Le aromatiche mediterranee in generale: poca acqua, poco concime, tanto sole. Forzarle è controproducente.",
            },
        },
        "fert_months": "3,4,5,6,7",
        "fert_interval": 45,
        "fert_product": "Leggero P-K, tipo piante mediterranee",
        "fert_note": "",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione leggera. Potatura di forma primaverile.",
            "4": "Stagione attiva. Fioritura viola-blu.",
            "5": "Continua per piante in vaso.",
            "6": "Continua. Raccogli le foglie regolarmente per stimolare nuova crescita.",
            "7": "Ultima concimazione. Da agosto stop.",
        },
        "root_depth_cm": 22,
        "p_coef": 0.50,
        "bb_schedules": [
            {
                "prod": "bloom", "months": "3,4,5,6,7", "interval_days": 45,
                "start_date": "2026-03-20", "dose": "½ dose",
                "note": "Mai Bio·Grow — l'azoto diluisce gli oli essenziali",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [
            {
                "prod": "zolfo", "months": "4,5", "interval_days": 30,
                "start_date": "2026-04-12", "dose": "3-5 g/L",
                "note": "Preventivo oidio — trattare al mattino presto o alla sera",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 23: Paulownia ─────────────────────────────────────────────
    {
        "name": "Paulownia",
        "latin": "Paulownia tomentosa",
        "icon": "🌳",
        "sim_group": "albero",
        "sensor_cat": "universale",
        "card_data": {
            "con": {
                "periodo": "Marzo – Luglio (solo giovani esemplari)",
                "frequenza": "Ogni 25 giorni",
                "concime": "Bilanciato NPK dose piena (per sostenere la crescita esplosiva)",
                "stop": "Da agosto — i rami devono lignificare",
                "note": "Cresce esponenzialmente nei primi anni — anche 3 metri all'anno. Concimare correttamente i giovani è cruciale.",
            },
            "sub": {
                "terreno": "Universale fertile, ben drenato",
                "ph": "6.0 – 7.0",
                "vaso": "Pianta da piena terra — il vaso solo per esemplari molto giovani",
                "rinvaso": "Trapianto in piena terra entro 1-2 anni",
                "vivo": "Compost generoso 20% al trapianto. Cornunghia 2-3× anno. Micorrize universali. Pacciamatura organica spessa.",
            },
            "esp": {
                "luce": "Pieno sole",
                "sole": "Diretto",
                "temperatura": "Rustica — sopporta -20°C",
                "umidita": "Normale",
            },
            "cur": {
                "acqua": "Generosa per giovani — la crescita esplosiva richiede molta acqua",
                "potatura": "Inverno: una sola cima dominante per albero alto, oppure capitozzatura per foglie giganti decorative",
                "parassiti": "Pochi nemici naturali",
                "extra": "Fiori viola spettacolari prima delle foglie negli adulti. Le foglie possono raggiungere il metro di diametro nei rami giovani capitozzati. Legno leggero e pregiato.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Fish·Mix · Alg·A·Mic",
                "primavera": "Bio·Grow + Fish·Mix alternati ogni 15 giorni (ritmo intenso per la crescita rapida)",
                "estate": "Continua fino a luglio",
                "autunno": "Stop assoluto",
                "rinvaso": "Root·Juice + cornunghia + micorrize",
                "note": "I giovani esemplari sono fra le piante più affamate del giardino. Concimazione abbondante e regolare per i primi 3 anni.",
            },
        },
        "fert_months": "3,4,5,6,7",
        "fert_interval": 25,
        "fert_product": "Bilanciato NPK dose piena (solo giovani)",
        "fert_note": "Solo giovani piante — crescita esplosiva",
        "monthly_states": [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        "monthly_notes": {
            "3": "Prima concimazione. Se giovane, sostieni la crescita esplosiva.",
            "4": "Crescita rapidissima. Foglie enormi in sviluppo.",
            "5": "Fioritura viola spettacolare (prima delle foglie sugli esemplari adulti).",
            "6": "Continua per giovani piante. Adulte in piena terra: nessun intervento.",
            "7": "Ultima concimazione. Da agosto stop — i rami devono lignificare.",
        },
        "root_depth_cm": 45,
        "p_coef": 0.55,
        "bb_schedules": [
            {
                "prod": "grow", "months": "3,4,5,6,7", "interval_days": 25,
                "start_date": "2026-03-15", "dose": "dose piena",
                "note": "Solo giovani piante — crescita esplosiva",
                "sort_order": 0,
            },
            {
                "prod": "fish", "months": "3,4,5", "interval_days": 30,
                "start_date": "2026-03-22", "dose": "dose piena",
                "note": "Alternato con Bio·Grow in primavera",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [],
    },

    # ─── id 24: Crassula Ovata ────────────────────────────────────────
    {
        "name": "Crassula Ovata",
        "latin": "Crassula ovata",
        "icon": "🌿",
        "sim_group": "succulenta",
        "sensor_cat": "succulente",
        "card_data": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "Ogni 30 giorni",
                "concime": "Liquido succulente, ½ dose",
                "stop": "Stop totale ottobre-marzo",
                "note": "Pianta robusta ma sensibile al sovra-concime. Mai dose piena.",
            },
            "sub": {
                "terreno": "Substrato per succulente, ben drenante",
                "ph": "6.5 – 7.5",
                "vaso": "Terracotta, drenaggio fondamentale. Profondità contenuta — radici superficiali",
                "rinvaso": "Ogni 3-4 anni",
                "vivo": "Mai humus né compost. Solo micorrize universali al rinvaso, dose minima.",
            },
            "esp": {
                "luce": "Pienissima — può stare anche al sole diretto",
                "sole": "Diretto, anche estivo (gradualmente acclimatare)",
                "temperatura": "Estate 25-35°C; inverno minimo 10°C",
                "umidita": "Bassa preferita",
            },
            "cur": {
                "acqua": "Quando il substrato è completamente asciutto, anche fino a 3 settimane in inverno",
                "potatura": "Rimuovere foglie/rami secchi. Le talee radicano facilmente",
                "parassiti": "Cocciniglia cotonosa (sotto le foglie e alla base del fusto)",
                "extra": "Detta 'Albero della Giada' o 'Pianta dei soldi'. I bordi delle foglie diventano rossi con molta luce — segno di salute. Molto longeva.",
            },
            "bio": {
                "prodotti": "Solo Alg·A·Mic — niente Bio·Grow né Bio·Bloom",
                "primavera": "Alg·A·Mic ¼ dose ogni 30 giorni",
                "estate": "Continua",
                "autunno": "Stop da ottobre",
                "rinvaso": "Root·Juice molto diluito",
                "note": "Stesso protocollo di Sanseviera e Aloe: solo Alg·A·Mic, mai concimi minerali.",
            },
        },
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 30,
        "fert_product": "Liquido succulente, ½ dose",
        "fert_note": "",
        "monthly_states": [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0],
        "monthly_notes": {
            "4": "Prima concimazione. Controlla la pianta per cocciniglia cotonosa.",
            "5": "Stagione attiva. Annaffia solo quando il substrato è completamente asciutto.",
            "6": "Piena estate — può stare all'aperto in posizione luminosa.",
            "7": "Continua normalmente.",
            "8": "Continua. Le foglie diventano rosse ai bordi con molta luce.",
            "9": "Ultima concimazione. Da ottobre stop totale.",
        },
        "root_depth_cm": 15,
        "p_coef": 0.60,
        "bb_schedules": [
            {
                "prod": "alg", "months": "4,5,6,7,8,9", "interval_days": 30,
                "start_date": "2026-04-12", "dose": "¼ dose",
                "note": "Unico prodotto adatto — mai Bio·Grow o Bio·Bloom",
                "sort_order": 0,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "5,6,7,8", "interval_days": 35,
                "start_date": "2026-05-10", "dose": "3 ml/L (dose ridotta)",
                "note": "Cocciniglia cotonosa — controllare anche sotto le foglie e alla base del fusto",
                "sort_order": 0,
            },
        ],
    },

    # ─── id 25: Carmona Bonsai ────────────────────────────────────────
    {
        "name": "Carmona Bonsai",
        "latin": "Carmona retusa",
        "icon": "🌳",
        "sim_group": "bonsai",
        "sensor_cat": "bonsai",
        "card_data": {
            "con": {
                "periodo": "Aprile – Settembre (intenso) · ottobre-marzo (ridotto se temp >18°C)",
                "frequenza": "Ogni 18 giorni in stagione, ogni 30 giorni in semiriposo",
                "concime": "Liquido bilanciato bonsai, ½ dose",
                "stop": "Mai stop totale — ridurre solo a temperature basse",
                "note": "La Carmona è un bonsai tropicale: necessita di luce, umidità e mai freddo. In inverno tenere sempre indoor.",
            },
            "sub": {
                "terreno": "Akadama 50% + pomice 30% + lapillo 20% (mix bonsai con più ritenzione)",
                "ph": "6.0 – 6.5",
                "vaso": "Bonsai poco profondo. Drenaggio fondamentale ma con un po' più di ritenzione del Glicine",
                "rinvaso": "Ogni 2 anni a fine inverno",
                "vivo": "Mai humus o compost. Solo micorrize universali al rinvaso, in dose ridotta.",
            },
            "esp": {
                "luce": "Luminosa indiretta in inverno (vicino a finestra a sud), mezz'ombra in estate",
                "sole": "Filtrato; mai pieno sole estivo (brucia le foglie piccole)",
                "temperatura": "20-28°C; mai sotto i 12°C — è tropicale",
                "umidita": "60-70% — fondamentale; usare sottovaso con argilla espansa e nebulizzare",
            },
            "cur": {
                "acqua": "Frequente — il substrato bonsai asciuga molto velocemente. Controllare ogni giorno",
                "potatura": "Primavera-estate: germogli a 2-3 foglie. Pianta che ramifica facilmente",
                "parassiti": "Cocciniglia, ragnetto rosso, mosca bianca — molto sensibile in ambienti secchi",
                "extra": "Detta 'tè di Fukien'. Fiorellini bianchi e bacche rosse decorative. Bonsai molto popolare ma esigente per l'umidità — non è un bonsai 'facile'.",
            },
            "bio": {
                "prodotti": "Bio·Grow · Alg·A·Mic",
                "primavera": "Bio·Grow ½ dose ogni 18 giorni + Alg·A·Mic ½ dose ogni 25",
                "estate": "Continua. Alg·A·Mic anche come spray fogliare per umidità",
                "autunno": "Riduci frequenza ma non fermare se temperature alte",
                "rinvaso": "Root·Juice + micorrize",
                "note": "Le radici della Carmona sono delicate: mai oltre ½ dose. L'Alg·A·Mic come spray fogliare è bonus per umidità ambientale.",
            },
        },
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 18,
        "fert_product": "Liquido bilanciato bonsai, ½ dose",
        "fert_note": "Regime ridotto in semiriposo: ogni 30 giorni in inverno se temp >18°C",
        "monthly_states": [2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2],
        "monthly_notes": {
            "1": "Se temp >18°C: concime ridotto 1× al mese. Nebulizzare le foglie quotidianamente.",
            "2": "Come gennaio. Aumentare umidità ambientale con sottovaso + argilla espansa.",
            "3": "Ripresa graduale. Aumentare frequenza se emette nuove foglie.",
            "4": "Stagione attiva. Concima ogni 2-3 settimane. Ottimo momento per potature di formazione.",
            "5": "Piena crescita. Può fiorire con piccoli fiori bianchi. Controlla umidità.",
            "6": "Estate: massima attenzione all'umidità. Mai sotto il sole diretto pomeridiano.",
            "7": "Continua. Il substrato bonsai asciuga rapidamente — controllare ogni giorno.",
            "8": "Continua normalmente. Accorcia i germogli a 2-3 foglie.",
            "9": "Ultima concimazione piena. Da ottobre ridurre.",
            "10": "Concime ridotto 1× al mese se temp >18°C. Mai portare fuori — niente freddo!",
            "11": "Dose molto ridotta. Mantenere umidità alta con i riscaldamenti.",
            "12": "Come novembre. Bacche rosse decorative se ha fiorito.",
        },
        "root_depth_cm": 15,
        "p_coef": 0.40,
        "bb_schedules": [
            {
                "prod": "grow", "months": "4,5,6,7,8,9", "interval_days": 18,
                "start_date": "2026-04-08", "dose": "½ dose",
                "note": "Non superare ½ dose — radici delicate",
                "sort_order": 0,
            },
            {
                "prod": "alg", "months": "4,5,6,7,8,9", "interval_days": 25,
                "start_date": "2026-04-15", "dose": "½ dose",
                "note": "Anche come spray fogliare diluito per umidità",
                "sort_order": 1,
            },
        ],
        "tr_schedules": [
            {
                "prod": "neem", "months": "4,5,6,7,8", "interval_days": 25,
                "start_date": "2026-04-08", "dose": "3 ml/L (dose ridotta)",
                "note": "Cocciniglia, ragnetto rosso e mosca bianca — molto sensibile in ambienti secchi",
                "sort_order": 0,
            },
            {
                "prod": "sapone", "months": "5,6,7", "interval_days": 30,
                "start_date": "2026-05-05", "dose": "8 g/L",
                "note": "Alternare con neem. Più delicato sulle foglie piccole",
                "sort_order": 1,
            },
        ],
    },
]


# ════════════════════════════════════════════════════════════════════════
# LOGICA DI INSERIMENTO
# ════════════════════════════════════════════════════════════════════════

def find_existing(conn, name):
    """Ritorna l'id della pianta con nome `name` se esiste, altrimenti None."""
    row = conn.execute(
        "SELECT id FROM custom_plants WHERE name = ?", (name,)
    ).fetchone()
    return row[0] if row else None


def delete_plant_cascade(conn, plant_id):
    """
    Cancella una pianta e i suoi schedule. Le foreign key con ON DELETE
    CASCADE delle tabelle plant_biobizz e plant_treatments si occupano
    di eliminare gli schedule figli automaticamente, ma ci tengo a
    cancellarli esplicitamente per due ragioni: (a) lo script funziona
    anche su database antichi che non hanno ancora le foreign key
    abilitate; (b) gli inserimenti di vasi nell'inventario che
    referenziano questa pianta vanno gestiti a parte (non c'è cascade
    da custom_plants verso inventory) — qui non li tocco perché lo
    script di seed non gestisce vasi.
    """
    conn.execute("DELETE FROM plant_biobizz WHERE plant_id = ?", (plant_id,))
    conn.execute("DELETE FROM plant_treatments WHERE plant_id = ?", (plant_id,))
    conn.execute("DELETE FROM custom_plants WHERE id = ?", (plant_id,))


def insert_plant(conn, plant):
    """
    Inserisce una pianta nella tabella custom_plants e gli eventuali
    schedule nelle tabelle figlie. Ritorna l'id assegnato dalla
    AUTOINCREMENT.

    L'inserimento è non transazionale dal punto di vista di questo
    helper: il chiamante è responsabile di chiamare conn.commit() (o di
    rollbackare in caso di errore). Questo permette al main loop di
    raggruppare più piante in una singola transazione se serve.
    """
    # Costruisco il dict di campi che vanno effettivamente nelle colonne
    # di custom_plants. Le liste bb_schedules e tr_schedules NON entrano
    # qui — vivono nelle tabelle figlie e le inserisco dopo aver l'id.
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

    # Schedule BioBizz
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


def seed_database(db_path, force=False, dry_run=False):
    """
    Funzione principale di seeding. Apre la connessione, abilita le
    foreign key, valida la presenza delle tabelle attese, e per ogni
    pianta in PLANTS verifica esistenza e inserisce o salta.

    Parameters
    ----------
    db_path : str
        Percorso al file SQLite del database.
    force : bool
        Se True, sovrascrive le piante esistenti cancellandole prima.
        Default False (salta gli esistenti).
    dry_run : bool
        Se True, non scrive niente nel database — solo simula e stampa
        cosa farebbe. Default False.
    """
    if not os.path.exists(db_path):
        print(f"❌ Database non trovato: {db_path}")
        print(f"   Avvia prima il server.py una volta per crearlo.")
        return False

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    # Le foreign key sono indispensabili per il cascade della cancellazione
    # quando --force è attivo. Senza, la cancellazione di una pianta
    # lascerebbe schedule orfani in plant_biobizz e plant_treatments.
    conn.execute("PRAGMA foreign_keys = ON")

    # Verifico che le tabelle attese esistano. Se manca custom_plants,
    # il database non è stato inizializzato correttamente; se mancano
    # plant_biobizz e plant_treatments, il server non è ancora stato
    # aggiornato con la nuova versione.
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    required = {"custom_plants", "plant_biobizz", "plant_treatments"}
    missing = required - tables
    if missing:
        print(f"❌ Tabelle mancanti nel database: {', '.join(sorted(missing))}")
        print(f"   Aggiorna server.py alla versione con le tabelle figlie")
        print(f"   e riavvialo una volta per applicare le migrazioni.")
        conn.close()
        return False

    # Statistiche per il riepilogo finale
    inserted = 0
    skipped = 0
    overwritten = 0
    errors = 0

    if dry_run:
        print(f"🔍 DRY RUN — non scrivo nulla nel database")
    print(f"📂 Database: {db_path}")
    print(f"🌱 Piante da elaborare: {len(PLANTS)}")
    print()

    try:
        for plant in PLANTS:
            name = plant["name"]
            existing_id = find_existing(conn, name)

            if existing_id is not None:
                if force:
                    if dry_run:
                        print(f"  [dry] sovrascriverei: {name} (id esistente {existing_id})")
                    else:
                        delete_plant_cascade(conn, existing_id)
                        new_id = insert_plant(conn, plant)
                        print(f"  🔄 sovrascritta: {name} (era {existing_id}, ora {new_id})")
                    overwritten += 1
                else:
                    print(f"  → già presente, salto: {name} (id {existing_id})")
                    skipped += 1
            else:
                if dry_run:
                    bb_count = len(plant.get("bb_schedules", []))
                    tr_count = len(plant.get("tr_schedules", []))
                    print(f"  [dry] inserirei: {name} ({bb_count} BB, {tr_count} TR)")
                else:
                    new_id = insert_plant(conn, plant)
                    bb_count = len(plant.get("bb_schedules", []))
                    tr_count = len(plant.get("tr_schedules", []))
                    print(f"  ✓ inserita: {name} (id {new_id}, {bb_count} BB, {tr_count} TR)")
                inserted += 1

        if not dry_run:
            conn.commit()

    except Exception as e:
        if not dry_run:
            conn.rollback()
        print(f"\n❌ Errore durante il seeding: {e}")
        import traceback
        traceback.print_exc()
        errors = 1

    finally:
        conn.close()

    print()
    print(f"════════════════════════════════════════")
    print(f"  Inserite:     {inserted}")
    print(f"  Saltate:      {skipped}")
    print(f"  Sovrascritte: {overwritten}")
    print(f"  Errori:       {errors}")
    print(f"════════════════════════════════════════")
    return errors == 0


def main():
    parser = argparse.ArgumentParser(
        description="Reinserisce le 26 piante native nel database de Il Mio Giardino",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db", default=None,
        help=f"percorso al database SQLite (default: {default_db_path()})"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="sovrascrive le piante esistenti (le cancella e reinserisce)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="simula l'esecuzione senza scrivere nel database"
    )
    args = parser.parse_args()

    db_path = args.db or default_db_path()
    success = seed_database(db_path, force=args.force, dry_run=args.dry_run)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
