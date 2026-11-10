# Spezifikation: API (Server)

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 13. API (Server)

```
GET    /api/health
GET    /api/engines                    # verfügbare Server-Engines + Formate + Status
POST   /api/upload                     # Chunked/resumable Upload (tus-Protokoll empfohlen)
POST   /api/jobs                       # { fileId, outputExt, mode: 'convert'|'compress'|'ocr', options, attachments?: { optionKey: fileId }, targets?: string[] }
GET    /api/jobs/:id
DELETE /api/jobs/:id                   # abbrechen
GET    /api/jobs/:id/result            # Download
POST   /api/jobs/batch/zip             # mehrere Ergebnisse als ZIP
WS     /api/ws                         # Fortschritts-Events
POST   /api/downloader/probe           # { url } → Metadaten/Vorschau
POST   /api/downloader/jobs            # { url, selection, limits, workflowId? }
GET    /api/booru/sites                # bekannte + eigene Booru-Instanzen
GET    /api/booru/:site/autocomplete?q=
POST   /api/booru/:site/search         # { tags, filters, page } → Treffer (bereits gefiltert)
POST   /api/booru/:site/jobs           # { tags | postIds, filters, limit, speed: 'normal'|'slow'|'very-slow', schedule?, naming, sidecar, workflowId?, targetIds? }
POST   /api/booru/jobs/:id/pause | /resume
GET/POST/PUT/DELETE /api/subscriptions # Tag-Abos
GET/POST/PUT/DELETE /api/workflows
POST   /api/workflows/:id/run          # { fileIds }
POST   /api/workflows/:id/test         # Testlauf mit einer Datei
GET/POST/PUT/DELETE /api/notifications/channels
GET    /api/settings / PUT /api/settings
GET    /api/targets                    # Speicherorte (ohne Zugangsdaten!)
POST   /api/targets                    # anlegen
PUT    /api/targets/:id / DELETE /api/targets/:id
POST   /api/targets/:id/test           # Verbindung testen
GET    /api/targets/:id/browse?path=   # Ordner auflisten
POST   /api/targets/:id/import         # Datei von Quelle laden → fileId
POST   /api/jobs/:id/export            # fertiges Ergebnis nachträglich an Ziel senden
GET/POST /api/downloader/feeds         # Abos für Profile, Kanäle, Threads (ergänzt 2026-10-30)
PUT/DELETE /api/downloader/feeds/:id
POST   /api/downloader/feeds/:id/check # „Jetzt nachsehen“
GET/PUT/PATCH/DELETE /api/keys/me      # eigener Schlüssel: öffentlicher Schlüssel + verschlossener privater (nur scrypt-verschlossen angenommen)
GET    /api/keys/directory             # öffentliche Schlüssel anderer Nutzer, die sie freigegeben haben
```

Alle Request/Response-Bodies sind über Zod-Schemas in `packages/schemas` definiert.

### Medien-Index & Swipen (2026-10-30)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/media/status` | Standard-Speicherort, Anzahl Dateien/unsortiert/Favoriten, letzter Abgleich, läuft gerade? |
| POST | `/api/media/sync` | Abgleich starten (läuft im Hintergrund) |
| GET / POST | `/api/media/reorganize` | Vorschlag zum Aufräumen alter Ordner / ausgewählte Verschiebungen ausführen |
| GET | `/api/swipe/sources?mode=` | Ordnerbaum (Plattform → Quelle → Unterordner) mit Anzahl |
| GET | `/api/swipe/next?mode=&folders=&sorted=&count=&exclude=` | zufällige Karten |
| POST | `/api/swipe/action` | `{ itemId, action }` – delete, keep, favorite, unfavorite, premium |
| POST | `/api/swipe/undo` | neueste wartende Entscheidung zurücknehmen |
| POST | `/api/swipe/flush` | alle wartenden Entscheidungen ausführen |

`PATCH /api/targets/:id` (2026-10-30): Schnellbearbeitung ohne Verbindung – `{ name?, usage?: { asTarget, asSource }, isDefault? }`; mindestens eine Nutzung bleibt an, Verbindung und Passwörter bleiben unverändert.

### Skripte, Tokens & CLI (2026-11-03)

Anmeldung für Skripte: `Authorization: Bearer cbt_…` (Token unter Einstellungen → API-Zugang, nur einmal angezeigt, gespeichert als SHA-256; Ablauf 30/90/365 Tage oder unbegrenzt). Tokens dürfen alles wie der Nutzer, außer `/api/tokens`, `/api/users`, `/api/groups`, `/api/admin/ldap`, `/api/auth/*` (außer `status`) und `/api/keys` → `403 TOKEN_NOT_ALLOWED`. Falsches/abgelaufenes Token → `401 INVALID_TOKEN`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST | `/api/tokens` | eigene Tokens auflisten / anlegen `{ name, expiresInDays: 30\|90\|365\|null }` → `{ token, secret }` |
| DELETE | `/api/tokens/:id` | Token löschen |
| POST | `/api/files?name=` | Datei als roher Body (beliebiger Content-Type) → `{ file }` |
| POST | `/api/convert?to=&name=&mode=&options=&wait=` | roher Body → wartet und liefert das Ergebnis (200), dauert es länger: `202 { job }`; Fehler `422` mit Text-Schlüssel |
| GET | `/api/openapi.json` | OpenAPI 3.1, aus den Zod-Schemas erzeugt (ohne Anmeldung) |
| GET | `/cli/conbert.mjs` | Kommandozeile zum Herunterladen (Node 20+) |
| GET | `/share?title=&text=&url=` | Teilen-Ziel der installierten Web-App → Downloader mit dem ersten Link |

Job-Schritte können `withOptions: true` tragen (KI-Schritt vor der Umwandlung bekommt die Optionen). Job-Modus `ocr` (PDF → durchsuchbares PDF). Weitere Endpunkte seit Phase 11: `/api/media/similar` (+`/scan`), `/api/whisper` (+`/default`, `/models/:id/download`, `DELETE /models/:id`), `/api/image-ai` (+`/models/:id/download`, `DELETE /models/:id`).

### Kontingente & Admin-Übersicht (2026-11-03)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/me/usage` | `{ usedBytes, quotaBytes }` – eigener Verbrauch auf dem Server (null = ohne Grenze) |
| GET | `/api/admin/overview` | Admin: System, Speicher, Nutzer mit Kontingenten, Aufträge, Downloads, Engines, KI-Modelle |
| PUT | `/api/admin/quota-default` | Admin: `{ bytes: number \| null }` – Standard-Kontingent |
| PUT | `/api/admin/users/:id/quota` | Admin: `{ quota: 'default' \| 'unlimited' \| number }` |
| GET | `/api/metrics` | Admin: Prometheus-Textformat (mit dem API-Token eines Admins abrufbar) |

Uploads, `/api/files`, `/api/convert`, `/api/targets/:id/import` und `/api/downloader/jobs` antworten bei vollem Kontingent mit `413 QUOTA_EXCEEDED`.

### Gruppen, Funktionsrechte & LDAP (2026-11-10)

Funktionen (`FEATURES` in `packages/schemas/src/permissions.ts`): `convert`, `serverConvert`, `downloader`, `booru`, `workflows`, `storage`, `media`, `ai`, `workshop`, `pdf`, `apiTokens`. Wirksam: Admin → alles; sonst Nutzer-Übersteuerung (`allow`/`deny`) vor Gruppen; erlaubt, solange keine Gruppe des Nutzers sie sperrt (Gruppen-`permissions`: `false` = gesperrt, fehlend = offen). Eingebaute Gruppe `everyone` (jeder Nutzer) erlaubt fest alles, ihre `permissions` lassen sich nicht ändern (`400 GROUP_BUILTIN`). Der Server sperrt nach Pfad (Session, Proxy und API-Token) → `403 FEATURE_FORBIDDEN`: `/api/jobs`, `/api/convert` (serverConvert), `/api/downloader` (downloader), `/api/booru`, `/api/subscriptions` (booru), `/api/workflows`, `/api/workflow-runs` (workflows), `/api/targets` (storage), `/api/media`, `/api/swipe` (media), `/api/tokens` (apiTokens); KI (Whisper, image-ai) beim Start eines Auftrags. `workshop`, `pdf` und lokales `convert` werden nur in der Oberfläche ausgeblendet. `UserDto` hat `authSource` (`local`/`ldap`/`proxy`) und `permissions` (wirksam); in der Admin-Liste zusätzlich `groups`, `permissionOverrides`, `disabled`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST | `/api/groups` | Admin: Gruppen mit Mitgliedern (`source`: manual/ldap/proxy) / anlegen |
| PATCH/DELETE | `/api/groups/:id` | Admin: Name, Beschreibung, `permissions`, `grantsAdmin`, `proxyName` / löschen (`everyone` → `400 GROUP_BUILTIN`) |
| PUT | `/api/groups/:id/members` | Admin: `{ userIds }` – nur von Hand gewählte Mitglieder |
| PATCH | `/api/users/:id` | zusätzlich `permissionOverrides`, `groupIds` (von Hand); Passwort nur bei lokalen Konten (`400 LDAP_MANAGED`) |
| GET/PUT | `/api/admin/ldap` | Admin: LDAP-Einstellungen (`hasBindPassword`, nie das Passwort; `bindPassword` weglassen = behalten, `''` = löschen) |
| POST | `/api/admin/ldap/test` | Admin: `{ settings, username?, password? }` – ungespeichert testen → Anzahl Nutzer/Gruppen, Test-Anmeldung |
| GET | `/api/admin/ldap/groups?q=` | Admin: Gruppen im Verzeichnis (max. 300) |
| POST | `/api/admin/ldap/import` | Admin: `{ dns }` – als Conbert-Gruppen übernehmen, danach Abgleich |
| POST | `/api/admin/ldap/sync` | Admin: Abgleich jetzt (Gruppen, Anzeigenamen, verschwundene Konten → `disabled`) |

`POST /api/auth/login`: lokales Konto mit Passwort zuerst; sonst LDAP (wenn eingeschaltet). Ein lokales Konto wird nie von LDAP übernommen. Verzeichnis nicht erreichbar → `502 LDAP_UNREACHABLE` (nur für Nicht-lokale Namen). `/api/auth/status` meldet `ldap: true`, wenn LDAP an ist. Proxy-Modus: `CONBERT_PROXY_GROUPS_HEADER` (Komma oder `|` getrennt, nur von vertrauenswürdigen Proxys) ordnet Gruppen über `proxyName` zu.
