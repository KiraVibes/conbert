# Spezifikation: FileWizard-Werkstatt & weitere Funktionen

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 12. Weitere Funktionen & FileWizard-Werkstatt

### 12.1 FileWizard-Werkstatt 🧙

Ein eigener Bereich **„Werkstatt“** mit verspielten, aber nützlichen Datei-Tricks. Jeder Trick bekommt eine Karte mit Icon, kurzem witzigen Teaser, einer **Erklärung, wie der Trick technisch funktioniert** (Lerneffekt!) und, wo sinnvoll, einem Gegenstück zum Aufdecken. Alles läuft, wenn möglich, **lokal im Browser**. Jeder Trick ist ein eigenes Modul in `features/workshop/<trick>/` und als Workflow-Schritt nutzbar. Die eigentliche Trick-Logik ist eine reine TypeScript-Funktion ohne Browser- oder Node-Abhängigkeiten (läuft in beiden), damit derselbe Code lokal im Browser und serverseitig in Workflows arbeitet.

**Verstecken & Aufdecken**
| Trick | Beschreibung |
|---|---|
| **Archiv im Bild** | Klassiker `copy /b bild.jpg + archiv.rar`: Ein ZIP/RAR/7Z wird ans Ende eines JPG/PNG/GIF gehängt. Das Bild öffnet sich normal, mit WinRAR/7-Zip öffnet sich das Archiv. Gegenstück: angehängte Archive erkennen und extrahieren. Hinweis, welche Kombinationen zuverlässig funktionieren (ZIP am besten, da das Inhaltsverzeichnis am Dateiende liegt). |
| **Steganografie (LSB)** | Text oder eine ganze Datei unsichtbar in den Pixeln eines PNG/BMP verstecken, optional mit Passwort (AES-GCM, Schlüssel per PBKDF2/Argon2). Anzeige, wie viel Platz das Bild bietet. Warnung: Nach JPG-Konvertierung oder Upload in Messenger geht der Inhalt verloren. |
| **Audio-Steganografie** | Text/Datei in WAV/FLAC verstecken (LSB der Samples). |
| **Bild im Spektrogramm** | Ein Bild wird in Töne umgewandelt, sodass es im Spektrogramm-Viewer (z. B. Audacity, oder direkt in Conbert) sichtbar wird – wie bei Aphex Twin. Gegenstück: Spektrogramm-Ansicht jeder Audiodatei. |
| **Geheimbotschaft in Metadaten** | Text in EXIF/XMP-Kommentare, ID3-Tags oder PDF-Eigenschaften schreiben bzw. auslesen. |
| **Polyglot-Dateien** | Dateien, die gleichzeitig zwei gültige Formate sind (z. B. GIF + ZIP, PDF + ZIP) – mit Erklärung, warum das geht. Nur harmlose Kombinationen aus Bild/Dokument + Archiv; keine ausführbaren Formate (EXE, Skripte, HTML mit JS). |
| **Unsichtbarer Text** | Botschaften mit Zero-Width-Zeichen in normalem Text verstecken und auslesen; Tool zum Aufspüren solcher Zeichen in kopierten Texten. |
| **Detektiv-Scan** | Untersucht eine beliebige Datei auf Versteckte: angehängte Daten nach dem Dateiende, eingebettete Dateien (Signatur-Suche wie binwalk), auffällige LSB-Muster, versteckte Metadaten, Zero-Width-Zeichen. Ergebnis als verständlicher Bericht mit Extrahieren-Buttons. |

**Datei-Röntgen**
| Trick | Beschreibung |
|---|---|
| **„Was ist diese Datei wirklich?“** | Erkennung über Magic Bytes statt Endung, Warnung bei falscher Endung („Das ist kein PDF, sondern ein ZIP“), Reparaturvorschlag (Endung korrigieren). |
| **Hex-Viewer** | Virtualisierte Hex-/ASCII-Ansicht auch für große Dateien, Header-Strukturen farbig markiert und erklärt (PNG-Chunks, ZIP-Einträge, JPEG-Marker). |
| **Hashes & Prüfsummen** | MD5, SHA-1, SHA-256, SHA-512, CRC32, BLAKE3; Vergleich mit eingefügtem Hash („✅ Datei ist unverändert“). |
| **Datei-Entropie** | Grafik, wie „zufällig“ die Datei ist – erklärt, warum komprimierte/verschlüsselte Daten nicht weiter schrumpfen. |
| **Vergleichen** (ergänzt 2026-11-14) | Zwei Dateien: erst Byte für Byte (identisch? erste Abweichung, Anzahl), dann je nach Art: Texte als Zeilen-Diff (Myers, gleiche Abschnitte eingeklappt, bis 10 MB), Bilder mit Schieberegler, Unterschiedsmaske mit Toleranz und Nebeneinander (andere Größe → B wird skaliert, mit Hinweis), sonst Liste der abweichenden Stellen mit Hex-Ausschnitt. Alles im Browser. |

**Schutz, Prüfen & Reparieren** (ergänzt 2026-10-30 auf Wunsch des Nutzers)
| Trick | Beschreibung |
|---|---|
| **Schlüssel-Tresor** | Jedes Konto kann ein Schlüsselpaar (age, X25519) anlegen. Der private Schlüssel entsteht im Browser und wird dort mit einem eigenen Tresor-Passwort verschlüsselt, bevor er auf dem Server landet. Dateien verschlüsselt man für sich selbst, für andere Nutzer der Instanz (nur wenn diese ihren öffentlichen Schlüssel freigegeben haben) oder für einen eingefügten age-Schlüssel. **Kontaktbuch** (pro Nutzer, Tabelle `age_contacts`): öffentliche Schlüssel mit Name und Notiz speichern (Tab „Kontakte“ im Werkzeug und Einstellungen → Kontaktbuch), beim Verschlüsseln per Häkchen wählen; eingefügte unbekannte Schlüssel lassen sich direkt „als Kontakt speichern“; der eigene öffentliche Schlüssel steht dort zum Kopieren. Ergebnis: `.age`-Dateien, die auch das `age`-Programm öffnet. Workflow-Schritt „Für Empfänger verschlüsseln“ (Parameter `self`, `userIds`, `contactIds`, `recipients`; Kontakte werden beim Lauf aus dem Kontaktbuch des Workflow-Besitzers gelesen, gelöschte entfallen). |
| **Privatsphäre-Check** | „Was verrät meine Datei?“: GPS, Seriennummern, Software, Autor, Kommentare/Änderungsverlauf in Office-Dateien, PDF-Metadaten, ein EXIF-Vorschaubild, das noch Weggeschnittenes zeigt – mit „Alles entfernen“. |
| **Datei-Reparatur** | Prüfsummen in PNG neu berechnen, abgeschnittene PNG/JPEG wieder öffnbar machen, falsche Endung korrigieren, angehängte Daten abschneiden – jeweils mit Erklärung, was kaputt war. |
| **Fälschungs-Detektor (ELA)** | Fehlerlevel-Analyse für JPEGs: zeigt Bereiche, die anders komprimiert sind als der Rest (Hinweis auf Bearbeitung). Ehrlich erklärt: ein Hinweis, kein Beweis. |
| **Schatzkarte & Geheimschrift** | Ein Geheimnis in N Teile zerlegen, von denen K zum Wiederherstellen reichen (Shamir). Dazu Caesar/ROT13, Vigenère, Atbash, Morse (auch als Ton) und Braille – mit „So knackt man das“, weil das keine echte Verschlüsselung ist. |

**Ergänzungen bestehender Tricks:** Der Detektiv-Scan holt Funde heraus (Teile der Datei, einzelne Dateien aus versteckten ZIPs); „Archiv im Bild“ kann versteckte ZIPs mit Passwort (AES-256) schützen und schreibt die ZIP-Positionen so um, dass auch Windows-Explorer/macOS das Archiv öffnen. Die Grenzen unten gelten für alle Verstecken-Tricks: keine ausführbaren Dateien oder Skripte verstecken.

**Spaß mit Bildern, Audio & Video**
- **ASCII-/ANSI-Art** aus Bildern (auch farbig, als Text, HTML oder Bild exportierbar), **Emoji-Mosaik**, **Pixel-Art-Konverter** mit Retro-Paletten (Game Boy, C64, NES).
- **Deep-Fry / Meme-Filter**, **„JPEG bis zur Unkenntlichkeit“** (Bild 100× neu komprimieren, Zwischenschritte als Animation).
- **Glitch-Art**: gezielte Byte-Manipulation („Datamoshing“) für Bilder und Videos, mit Erklärung.
- **GIF rückwärts / Bumerang**, Video als Sprite-Sheet oder Kontaktbogen, Bild-Collage.
- **Audio zu Video** (ergänzt 2026-11-14): Tondatei + optionales Cover → MP4/WebM mit Wellenform, Frequenz-Säulen, Spektrum oder nur Bild (Engine `audio-video`, nur Server; auch über „Umwandeln“ und in Workflows).
- **Audio rückwärts**, Tonhöhe/Tempo ändern („Chipmunk“), Klingelton-Maker (Ausschnitt + Fade + M4R/MP3).
- **Icon- & Favicon-Generator**: ein Bild → ICO, ICNS, alle Favicon-Größen + `manifest.json`.
- **QR-Codes** erstellen (Text, WLAN-Zugang, Kontakt) mit Logo in der Mitte, und QR/Barcodes aus Bildern lesen.

**Datei-Werkzeuge**
- **Datei-Splitter/Joiner** (z. B. für Upload-Limits, auch als gesplittetes 7Z/ZIP).
- **Passwortgeschützte Archive** erstellen (7Z/ZIP mit AES-256).
- **Base64 / Hex / URL-Encoding** für Dateien und Text, **Data-URI-Generator**.
- **Text-Werkzeuge**: Zeichenkodierung erkennen und umwandeln (z. B. kaputte Umlaute „FÃ¼r“ → „Für“ reparieren), Zeilenenden CRLF ↔ LF.
- **Bilder herausholen** (ergänzt 2026-11-14): alle Bilder aus ZIP-basierten Dokumenten (DOCX/PPTX/XLSX, ODT/ODP/ODS, EPUB, CBZ, Pages/Keynote/Numbers, ZIP) unverändert auspacken; aus PDFs JPEG/JPEG 2000 unverändert, Flate-Rohpixel (Grau/RGB/CMYK, 8 Bit, auch mit PNG-Prädiktor) als PNG. Masken, Paletten-/Sonderfarbräume, CCITT/JBIG2 werden übersprungen und gezählt; Vorschaubilder der App sind abgewählt; Auswahl als ZIP. Im Browser.
- **Testdateien** (ergänzt 2026-11-14): Dateien in exakter Größe (Nullen, Zufallsdaten, Textzeilen; bis 4 GB, frei wählbare Endung), Testbild (Farbbalken, Grauverlauf, Gitter mit Kreis, roter Rand; PNG/JPG/WebP), Testton (440 Hz, Frequenz-Lauf, Piepton pro Sekunde, links/rechts; WAV), Test-PDF mit nummerierten A4-Seiten, Testvideo (Farbbalken, Uhr, Bildnummer, Piepton; MP4/WebM über WebCodecs). Alles im Browser.

**Grenzen der Werkstatt:** Keine Tricks, die ausführbaren Code tarnen (EXE in Bild, Doppel-Endungen wie `bild.jpg.exe`, Makros), keine Werkzeuge zum Umgehen von Virenscannern oder Upload-Filtern Dritter. Beim Verstecken in Archiven nur Archivformate.

**Ton & Stil:** Die Werkstatt darf verspielt sein (Zauberer-Thema, Sprüche wie „Abrakadabra – dein Archiv ist jetzt eine Katze 🐱“), aber Erklärungen bleiben klar und korrekt.

### 12.2 Weitere Funktionen

Diese Funktionen gehören zum Funktionsumfang, werden aber erst nach den Kernphasen umgesetzt (siehe Roadmap). Jede braucht ebenfalls Laienerklärungen.

**Bearbeiten (leicht, kein Ersatz für Photoshop)**
- Bild: zuschneiden, drehen, Größe ändern, Seitenverhältnis-Vorlagen (Instagram 4:5, YouTube-Thumbnail 16:9), **Hintergrund entfernen** (ONNX-Modell lokal im Browser oder auf dem Server), **Hochskalieren** (Real-ESRGAN, serverseitig, GPU falls vorhanden).
- Video: **zuschneiden/kürzen** per Zeitleiste ohne Neukodierung (wenn möglich), Ausschnitt als **GIF/WebP-Animation**, Ton entfernen, Standbild exportieren.
- Audio: Lautstärke angleichen (EBU R128 / `loudnorm`), Stille am Anfang/Ende entfernen, Ausschnitt schneiden. *(Umgesetzt als Expertenoptionen der ffmpeg-Engines, Browser und Server.)*
- PDF: zusammenfügen, aufteilen, Seiten sortieren/drehen/löschen, **OCR** (Tesseract) für durchsuchbare PDFs. **Schwärzen** (ergänzt 2026-11-14): Rechtecke pro Seite ziehen; die Seite wird beim Erstellen als Bild (150 dpi, JPEG) neu aufgebaut, damit Text/Links darunter wirklich weg sind. **Wasserzeichen** (Text groß schräg, groß mittig oder klein unten; pdf-lib, im Browser; Zeichen außerhalb der PDF-Standardschrift werden mit Hinweis weggelassen). **Passwort** setzen (AES-256) und geschützte PDFs mit Passwort öffnen: qpdf auf dem Server (`POST /api/pdf/password`, Passwort nur in einer Argument-Datei, nie in der Befehlszeile/im Log, nichts gespeichert).

**Transkription & Untertitel**
- Sprache aus Video/Audio in Text bzw. Untertitel (SRT/VTT) umwandeln mit Whisper (`whisper.cpp`, serverseitig; kleines Modell optional im Browser).
- Untertitel aus Videos extrahieren, umwandeln (SRT ↔ VTT ↔ ASS) oder fest einbrennen.

**Metadaten**
- Metadaten anzeigen, bearbeiten und entfernen (ExifTool serverseitig, `exifr` im Browser). Klar sichtbarer Hinweis, wenn ein Foto **GPS-Standortdaten** enthält.

**Sammlungen aufräumen**
- **Swipen** (umgesetzt 2026-10-30): Downloads wie bei Tinder sortieren – löschen, behalten, Favorit, Premium; Details in `speicherorte.md` 10.5.
- **Ähnliche Bilder finden** (Perceptual Hash), nicht nur exakte Duplikate – mit Vergleichsansicht und Auswahl, welche behalten werden.
- **Massen-Umbenennung** mit Muster und Live-Vorschau.

**Automatisierung**
- **Überwachte Ordner** (Hot-Folders) auf lokalen Mounts und Speicherzielen, verknüpft mit einem Workflow.
- **REST-API mit API-Tokens** und eine kleine **CLI** (`conbert convert foto.heic --to jpg`), damit sich das Tool in Skripte, Home Assistant oder n8n einbinden lässt. OpenAPI-Dokumentation automatisch aus den Zod-Schemas erzeugen.
- **Teilen-Ziel auf dem Handy**: Als PWA mit Web Share Target, sodass man in der Instagram- oder Browser-App auf „Teilen → Conbert“ tippen kann und der Link direkt im Downloader landet. Optional eine Browser-Erweiterung mit Rechtsklick „Mit Conbert herunterladen/umwandeln“.

**Server & Betrieb**
- **Hardware-Beschleunigung** automatisch erkennen (NVIDIA NVENC, Intel QSV, AMD/VAAPI) und in den Einstellungen verständlich anzeigen („Deine Grafikkarte kann Videos 5× schneller umwandeln“). *Vorgezogen in Phase 3.*
- **Verlauf**: alle Jobs mit Einstellungen, „Nochmal mit gleichen Einstellungen“.
- **Teilen-Links** für Ergebnisse mit Ablaufdatum und optionalem Passwort.
- **Mehrere Benutzer** mit eigenen Einstellungen, Speicherzielen, Accounts (Cookies, API-Keys), Abos und Speicher-Kontingenten; Admin-Rolle. *Grundlage (Konten, Anmeldung, nutzergebundene Daten) ab Phase 2, Kontingente später.*
- **Dashboard** für Admins: Auslastung, laufende Jobs, Speicherplatz, Engine-Status; optional Prometheus-Metriken.
- **Einstellungen sichern/wiederherstellen** (Export als verschlüsselte Datei).
- Updates für yt-dlp/gallery-dl aus der Oberfläche, Hinweis wenn eine neue App-Version verfügbar ist.
