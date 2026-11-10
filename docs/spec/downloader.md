# Spezifikation: Downloader (Social Media & Booru)

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 8. Downloader (Social Media & Booru)

### 8.1 Social Media

**Nur serverseitig** (CORS, Auth, Binaries). Wrapper in `apps/server/src/downloader/`.

| Tool | Einsatz |
|---|---|
| `yt-dlp` | Videos von YouTube, TikTok, X, Reddit, Vimeo, Instagram-Reels u. v. m. |
| `gallery-dl` | Bilder, Galerien, ganze Profile (Instagram, X, Reddit, Pinterest, Tumblr, Pixiv …) |
| `instaloader` | Instagram-Profile, Stories, Highlights, Posts inkl. Metadaten |

Anforderungen:
- URL einfügen → Server erkennt Plattform und Typ (Einzelpost, Profil, Playlist) und zeigt Vorschau (Titel, Thumbnail, Anzahl Elemente) **bevor** heruntergeladen wird.
- Bei Profilen: Auswahl, was geladen wird (Posts / Reels / Stories / Highlights), optional Limit und Zeitraum.
- Heruntergeladene Dateien landen in derselben Dateiliste und können direkt weiterkonvertiert/komprimiert werden.
- **Cookies/Login**: Für private oder login-pflichtige Inhalte kann der Nutzer in den Einstellungen eine `cookies.txt` pro Plattform hinterlegen. Cookies verschlüsselt speichern (Schlüssel aus Umgebungsvariable), nie loggen, nie ans Frontend zurückgeben.
- Keine Passwörter von Social-Media-Konten speichern oder abfragen – nur Cookie-Import.
- Rate-Limits und Wartezeiten zwischen Requests einbauen (konfigurierbar), um Kontosperren zu vermeiden.
- Tools im Container beim Start aktualisierbar machen (`yt-dlp -U` bzw. Button in den Einstellungen), da Plattformen sich oft ändern.
- Im UI ein kurzer Hinweis: Nur Inhalte herunterladen, für die man die Rechte hat bzw. die man privat nutzen darf.
- Laienfreundliche Anleitung im Tool, wie man eine `cookies.txt` exportiert (Schritt für Schritt mit Screenshots-Platzhaltern, Browser-Erweiterung nennen).

**Pixiv** (ergänzt 2026-10-30 auf Wunsch des Nutzers):
- Einzelwerke, Künstlerprofile, Tag-Suchen und Lesezeichen über `gallery-dl` (yt-dlp kennt Pixiv nicht). Downloads landen unter `Pixiv/<Künstler>` bzw. `Pixiv/Tag <Tag>`; Profile und Tag-Suchen lassen sich als Abo speichern (höchstens stündlich).
- **Anmeldung über einen Refresh-Token statt Cookies** (Ausnahme von „nur Cookie-Import“): Die App-API von Pixiv kennt keine Cookies. Der Nutzer meldet sich auf der Pixiv-Seite selbst an (Conbert sieht das Passwort nie), kopiert den Einmal-Code aus der Browser-Konsole und fügt ihn ein; der Server tauscht ihn gegen den Token (PKCE, wie `gallery-dl oauth:pixiv`). Im Expertenmodus kann ein vorhandener Token direkt eingefügt werden. Token verschlüsselt gespeichert, nie geloggt, nie zurückgegeben; an gallery-dl nur als temporäre Konfigurationsdatei, nie auf der Kommandozeile.
- **Ugoira** (animierte Pixiv-Bilder) werden per ffmpeg zu MP4 (Standard), GIF oder WebM umgewandelt oder als Einzelbilder (ZIP) behalten.
- Werke ab 18 (R-18/R-18G) sind standardmäßig ausgefiltert und nur per Schalter ladbar.

**DeviantArt** (ergänzt 2026-11-05):
- Einzelwerke, Galerien, Favoriten und Profile nur über `gallery-dl` (yt-dlp kennt DeviantArt nicht). Downloads landen unter `DeviantArt/<Name>`; Abos höchstens stündlich.
- gallery-dl nutzt die offizielle DeviantArt-API mit seiner eingebauten Client-ID, die sich alle gallery-dl-Nutzer teilen. Sie läuft oft ins Limit (`429 application_api_threshold`); gallery-dl wartet dann immer länger (bis 30 s pro Anfrage), bricht aber nicht ab. Ohne Anmeldung (Refresh-Token) überspringt die API Mature- und private Werke. **Cookies helfen dabei nicht** (sie gelten nur für die Web-Schnittstelle, z. B. Scraps), deshalb keine DeviantArt-Cookies in der Cookie-Verwaltung.
- **Eigener Zugang + Anmeldung** (Nutzerwunsch 2026-11-05, Ausnahme von „nur Cookie-Import“ wie bei Pixiv): Unter Einstellungen → Herunterladen → „DeviantArt-Zugang“ trägt der Nutzer Client-ID und Secret seiner eigenen DeviantArt-App ein (Anleitung im UI; Redirect-URI der App = gallery-dls Weiterleitungsseite `https://mikf.github.io/gallery-dl/oauth-redirect.html`). Conbert prüft die App per `client_credentials` und speichert sie verschlüsselt; damit gilt das API-Limit nur für den Nutzer. Optional danach „Bei DeviantArt anmelden“: Login auf der DeviantArt-Seite (PKCE + state), der Tab landet auf `http://localhost:6414/?code=…`, der Nutzer fügt die Adresse ein, der Server tauscht sie gegen den Refresh-Token. App und Token gehen nur per temporärer gallery-dl-Konfigurationsdatei an gallery-dl, nie auf die Kommandozeile; das Secret wird nie zurückgegeben (nur die Client-ID).

**Abos für Profile, Kanäle und Threads** (ergänzt 2026-10-30 auf Wunsch des Nutzers):
- Ein geprüfter Link zu einem Profil, Kanal, einer Playlist oder einem 4chan-Thread lässt sich **„Als Abo speichern“**. Der Server sieht im gewählten Abstand nach (10 Minuten bis täglich; Instagram höchstens stündlich, um Kontosperren zu vermeiden) und lädt **nur, was neu ist** – über das Download-Archiv von yt-dlp bzw. gallery-dl (eine Datei pro Abo).
- „Nur Neues ab jetzt“ (Standard): Die erste Prüfung merkt sich nur, was schon da ist. Sonst lädt sie die neuesten Beiträge bis zur Höchstzahl.
- Qualität, Profil-Teile, Höchstzahl pro Prüfung, Ziel (Liste/Speicherorte) und „Danach automatisch …“ wie beim normalen Download; Benachrichtigung bei Neuem, bei Fehlern und wenn ein Thread endet (archiviert/gelöscht → Abo endet von selbst).
- Seite **„Abos“**: Übersicht aller Abos (Profile/Kanäle/Threads und Booru-Tag-Suchen) mit Status, letzter/nächster Prüfung, „Jetzt nachsehen“, Pausieren, Abstand ändern, Löschen.

### 8.2 Booru-Seiten

Download von Bild-Boards im Booru-Stil, **einzeln per URL oder als Crawl nach Tags**.

**Unterstützte Seiten** (über `gallery-dl`, das diese Seiten nativ kennt): Safebooru, Gelbooru, Konachan, yande.re, Zerochan. (Danbooru und e621/e926 sind seit 2026-10 nicht mehr vorgegeben, weil sie Server-Abrufe per Cloudflare sperren – auch mit Konto; ihre APIs bleiben für eigene Instanzen wählbar.) Zusätzlich **eigene Instanzen** eintragbar (Typ wählen: Danbooru-, Gelbooru- oder Moebooru-API + Basis-URL), damit auch selbst gehostete Boorus funktionieren. Wo gallery-dl etwas nicht abdeckt, eigener schlanker Adapter auf Basis der offiziellen JSON-API der Seite.

**Tag-Suche & Crawl:**
- Eingabefeld für Tags mit **Autovervollständigung** über die API der Seite (inkl. Anzahl Treffer pro Tag und Tag-Kategorie wie Künstler, Figur, Serie, allgemein – farbig markiert).
- Unterstützt die Such-Syntax der Seite: mehrere Tags (UND), Ausschluss mit `-tag`, `order:score`, `score:>50`, Seitengrößen-Filter usw. Für Laien zusätzlich ein **Formular** (Tags hinzufügen / ausschließen, Mindest-Score, Mindest-Auflösung, Zeitraum, Sortierung, Dateityp Bild/Animation/Video), das die Syntax automatisch erzeugt. Beide Ansichten sind synchron.
- **Rating-Filter** (General / Sensitive / Questionable / Explicit bzw. Safe/Questionable/Explicit je nach Seite). Standard: nur jugendfreie Inhalte. Nicht jugendfreie Ratings müssen in den Einstellungen ausdrücklich freigeschaltet werden (mit Altersbestätigung) und lassen sich per Passwort sperren.
- **Limit** für die Anzahl der Posts (Standard 50, höchstens 50.000, Hinweis ab 200), damit niemand versehentlich zehntausende Dateien lädt.
- **Vorschau-Raster** vor dem Download: Thumbnails der Treffer, einzeln an- und abwählbar, „Alle auswählen“, geschätzte Gesamtgröße.
- Seitenlimits der APIs beachten (z. B. maximale Seitenzahl ohne Account) und dem Nutzer verständlich erklären, wenn ein Account/API-Key mehr Ergebnisse erlauben würde.

**Pflicht-Schutz (nicht abschaltbar):**
- Eine fest eingebaute, **nicht deaktivierbare Sperrliste** verhindert Suche, Anzeige und Download von Inhalten, die Minderjährige sexualisieren. Geprüft wird sowohl die Suchanfrage als auch **jeder einzelne Treffer** anhand seiner Tags und seines Ratings, bevor ein Thumbnail angezeigt oder eine Datei geladen wird. Diese Regel steht über allen Nutzereinstellungen und gilt auch für Abos und Workflows.
- Zusätzlich eine **eigene Blacklist** pro Nutzer (Tags, die nie geladen oder angezeigt werden sollen), vorausgefüllt mit sinnvollen Vorschlägen.

**Speichern & Metadaten:**
- Dateinamens-Muster wählbar, z. B. `{site}_{id}_{artist}.{ext}` oder `{md5}.{ext}`, mit Live-Beispiel.
- Ordner-Muster, z. B. `{site}/{search_tags}/` oder `{artist}/`.
- Tags optional als **Sidecar-Datei** speichern: `.json` (vollständige Metadaten), `.txt` (Tags kommagetrennt, z. B. für Bildkataloge oder KI-Datensätze) oder direkt als **XMP/IPTC-Schlagwörter** in die Bilddatei (dann in Bildverwaltungen wie digiKam oder Lightroom durchsuchbar).
- Quelle, Künstler und Original-URL immer in den Metadaten mitspeichern.
- **Duplikat-Schutz**: Boorus liefern MD5-Hashes mit → schon vorhandene Dateien überspringen. Download-Archiv pro Seite (wie `gallery-dl --download-archive`), damit bei erneutem Crawl nur Neues geladen wird.
- Höchste verfügbare Auflösung (Original) laden, optional „Sample“-Version für kleineren Speicherbedarf.

**Abos (Tag-Überwachung):**
- Eine Tag-Suche als **Abo** speichern: Server prüft in einem einstellbaren Intervall (Standard täglich) auf neue Posts und lädt nur diese. Benachrichtigung über neue Treffer (siehe Abschnitt 11.1).
- Abos lassen sich pausieren, mit Workflow verknüpfen und auf ein Speicherziel legen.

**Langsam-Modus (für Nutzer ohne Premium-Account):**

Viele Boorus begrenzen kostenlose oder anonyme Nutzer, z. B. auf wenige Tags pro Suche, eine maximale Seitenzahl bei der Blätter-Navigation oder wenige Anfragen pro Sekunde. Der Langsam-Modus holt trotzdem alle Treffer, **indem er sich strikt an diese Grenzen hält und dafür einfach mehr Zeit braucht**.

- **Automatische Erkennung**: Ohne API-Key bzw. bei Fehlern wie „zu viele Tags“ oder „Seitenlimit erreicht“ schlägt das Tool den Langsam-Modus vor. Manuell immer auswählbar: „Normal“, „Langsam“, „Sehr langsam (über Nacht)“.
- **Zu viele Tags**: Nur so viele Tags an die API senden, wie das Konto erlaubt (die seltensten bzw. treffschärfsten zuerst, Trefferzahlen kommen aus der Autovervollständigung). Die übrigen Tags, Ausschlüsse und Filter werden **lokal auf dem Server** auf die Ergebnisse angewendet. Im UI erklären: „Dein Konto erlaubt nur 2 Tags pro Suche. Die anderen Tags prüfen wir selbst – das dauert länger, weil mehr Posts durchgesehen werden müssen.“ Vorab eine grobe Schätzung anzeigen, wie viele Posts durchsucht werden müssen.
- **Seitenlimit**: Statt Seitenzahlen die **ID-basierte Navigation** der API nutzen, sofern die Seite sie anbietet (z. B. Danbooru `page=b<id>`, „alle Posts älter als ID X“). So gibt es kein Blätterlimit, und ein Crawl kann exakt dort weitermachen, wo er aufgehört hat.
- **Tempo**: Pro Seite feste Mindestabstände zwischen Anfragen (Standard „Langsam“: 1 Anfrage alle 2 s, „Sehr langsam“: alle 10 s), konfigurierbar, aber nie schneller als die von der Seite dokumentierten Limits. Bei HTTP 429/503 oder `Retry-After` automatisch exponentiell abwarten und danach weitermachen.
- **Fortsetzbar**: Crawl-Zustand (letzte ID, bereits geprüfte Posts, Fortschritt) in SQLite speichern. Server-Neustart, Pause oder Internet-Ausfall unterbrechen nur; danach läuft der Crawl automatisch weiter. Button „Pausieren / Fortsetzen“.
- **Zeitfenster** optional: nur nachts crawlen (z. B. 1–7 Uhr), damit Netz und Seite tagsüber nicht belastet werden.
- **Fortschrittsanzeige in Laiensprache**: „4.312 Posts durchgesehen, 287 passen, 251 geladen – voraussichtlich noch ca. 3 Stunden.“ Gefundene Bilder erscheinen schon während des Crawls im Vorschau-Raster.
- Läuft vollständig serverseitig im Hintergrund (BullMQ-Job), der Browser kann geschlossen werden; Benachrichtigung, wenn fertig.
- **Grenze**: Der Langsam-Modus umgeht keine Sperren. Keine Proxy-Rotation, keine wechselnden Accounts, kein Umgehen von CAPTCHAs oder Cloudflare-Prüfungen, keine Inhalte, die der Account nicht sehen darf. Wenn eine Seite den Zugriff blockiert, Crawl pausieren und dem Nutzer verständlich erklären, warum.

**Accounts & Fairness:**
- Optional Benutzername + **API-Key** pro Seite (Danbooru, e621, Gelbooru bieten das an). Verschlüsselt speichern wie die Cookies.
- Eigenen, ehrlichen User-Agent senden (e621 verlangt das z. B. ausdrücklich), Rate-Limits der Seiten einhalten, parallele Downloads pro Seite begrenzen (Standard 2).

### 8.3 Direkt weiterverarbeiten

Jeder Download (Social Media, Booru, Einzel-URL, Abo) kann **sofort mit einem Workflow verknüpft** werden, z. B. „Herunterladen → in WebP umwandeln → komprimieren → auf NAS speichern“. Im Download-Dialog gibt es dafür den Punkt **„Danach automatisch …“** mit Auswahl eines gespeicherten Workflows oder einer schnellen Einzelaktion („In … umwandeln“, „Komprimieren“). Details siehe Abschnitt 11.
