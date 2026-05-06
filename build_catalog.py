#!/usr/bin/env python3
"""
build_catalog.py — Genera il file extended_catalog.json a partire dalle
specifiche delle 150 piante del catalogo esteso.

Lo script vive separato dal seed_extended_catalog.py finale: build_catalog.py
serve solo a costruire il file JSON, mentre seed_extended_catalog.py (il
prodotto finito) lo legge e popola il database.

L'idea è di avere template di scheda colturale per ogni gruppo simulazione
(mediterranea, aromatica, tropicale, ecc.) così le 150 piante restano
coerenti senza dover riscrivere a mano ogni singolo blocco. Il template
viene poi specializzato pianta per pianta con nome, latino, icona, e i
campi che variano davvero (root_depth_cm, p_coef, fert_months, ecc.).
"""

import json
import os

# ════════════════════════════════════════════════════════════════════════
# TEMPLATE PER GRUPPO SIMULAZIONE
# ════════════════════════════════════════════════════════════════════════
# Ogni template fornisce i campi della scheda colturale che sono comuni
# a tutto il gruppo. Per le voci specifiche (es. il rosmarino ha bisogno
# di rincalzare contro il gelo, il basilico va seminato ogni anno) si
# sovrascrive solo il campo che cambia, lasciando intatto il resto.

TEMPLATES = {
    # ─── MEDITERRANEE ─────────────────────────────────────────────────
    # Piante adattate al clima mediterraneo: estate calda secca, inverno
    # mite umido. Tipicamente xerofite o sempreverdi sclerofille.
    # Kc tipico: ini 0.40, dev 0.65, mid 0.85, end 0.50 (gestito da
    # SIM_KC_BY_GROUP nel frontend, qui lasciamo NULL).
    "mediterranea": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "1× ogni 3-4 settimane",
                "concime": "Liquido bilanciato, dose normale",
                "stop": "Stop in autunno e inverno",
                "note": "Tipologia mediterranea: poca acqua e poco concime, soffre più gli eccessi che le carenze.",
            },
            "sub": {
                "tipo": "Drenante: terriccio universale + sabbia o pomice (4:1)",
                "ph": "Neutro o leggermente alcalino (pH 6.5-7.5)",
                "drenaggio": "Argilla espansa sul fondo, almeno 3-4 cm",
                "rinvaso": "Ogni 2-3 anni, in primavera",
                "note": "Evitare ristagni: il marciume radicale è il principale pericolo.",
            },
            "esp": {
                "luce": "Pieno sole, almeno 6 ore al giorno",
                "temperatura": "Resiste bene da -5°C a +35°C",
                "umidità": "Bassa o moderata (ambiente mediterraneo tipico)",
                "vento": "Tollera bene il vento",
                "note": "Pianta da esterno tutto l'anno nelle zone temperate.",
            },
            "cur": {
                "potatura": "Leggera dopo la fioritura, per mantenere la forma",
                "controlli": "Cocciniglia e afidi in primavera",
                "pulizia": "Rimuovere foglie secche e fiori appassiti",
                "note": "Pianta robusta, richiede poche cure.",
            },
            "bio": {
                "regime": "Top-Max o equivalente in fioritura",
                "frequenza": "1× a settimana in piena vegetazione",
                "note": "Riduci o sospendi durante riposo invernale.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 21,
        "fert_product": "Liquido bilanciato (NPK 10-10-10) o specifico mediterranee",
        "root_depth_cm": 30,
        "p_coef": 0.50,
    },

    # ─── AROMATICHE ───────────────────────────────────────────────────
    # Erbe aromatiche e officinali. Spesso mediterranee per origine ma
    # con esigenze leggermente diverse (più acqua del rosmarino tipo,
    # raccolto frequente delle foglie).
    "aromatica": {
        "card_data_template": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "1× ogni 2 settimane",
                "concime": "Liquido per aromatiche o organico, dose ridotta",
                "stop": "Stop in autunno-inverno per le perenni",
                "note": "Concime moderato: troppi nutrienti riducono l'aroma delle foglie.",
            },
            "sub": {
                "tipo": "Universale leggero, ben drenato",
                "ph": "Neutro (pH 6.0-7.0)",
                "drenaggio": "Argilla espansa o ghiaia sul fondo",
                "rinvaso": "Ogni anno per le annuali, ogni 2 anni per le perenni",
                "note": "Vasi singoli per evitare che una specie soffochi le altre.",
            },
            "esp": {
                "luce": "Pieno sole o sole filtrato (almeno 4-6 ore)",
                "temperatura": "Variabile per specie; protezione invernale per le perenni delicate",
                "umidità": "Moderata; alcune (basilico) preferiscono umidità maggiore",
                "vento": "Tollerano vento moderato",
                "note": "Posizione luminosa ma non torrida nelle ore centrali estive.",
            },
            "cur": {
                "potatura": "Cimature regolari per favorire la cespugliatura",
                "controlli": "Afidi (basilico), oidio (salvia), ragnetto rosso (timo)",
                "pulizia": "Raccolto frequente delle foglie (è anche potatura)",
                "note": "Le aromatiche traggono vantaggio da raccolti regolari.",
            },
            "bio": {
                "regime": "Bio-Grow leggero in vegetazione",
                "frequenza": "Ogni 2 settimane se in piena crescita",
                "note": "Concimazione minima per non alterare il profilo aromatico.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 14,
        "fert_product": "Liquido per aromatiche o organico",
        "root_depth_cm": 20,
        "p_coef": 0.50,
    },

    # ─── SUCCULENTE ───────────────────────────────────────────────────
    # Crassulacee, agavacee, asfodelacee: piante che immagazzinano acqua
    # nei tessuti. CAM o quasi-CAM, traspirazione molto ridotta.
    "succulenta": {
        "card_data_template": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "1× ogni 4-6 settimane",
                "concime": "Liquido per succulente, ½ dose",
                "stop": "Stop completo in autunno e inverno",
                "note": "Concima MAI su substrato secco e MAI in inverno.",
            },
            "sub": {
                "tipo": "Sabbioso-drenante: terriccio per cactacee + pomice (1:1)",
                "ph": "Neutro o leggermente acido (pH 6.0-7.0)",
                "drenaggio": "Strato spesso di argilla espansa (almeno 4 cm)",
                "rinvaso": "Ogni 2-3 anni, primavera, vaso solo leggermente più grande",
                "note": "Substrato povero e drenante: il marciume radicale è la prima causa di morte.",
            },
            "esp": {
                "luce": "Luce intensa indiretta o sole pieno (varia per specie)",
                "temperatura": "10-30°C; alcune temono il gelo",
                "umidità": "Bassa, ambiente secco",
                "vento": "Indifferente al vento",
                "note": "Da maggio a settembre fuori al sole, in inverno luogo luminoso e fresco.",
            },
            "cur": {
                "potatura": "Solo per rimuovere foglie morte o steli appassiti",
                "controlli": "Cocciniglia cotonosa nelle pieghe delle foglie",
                "pulizia": "Spolverare delicatamente le foglie con un pennello",
                "note": "Resistenza naturale ai parassiti se ambiente sano.",
            },
            "bio": {
                "regime": "Top-Max in piccola dose durante l'attiva crescita",
                "frequenza": "1× al mese in vegetazione",
                "note": "Le succulente non amano fertirrigazioni frequenti.",
            },
        },
        "monthly_states": [0,0,2,1,1,1,1,1,1,2,0,0],
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 35,
        "fert_product": "Liquido per cactus e succulente, ½ dose",
        "root_depth_cm": 15,
        "p_coef": 0.50,
    },

    # ─── ORCHIDEE ─────────────────────────────────────────────────────
    # Phalaenopsis e altre orchidee epifite: substrato di corteccia,
    # CAM facoltativo, esigenze idriche e nutrizionali peculiari.
    "orchidea": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Ottobre",
                "frequenza": "1× ogni 2 settimane in vegetazione",
                "concime": "Specifico per orchidee, ¼-½ dose",
                "stop": "Stop o ridotto in inverno",
                "note": "Le orchidee soffrono molto la salinità: alterna concimazione e lavaggio con acqua pura.",
            },
            "sub": {
                "tipo": "Corteccia di pino sterilizzata, granulometria media",
                "ph": "Acido (pH 5.5-6.5)",
                "drenaggio": "La corteccia è naturalmente drenante; vaso trasparente",
                "rinvaso": "Ogni 2-3 anni, dopo la fioritura",
                "note": "Mai terriccio normale: le radici devono respirare.",
            },
            "esp": {
                "luce": "Luce molto intensa indiretta, mai sole diretto",
                "temperatura": "18-26°C, salto notturno benvenuto per la fioritura",
                "umidità": "Alta (50-70%), nebulizzare le radici aeree",
                "vento": "Aria circolante ma non correnti dirette",
                "note": "Posizione vicino a finestra luminosa, mai a sud diretto.",
            },
            "cur": {
                "potatura": "Tagliare lo stelo del fiore dopo l'appassimento",
                "controlli": "Cocciniglia cotonosa, ragnetto rosso se aria troppo secca",
                "pulizia": "Spolverare le foglie, controllare le radici trasparenti",
                "note": "Foglie carnose verde scuro = pianta sana; gialle = troppo sole o troppa acqua.",
            },
            "bio": {
                "regime": "Specifico orchidee, mai Top-Max o concentrati generali",
                "frequenza": "Ogni 2 settimane in vegetazione",
                "note": "Lava il substrato ogni 4-6 settimane per evitare accumulo di sali.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9,10",
        "fert_interval": 14,
        "fert_product": "Specifico per orchidee, ¼-½ dose",
        "root_depth_cm": 15,
        "p_coef": 0.40,
    },

    # ─── TROPICALI APPARTAMENTO ───────────────────────────────────────
    # Aroidi, Moraceae, Marantaceae, Bromeliaceae: piante tropicali da
    # interno con esigenze di umidità elevata e luce indiretta.
    "tropicale": {
        "card_data_template": {
            "con": {
                "periodo": "Tutto l'anno (in interno con riscaldamento)",
                "frequenza": "1× ogni 2 settimane in primavera-estate, mensile in inverno",
                "concime": "Liquido per piante verdi, dose normale primavera-estate, ½ dose inverno",
                "stop": "Mai stop completo, solo riduzione",
                "note": "Le tropicali in casa non hanno vero riposo invernale, solo rallentamento.",
            },
            "sub": {
                "tipo": "Universale per piante verdi, leggero e ricco",
                "ph": "Leggermente acido (pH 5.5-6.5)",
                "drenaggio": "Argilla espansa sul fondo + perlite nel substrato",
                "rinvaso": "Ogni 2 anni, in primavera",
                "note": "Substrato sempre umido ma mai inzuppato.",
            },
            "esp": {
                "luce": "Luce intensa indiretta; mai sole diretto",
                "temperatura": "18-26°C tutto l'anno; teme correnti d'aria fredda",
                "umidità": "Alta (50-70%); nebulizzare le foglie",
                "vento": "No correnti dirette",
                "note": "Lontano da termosifoni e correnti d'aria.",
            },
            "cur": {
                "potatura": "Leggera, per dare forma o rimuovere foglie ingiallite",
                "controlli": "Ragnetto rosso, cocciniglia, mosca bianca",
                "pulizia": "Spolverare le foglie ogni 2 settimane con panno umido",
                "note": "Foglie pulite = fotosintesi efficiente.",
            },
            "bio": {
                "regime": "Bio-Grow + Bio-Bloom alternati nelle dosi raccomandate",
                "frequenza": "Ogni 2 settimane in piena attività vegetativa",
                "note": "Riduci la dose in inverno quando la luce è scarsa.",
            },
        },
        "monthly_states": [2,2,1,1,1,1,1,1,1,1,2,2],
        "fert_months": "3,4,5,6,7,8,9,10",
        "fert_interval": 14,
        "fert_product": "Liquido per piante verdi NPK 7-3-6 o simile",
        "root_depth_cm": 25,
        "p_coef": 0.50,
    },

    # ─── AGRUMI ───────────────────────────────────────────────────────
    # Citrus in vaso: limone, arancio, mandarino, kumquat. Esigenze
    # idriche e nutrizionali importanti, pH leggermente acido.
    "agrume": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Ottobre",
                "frequenza": "1× ogni 15-20 giorni",
                "concime": "Specifico per agrumi (alto in azoto e ferro)",
                "stop": "Stop da novembre a febbraio",
                "note": "Carenza di ferro causa ingiallimento (clorosi); usa chelato di ferro 1-2× l'anno.",
            },
            "sub": {
                "tipo": "Specifico per agrumi o universale + sabbia (3:1)",
                "ph": "Leggermente acido (pH 6.0-6.8)",
                "drenaggio": "Argilla espansa abbondante sul fondo",
                "rinvaso": "Ogni 2-3 anni, in primavera",
                "note": "Vaso ampio, gli agrumi hanno radici espanse.",
            },
            "esp": {
                "luce": "Pieno sole, almeno 6-8 ore",
                "temperatura": "Resistono fino a -5°C ma meglio ricoverarli sotto +5°C",
                "umidità": "Moderata; nebulizzare in estate calda",
                "vento": "Riparare dai venti freddi invernali",
                "note": "In zone fredde: ricovero invernale in serra fredda o veranda luminosa.",
            },
            "cur": {
                "potatura": "Marzo: sfoltimento e taglio dei polloni",
                "controlli": "Cocciniglia, mosca bianca, ragnetto rosso, minatrice serpentina",
                "pulizia": "Rimuovere frutti caduti, foglie gialle",
                "note": "Trattamento preventivo con olio bianco a fine inverno.",
            },
            "bio": {
                "regime": "Top-Max + Bio-Bloom durante fioritura e fruttificazione",
                "frequenza": "Ogni 2 settimane da marzo a ottobre",
                "note": "Importante: gli agrumi sono molto sensibili a deficit di micronutrienti.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9,10",
        "fert_interval": 18,
        "fert_product": "Specifico agrumi (NPK 10-5-15 + microelementi)",
        "root_depth_cm": 35,
        "p_coef": 0.50,
    },

    # ─── BONSAI ───────────────────────────────────────────────────────
    # Bonsai generico (specie-dipendente, ma struttura cura simile).
    # Per i bonsai di specie che esistono anche full-size nel catalogo,
    # creiamo voci specifiche tipo "Bonsai di Acero giapponese" che
    # ereditano i kc dalla specie madre ma con intervalli più corti.
    "bonsai": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Ottobre",
                "frequenza": "1× ogni 2 settimane",
                "concime": "Specifico per bonsai (solido a lenta cessione + liquido)",
                "stop": "Stop o molto ridotto in inverno",
                "note": "Vaso piccolo = poche riserve nutrizionali nel substrato. Concimazione regolare critica.",
            },
            "sub": {
                "tipo": "Akadama + pomice + lapillo (50:25:25) o specifico bonsai",
                "ph": "Neutro (pH 6.0-7.0)",
                "drenaggio": "Eccellente: drenaggio è la regola principale per i bonsai",
                "rinvaso": "Bonsai giovani ogni 2-3 anni, maturi ogni 4-5 anni; in primavera",
                "note": "Durante il rinvaso si tagliano anche le radici per mantenere la dimensione.",
            },
            "esp": {
                "luce": "Variabile per specie (vedi nota); generalmente luminosa",
                "temperatura": "Specie-dipendente: tropicali in casa, temperate fuori",
                "umidità": "Media; nebulizzare quando aria secca",
                "vento": "Riparare dai venti forti che asciugano il vaso piccolo",
                "note": "Il vaso piccolo si asciuga molto in fretta: monitorare quotidianamente in estate.",
            },
            "cur": {
                "potatura": "Pinzatura regolare durante la stagione vegetativa per ramificazione",
                "controlli": "Cocciniglia, afidi, ragnetto rosso (specie dipendente)",
                "pulizia": "Mantenere la superficie del substrato pulita",
                "note": "La filatura è specifica del bonsai e richiede tecnica dedicata.",
            },
            "bio": {
                "regime": "Bio-Grow in vegetazione + organico solido a lenta cessione",
                "frequenza": "Ogni 2 settimane in piena attività",
                "note": "I bonsai temono accumulo salino: lavare il substrato ogni 4-6 settimane.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9,10",
        "fert_interval": 14,
        "fert_product": "Specifico bonsai (organico a lenta cessione + liquido)",
        "root_depth_cm": 12,
        "p_coef": 0.40,
    },

    # ─── ARBUSTO ──────────────────────────────────────────────────────
    # Arbusti ornamentali: ortensie, azalee, gardenie, ibiscus, eccetera.
    # Diversificati: alcuni acidofili, alcuni mediterranei, ecc.
    "arbusto": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Settembre",
                "frequenza": "1× ogni 3 settimane",
                "concime": "Liquido bilanciato o specifico (es. acidofile per azalee)",
                "stop": "Stop in autunno-inverno",
                "note": "Specie-dipendente: vedi note per acidofile (ortensie, azalee, gardenie).",
            },
            "sub": {
                "tipo": "Universale leggero o specifico (acidofile dove richiesto)",
                "ph": "Specie-dipendente: neutro per la maggior parte, acido per acidofile",
                "drenaggio": "Argilla espansa sul fondo",
                "rinvaso": "Ogni 2-3 anni, in primavera",
                "note": "Vaso ampio per arbusti di taglia media (ortensie, ibiscus).",
            },
            "esp": {
                "luce": "Specie-dipendente: pieno sole o mezz'ombra",
                "temperatura": "Resistenza variabile al gelo; vedi note per specie",
                "umidità": "Media",
                "vento": "Tollerano vento moderato",
                "note": "In zone fredde, alcuni arbusti delicati richiedono ricovero invernale.",
            },
            "cur": {
                "potatura": "Dopo la fioritura per dare forma e stimolare nuovi getti",
                "controlli": "Afidi, oidio, cocciniglia (variabile per specie)",
                "pulizia": "Rimozione foglie e fiori secchi",
                "note": "Arbusti longevi se ben curati.",
            },
            "bio": {
                "regime": "Bio-Grow + Bio-Bloom in fioritura",
                "frequenza": "Ogni 2 settimane in vegetazione",
                "note": "Concimazione regolare per fioriture abbondanti.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 21,
        "fert_product": "Liquido bilanciato o specifico acidofile",
        "root_depth_cm": 30,
        "p_coef": 0.50,
    },

    # ─── ALBERO LATIFOGLIA ────────────────────────────────────────────
    # Latifoglie nobili: querce, aceri, faggi, tigli, frassini, olmi,
    # ippocastani, betulle, pioppi, liriodendri, platani.
    # Ovviamente in vaso solo da giovani; full-size in piena terra.
    "albero": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Settembre (giovani esemplari in vaso)",
                "frequenza": "1× ogni 4-6 settimane",
                "concime": "Solido a lenta cessione + liquido bilanciato",
                "stop": "Stop in autunno-inverno",
                "note": "Da adulti in piena terra non richiedono concimazione regolare.",
            },
            "sub": {
                "tipo": "Universale di buona qualità, profondo",
                "ph": "Specie-dipendente, generalmente neutro o leggermente acido",
                "drenaggio": "Importante: profondità del vaso almeno 50 cm per giovani esemplari",
                "rinvaso": "Ogni 2-3 anni; valutare passaggio in piena terra",
                "note": "Gli alberi crescono male in vasi troppo piccoli per le radici a fittone.",
            },
            "esp": {
                "luce": "Pieno sole o mezz'ombra (specie-dipendente)",
                "temperatura": "Generalmente molto rustici, resistono al gelo",
                "umidità": "Media",
                "vento": "Resistenti al vento da adulti, giovani da proteggere",
                "note": "Giovani in vaso: protezione invernale del vaso (radici esposte al gelo).",
            },
            "cur": {
                "potatura": "Specie-dipendente; alcuni richiedono potatura formativa",
                "controlli": "Variabili: processionaria (querce), cocciniglia, afidi",
                "pulizia": "Rimozione rami secchi",
                "note": "In zone urbane controllare attacchi di insetti tipici della specie.",
            },
            "bio": {
                "regime": "Organico solido a lenta cessione 1-2× l'anno",
                "frequenza": "Inizio primavera + estate",
                "note": "Concimazione modesta: gli alberi attingono nutrienti dal terreno profondo.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9",
        "fert_interval": 35,
        "fert_product": "Organico solido a lenta cessione",
        "root_depth_cm": 60,
        "p_coef": 0.55,
    },

    # ─── CONIFERA ─────────────────────────────────────────────────────
    # Pini, abeti, cedri, ginepri, tassi, cipressi, larici. Resinose
    # con foglie aghiformi, sempreverdi (escluso il larice).
    "conifera": {
        "card_data_template": {
            "con": {
                "periodo": "Aprile – Settembre",
                "frequenza": "1× ogni 6 settimane",
                "concime": "Specifico per conifere o organico bilanciato",
                "stop": "Stop in autunno-inverno",
                "note": "Le conifere richiedono pochi nutrienti rispetto alle latifoglie.",
            },
            "sub": {
                "tipo": "Drenante, leggermente acido; akadama per i bonsai di conifere",
                "ph": "Acido o leggermente acido (pH 5.5-6.5)",
                "drenaggio": "Eccellente; le radici delle conifere temono il ristagno",
                "rinvaso": "Ogni 3-4 anni; per i bonsai ogni 4-5 anni",
                "note": "Le conifere sono lente a riprendersi dal rinvaso: rinvasare in fine inverno.",
            },
            "esp": {
                "luce": "Pieno sole",
                "temperatura": "Molto rustiche, resistono al gelo intenso",
                "umidità": "Bassa-media",
                "vento": "Tollerano bene",
                "note": "Pieno sole essenziale per la salute degli aghi.",
            },
            "cur": {
                "potatura": "Pinzatura dei nuovi germogli (candele) per i pini",
                "controlli": "Processionaria del pino, cocciniglia, oziorrinco",
                "pulizia": "Rimozione aghi vecchi caduti, controllo cortecce",
                "note": "La processionaria del pino è urticante e tossica: trattare preventivamente.",
            },
            "bio": {
                "regime": "Organico solido a lenta cessione 1-2× l'anno",
                "frequenza": "Inizio primavera + estate",
                "note": "Concimazione minimale, le conifere si nutrono lentamente.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "4,5,6,7,8,9",
        "fert_interval": 42,
        "fert_product": "Organico per conifere o granulare bilanciato",
        "root_depth_cm": 40,
        "p_coef": 0.55,
    },

    # ─── FIORITA ──────────────────────────────────────────────────────
    # Annuali e perenni da fiore per balcone (gerani, petunie, surfinie,
    # bouganville, dipladenie, ortensie, ecc.). Esigenze elevate di
    # nutrienti e acqua per sostenere fioriture continue.
    "fiorita": {
        "card_data_template": {
            "con": {
                "periodo": "Marzo – Ottobre",
                "frequenza": "1× a settimana in piena fioritura",
                "concime": "Specifico per piante fiorite (alto in fosforo e potassio)",
                "stop": "Stop in autunno-inverno",
                "note": "Concimazione regolare è la chiave per fioriture abbondanti.",
            },
            "sub": {
                "tipo": "Universale per piante fiorite, ricco di sostanza organica",
                "ph": "Neutro (pH 6.0-7.0)",
                "drenaggio": "Argilla espansa sul fondo",
                "rinvaso": "Annuale per le annuali, ogni 1-2 anni per le perenni",
                "note": "Vasi capienti per le radici espanse di petunie e gerani.",
            },
            "esp": {
                "luce": "Pieno sole o sole filtrato (specie-dipendente)",
                "temperatura": "Molte temono il gelo; ricovero invernale",
                "umidità": "Media; nebulizzare in estate calda",
                "vento": "Riparare dai venti forti che danneggiano fiori delicati",
                "note": "Posizione molto luminosa per fioriture intense.",
            },
            "cur": {
                "potatura": "Cimature regolari per stimolare la fioritura continua",
                "controlli": "Afidi (gerani), oidio (begonie), botrite (petunie)",
                "pulizia": "Rimozione costante di fiori appassiti per stimolare nuova fioritura",
                "note": "La rimozione dei fiori secchi è essenziale.",
            },
            "bio": {
                "regime": "Bio-Bloom + Top-Max in piena fioritura",
                "frequenza": "Ogni settimana in fioritura",
                "note": "Le fiorite sono grandi consumatrici di nutrienti.",
            },
        },
        "monthly_states": [0,0,1,1,1,1,1,1,1,1,0,0],
        "fert_months": "3,4,5,6,7,8,9,10",
        "fert_interval": 7,
        "fert_product": "Specifico piante fiorite (NPK 5-15-30 o simile)",
        "root_depth_cm": 25,
        "p_coef": 0.45,
    },
}

# Default sensor_cat per gruppo
SENSOR_CAT_BY_GROUP = {
    "mediterranea": "mediterranee",
    "aromatica": "aromatiche",
    "succulenta": "succulente",
    "orchidea": "orchidee",
    "tropicale": "tropicali",
    "agrume": "agrumi",
    "bonsai": "bonsai",
    "arbusto": "universale",
    "albero": "universale",
    "conifera": "universale",
    "fiorita": "universale",
}


def make_plant(name, latin, icon, group, **overrides):
    """Costruisce un dict pianta partendo dal template del gruppo,
    permettendo override su qualsiasi campo (anche su sotto-campi
    della card_data tramite la chiave 'card_data_overrides').

    Parametri:
        name: Nome italiano comune (es. "Rosmarino")
        latin: Nome scientifico (es. "Rosmarinus officinalis")
        icon: Emoji singolo (es. "🌿")
        group: Uno dei gruppi in TEMPLATES
        **overrides: Campi da sovrascrivere; usa card_data_overrides
                     per modificare specifici sotto-campi della scheda

    Restituisce:
        dict pianta nel formato compatibile con seed_native_plants.py
    """
    if group not in TEMPLATES:
        raise ValueError(f"Gruppo {group} non riconosciuto. Disponibili: {list(TEMPLATES.keys())}")

    tpl = TEMPLATES[group]

    # Deep copy della card_data (no shared state tra piante)
    card_data = json.loads(json.dumps(tpl["card_data_template"]))

    # Applica eventuali override su singoli sotto-campi
    cd_over = overrides.pop("card_data_overrides", {})
    for section, fields in cd_over.items():
        if section in card_data:
            card_data[section].update(fields)

    plant = {
        "name": name,
        "latin": latin,
        "icon": icon,
        "sim_group": group,
        "sensor_cat": SENSOR_CAT_BY_GROUP.get(group, "universale"),
        "card_data": card_data,
        "fert_months": tpl["fert_months"],
        "fert_interval": tpl["fert_interval"],
        "fert_product": tpl["fert_product"],
        "fert_note": "",
        "monthly_states": list(tpl["monthly_states"]),
        "monthly_notes": {},
        "root_depth_cm": tpl["root_depth_cm"],
        "p_coef": tpl["p_coef"],
        "bb_schedules": [],
        "tr_schedules": [],
    }

    # Override generici (root_depth_cm, p_coef, fert_*, monthly_*, ecc.)
    plant.update(overrides)
    return plant


# ════════════════════════════════════════════════════════════════════════
# I DATI: 150 PIANTE DEL CATALOGO ESTESO
# ════════════════════════════════════════════════════════════════════════
# Ordinate per categoria. Ogni voce è una sola riga di codice perché
# l'80% del contenuto è ereditato dal template del gruppo.

PLANTS = []

# ─── AROMATICHE E OFFICINALI (15) ────────────────────────────────────
PLANTS += [
    make_plant("Basilico", "Ocimum basilicum", "🌿", "aromatica",
               root_depth_cm=20,
               card_data_overrides={"con": {"note": "Basilico annuale: semina ogni primavera. Cimare i fiori per prolungare la produzione di foglie."}}),
    make_plant("Rosmarino", "Rosmarinus officinalis", "🌿", "aromatica",
               root_depth_cm=30, p_coef=0.55,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Sempreverde robusto, resiste al gelo. In vaso protezione invernale del fittone."}}),
    make_plant("Salvia", "Salvia officinalis", "🌿", "aromatica",
               root_depth_cm=25,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Timo", "Thymus vulgaris", "🌿", "aromatica",
               root_depth_cm=15,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Origano", "Origanum vulgare", "🌿", "aromatica",
               root_depth_cm=20,
               monthly_states=[0,0,1,1,1,1,1,1,1,1,0,0]),
    make_plant("Maggiorana", "Origanum majorana", "🌿", "aromatica", root_depth_cm=15),
    make_plant("Prezzemolo", "Petroselinum crispum", "🌿", "aromatica",
               root_depth_cm=20,
               card_data_overrides={"con": {"note": "Biennale: nel secondo anno fiorisce e poi muore. Risemina ogni anno."}}),
    make_plant("Erba cipollina", "Allium schoenoprasum", "🌿", "aromatica", root_depth_cm=15),
    make_plant("Menta", "Mentha spicata", "🌿", "aromatica",
               root_depth_cm=20,
               card_data_overrides={"sub": {"note": "Pianta invasiva: coltivare sempre in vaso isolato. Le rizome occupano tutto lo spazio disponibile."}}),
    make_plant("Melissa", "Melissa officinalis", "🌿", "aromatica", root_depth_cm=20),
    make_plant("Lavanda", "Lavandula angustifolia", "💜", "aromatica",
               root_depth_cm=30, p_coef=0.55,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Dragoncello", "Artemisia dracunculus", "🌿", "aromatica", root_depth_cm=20),
    make_plant("Alloro", "Laurus nobilis", "🌿", "mediterranea",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Finocchio selvatico", "Foeniculum vulgare", "🌿", "aromatica", root_depth_cm=25),
    make_plant("Coriandolo", "Coriandrum sativum", "🌿", "aromatica", root_depth_cm=15),
]

# ─── MEDITERRANEE (10) ────────────────────────────────────────────────
PLANTS += [
    make_plant("Olivo", "Olea europaea", "🫒", "mediterranea",
               root_depth_cm=50, p_coef=0.55,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Gelsomino", "Jasminum officinale", "🤍", "mediterranea", root_depth_cm=30),
    make_plant("Oleandro", "Nerium oleander", "🌺", "mediterranea",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Mirto", "Myrtus communis", "🌿", "mediterranea",
               root_depth_cm=30,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Plumbago", "Plumbago auriculata", "💙", "mediterranea", root_depth_cm=30),
    make_plant("Bouganville", "Bougainvillea spectabilis", "🌸", "mediterranea",
               root_depth_cm=30, p_coef=0.55),
    make_plant("Pittosporo", "Pittosporum tobira", "🌿", "mediterranea",
               root_depth_cm=35,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Cisto", "Cistus incanus", "🌸", "mediterranea", root_depth_cm=25),
    make_plant("Corbezzolo", "Arbutus unedo", "🍒", "mediterranea",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Lentisco", "Pistacia lentiscus", "🌿", "mediterranea",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
]

# ─── SUCCULENTE (10) ──────────────────────────────────────────────────
PLANTS += [
    make_plant("Aloe vera", "Aloe barbadensis", "🌵", "succulenta", root_depth_cm=20),
    make_plant("Sansevieria", "Dracaena trifasciata", "🌿", "succulenta", root_depth_cm=20),
    make_plant("Crassula (Albero di giada)", "Crassula ovata", "🌳", "succulenta", root_depth_cm=15),
    make_plant("Echeveria", "Echeveria elegans", "🌸", "succulenta", root_depth_cm=10),
    make_plant("Sedum", "Sedum morganianum", "🌿", "succulenta", root_depth_cm=12),
    make_plant("Kalanchoe", "Kalanchoe blossfeldiana", "🌺", "succulenta", root_depth_cm=12),
    make_plant("Haworthia", "Haworthia fasciata", "🌵", "succulenta", root_depth_cm=10),
    make_plant("Agave nana", "Agave parviflora", "🌵", "succulenta", root_depth_cm=20),
    make_plant("Euphorbia", "Euphorbia trigona", "🌵", "succulenta", root_depth_cm=20),
    make_plant("Lithops (Pietra vivente)", "Lithops spp.", "🪨", "succulenta", root_depth_cm=8),
]

# ─── TROPICALI APPARTAMENTO (15) ──────────────────────────────────────
PLANTS += [
    make_plant("Ficus elastica", "Ficus elastica", "🌳", "tropicale", root_depth_cm=30),
    make_plant("Ficus benjamina", "Ficus benjamina", "🌳", "tropicale", root_depth_cm=30),
    make_plant("Ficus lyrata", "Ficus lyrata", "🌳", "tropicale", root_depth_cm=35),
    make_plant("Monstera deliciosa", "Monstera deliciosa", "🍃", "tropicale", root_depth_cm=30),
    make_plant("Pothos", "Epipremnum aureum", "🌿", "tropicale", root_depth_cm=20),
    make_plant("Spatifillo", "Spathiphyllum wallisii", "🤍", "tropicale", root_depth_cm=25),
    make_plant("Anthurium", "Anthurium andraeanum", "❤️", "tropicale", root_depth_cm=20),
    make_plant("Calathea", "Calathea ornata", "🌿", "tropicale", root_depth_cm=20),
    make_plant("Alocasia", "Alocasia amazonica", "🍃", "tropicale", root_depth_cm=25),
    make_plant("Dracena", "Dracaena marginata", "🌴", "tropicale", root_depth_cm=30),
    make_plant("Kentia", "Howea forsteriana", "🌴", "tropicale", root_depth_cm=40),
    make_plant("Areca", "Dypsis lutescens", "🌴", "tropicale", root_depth_cm=35),
    make_plant("Zamioculcas", "Zamioculcas zamiifolia", "🌿", "tropicale", root_depth_cm=20),
    make_plant("Philodendron", "Philodendron hederaceum", "🌿", "tropicale", root_depth_cm=20),
    make_plant("Pilea", "Pilea peperomioides", "💰", "tropicale", root_depth_cm=15),
]

# ─── ORCHIDEE (4) ──────────────────────────────────────────────────────
PLANTS += [
    make_plant("Phalaenopsis", "Phalaenopsis spp.", "🌸", "orchidea", root_depth_cm=15),
    make_plant("Dendrobium", "Dendrobium nobile", "💐", "orchidea", root_depth_cm=15),
    make_plant("Cymbidium", "Cymbidium hybrid", "🌸", "orchidea", root_depth_cm=18),
    make_plant("Cattleya", "Cattleya labiata", "💜", "orchidea", root_depth_cm=15),
]

# ─── BONSAI INTERNO TROPICALI (8) ─────────────────────────────────────
PLANTS += [
    make_plant("Bonsai Ficus retusa", "Ficus retusa", "🌳", "bonsai", root_depth_cm=10,
               card_data_overrides={"esp": {"note": "Bonsai da interno: posizione luminosa, no sole diretto. Min 16°C."}}),
    make_plant("Bonsai Ficus ginseng", "Ficus microcarpa", "🌳", "bonsai", root_depth_cm=10,
               card_data_overrides={"esp": {"note": "Bonsai da interno: simile a Ficus retusa. Cresce rapidamente."}}),
    make_plant("Bonsai Carmona", "Ehretia microphylla", "🌳", "bonsai", root_depth_cm=10,
               card_data_overrides={"esp": {"note": "Bonsai da interno delicato: temperatura stabile, alta umidità."}}),
    make_plant("Bonsai Serissa", "Serissa foetida", "🌸", "bonsai", root_depth_cm=10),
    make_plant("Bonsai Ligustro cinese", "Ligustrum sinense", "🌳", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Podocarpus", "Podocarpus macrophyllus", "🌲", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Schefflera", "Schefflera arboricola", "🌿", "bonsai", root_depth_cm=10),
    make_plant("Bonsai Sageretia", "Sageretia theezans", "🌳", "bonsai", root_depth_cm=10),
]

# ─── BONSAI ESTERNO (12) ──────────────────────────────────────────────
PLANTS += [
    make_plant("Bonsai Acero giapponese", "Acer palmatum", "🍁", "bonsai", root_depth_cm=12,
               card_data_overrides={"esp": {"note": "Bonsai da esterno: mezz'ombra, riparare dal sole estivo. Resiste al gelo."}}),
    make_plant("Bonsai Acero tridente", "Acer buergerianum", "🍁", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Ginepro", "Juniperus chinensis", "🌲", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Pino nero", "Pinus thunbergii", "🌲", "bonsai", root_depth_cm=15),
    make_plant("Bonsai Pino silvestre", "Pinus sylvestris", "🌲", "bonsai", root_depth_cm=15),
    make_plant("Bonsai Olivo", "Olea europaea", "🫒", "bonsai", root_depth_cm=15),
    make_plant("Bonsai Melograno", "Punica granatum", "🍎", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Biancospino", "Crataegus monogyna", "🌳", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Faggio", "Fagus sylvatica", "🍂", "bonsai", root_depth_cm=15),
    make_plant("Bonsai Olmo cinese", "Ulmus parvifolia", "🌳", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Cotoneaster", "Cotoneaster horizontalis", "🌳", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Ginkgo", "Ginkgo biloba", "🍂", "bonsai", root_depth_cm=15),
]

# ─── ORTICOLE DA VASO (10) ────────────────────────────────────────────
PLANTS += [
    make_plant("Pomodoro nano", "Solanum lycopersicum", "🍅", "fiorita",
               root_depth_cm=30, p_coef=0.40,
               fert_interval=10, fert_months="4,5,6,7,8,9",
               card_data_overrides={"con": {"note": "Pomodori: kc molto variabile per fase (vegetativa 0.6, fioritura 1.0, fruttificazione 1.5). Esigenze idriche elevate."}}),
    make_plant("Peperoncino", "Capsicum annuum", "🌶️", "fiorita",
               root_depth_cm=25, fert_interval=10),
    make_plant("Peperone", "Capsicum annuum (grossum)", "🫑", "fiorita",
               root_depth_cm=30, fert_interval=10),
    make_plant("Melanzana", "Solanum melongena", "🍆", "fiorita",
               root_depth_cm=30, fert_interval=10),
    make_plant("Fragola", "Fragaria × ananassa", "🍓", "fiorita",
               root_depth_cm=20, fert_interval=14),
    make_plant("Lattuga da taglio", "Lactuca sativa", "🥬", "aromatica",
               root_depth_cm=15, fert_interval=14,
               monthly_states=[0,0,1,1,1,1,1,1,1,1,0,0]),
    make_plant("Ravanello", "Raphanus sativus", "🥕", "aromatica",
               root_depth_cm=15, fert_interval=14),
    make_plant("Bietola da costa", "Beta vulgaris", "🥬", "aromatica",
               root_depth_cm=20, fert_interval=14),
    make_plant("Zucchina", "Cucurbita pepo", "🥒", "fiorita",
               root_depth_cm=30, fert_interval=10),
    make_plant("Cetriolo", "Cucumis sativus", "🥒", "fiorita",
               root_depth_cm=30, fert_interval=10),
]

# ─── AGRUMI NANI (5) ──────────────────────────────────────────────────
PLANTS += [
    make_plant("Limone 'Quattro stagioni'", "Citrus × limon", "🍋", "agrume", root_depth_cm=35),
    make_plant("Arancio amaro", "Citrus × aurantium", "🍊", "agrume", root_depth_cm=35),
    make_plant("Mandarino", "Citrus reticulata", "🍊", "agrume", root_depth_cm=35),
    make_plant("Kumquat", "Citrus japonica", "🍊", "agrume", root_depth_cm=30),
    make_plant("Calamondino", "Citrus × microcarpa", "🍊", "agrume", root_depth_cm=30),
]

# ─── FIORITE DA BALCONE (12) ──────────────────────────────────────────
PLANTS += [
    make_plant("Geranio (Pelargonio)", "Pelargonium × hortorum", "🌸", "fiorita", root_depth_cm=20),
    make_plant("Geranio edera", "Pelargonium peltatum", "🌸", "fiorita", root_depth_cm=20),
    make_plant("Petunia", "Petunia × hybrida", "💜", "fiorita", root_depth_cm=20),
    make_plant("Surfinia", "Petunia × atkinsiana", "💜", "fiorita", root_depth_cm=20),
    make_plant("Dipladenia", "Mandevilla sanderi", "🌺", "fiorita", root_depth_cm=25),
    make_plant("Verbena", "Verbena × hybrida", "💜", "fiorita", root_depth_cm=15),
    make_plant("Begonia", "Begonia semperflorens", "🌸", "fiorita", root_depth_cm=15),
    make_plant("Impatiens (Lisette)", "Impatiens walleriana", "🌸", "fiorita", root_depth_cm=15),
    make_plant("Calibrachoa", "Calibrachoa × hybrida", "🌸", "fiorita", root_depth_cm=15),
    make_plant("Lobelia", "Lobelia erinus", "💙", "fiorita", root_depth_cm=12),
    make_plant("Viola del pensiero", "Viola × wittrockiana", "💜", "fiorita", root_depth_cm=12),
    make_plant("Primula", "Primula vulgaris", "🌼", "fiorita", root_depth_cm=12),
]

# ─── ARBUSTI ORNAMENTALI (15) ─────────────────────────────────────────
PLANTS += [
    make_plant("Ortensia", "Hydrangea macrophylla", "💙", "arbusto",
               root_depth_cm=30,
               card_data_overrides={"sub": {"note": "Acidofila: pH acido (5.0-6.0) per fioriture blu, neutro per rosa. Substrato per acidofile."}}),
    make_plant("Azalea", "Rhododendron simsii", "🌸", "arbusto",
               root_depth_cm=25,
               card_data_overrides={"sub": {"note": "Acidofila: substrato specifico per rododendri (pH 4.5-5.5)."}}),
    make_plant("Camelia", "Camellia japonica", "🌺", "arbusto",
               root_depth_cm=30,
               card_data_overrides={"sub": {"note": "Acidofila: substrato per acidofile (pH 5.0-6.0)."}}),
    make_plant("Gardenia", "Gardenia jasminoides", "🤍", "arbusto",
               root_depth_cm=25,
               card_data_overrides={"sub": {"note": "Acidofila e delicata: substrato specifico, alta umidità."}}),
    make_plant("Ibiscus", "Hibiscus rosa-sinensis", "🌺", "arbusto", root_depth_cm=30),
    make_plant("Forsizia", "Forsythia × intermedia", "🌼", "arbusto", root_depth_cm=30),
    make_plant("Viburno", "Viburnum tinus", "🤍", "arbusto",
               root_depth_cm=30,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Ligustro", "Ligustrum japonicum", "🌳", "arbusto",
               root_depth_cm=30,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Biancospino", "Crataegus monogyna", "🌳", "arbusto", root_depth_cm=35),
    make_plant("Cotogno da fiore", "Chaenomeles japonica", "🌸", "arbusto", root_depth_cm=30),
    make_plant("Cotoneaster", "Cotoneaster horizontalis", "🌳", "arbusto", root_depth_cm=25),
    make_plant("Callicarpa", "Callicarpa bodinieri", "💜", "arbusto", root_depth_cm=25),
    make_plant("Lonicera (Caprifoglio)", "Lonicera caprifolium", "🌸", "arbusto", root_depth_cm=25),
    make_plant("Magnolia stellata", "Magnolia stellata", "🤍", "arbusto", root_depth_cm=35),
    make_plant("Fucsia", "Fuchsia magellanica", "💜", "arbusto", root_depth_cm=20),
]

# ─── ALBERI LATIFOGLIE (18) ──────────────────────────────────────────
PLANTS += [
    make_plant("Quercia comune (Farnia)", "Quercus robur", "🌳", "albero", root_depth_cm=80),
    make_plant("Leccio", "Quercus ilex", "🌳", "albero",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Quercia da sughero", "Quercus suber", "🌳", "albero",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Roverella", "Quercus pubescens", "🌳", "albero", root_depth_cm=70),
    make_plant("Cerro", "Quercus cerris", "🌳", "albero", root_depth_cm=70),
    make_plant("Faggio", "Fagus sylvatica", "🍂", "albero", root_depth_cm=60),
    make_plant("Faggio rosso", "Fagus sylvatica purpurea", "🍂", "albero", root_depth_cm=60),
    make_plant("Acero campestre", "Acer campestre", "🍁", "albero", root_depth_cm=50),
    make_plant("Acero riccio", "Acer platanoides", "🍁", "albero", root_depth_cm=60),
    make_plant("Acero di monte", "Acer pseudoplatanus", "🍁", "albero", root_depth_cm=60),
    make_plant("Tiglio nostrano", "Tilia platyphyllos", "🌳", "albero", root_depth_cm=70),
    make_plant("Tiglio selvatico", "Tilia cordata", "🌳", "albero", root_depth_cm=60),
    make_plant("Frassino comune", "Fraxinus excelsior", "🌳", "albero", root_depth_cm=60),
    make_plant("Frassino orniello", "Fraxinus ornus", "🌳", "albero", root_depth_cm=50),
    make_plant("Olmo campestre", "Ulmus minor", "🌳", "albero", root_depth_cm=60),
    make_plant("Ippocastano", "Aesculus hippocastanum", "🌳", "albero", root_depth_cm=70),
    make_plant("Liriodendro", "Liriodendron tulipifera", "🌳", "albero", root_depth_cm=70),
    make_plant("Platano", "Platanus × acerifolia", "🌳", "albero", root_depth_cm=80),
]

# ─── ALBERI CADUCIFOGLIE DA FIORE (10) ───────────────────────────────
PLANTS += [
    make_plant("Betulla", "Betula pendula", "🌳", "albero", root_depth_cm=50),
    make_plant("Pioppo nero", "Populus nigra", "🌳", "albero", root_depth_cm=60),
    make_plant("Pioppo bianco", "Populus alba", "🌳", "albero", root_depth_cm=60),
    make_plant("Salice piangente", "Salix babylonica", "🌳", "albero", root_depth_cm=50),
    make_plant("Albicocco", "Prunus armeniaca", "🍑", "albero", root_depth_cm=50),
    make_plant("Pesco", "Prunus persica", "🍑", "albero", root_depth_cm=50),
    make_plant("Ciliegio", "Prunus avium", "🍒", "albero", root_depth_cm=60),
    make_plant("Susino", "Prunus domestica", "🟣", "albero", root_depth_cm=50),
    make_plant("Melo", "Malus domestica", "🍎", "albero", root_depth_cm=60),
    make_plant("Pero", "Pyrus communis", "🍐", "albero", root_depth_cm=60),
]

# ─── CONIFERE (10) ────────────────────────────────────────────────────
PLANTS += [
    make_plant("Pino domestico", "Pinus pinea", "🌲", "conifera",
               root_depth_cm=70,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Pino marittimo", "Pinus pinaster", "🌲", "conifera",
               root_depth_cm=70,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Pino d'Aleppo", "Pinus halepensis", "🌲", "conifera",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Cedro dell'Atlante", "Cedrus atlantica", "🌲", "conifera",
               root_depth_cm=70,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Cedro del Libano", "Cedrus libani", "🌲", "conifera",
               root_depth_cm=70,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Cedro deodara", "Cedrus deodara", "🌲", "conifera",
               root_depth_cm=70,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Cipresso comune", "Cupressus sempervirens", "🌲", "conifera",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Ginepro comune", "Juniperus communis", "🌲", "conifera",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Tasso", "Taxus baccata", "🌲", "conifera",
               root_depth_cm=50,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Larice", "Larix decidua", "🌲", "conifera", root_depth_cm=60),
]

# ─── RAMPICANTI (8) ────────────────────────────────────────────────────
PLANTS += [
    make_plant("Glicine", "Wisteria sinensis", "💜", "arbusto", root_depth_cm=40),
    make_plant("Edera comune", "Hedera helix", "🌿", "tropicale",
               root_depth_cm=20,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Falso gelsomino", "Trachelospermum jasminoides", "🤍", "mediterranea",
               root_depth_cm=30,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Vite americana", "Parthenocissus quinquefolia", "🍂", "arbusto", root_depth_cm=30),
    make_plant("Caprifoglio comune", "Lonicera japonica", "🌸", "arbusto", root_depth_cm=25),
    make_plant("Clematide", "Clematis vitalba", "🤍", "arbusto", root_depth_cm=25),
    make_plant("Passiflora", "Passiflora caerulea", "💜", "arbusto", root_depth_cm=25),
    make_plant("Ipomea (Campanella)", "Ipomoea purpurea", "💜", "fiorita", root_depth_cm=20),
]

# ─── PIANTE GRASSE E CACTACEE EXTRA (8) ───────────────────────────────
PLANTS += [
    make_plant("Cactus globoso", "Echinocactus grusonii", "🌵", "succulenta", root_depth_cm=12),
    make_plant("Cereus peruvianus", "Cereus repandus", "🌵", "succulenta", root_depth_cm=15),
    make_plant("Mammillaria", "Mammillaria spp.", "🌵", "succulenta", root_depth_cm=10),
    make_plant("Opuntia (Fico d'India)", "Opuntia ficus-indica", "🌵", "succulenta", root_depth_cm=20),
    make_plant("Schlumbergera (Cactus di Natale)", "Schlumbergera bridgesii", "🌸", "succulenta", root_depth_cm=12),
    make_plant("Senecio", "Senecio rowleyanus", "🌿", "succulenta", root_depth_cm=10),
    make_plant("Pachira (Acquatica)", "Pachira aquatica", "🌳", "tropicale", root_depth_cm=25),
    make_plant("Beaucarnea (Pianta mangiafumo)", "Beaucarnea recurvata", "🌴", "succulenta", root_depth_cm=20),
]

# ════════════════════════════════════════════════════════════════════════
# AMPLIAMENTO #1 — Aggiunte richieste e voci comuni mancanti
# ════════════════════════════════════════════════════════════════════════
# Questo blocco completa il catalogo con piante segnalate come mancanti
# e voci comuni in Italia che erano sfuggite al primo giro:
#
# - Mimosa (Acacia dealbata): l'albero da fiori gialli più iconico del
#   primo periodo primaverile, presente in mille giardini italiani
# - Paulownia tomentosa: l'"albero principessa", molto di moda negli
#   ultimi anni anche per scopi di biomassa
# - Juniperus chinensis 'Itoigawa': una varietà specifica del ginepro
#   cinese, è IL ginepro per bonsai (foglie minuscole, ramificazione
#   fitta, legno secco scolpibile in jin/shari)
#
# Più piante comuni dimenticate al primo giro: arbusti da siepe (nandina,
# weigela, spirea, photinia), alberi nobili (carpino, ontano), aromatiche
# (verbena odorosa, ruta, stevia), bonsai (zelkova, olmo siberiano),
# tropicali appartamento (schefflera full-size, croton, asparagina),
# succulenta (epifillo).

PLANTS += [
    # ─── Le tre richieste esplicitamente ──────────────────────────────
    make_plant("Mimosa", "Acacia dealbata", "🌼", "albero",
               root_depth_cm=50, p_coef=0.50,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Sempreverde da fiori gialli profumati a fine inverno (gennaio-marzo). Resistente al gelo solo fino a -5°C: in Nord Italia teme inverni rigidi."}}),
    make_plant("Paulownia (Albero principessa)", "Paulownia tomentosa", "💜", "albero",
               root_depth_cm=70,
               card_data_overrides={"esp": {"note": "Albero a crescita rapidissima (fino a 3 m/anno) con grandi fiori lilla a forma di tromba in primavera. Foglie cuoriformi grandi fino a 30 cm."}}),
    make_plant("Bonsai Ginepro Itoigawa", "Juniperus chinensis 'Itoigawa'", "🌲", "bonsai",
               root_depth_cm=12,
               card_data_overrides={"esp": {"note": "Varietà giapponese del ginepro cinese, la più usata nel bonsai per fogliame fitto e finissimo. Adatta a tecniche jin/shari. Da esterno tutto l'anno con protezione invernale del vaso."}}),

    # ─── Arbusti ornamentali aggiuntivi ───────────────────────────────
    make_plant("Nandina (Bambù sacro)", "Nandina domestica", "🌿", "arbusto",
               root_depth_cm=25,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Sempreverde con fogliame rossastro in autunno-inverno, bacche rosse durature. Molto resistente."}}),
    make_plant("Weigela", "Weigela florida", "🌸", "arbusto", root_depth_cm=30),
    make_plant("Spirea", "Spiraea japonica", "🌸", "arbusto", root_depth_cm=25),
    make_plant("Photinia", "Photinia × fraseri", "🌳", "arbusto",
               root_depth_cm=35,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Sempreverde da siepe, germogli rossi in primavera. Tollerante al sole e alla potatura."}}),
    make_plant("Bosso", "Buxus sempervirens", "🌿", "arbusto",
               root_depth_cm=25,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"cur": {"note": "Da controllare per piralide del bosso (Cydalima perspectalis): trattamento preventivo con Bacillus thuringiensis primavera-estate."}}),
    make_plant("Lauroceraso", "Prunus laurocerasus", "🌳", "arbusto",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Pieris", "Pieris japonica", "🤍", "arbusto",
               root_depth_cm=30,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"sub": {"note": "Acidofila: substrato per acidofile (pH 5.0-6.0), come azalee e camelie."}}),
    make_plant("Skimmia", "Skimmia japonica", "❤️", "arbusto",
               root_depth_cm=25,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"sub": {"note": "Acidofila: substrato per acidofile. Bacche rosse persistenti in inverno."}}),

    # ─── Alberi latifoglie aggiuntivi ─────────────────────────────────
    make_plant("Carpino bianco", "Carpinus betulus", "🌳", "albero",
               root_depth_cm=50,
               card_data_overrides={"cur": {"note": "Latifoglia da siepe formale per eccellenza. Conserva le foglie secche in inverno (marcescenza), funzione di schermatura tutto l'anno."}}),
    make_plant("Carpino nero", "Ostrya carpinifolia", "🌳", "albero", root_depth_cm=50),
    make_plant("Ontano nero", "Alnus glutinosa", "🌳", "albero", root_depth_cm=50),
    make_plant("Acero negundo", "Acer negundo", "🍁", "albero", root_depth_cm=50),
    make_plant("Sofora del Giappone", "Styphnolobium japonicum", "🌳", "albero", root_depth_cm=60),
    make_plant("Albero di Giuda", "Cercis siliquastrum", "💜", "albero",
               root_depth_cm=45,
               card_data_overrides={"esp": {"note": "Fioritura spettacolare rosa-violetta direttamente sui rami in aprile, prima delle foglie. Resistente alla siccità mediterranea."}}),
    make_plant("Bagolaro", "Celtis australis", "🌳", "albero", root_depth_cm=60),
    make_plant("Sorbo domestico", "Sorbus domestica", "🌳", "albero", root_depth_cm=50),

    # ─── Conifere aggiuntive ──────────────────────────────────────────
    make_plant("Abete bianco", "Abies alba", "🌲", "conifera",
               root_depth_cm=70,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Abete rosso (Peccio)", "Picea abies", "🌲", "conifera",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Pino silvestre", "Pinus sylvestris", "🌲", "conifera",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Cipresso di Leyland", "× Cuprocyparis leylandii", "🌲", "conifera",
               root_depth_cm=50,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Tuia", "Thuja occidentalis", "🌲", "conifera",
               root_depth_cm=45,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),

    # ─── Aromatiche e officinali aggiuntive ───────────────────────────
    make_plant("Verbena odorosa (Erba Luigia)", "Aloysia citrodora", "🌿", "aromatica",
               root_depth_cm=25,
               card_data_overrides={"esp": {"note": "Foglie con intenso profumo di limone, ottime in tisana. In Nord Italia perde le foglie in inverno: protezione del fittone."}}),
    make_plant("Ruta", "Ruta graveolens", "🌿", "aromatica",
               root_depth_cm=20,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Stevia", "Stevia rebaudiana", "🌿", "aromatica",
               root_depth_cm=20,
               card_data_overrides={"esp": {"note": "Foglie naturalmente dolci. Teme il gelo: in Nord Italia ricovero invernale o coltivata come annuale."}}),
    make_plant("Santoreggia", "Satureja montana", "🌿", "aromatica",
               root_depth_cm=20,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Issopo", "Hyssopus officinalis", "💜", "aromatica", root_depth_cm=20),

    # ─── Bonsai aggiuntivi ────────────────────────────────────────────
    make_plant("Bonsai Zelkova", "Zelkova serrata", "🌳", "bonsai", root_depth_cm=12,
               card_data_overrides={"esp": {"note": "Bonsai da esterno per eccellenza per stile broom (eretto formale a chioma globosa). Resistente al gelo."}}),
    make_plant("Bonsai Olmo siberiano", "Ulmus pumila", "🌳", "bonsai", root_depth_cm=12),
    make_plant("Bonsai Glicine", "Wisteria sinensis", "💜", "bonsai", root_depth_cm=12,
               card_data_overrides={"esp": {"note": "Bonsai da esterno con fioritura spettacolare a grappoli pendenti in aprile-maggio. Esigenze idriche elevate in fioritura."}}),
    make_plant("Bonsai Azalea Satsuki", "Rhododendron indicum", "🌸", "bonsai", root_depth_cm=12,
               card_data_overrides={"sub": {"note": "Acidofila: substrato kanuma puro (pH 4.5-5.5). Annaffiare solo con acqua decalcificata o piovana."}}),
    make_plant("Bonsai Cotogno giapponese", "Chaenomeles japonica", "🌸", "bonsai", root_depth_cm=12),

    # ─── Tropicali appartamento aggiuntive ────────────────────────────
    make_plant("Schefflera", "Schefflera arboricola", "🌿", "tropicale", root_depth_cm=25),
    make_plant("Croton (Codiaeum)", "Codiaeum variegatum", "🍂", "tropicale", root_depth_cm=20,
               card_data_overrides={"esp": {"note": "Fogliame multicolore (verde, giallo, rosso) molto decorativo. Esigenze di luce intensa per mantenere le colorazioni."}}),
    make_plant("Asparagina", "Asparagus densiflorus", "🌿", "tropicale", root_depth_cm=20),
    make_plant("Felce di Boston", "Nephrolepis exaltata", "🌿", "tropicale", root_depth_cm=20,
               card_data_overrides={"esp": {"note": "Felce classica da appartamento, ama umidità elevata. Ottima per bagni luminosi."}}),
    make_plant("Aglaonema", "Aglaonema commutatum", "🌿", "tropicale", root_depth_cm=20),
    make_plant("Dieffenbachia", "Dieffenbachia seguine", "🌿", "tropicale", root_depth_cm=25,
               card_data_overrides={"cur": {"note": "Linfa irritante: lavarsi le mani dopo manipolazione. Tossica per bambini e animali."}}),
    make_plant("Strelitzia (Uccello del paradiso)", "Strelitzia reginae", "🧡", "tropicale", root_depth_cm=35),

    # ─── Succulente aggiuntive ────────────────────────────────────────
    make_plant("Epifillo (Cactus orchidea)", "Epiphyllum oxypetalum", "🌸", "succulenta", root_depth_cm=15),
    make_plant("Aeonium", "Aeonium arboreum", "🌹", "succulenta", root_depth_cm=15),
    make_plant("Graptopetalum", "Graptopetalum paraguayense", "🌸", "succulenta", root_depth_cm=10),
]

# ════════════════════════════════════════════════════════════════════════
# AMPLIAMENTO #2 — Macchia mediterranea + flora del Nord Italia
# ════════════════════════════════════════════════════════════════════════
# Questo blocco raggruppa due categorie di aggiunte:
#
# A) MACCHIA MEDITERRANEA: piante tipiche del bosco e della macchia delle
#    coste italiane meridionali e insulari, e in alcuni casi diffuse anche
#    in Pianura Padana per coltivazione (carrubo, agrifoglio). Coprono
#    buchi importanti come il carrubo, la ginestra, l'erica arborea, la
#    fillirea, l'alaterno e l'olivastro che sono protagonisti della
#    macchia ma erano assenti dal catalogo.
#
# B) NORD ITALIA / PIANURA PADANA: specie autoctone della pianura padana
#    e dei bassi rilievi alpini. Coprono il gelso (storicamente importante
#    per l'allevamento del baco da seta in Lombardia), gli arbusti
#    autoctoni delle siepi rurali padane (sambuco, nocciolo, prugnolo,
#    biancospino, sanguinello), gli alberi delle zone umide (salice
#    bianco, ontano nero — già presente ma confermato), e specie utili
#    nei giardini di campagna (melo e pero selvatici, sorbo degli
#    uccellatori).
#
# C) AROMATICHE E OFFICINALI tipiche del Nord Italia (camomilla, achillea,
#    iperico, equiseto) che integrano la lista delle aromatiche da
#    balcone con voci più "spontanee" di erboristeria.

PLANTS += [
    # ─── A. MACCHIA MEDITERRANEA ──────────────────────────────────────
    make_plant("Carrubo", "Ceratonia siliqua", "🌳", "albero",
               root_depth_cm=60,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Albero sempreverde mediterraneo, longevo e resistente alla siccità. Predilige climi caldi: in Nord Italia rischia il gelo intenso."}}),
    make_plant("Ginestra odorosa", "Spartium junceum", "💛", "mediterranea",
               root_depth_cm=40,
               card_data_overrides={"esp": {"note": "Arbusto pioniero della macchia mediterranea, fioritura giallo intenso giugno-luglio. Resiste alla siccità estrema."}}),
    make_plant("Ginestra dei carbonai", "Cytisus scoparius", "💛", "arbusto",
               root_depth_cm=30,
               card_data_overrides={"esp": {"note": "Arbusto con fioritura gialla aprile-maggio. Colonizza pendii e terreni poveri. Resistente al gelo, presente anche al Nord."}}),
    make_plant("Erica arborea", "Erica arborea", "🤍", "arbusto",
               root_depth_cm=30,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"sub": {"note": "Acidofila: substrato per acidofile (pH 4.5-6.0). Foglie aghiformi minuscole, fiori bianchi a campanella in marzo-maggio."}}),
    make_plant("Fillirea (Ilatro)", "Phillyrea latifolia", "🌿", "mediterranea",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Alaterno", "Rhamnus alaternus", "🌿", "mediterranea",
               root_depth_cm=35,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Olivastro (Olivo selvatico)", "Olea europaea var. sylvestris", "🫒", "mediterranea",
               root_depth_cm=50, p_coef=0.55,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Forma selvatica dell'olivo, molto longeva e resistente. Tipica della macchia alta delle coste italiane."}}),
    make_plant("Palma nana (Palma di San Pietro)", "Chamaerops humilis", "🌴", "mediterranea",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Unica palma autoctona europea. Resistente al gelo (-12°C) ma cresce molto lentamente. Coltivabile anche al Nord."}}),
    make_plant("Cappero", "Capparis spinosa", "🤍", "mediterranea",
               root_depth_cm=30,
               card_data_overrides={"esp": {"note": "Cresce spontaneo su rupi e muretti, fiori bianchi/rosa estivi. I boccioli sotto sale sono i 'capperi' da cucina."}}),
    make_plant("Agrifoglio", "Ilex aquifolium", "🌳", "arbusto",
               root_depth_cm=40,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Sempreverde con bacche rosse natalizie. Tollera bene mezz'ombra e gelo. Comune sia in macchia che nel sottobosco padano."}}),
    make_plant("Pungitopo", "Ruscus aculeatus", "🌿", "arbusto",
               root_depth_cm=20,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Mortella (Mirto comune)", "Myrtus communis 'Tarentina'", "🌿", "mediterranea",
               root_depth_cm=25,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Cultivar di mirto a foglia piccola, molto compatto. Usato per siepi formali nei giardini mediterranei."}}),
    make_plant("Euforbia arborescente", "Euphorbia dendroides", "🌿", "succulenta",
               root_depth_cm=25,
               card_data_overrides={"cur": {"note": "Linfa lattice irritante: usare guanti durante la potatura. In estate va a riposo perdendo le foglie (strategia di tolleranza alla siccità)."}}),
    make_plant("Lavanda dei muri", "Lavandula stoechas", "💜", "aromatica",
               root_depth_cm=25,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Lavanda mediterranea con fiori a 'pennacchio' in primavera. Più calda della L. angustifolia, in Nord Italia richiede protezione invernale."}}),

    # ─── B. NORD ITALIA / PIANURA PADANA ──────────────────────────────
    make_plant("Gelso bianco", "Morus alba", "🍃", "albero",
               root_depth_cm=60,
               card_data_overrides={"esp": {"note": "Storicamente coltivato in Lombardia per l'allevamento del baco da seta. Foglie cuoriformi, frutti dolci bianco-rosati commestibili."}}),
    make_plant("Gelso nero", "Morus nigra", "🫐", "albero",
               root_depth_cm=60,
               card_data_overrides={"esp": {"note": "Frutti molto saporiti, color nero-violaceo a maturità. Più rustico del gelso bianco, presente nelle campagne padane."}}),
    make_plant("Robinia (Acacia falsa)", "Robinia pseudoacacia", "🌳", "albero",
               root_depth_cm=50,
               card_data_overrides={"esp": {"note": "Specie alloctona invasiva (origine nordamericana) ma diffusissima in Pianura Padana. Fioritura bianca profumata fine maggio."}}),
    make_plant("Salice bianco", "Salix alba", "🌳", "albero",
               root_depth_cm=50,
               card_data_overrides={"esp": {"note": "Tipico delle zone umide e dei greti fluviali padani. Tollera ristagni idrici e cresce rapidamente."}}),
    make_plant("Sambuco nero", "Sambucus nigra", "🤍", "arbusto",
               root_depth_cm=40,
               card_data_overrides={"con": {"note": "Fiori bianchi profumati a maggio (utili per sciroppi), bacche nere in agosto-settembre. Tipico delle siepi spontanee padane."}}),
    make_plant("Nocciolo comune", "Corylus avellana", "🌰", "arbusto",
               root_depth_cm=40,
               card_data_overrides={"esp": {"note": "Arbusto autoctono italiano. In coltivazione produce nocciole; in giardino è ottima siepe alta sempreverde modesta."}}),
    make_plant("Prugnolo", "Prunus spinosa", "🤍", "arbusto",
               root_depth_cm=35,
               card_data_overrides={"esp": {"note": "Arbusto spinoso autoctono delle siepi rurali. Fioritura bianca in marzo-aprile prima delle foglie. Frutti (prugnoli) per liquori."}}),
    make_plant("Sanguinello", "Cornus sanguinea", "🌳", "arbusto",
               root_depth_cm=30,
               card_data_overrides={"esp": {"note": "Tipico delle siepi padane. In autunno i rami diventano rosso sangue, da cui il nome. Bacche nere non commestibili."}}),
    make_plant("Corniolo", "Cornus mas", "💛", "arbusto",
               root_depth_cm=30,
               card_data_overrides={"esp": {"note": "Fioritura gialla precocissima (febbraio-marzo). Drupe rosse commestibili in agosto, ottime per marmellate."}}),
    make_plant("Sorbo degli uccellatori", "Sorbus aucuparia", "🌳", "albero",
               root_depth_cm=45,
               card_data_overrides={"esp": {"note": "Albero rustico delle Alpi e Prealpi. Bacche rosso vivo in autunno, attirano gli uccelli (da cui il nome)."}}),
    make_plant("Melo selvatico", "Malus sylvestris", "🍎", "albero", root_depth_cm=50),
    make_plant("Pero selvatico", "Pyrus pyraster", "🍐", "albero", root_depth_cm=50),
    make_plant("Acero riccio (Norvegese)", "Acer platanoides 'Crimson King'", "🍁", "albero",
               root_depth_cm=60,
               card_data_overrides={"esp": {"note": "Cultivar a foglia rosso-purpurea, molto comune nei viali alberati e nei parchi del Nord Italia."}}),
    make_plant("Olmo siberiano (Olmo da siepe)", "Ulmus pumila", "🌳", "albero",
               root_depth_cm=50,
               card_data_overrides={"esp": {"note": "Resistente alla grafiosi (malattia che ha decimato gli olmi europei). Usato nelle siepi formali delle ville padane."}}),
    make_plant("Tasso barbasso", "Verbascum thapsus", "💛", "fiorita",
               root_depth_cm=30,
               card_data_overrides={"esp": {"note": "Pianta biennale spontanea, alta fino a 2 metri al secondo anno con spiga giallo intenso. Comune nei prati incolti padani."}}),
    make_plant("Edera terrestre", "Glechoma hederacea", "💜", "tropicale",
               root_depth_cm=15,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),

    # ─── C. AROMATICHE E OFFICINALI SPONTANEE ─────────────────────────
    make_plant("Camomilla", "Matricaria chamomilla", "🌼", "aromatica",
               root_depth_cm=15,
               card_data_overrides={"con": {"note": "Annuale spontanea dei prati incolti. I capolini essiccati danno la classica tisana digestiva."}}),
    make_plant("Achillea", "Achillea millefolium", "🤍", "aromatica",
               root_depth_cm=20,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1]),
    make_plant("Iperico (Erba di San Giovanni)", "Hypericum perforatum", "💛", "aromatica",
               root_depth_cm=25,
               card_data_overrides={"esp": {"note": "Erba officinale tradizionale, fioritura gialla a fine giugno (San Giovanni). Resistente al gelo, comune nelle scarpate."}}),
    make_plant("Tarassaco (Dente di leone)", "Taraxacum officinale", "💛", "aromatica",
               root_depth_cm=25,
               card_data_overrides={"con": {"note": "Spontaneo in tutti i prati italiani. Foglie giovani in insalata, radici come surrogato del caffè."}}),
    make_plant("Calendula", "Calendula officinalis", "🌼", "aromatica",
               root_depth_cm=15,
               card_data_overrides={"con": {"note": "Annuale da fiore commestibile, anche officinale. Resiste al freddo: fiorisce da marzo a novembre in zone miti."}}),
    make_plant("Cerfoglio", "Anthriscus cerefolium", "🌿", "aromatica", root_depth_cm=15),
    make_plant("Levistico (Sedano di monte)", "Levisticum officinale", "🌿", "aromatica",
               root_depth_cm=30,
               card_data_overrides={"esp": {"note": "Aromatica perenne dal sapore intenso simile al sedano. Cresce bene anche al Nord, ricaccia ogni primavera."}}),
    make_plant("Aneto", "Anethum graveolens", "🌿", "aromatica", root_depth_cm=20),
]

# ════════════════════════════════════════════════════════════════════════
# AMPLIAMENTO #3 — Integrazione delle 26 piante native nel catalogo
# ════════════════════════════════════════════════════════════════════════
# Le 26 piante "native" originali del progetto vivono nel database SQLite
# (vedi seed_native_plants.py) ma fino a oggi NON erano nel catalogo JSON
# usato per autocompletamento. Conseguenza: digitando "Phalaenopsis" nel
# form "Crea pianta personalizzata" il sistema non suggeriva la voce
# corrispondente, perché quella esiste solo come record nel database.
#
# Aggiungo qui le voci native MANCANTI (cioè quelle con nome italiano non
# già presente nel catalogo esteso). Quelle con nome italiano già presente
# nel catalogo (es. Aloe vera, Salvia, Rosmarino, Ficus elastica, Mimosa,
# Paulownia, Crassula, Oleandro, Pittosforo che è già "Pittosporo" nel
# catalogo) non vengono duplicate per non confondere l'utente con due
# voci uguali nel dropdown di autocompletamento.
#
# I dati delle voci aggiunte qui sono volutamente snelli (template di
# gruppo + override minimi) e NON replicano le schede ricche delle native
# nel database. Lo scopo è solo permettere all'autocompletamento di
# trovare il nome — quando l'utente seleziona dal dropdown, il form si
# popola con questa scheda generica, ma quando crea la pianta nel
# database, la pianta esistente con lo stesso nome resta intatta.

PLANTS += [
    # ─── Native con nomi unici (non già nel catalogo) ─────────────────
    # NB: alcune native sono escluse perché già nel catalogo:
    # - Sanseviera (già "Sansevieria")
    # - Ficus Benjamina (già "Ficus benjamina")
    # - Pilea/Moneta cinese (già "Pilea")
    # - Crassula Ovata (già "Crassula (Albero di giada)")
    # - Aloe Vera (già "Aloe vera")
    # - Salvia, Rosmarino, Mimosa, Paulownia, Oleandro, Pittosforo,
    #   Acero Campestre, Betulla, Ippocastano, Ficus Elastica
    #   (già in catalogo)
    make_plant("Orchidea Phalaenopsis (generica)", "Phalaenopsis sp.", "🌸", "orchidea",
               root_depth_cm=15,
               card_data_overrides={"esp": {"note": "Orchidea da appartamento più diffusa. Fioritura prolungata di 2-3 mesi, può rifiorire dallo stesso stelo."}}),
    make_plant("Glicine Bonsai (varietà nativa)", "Wisteria sinensis 'nativa'", "💜", "bonsai", root_depth_cm=12,
               card_data_overrides={"esp": {"note": "Bonsai da esterno con fioritura primaverile spettacolare. Esigenze idriche elevate da aprile a settembre."}}),
    make_plant("Limone (varietà generica)", "Citrus limon", "🍋", "agrume", root_depth_cm=35),
    make_plant("Vinca (Pervinca)", "Vinca major", "💜", "tropicale",
               root_depth_cm=20,
               monthly_states=[1,1,1,1,1,1,1,1,1,1,1,1],
               card_data_overrides={"esp": {"note": "Tappezzante perenne sempreverde. Tollera bene mezz'ombra e gelo. Fiori azzurro-violacei a 5 petali."}}),
    make_plant("Melograno", "Punica granatum", "🍎", "albero",
               root_depth_cm=40,
               card_data_overrides={"esp": {"note": "Piccolo albero da frutto mediterraneo. Fioritura rosso-arancio in maggio, frutti maturi in autunno."}}),
    make_plant("Stella di Natale", "Euphorbia pulcherrima", "❤️", "tropicale",
               root_depth_cm=20,
               card_data_overrides={"esp": {"note": "Brattee rosse decorative in inverno. Per rifiorire l'anno seguente serve buio assoluto 14h/giorno per 8 settimane in autunno."}}),
    make_plant("Liquidambar", "Liquidambar styraciflua", "🍂", "albero",
               root_depth_cm=60,
               card_data_overrides={"esp": {"note": "Albero ornamentale dai colori autunnali spettacolari (giallo, arancio, rosso, viola). Foglia palmata simile all'acero."}}),
    make_plant("Spino di Giuda", "Gleditsia triacanthos", "🌳", "albero", root_depth_cm=50),
    make_plant("Gelso Bonsai", "Morus alba (bonsai)", "🌳", "bonsai", root_depth_cm=12),
    make_plant("Tradescantia", "Tradescantia zebrina", "💜", "tropicale",
               root_depth_cm=15,
               card_data_overrides={"esp": {"note": "Tropicale d'appartamento ricadente, foglie strisce viola-argento. Crescita molto rapida, propagazione facilissima."}}),
    make_plant("Carmona Bonsai", "Carmona retusa", "🌳", "bonsai", root_depth_cm=10,
               card_data_overrides={"esp": {"note": "Bonsai tropicale d'appartamento. Foglie piccole lucide, fiori bianchi minuscoli. Teme correnti e sbalzi termici."}}),
]

# ════════════════════════════════════════════════════════════════════════
# OUTPUT
# ════════════════════════════════════════════════════════════════════════

def main():
    print(f"Catalogo generato: {len(PLANTS)} piante")

    # Distribuzione per gruppo
    from collections import Counter
    by_group = Counter(p["sim_group"] for p in PLANTS)
    print("\nDistribuzione per gruppo:")
    for g, n in sorted(by_group.items()):
        print(f"  {g:15s} {n:3d}")

    # Verifica nomi unici
    names = [p["name"] for p in PLANTS]
    if len(names) != len(set(names)):
        from collections import Counter as C
        dups = [n for n, c in C(names).items() if c > 1]
        print(f"\nATTENZIONE: nomi duplicati: {dups}")
        return 1

    # Verifica latini unici
    latins = [p["latin"] for p in PLANTS]
    if len(latins) != len(set(latins)):
        from collections import Counter as C
        dups = [l for l, c in C(latins).items() if c > 1]
        print(f"\nNomi latini duplicati (alcuni intenzionali, es. bonsai vs full-size): {dups}")

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extended_catalog.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(PLANTS, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Scritto {out_path}")
    print(f"  Dimensione: {os.path.getsize(out_path):,} byte")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
