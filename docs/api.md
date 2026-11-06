# Conbert aus Skripten und anderen Programmen benutzen (API)

Conbert lässt sich nicht nur im Browser bedienen. Über die **API** (eine
Schnittstelle für Programme) können Skripte, **Home Assistant**, **n8n**,
**iPhone-Kurzbefehle** oder die **Kommandozeile** Dateien umwandeln,
komprimieren und Links herunterladen – ganz ohne Klicken.

Diese Anleitung erklärt alles von Anfang an. Du brauchst nur:

- deinen laufenden Conbert-Server,
- ein **API-Token** (eine Art Passwort nur für Programme),
- ein Programm, das Webanfragen schicken kann – z. B. `curl`, das auf
  Windows 10/11, macOS und Linux schon dabei ist.

---

## Inhalt

1. [Das Wichtigste in einer Minute](#1-das-wichtigste-in-einer-minute)
2. [Ein Token anlegen](#2-ein-token-anlegen)
3. [Die Adresse deines Servers](#3-die-adresse-deines-servers)
4. [Eine Datei umwandeln – der einfachste Weg](#4-eine-datei-umwandeln--der-einfachste-weg)
5. [Einstellungen (Optionen) mitgeben](#5-einstellungen-optionen-mitgeben)
6. [Besondere Aufgaben: komprimieren, OCR, Schneiden, KI, Untertitel](#6-besondere-aufgaben)
7. [Schritt für Schritt: hochladen, Auftrag, Ergebnis](#7-schritt-für-schritt-hochladen-auftrag-ergebnis)
8. [Links herunterladen (Instagram, YouTube …)](#8-links-herunterladen)
9. [Die Kommandozeile `conbert`](#9-die-kommandozeile-conbert)
10. [Beispiele: Home Assistant, n8n, iPhone, Python, Windows](#10-beispiele)
11. [Fehlermeldungen verstehen](#11-fehlermeldungen-verstehen)
12. [Grenzen und Sicherheit](#12-grenzen-und-sicherheit)
13. [Alle Endpunkte (OpenAPI)](#13-alle-endpunkte-openapi)

---

## 1. Das Wichtigste in einer Minute

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" \
     --data-binary @foto.heic \
     "http://192.168.1.10:3313/api/convert?to=jpg&name=foto.heic" \
     -o foto.jpg
```

- `Authorization: Bearer DEIN_TOKEN` – damit weiß Conbert, wer du bist.
- `--data-binary @foto.heic` – schickt die Datei so, wie sie ist.
- `to=jpg` – das Zielformat.
- `name=foto.heic` – der Originalname (für den Namen des Ergebnisses).
- `-o foto.jpg` – speichert das Ergebnis.

Fertig. Alles Weitere sind Varianten davon.

---

## 2. Ein Token anlegen

1. Öffne Conbert im Browser und melde dich an.
2. Geh auf **Einstellungen → API-Zugang**.
3. Gib bei **„Wofür?“** einen Namen ein, z. B. `Home Assistant` oder
   `Mein Laptop`. So erkennst du später, welches Token wofür ist.
4. Wähl, wie lange es gelten soll (30 Tage, 90 Tage, 1 Jahr oder unbegrenzt).
5. Klick auf **„Token anlegen“**.
6. **Kopier das Token sofort** – es beginnt mit `cbt_` und wird **nur dieses
   eine Mal** angezeigt. Conbert speichert selbst nur einen „Fingerabdruck“
   davon und kann es dir nicht noch einmal zeigen.

Verloren? Kein Problem: altes Token löschen, neues anlegen.

**Was ein Token darf:** alles, was du in Conbert darfst – Dateien umwandeln,
komprimieren, herunterladen, Speicherorte benutzen.
**Was ein Token nicht darf:** Tokens, Benutzer, Passwörter und den
Schlüssel-Tresor verwalten. Gerät ein Token in falsche Hände, kann damit also
niemand dein Konto übernehmen. Lösch es trotzdem sofort, wenn du es nicht
mehr brauchst.

In der Liste siehst du zu jedem Token, wann es angelegt und **zuletzt
benutzt** wurde und wie lange es noch gilt.

---

## 3. Die Adresse deines Servers

Das ist dieselbe Adresse, die du im Browser eingibst, z. B.:

| Situation                                        | Adresse                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| Programm läuft auf demselben Rechner wie Conbert | `http://localhost:3313`                            |
| Im Heimnetz                                      | `http://192.168.1.10:3313` (die IP deines Servers) |
| Über einen Reverse-Proxy mit HTTPS               | `https://conbert.example.de`                       |

In allen Beispielen unten steht `http://192.168.1.10:3313` – ersetz es durch
deine Adresse.

> **Tipp:** Wenn du über das Internet zugreifst, nimm immer **HTTPS**. Sonst
> wird das Token unverschlüsselt übertragen.

**Kurzer Test**, ob alles passt:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" http://192.168.1.10:3313/api/engines
```

Kommt eine lange Liste zurück, stimmt alles. Kommt `INVALID_TOKEN`, ist das
Token falsch kopiert, abgelaufen oder gelöscht.

---

## 4. Eine Datei umwandeln – der einfachste Weg

**`POST /api/convert`** nimmt eine Datei, wandelt sie um und schickt das
Ergebnis direkt zurück – alles in einer Anfrage.

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" \
     --data-binary @urlaub.mov \
     "http://192.168.1.10:3313/api/convert?to=mp4&name=urlaub.mov" \
     -o urlaub.mp4
```

### Die Angaben in der Adresse

| Angabe    | Pflicht?  | Bedeutung                                                                                                                    | Beispiel                 |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `to`      | ja        | Zielformat (Dateiendung ohne Punkt)                                                                                          | `to=webp`                |
| `name`    | empfohlen | Originalname der Datei. Daraus wird der Name des Ergebnisses; bei Text-Formaten (CSV, SVG …) hilft die Endung beim Erkennen. | `name=bericht.docx`      |
| `mode`    | nein      | `convert` (Standard), `compress` (kleiner machen) oder `ocr` (PDF durchsuchbar machen)                                       | `mode=compress`          |
| `options` | nein      | Einstellungen als JSON, siehe [Abschnitt 5](#5-einstellungen-optionen-mitgeben)                                              | `options={"quality":80}` |
| `wait`    | nein      | Wie viele Sekunden Conbert auf das Ergebnis wartet (0–1800, Standard 600)                                                    | `wait=60`                |

### Was zurückkommt

| Antwort                  | Bedeutung                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **200** + Datei          | Fertig. Der Name steht im Kopf `Content-Disposition`, die Auftrags-ID in `X-Conbert-Job`.                                                                           |
| **202** + `{ "job": … }` | Dauert länger als `wait`. Der Auftrag läuft weiter – frag ihn mit `GET /api/jobs/{id}` ab (siehe [Abschnitt 7](#7-schritt-für-schritt-hochladen-auftrag-ergebnis)). |
| **400**                  | Leere Datei oder falsche Angaben (z. B. `options` ist kein gültiges JSON).                                                                                          |
| **413**                  | Datei größer als erlaubt (Standard 2 GB).                                                                                                                           |
| **422**                  | Kein Weg in dieses Format, oder die Umwandlung ist fehlgeschlagen. Die Antwort sagt warum.                                                                          |

Welches Format wohin geht, verrät `GET /api/engines` – oder kurz mit der
Kommandozeile: `conbert formats heic` (siehe [Abschnitt 9](#9-die-kommandozeile-conbert)).

> **Wichtig:** Die Umwandlung läuft **immer auf dem Server**. Formate, die
> Conbert nur im Browser kann, gehen über die API nicht.

---

## 5. Einstellungen (Optionen) mitgeben

Alles, was du in der Weboberfläche einstellen kannst, geht auch über die API.
Die Einstellungen kommen als JSON in die Angabe `options`.

**Bild mit Qualität 70:**

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" --data-binary @foto.png \
     "http://192.168.1.10:3313/api/convert?to=jpg&name=foto.png&options=%7B%22quality%22%3A70%7D" \
     -o foto.jpg
```

`%7B%22quality%22%3A70%7D` ist `{"quality":70}`, „URL-kodiert“ (damit die
Sonderzeichen in die Adresse passen). Bequemer geht es mit der
[Kommandozeile](#9-die-kommandozeile-conbert): `--option quality=70`.

### Häufige Einstellungen

| Schlüssel       | Für                 | Werte                                               | Bedeutung                                   |
| --------------- | ------------------- | --------------------------------------------------- | ------------------------------------------- |
| `quality`       | JPG, WebP, AVIF     | 1–100 (Standard 80)                                 | Bildqualität – höher = schöner, aber größer |
| `stripMetadata` | Bilder              | `true`/`false`                                      | Kamera-Daten und GPS-Ort entfernen          |
| `videoQuality`  | Videos              | `high`, `balanced`, `small`                         | Videoqualität                               |
| `resolution`    | Videos, GIF         | `keep`, `2160`, `1440`, `1080`, `720`, `480`, `360` | höchstens so viele Pixel hoch               |
| `fps`           | Videos, GIF         | `keep`, `60`, `30`, `24`, `15`, `10`                | Bilder pro Sekunde                          |
| `removeAudio`   | Videos              | `true`                                              | Ton entfernen                               |
| `audioQuality`  | MP3, OGG, Opus, M4A | `high`, `balanced`, `small`                         | Tonqualität                                 |
| `audioBitrate`  | Musik, Videos       | `auto`, `64` … `320`                                | feste Bitrate in kbit/s                     |
| `channels`      | Musik               | `keep`, `stereo`, `mono`                            | Tonkanäle                                   |

**Alle Einstellungen einer Engine** – mit Standardwerten und erlaubten
Werten – liefert `GET /api/engines`. Mit dem Hilfsprogramm `jq`:

```bash
curl -s -H "Authorization: Bearer DEIN_TOKEN" http://192.168.1.10:3313/api/engines \
  | jq '.engines[] | {id, options: [.options[] | {key, default, values: [.choices[]?.value]}]}'
```

Unbekannte oder unpassende Einstellungen ignoriert Conbert.

---

## 6. Besondere Aufgaben

### Komprimieren (gleiches Format, kleinere Datei)

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" --data-binary @gross.jpg \
     "http://192.168.1.10:3313/api/convert?to=jpg&mode=compress&name=gross.jpg" -o klein.jpg
```

Die Stärke steuerst du über die Einstellungen, z. B. `{"quality":60}`.

### Gescanntes PDF durchsuchbar machen (OCR)

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" --data-binary @scan.pdf \
     "http://192.168.1.10:3313/api/convert?to=pdf&mode=ocr&name=scan.pdf" -o scan-text.pdf
```

Einstellungen: `ocrLanguage` (`deu+eng`, `deu`, `eng`), `ocrRotate`
(`true`/`false`), `ocrDeskew` (`true` = schiefe Seiten geraderücken),
`ocrMode` (`skip`, `redo`, `force`). OCR kann bei vielen Seiten ein paar
Minuten dauern – setz `wait` dann höher.

### Nur einen Teil eines Videos oder Songs

`trimStart` und `trimEnd` in Sekunden, `trimFast: true` schneidet ohne
Neukodierung (nur bei gleichem Format, Anfang ungenau):

```text
options={"trimStart":12.5,"trimEnd":30}
```

Ein Ausschnitt geht auch ins **gleiche Format** (`to=mp4` aus einer MP4) oder
als **GIF/WebP-Animation** (`to=gif`, `to=webp`).

### Hintergrund entfernen, hochskalieren (KI)

```text
options={"removeBackground":true}          → am besten mit to=png
options={"upscale":2}                       → doppelt so groß (oder 4)
options={"removeBackground":true,"upscale":2}
```

Beim ersten Mal lädt der Server das KI-Modell (einmalig bis ~180 MB) – die
erste Anfrage dauert dann länger.

### Sprache in Text oder Untertitel (Whisper)

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" --data-binary @vortrag.mp4 \
     "http://192.168.1.10:3313/api/convert?to=srt&name=vortrag.mp4&wait=1800" -o vortrag.srt
```

Ziele: `srt`, `vtt` (Untertitel) oder `txt` (reiner Text). Einstellungen:
`speechLanguage` (`auto`, `de`, `en`, …), `translateToEnglish` (`true`).
Lange Aufnahmen brauchen Zeit – nimm `wait=1800` oder den Weg aus
[Abschnitt 7](#7-schritt-für-schritt-hochladen-auftrag-ergebnis).

---

## 7. Schritt für Schritt: hochladen, Auftrag, Ergebnis

Für lange Aufträge, große Dateien oder wenn du den Fortschritt anzeigen
willst. Drei Schritte:

**1. Datei hochladen** – `POST /api/files`:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" --data-binary @film.mkv \
     "http://192.168.1.10:3313/api/files?name=film.mkv"
```

Antwort: `{"file":{"id":"3f2b…","name":"film.mkv","ext":"mkv","size":…}}`

**2. Auftrag starten** – `POST /api/jobs` mit JSON:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"fileId":"3f2b…","outputExt":"mp4","mode":"convert","options":{"videoQuality":"small"}}' \
     http://192.168.1.10:3313/api/jobs
```

Antwort: `{"job":{"id":"9a1c…","status":"queued","progress":0,…}}`

**3. Nachfragen, bis er fertig ist** – `GET /api/jobs/{id}`:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" http://192.168.1.10:3313/api/jobs/9a1c…
```

| `status`    | Bedeutung                                                          |
| ----------- | ------------------------------------------------------------------ |
| `queued`    | wartet, bis er dran ist                                            |
| `running`   | läuft – `progress` (0–100) und `stage` zeigen, was gerade passiert |
| `done`      | fertig – `resultName`, `resultSize`                                |
| `error`     | fehlgeschlagen – `error.messageKey` und `error.details`            |
| `cancelled` | abgebrochen                                                        |

Frag nicht öfter als etwa einmal pro Sekunde nach.

**4. Ergebnis holen** – `GET /api/jobs/{id}/result`:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" -OJ http://192.168.1.10:3313/api/jobs/9a1c…/result
```

(`-OJ` speichert unter dem Namen, den Conbert vorgibt.)

**Abbrechen:** `DELETE /api/jobs/{id}`.

> Ergebnisse und hochgeladene Dateien löscht Conbert nach einer Weile wieder
> (Standard: 60 Minuten nach Fertigstellung, einstellbar mit
> `CONBERT_CLEANUP_MINUTES`). Hol sie also zeitnah ab.

---

## 8. Links herunterladen

Wie auf der Seite „Herunterladen“ – nur per Programm.

**Was steckt hinter einem Link?** – `POST /api/downloader/probe`:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
     http://192.168.1.10:3313/api/downloader/probe
```

Antwort: Plattform, Titel, ob Video/Playlist/Profil, Anzahl, ob eine
Anmeldung nötig wäre …

**Herunterladen** – `POST /api/downloader/jobs`:

```bash
curl -H "Authorization: Bearer DEIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://www.instagram.com/reel/ABC123/","targetIds":["ID-DEINES-SPEICHERORTS"],"toList":false}' \
     http://192.168.1.10:3313/api/downloader/jobs
```

| Feld                      | Bedeutung                                                         |
| ------------------------- | ----------------------------------------------------------------- |
| `url`                     | der Link                                                          |
| `quality`                 | `best` (Standard), `1080`, `720`, `480` oder `audio` (nur Ton)    |
| `parts`                   | bei Instagram-Profilen: `posts`, `reels`, `stories`, `highlights` |
| `limit`                   | höchstens so viele Beiträge (Standard 50, höchstens 1000)         |
| `dateAfter`, `dateBefore` | nur aus diesem Zeitraum (`2026-01-31`)                            |
| `targetIds`               | Speicherorte, auf denen die Dateien landen sollen                 |
| `toList`                  | `true` = Dateien bleiben auf dem Server zum Abholen (Standard)    |
| `skipKnown`               | schon einmal Geladenes überspringen (Standard `true`)             |

Die **ID eines Speicherorts** findest du mit
`GET /api/targets` (Feld `id`). Mit `toList: false` musst du mindestens einen
Speicherort angeben.

**Stand abfragen:** `GET /api/downloader/jobs/{id}` – die fertigen Dateien
stehen unter `files` (mit `fileId`). Eine Datei holst du mit
`GET /api/files/{fileId}/content`.

---

## 9. Die Kommandozeile `conbert`

Ein kleines Programm, das dir das Hochladen, Warten und Speichern abnimmt.
Es braucht **Node.js 20 oder neuer** (kostenlos von nodejs.org).

**Herunterladen** – dein Server bietet es selbst an:

```bash
curl -O http://192.168.1.10:3313/cli/conbert.mjs
```

**Einmal anmelden** (speichert Adresse und Token):

```bash
node conbert.mjs login http://192.168.1.10:3313 DEIN_TOKEN
```

Die Angaben liegen danach in `~/.config/conbert/config.json` (Windows:
`%APPDATA%\conbert\config.json`), nur für dich lesbar.

**Umwandeln:**

```bash
node conbert.mjs convert foto.heic --to jpg
node conbert.mjs convert *.wav --to mp3 --option audioQuality=high --out fertig/
node conbert.mjs convert scan.pdf --to pdf --mode ocr
node conbert.mjs convert gross.jpg --to jpg --mode compress --option quality=60
```

| Angabe                           | Bedeutung                                                                |
| -------------------------------- | ------------------------------------------------------------------------ |
| `--to <Format>`                  | Zielformat (Pflicht)                                                     |
| `--out <Ordner>`                 | Ergebnisse dort ablegen (Standard: neben der Originaldatei)              |
| `--mode compress` / `--mode ocr` | komprimieren / PDF durchsuchbar machen                                   |
| `--option schlüssel=wert`        | Einstellung (mehrfach möglich); Zahlen und `true`/`false` werden erkannt |

**Was kann ein Format werden?**

```bash
node conbert.mjs formats heic
```

**Ohne Anmelden**, z. B. in Skripten oder Docker: die Umgebungsvariablen
`CONBERT_URL` und `CONBERT_TOKEN` setzen.

**Rückgabewert:** `0` = alles geklappt, `1` = mindestens eine Datei ist
fehlgeschlagen (oder nicht angemeldet), `2` = falscher Aufruf. Praktisch für
Skripte: `node conbert.mjs convert … || echo "Hat nicht geklappt"`.

Die Meldungen sind deutsch, wenn dein System auf Deutsch steht (`LANG=de…`),
sonst englisch.

Damit du nicht immer `node conbert.mjs` tippen musst (Linux/macOS):

```bash
chmod +x conbert.mjs && sudo mv conbert.mjs /usr/local/bin/conbert
conbert convert foto.heic --to jpg
```

---

## 10. Beispiele

### Bash: alle iPhone-Fotos eines Ordners in JPG

```bash
export CONBERT_URL=http://192.168.1.10:3313
export CONBERT_TOKEN=DEIN_TOKEN
node conbert.mjs convert ~/Bilder/*.HEIC --to jpg --out ~/Bilder/jpg
```

### Windows PowerShell

In PowerShell ist `curl` ein anderer Befehl – nimm `curl.exe`:

```powershell
curl.exe -H "Authorization: Bearer DEIN_TOKEN" --data-binary "@foto.heic" `
  "http://192.168.1.10:3313/api/convert?to=jpg&name=foto.heic" -o foto.jpg
```

Oder mit Bordmitteln:

```powershell
Invoke-WebRequest -Method Post -Headers @{ Authorization = "Bearer DEIN_TOKEN" } `
  -InFile foto.heic -Uri "http://192.168.1.10:3313/api/convert?to=jpg&name=foto.heic" `
  -OutFile foto.jpg
```

### Python

```python
import requests

SERVER = "http://192.168.1.10:3313"
HEADERS = {"Authorization": "Bearer DEIN_TOKEN"}

with open("foto.heic", "rb") as f:
    r = requests.post(f"{SERVER}/api/convert",
                      params={"to": "jpg", "name": "foto.heic", "options": '{"quality":85}'},
                      headers=HEADERS, data=f, timeout=900)
if r.status_code == 200:
    open("foto.jpg", "wb").write(r.content)
else:
    print("Fehler:", r.json()["error"])
```

### Home Assistant

**Einen Link (z. B. von einer Benachrichtigung) auf die NAS herunterladen.**
In `configuration.yaml`:

```yaml
rest_command:
  conbert_download:
    url: 'http://192.168.1.10:3313/api/downloader/jobs'
    method: POST
    headers:
      Authorization: !secret conbert_token # in secrets.yaml: "Bearer cbt_…"
      Content-Type: application/json
    payload: '{"url": "{{ url }}", "targetIds": ["ID-DEINES-SPEICHERORTS"], "toList": false}'
```

Aufruf in einer Automation: Dienst `rest_command.conbert_download` mit
`url: "https://…"`.

**Eine Datei umwandeln** (z. B. ein Kamerabild) geht mit `shell_command` und
curl:

```yaml
shell_command:
  conbert_to_webp: >-
    curl -s -H "Authorization: Bearer DEIN_TOKEN" --data-binary @/config/www/snapshot.jpg
    "http://192.168.1.10:3313/api/convert?to=webp&name=snapshot.jpg" -o /config/www/snapshot.webp
```

### n8n

1. Knoten **HTTP Request** hinzufügen.
2. **Method:** `POST`, **URL:** `http://192.168.1.10:3313/api/convert?to=jpg&name={{ $binary.data.fileName }}`.
3. **Authentication:** „Generic Credential Type“ → „Header Auth“ mit
   Name `Authorization` und Wert `Bearer DEIN_TOKEN`.
4. **Send Body:** an, **Body Content Type:** „n8n Binary File“, Feld `data`.
5. **Options → Response → Response Format:** „File“.

Tipp: In n8n (und Postman) kannst du auch die OpenAPI-Beschreibung
importieren – siehe [Abschnitt 13](#13-alle-endpunkte-openapi).

### iPhone / iPad: Kurzbefehl „Mit Conbert in JPG“

1. Neuer Kurzbefehl, in den Einstellungen „Im Share-Sheet anzeigen“ an,
   Typ „Bilder“ und „Dateien“.
2. Aktion **„Inhalte von URL abrufen“**:
   - URL: `https://conbert.example.de/api/convert?to=jpg&name=bild.heic`
   - Methode: **POST**
   - Header: `Authorization` = `Bearer DEIN_TOKEN`
   - Anfragetext: **Datei** → „Kurzbefehl-Eingabe“
3. Aktion **„In Fotos sichern“** (oder „Datei sichern“).

Für das iPhone brauchst du eine Adresse, die es erreicht – im Heimnetz die
IP, unterwegs eine HTTPS-Adresse über deinen Reverse-Proxy.

> Links aus Instagram, TikTok & Co. kannst du auf dem Handy auch ganz ohne
> API teilen: Conbert als App installieren („Zum Startbildschirm“), dann
> **Teilen → Conbert** – der Link landet direkt auf der Seite „Herunterladen“.
> Das braucht HTTPS.

---

## 11. Fehlermeldungen verstehen

Jede Fehlerantwort sieht so aus:

```json
{
  "error": {
    "code": "NO_SERVER_ROUTE",
    "messageKey": "errors.noServerRoute",
    "details": "png → xyz"
  }
}
```

- `code` – kurz und fest, gut zum Abfragen in Skripten.
- `messageKey` – der Schlüssel des Hilfetextes in Conbert (unter diesem
  Namen steht in der Oberfläche die verständliche Erklärung).
- `details` – technische Einzelheiten, falls vorhanden.

| HTTP | `code`              | Was ist los?                                                                                                   | Was tun?                                                             |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 401  | `UNAUTHORIZED`      | Kein Token mitgeschickt                                                                                        | Kopfzeile `Authorization: Bearer …` ergänzen                         |
| 401  | `INVALID_TOKEN`     | Token falsch, abgelaufen oder gelöscht                                                                         | Neues Token anlegen                                                  |
| 403  | `TOKEN_NOT_ALLOWED` | Das darf ein Token nicht (Tokens, Benutzer, Passwörter verwalten)                                              | Im Browser anmelden                                                  |
| 400  | `BAD_REQUEST`       | Leere Datei oder falsche Angaben                                                                               | Aufruf prüfen; `details` sagt, was nicht passt                       |
| 413  | `FILE_TOO_LARGE`    | Datei größer als erlaubt                                                                                       | Admin kann `CONBERT_MAX_UPLOAD_MB` erhöhen                           |
| 422  | `NO_SERVER_ROUTE`   | Dieses Format kann der Server nicht in das Ziel umwandeln                                                      | Anderes Ziel, oder in der Weboberfläche „Auf diesem Gerät“ versuchen |
| 422  | `CONVERSION_FAILED` | Die Umwandlung ist schiefgegangen; `messageKey` sagt warum (z. B. `errors.encrypted` = Datei hat ein Passwort) | `details` lesen, Datei prüfen                                        |
| 410  | `RESULT_GONE`       | Ergebnis noch nicht fertig oder schon gelöscht                                                                 | Später/früher abholen                                                |
| 503  | `QUEUE_UNAVAILABLE` | Die Warteschlange des Servers (Valkey/Redis) läuft nicht                                                       | Admin: `docker compose ps` prüfen                                    |
| 404  | `NOT_FOUND`         | Adresse oder Auftrag gibt es nicht                                                                             | Adresse und ID prüfen                                                |

---

## 12. Grenzen und Sicherheit

- **Dateigröße:** höchstens 2 GB pro Datei (Admin: `CONBERT_MAX_UPLOAD_MB`).
- **Speicher-Kontingent:** Der Admin kann festlegen, wie viel du gleichzeitig auf dem Server liegen haben darfst. Deinen Stand liefert `GET /api/me/usage` (`usedBytes`, `quotaBytes` – `null` heißt ohne Grenze).
- **Aufbewahrung:** Hochgeladenes und Ergebnisse werden nach
  `CONBERT_CLEANUP_MINUTES` (Standard 60 Minuten) gelöscht.
- **Gleichzeitig:** Der Server arbeitet `CONBERT_JOB_CONCURRENCY` Aufträge
  gleichzeitig ab (Standard 2), weitere warten in der Schlange.
- **Jeder sieht nur seins:** Dateien, Aufträge und Speicherorte gehören dem
  Benutzer, dem das Token gehört.
- **Tokens sind wie Passwörter:** nicht in öffentliche Skripte, Git oder
  Screenshots. In Home Assistant in `secrets.yaml` ablegen.
- **HTTPS** verwenden, sobald es über das Internet geht.
- Ein Token, das du nicht mehr brauchst: **löschen**. Es gilt dann sofort
  nicht mehr.

---

**Für Admins – Überwachung mit Prometheus:** `GET /api/metrics` liefert Kennzahlen
(Aufträge, Speicherplatz, Verbrauch pro Nutzer, Engine-Status) im
Prometheus-Format. Leg dafür als Admin ein Token an und trag es als
Bearer-Token in die Prometheus-Konfiguration ein:

```yaml
scrape_configs:
  - job_name: conbert
    metrics_path: /api/metrics
    authorization: { type: Bearer, credentials: DEIN_ADMIN_TOKEN }
    static_configs: [{ targets: ['192.168.1.10:3313'] }]
```

## 13. Alle Endpunkte (OpenAPI)

Die vollständige, maschinenlesbare Beschreibung aller hier genannten
Endpunkte liegt unter:

```text
http://192.168.1.10:3313/api/openapi.json
```

Sie wird aus denselben Regeln erzeugt, mit denen Conbert jede Anfrage prüft,
und ist deshalb immer aktuell. Du kannst sie importieren in:

- **n8n** und **Postman** (Import → „OpenAPI“),
- den **Swagger Editor** (editor.swagger.io → File → Import URL), um alles
  übersichtlich zu lesen und auszuprobieren.

Diese Anleitung liefert dein Server auch selbst aus: `/docs/api.md` (Link in
**Einstellungen → API-Zugang**). Die Übersicht für Entwickler (alle
Endpunkte, auch die der Weboberfläche) steht im Projekt unter
`docs/spec/api.md`.
