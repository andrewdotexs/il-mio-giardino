# ── Dockerfile per Il Mio Giardino ─────────────────────────────────────────
#
# Questo file descrive come Docker deve costruire l'immagine che conterrà
# il server.py e tutti i file dell'app. Ogni istruzione "RUN", "COPY" o
# "FROM" produce uno strato (layer) dell'immagine, e Docker mantiene una
# cache di questi strati per velocizzare le ricostruzioni successive.
#
# Filosofia generale: l'app non ha dipendenze esterne (usa solo la stdlib
# di Python), quindi l'immagine può essere molto piccola. Userò la variante
# "slim" di Python che è minimale ma completa, evitando "alpine" che ha
# qualche peculiarità (musl libc) e potrebbe creare problemi inattesi.

# Partenza: immagine ufficiale Python 3.13 slim.
# La versione 3.13 è quella che usi su Termux, così l'ambiente è coerente.
# L'opzione "slim" produce un'immagine ~50 MB invece dei ~900 MB della
# versione completa, perché esclude documentazione, build tools, e altre
# cose che non servono in produzione.
FROM python:3.13-slim

# Imposto la directory di lavoro dentro il container. Tutti i comandi
# successivi (COPY, RUN, CMD) saranno relativi a questo percorso.
# /app è una convenzione molto diffusa nel mondo Docker.
WORKDIR /app

# Variabili d'ambiente utili.
# PYTHONUNBUFFERED=1 fa sì che i print() di Python appaiano subito nei log
# di Docker invece di essere bufferizzati. È fondamentale per vedere i
# messaggi di server.py in tempo reale con "docker logs".
# PYTHONDONTWRITEBYTECODE=1 evita la creazione dei file .pyc nei container,
# che sarebbero comunque persi al riavvio.
# DATA_DIR=/app/data dice a server.py di tenere il database e il config
# in una cartella dedicata, che il docker-compose.yml monta come volume
# per persistere i dati tra restart e rebuild dell'immagine.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/app/data

# Copio i file dell'app dentro il container.
# Il primo "." è il contesto di build (la cartella corrente sull'host),
# il secondo "." è la WORKDIR dentro il container.
# Il file .dockerignore (separato) esclude .git, __pycache__ e altri
# file che non servono dentro l'immagine.
COPY . .

# Espongo la porta 8765 come "documentazione" — è la porta su cui server.py
# ascolta. Questa istruzione non apre davvero la porta sul sistema host,
# ma serve come dichiarazione d'intenti per chi userà l'immagine.
# La pubblicazione effettiva avviene con "docker run -p" o tramite
# docker-compose.yml.
EXPOSE 8765

# Comando di default eseguito all'avvio del container.
# Uso la forma "exec" (lista invece di stringa) perché permette a Python
# di ricevere i segnali di shutdown (SIGTERM) correttamente quando si fa
# "docker stop", invece di essere wrappato da una shell che li intercetta.
# La cartella /app/data viene creata automaticamente da server.py
# (os.makedirs con exist_ok=True) quando legge la variabile DATA_DIR.
CMD ["python", "server.py"]
