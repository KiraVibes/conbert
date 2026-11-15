# Conbert installieren (mit Docker)

Diese Anleitung bringt Conbert auf einen Computer oder eine NAS in deinem
Heimnetz. Du brauchst dafür keine Programmierkenntnisse – nur ein paar Befehle
zum Abtippen. Rechne mit etwa 15 Minuten (plus Downloadzeit).

**Kurzfassung für Eilige:**

```bash
mkdir conbert && cd conbert
curl -fsSLO https://raw.githubusercontent.com/OWNER/conbert/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/OWNER/conbert/main/.env.example
docker compose up -d
docker compose logs conbert  # zeigt den Einrichtungscode
```

Dann im Browser `http://localhost:3313` öffnen und den Code eingeben.

---

## 1. Was du brauchst

- Einen Computer, der dauerhaft läuft: z. B. eine NAS (Synology, QNAP,
  Unraid, TrueNAS), einen Mini-PC, einen Raspberry Pi 4/5 oder deinen PC.
- **Mindestens 2 GB Arbeitsspeicher** (besser 4 GB, wenn du Videos umwandelst)
  und etwa **5 GB freien Platz** für das Programm.
- **Docker** mit „Docker Compose“:
  - Windows / Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop/) installieren.
  - Linux: `curl -fsSL https://get.docker.com | sh` (danach einmal ab- und
    wieder anmelden).
  - Synology: im Paket-Zentrum **Container Manager** installieren.
  - QNAP: im App Center **Container Station** installieren.
  - Unraid: Docker ist schon dabei; für Compose das Plugin „Docker Compose
    Manager“ installieren.

Prüfen, ob es klappt: In einem Terminal `docker compose version` eingeben. Es
sollte eine Versionsnummer erscheinen.

> **Terminal?** Unter Windows heißt es „PowerShell“ oder „Terminal“ (Startmenü),
> auf dem Mac „Terminal“ (Programme → Dienstprogramme). Auf einer NAS meldest
> du dich per SSH an (bei Synology: Systemsteuerung → Terminal & SNMP → SSH
> aktivieren, dann `ssh deinname@<IP-der-NAS>`).

## 2. Conbert herunterladen

Du brauchst nur zwei kleine Dateien. Das eigentliche Programm (das
„Docker-Image“) lädt Docker beim Start selbst – fertig gebaut, für normale
PCs und NAS (amd64) genauso wie für ARM-Geräte wie den Raspberry Pi.

Leg einen Ordner an und lade die Dateien hinein:

```bash
mkdir conbert && cd conbert
curl -fsSLO https://raw.githubusercontent.com/OWNER/conbert/main/docker-compose.yml
curl -fsSL -o .env.example https://raw.githubusercontent.com/OWNER/conbert/main/.env.example
```

Ohne Terminal geht es auch: Öffne die beiden Adressen im Browser, speichere
die Dateien unter genau diesen Namen (`docker-compose.yml`, `.env.example`)
und leg sie zusammen in einen Ordner. Auf einer NAS kannst du den Ordner
z. B. über die Dateifreigabe anlegen.

> **Selbst bauen statt herunterladen?** Wer den Quellcode ändern möchte,
> klont das Repository (`git clone https://github.com/OWNER/conbert.git`) und
> startet mit
> `docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d`.
> Das dauert beim ersten Mal 10 bis 30 Minuten.

## 3. Einstellungen in der Datei `.env` (optional, aber empfohlen)

Kopiere die Beispieldatei:

```bash
cp .env.example .env
```

Öffne `.env` mit einem Texteditor. Alles darin ist optional – die wichtigsten
Punkte:

| Einstellung             | Wofür                                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| `CONBERT_PORT`          | Unter welchem Port Conbert erreichbar ist (Standard `3313`).             |
| `CONBERT_SECRET`        | Schlüssel für gespeicherte Passwörter – siehe unten.                     |
| `CONBERT_MAX_UPLOAD_MB` | Größte Datei, die du hochladen darfst (Standard 2048 = 2 GB).            |
| `CONBERT_MEMORY_LIMIT`  | Wie viel Arbeitsspeicher Conbert höchstens nutzt (z. B. `4g`).           |
| `CONBERT_IMAGE_TAG`     | `full` für E-Book-Formate wie MOBI und AZW3 (Image wird ~850 MB größer). |

Eine Zeile, die mit `#` beginnt, ist ausgeschaltet. Zum Einschalten das `#`
entfernen.

### Der Schlüssel `CONBERT_SECRET` – was ist das?

Wenn du in Conbert Speicherorte (NAS-Freigaben, Nextcloud …) oder Cookies
hinterlegst, speichert Conbert die Passwörter **verschlüsselt**. Der Schlüssel
dafür ist `CONBERT_SECRET`.

- **Setzt du ihn nicht**, erzeugt Conbert beim ersten Start selbst einen
  zufälligen Schlüssel und legt ihn in seinem Daten-Ordner ab
  (`/data/secret.key`). Das funktioniert – aber dann liegen Schlüssel und
  verschlüsselte Passwörter nebeneinander. Wer eine Kopie des Daten-Ordners
  hat, hat beides.
- **Besser:** einen eigenen Schlüssel in `.env` eintragen. Einen guten erzeugst
  du so:

  ```bash
  openssl rand -base64 32
  ```

  (Ohne `openssl`: irgendeine Zufallsfolge aus mindestens 16 Zeichen, z. B. aus
  einem Passwort-Manager.) Dann in `.env`:

  ```ini
  CONBERT_SECRET=hier-die-erzeugte-Zeichenfolge
  ```

- **Bewahre den Schlüssel gut auf** (z. B. im Passwort-Manager). Geht er
  verloren oder änderst du ihn, kann Conbert die gespeicherten Passwörter nicht
  mehr lesen. Dann musst du sie bei den Speicherorten und Cookies einmal neu
  eingeben – Dateien gehen dabei nicht verloren.
- Wechselst du später vom automatisch erzeugten zu einem eigenen Schlüssel,
  gilt dasselbe: Passwörter einmal neu eingeben.

## 4. Starten

```bash
docker compose up -d
```

Beim ersten Mal lädt Docker das Programm herunter. Es ist groß (entpackt
rund 3,5 GB), weil viele Umwandlungs-Werkzeuge dabei sind – je nach Internet
dauert das **ein paar Minuten**. Danach
startet Conbert in wenigen Sekunden.

Läuft es? `docker compose ps` zeigt bei `conbert` den Zustand `healthy`.

## 5. Einrichten

1. Den **Einrichtungscode** aus dem Protokoll holen:

   ```bash
   docker compose logs conbert
   ```

   Er steht in einem Kasten „Conbert is not set up yet“.

2. Im Browser öffnen:
   - auf demselben Gerät: `http://localhost:3313`
   - von einem anderen Gerät im Heimnetz: `http://<IP-des-Servers>:3313`
     (die IP findest du z. B. in deinem Router oder bei Synology unter
     Systemsteuerung → Netzwerk)

3. Code eingeben und dein **Admin-Konto** anlegen (Benutzername und ein
   Passwort mit mindestens 10 Zeichen). Weitere Konten legst du danach unter
   **Verwaltung** an.

   Alternative: „Anmeldung übernimmt mein Reverse-Proxy“ – nur, wenn du schon
   Authelia, Authentik o. Ä. benutzt (siehe `.env.example`).

## 6. HTTPS – warum und wie?

Über `http://<IP>:3313` funktioniert Conbert, aber dein Browser sperrt dann aus
Sicherheitsgründen einige Funktionen:

- **Umwandeln „auf diesem Gerät“** (für manche Werkzeuge – Conbert weicht dann
  auf den Server aus),
- **Offline-Nutzung** und **Installieren als App** (inkl. „Teilen → Conbert“
  auf dem Handy).

Auf `http://localhost:3313` geht alles. Für die anderen Geräte brauchst du
**HTTPS**, also eine verschlüsselte Adresse wie `https://conbert.meine-domain.de`.
Das übernimmt ein **Reverse-Proxy**, z. B.:

- **Nginx Proxy Manager** (einfach, mit Oberfläche),
- **Caddy** (eine Zeile Konfiguration: `conbert.example.de { reverse_proxy conbert:3313 }`),
- **Traefik**,
- bei Synology: Systemsteuerung → Anmeldeportal → Erweitert → Reverse-Proxy.

Wichtig dabei: Der Proxy muss **WebSockets** durchlassen (für den Fortschritt)
und große Uploads erlauben (z. B. bei Nginx `client_max_body_size 2g;`).

Für **Nginx** liegt eine fertige Vorlage in
[reverse-proxy/nginx.conf](reverse-proxy/nginx.conf) – nur HTTP, das
Zertifikat ergänzt danach `certbot --nginx`. Wichtig darin: Nginx muss den
echten `Host` weitergeben, sonst lehnt Conbert Anmelden und Hochladen ab.

## 7. Grenzen für Arbeitsspeicher und CPU (für kleine NAS)

Videos umwandeln braucht viel Kraft. Damit deine NAS daneben benutzbar bleibt,
kannst du Conbert begrenzen – in `.env`:

```ini
CONBERT_MEMORY_LIMIT=3g     # höchstens 3 GB Arbeitsspeicher
CONBERT_CPUS=2              # höchstens 2 Prozessorkerne
CONBERT_JOB_CONCURRENCY=1   # nur eine Umwandlung auf dem Server gleichzeitig
```

Danach `docker compose up -d` ausführen. Reicht der Speicher für eine Datei
nicht, bricht nur diese Umwandlung mit einer verständlichen Meldung ab – der
Rest läuft weiter. Umwandlungen laufen außerdem mit niedrigerer Priorität,
damit die Oberfläche flüssig bleibt.

## 8. Ordner und NAS-Freigaben einbinden

Conbert kann Ergebnisse direkt auf deiner NAS speichern und Dateien von dort
öffnen. Wie du die Adresse deiner Freigabe findest, steht in
[speicherorte.md](speicherorte.md).

Ordner, die direkt auf dem Server liegen, bindest du in `docker-compose.yml`
unter `volumes:` ein, z. B.:

```yaml
- /volume1/fotos:/storage/fotos
```

## 9. Grafikkarte für schnellere Videos (optional)

In `docker-compose.yml` stehen auskommentierte Beispiele für Intel/AMD
(`/dev/dri`) und NVIDIA. Einkommentieren, `docker compose up -d`, fertig. Unter
**Einstellungen → Engines** siehst du, ob Conbert die Karte erkannt hat.

## 10. Aktualisieren

```bash
docker compose pull
docker compose up -d
```

Docker lädt dabei nur, was sich geändert hat. Willst du bei einer bestimmten
Version bleiben, trag sie in `.env` ein, z. B. `CONBERT_IMAGE_TAG=0.1.0`.
Welche Versionen es gibt und was neu ist, steht auf der Release-Seite des
Projekts auf GitHub.

Hast du selbst gebaut: `git pull`, dann wieder
`docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d`.

Deine Konten, Einstellungen und Speicherorte bleiben erhalten (sie liegen im
Docker-Volume `conbert-data`).

## 11. Sichern (Backup)

Alles Wichtige liegt im Volume `conbert-data`. So sicherst du es in eine Datei:

```bash
docker run --rm -v conbert_conbert-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/conbert-backup.tar.gz -C /data .
```

(Der Volume-Name beginnt mit dem Ordnernamen, hier `conbert_`. Den genauen
Namen zeigt `docker volume ls`.) Sichere außerdem deine `.env` – vor allem
`CONBERT_SECRET`.

## 12. Admin-Passwort vergessen

Gibt es noch einen anderen Admin, kann er dein Passwort unter **Verwaltung**
zurücksetzen. Bist du der einzige Admin, setzt du es direkt auf dem Server
zurück:

```bash
docker compose exec conbert node server/dist/index.mjs reset-password admin
```

(`admin` durch deinen Benutzernamen ersetzen.) Conbert zeigt ein neues,
zufälliges Passwort an und meldet dich auf allen Geräten ab. Melde dich damit
an und ändere es unter **Einstellungen → Dein Konto**.

## 13. Wenn etwas nicht klappt

| Problem                                  | Was meistens hilft                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `port is already allocated`              | Port 3313 ist belegt. In `.env` z. B. `CONBERT_PORT=3320` setzen.                                                         |
| Seite lädt nicht von einem anderen Gerät | IP-Adresse prüfen, Firewall des Servers für den Port öffnen.                                                              |
| Einrichtungscode nicht gefunden          | `docker compose logs conbert \| grep -A3 "not set up"`                                                                    |
| „Auf diesem Gerät“ geht nicht            | Über `https://…` oder `http://localhost:3313` öffnen (siehe Abschnitt 6).                                                 |
| Videos brechen mit „Arbeitsspeicher“ ab  | `CONBERT_MEMORY_LIMIT` erhöhen oder `CONBERT_JOB_CONCURRENCY=1` setzen.                                                   |
| Downloads von Instagram & Co. scheitern  | Unter **Einstellungen → Herunterladen** die Werkzeuge aktualisieren; ggf. Cookies hinterlegen ([cookies.md](cookies.md)). |
| Gespeicherte Passwörter gehen nicht mehr | `CONBERT_SECRET` wurde geändert – alten Wert zurück oder Passwörter neu eingeben.                                         |

Mehr Hilfe findest du in Conbert selbst: oben rechts auf das **?** klicken.
