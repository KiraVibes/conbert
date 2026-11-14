# Spezifikation: Engines

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 5. Engines

### 5.1 Basis-Engines (Pflicht, Phase 1–3)

| Engine | Kategorie | Browser | Server | Umsetzung |
|---|---|---|---|---|
| imagemagick | image | ✅ | ✅ | Browser: `@imagemagick/magick-wasm` (Engine `magick-wasm`, läuft ohne Cross-Origin-Isolation); Server: `magick` CLI (ImageMagick 7, restriktive `policy.xml`) |
| libvips | image | ✅ | ✅ | Browser: `wasm-vips` (braucht Cross-Origin-Isolation); Server: `sharp` |
| vectorizer | vector | ⏳ später | ✅ | `vtracer` 0.6.4: Server per CLI (offizielles Release-Binary, Checksumme gepinnt), Raster → SVG. Fünf Detailstufen, Nachzeichnen in bis zu 4096 Pixeln (kleine Bilder werden vorher vergrößert), im Expertenmodus jeder vtracer-Wert einzeln (Flecken, Farbgenauigkeit, Verläufe, Ecken, Kurven, Ebenen). Browser erst später über eigenen WASM-Build des Rust-Crates (npm-Pakete sind veraltet) |
| ffmpeg (audio) | audio | ✅ | ✅ | Browser: `@ffmpeg/ffmpeg` mit **Single-Thread-Core** `@ffmpeg/core` (eine Engine `ffmpeg-wasm` für Audio, Video, GIF und animiertes WebP; Fallback hinter mediabunny); Server: natives `ffmpeg` (Engine `ffmpeg-audio`). **Lautstärke angleichen** (Expertenmodus, auch für den Ton von Videos): `loudnorm` in einem Durchgang, Ziele −14/−16/−23 LUFS, danach `aresample` auf 48 kHz (oder die gewählte Abtastrate). **Stille am Anfang/Ende entfernen** (nur Audio-Ziele): Anfang per `silenceremove`, Ende per Vorab-Durchgang `silencedetect` + `atrim` (gleiches Verhalten in ffmpeg 5 und 7, ohne die ganze Datei im Speicher umzudrehen) |
| ffmpeg-video | video | ✅ | ✅ | wie oben, Video-Profile; im Browser WebM als VP8 (VP9 hängt in ffmpeg.wasm); serverseitig (Engine `ffmpeg-video`) mit automatischer GPU-Beschleunigung (NVENC/QSV/VAAPI per Test-Kodierung erkannt), falls vorhanden. Schreibt auch GIF und animiertes WebP (`libwebp_anim`). **Schneiden** (`supportsTrim`): `-ss` vor der Eingabe + `-t`; „schnell“ ins gleiche Format per `-c copy`. **Untertitel einbrennen** (nur Server, Expertenmodus): eingebaute Spur per libass-Filter `subtitles` ins Bild (beim Schneiden mit `setpts`-Ausgleich), Bild-Untertitel (DVD/Blu-ray) per `overlay` |
| audio-video | audio | – | ✅ | Ton → Video (MP3, WAV, FLAC, OGG, Opus, M4A, AAC, AIFF, WMA → MP4, WebM, MOV, MKV) mit ffmpeg-Filtern: *Wellenform* (`showwaves`, `draw=full`), *Frequenz-Säulen* (`showfreqs`), *Spektrum* (`showspectrum`, schmal gezeichnet und gestreckt, damit es sich in Sekunden füllt), *Nur das Bild* (2 Bilder/s, `-tune stillimage`). Optionales Cover (Optionstyp `file`, JPG/PNG/WebP/BMP, Typ per Magic Bytes; scharf in der Mitte, verschwommen als Hintergrund), Formate 1280×720, 1920×1080, 1080×1080, 1080×1920, fünf Farben. Priorität 5. Auch als Werkstatt-Karte „Audio zu Video“. Ergänzt 2026-11-14. |
| mediabunny | video | ✅ | – | `mediabunny` (WebCodecs, sehr schnell; kopiert Spuren ohne Neukodierung, wenn der Ziel-Container sie aufnimmt), MP3 über `@mediabunny/mp3-encoder` (LAME). Fehlt dem Browser ein Codec – oder ist „Lautstärke angleichen“/„Stille entfernen“ an –, übernimmt automatisch ffmpeg.wasm. Schneiden über `Conversion.trim` (genau: Video neu kodiert; schnell: Kopie ab dem Schlüsselbild davor) |
| spessasynth-midi | midi | ✅ | – | `spessasynth_core` (WebAudio-freier Kern von SpessaSynth, läuft im Web Worker): MIDI → WAV mit dem Soundfont **GeneralUser GS** (beim Build geladen, selbst ausgeliefert); MP3 & Co. über Router-Ketten (MIDI → WAV → MP3) |
| spessasynth-soundfont | audio | ✅ | – | `spessasynth_core`: Soundfont-Konvertierung, liest SF2/SF3/DLS, schreibt SF2/DLS (SF3 schreiben bräuchte einen Vorbis-Encoder) |
| pandoc | document | ✅ | ✅ | Browser: `pandoc-wasm` (offizieller WASM-Build, Engine `pandoc-wasm`, ~58 MB, lazy); Server: offizielles statisches `pandoc`-Binary (Checksumme gepinnt, immer mit `--sandbox`). Gleiche Einstellungen über `pandocSettings` in core |

Alle Engines werden selbst implementiert, direkt auf Basis der jeweiligen Bibliothek. Es wird **kein vertd** verwendet; GPU-Videokonvertierung läuft über natives ffmpeg im Server-Container. Lizenzen der eingebundenen Bibliotheken (z. B. ffmpeg LGPL/GPL je nach Build) in `THIRD_PARTY_LICENSES.md` dokumentieren.

Im Browser gilt: Sind mehrere Engines möglich, gewinnt die höhere Priorität (z. B. mediabunny vor ffmpeg.wasm, libvips vor ImageMagick). Meldet eine Engine zur Laufzeit `errors.formatUnavailable`, `errors.engineLoadFailed` oder `errors.notIsolated`, probiert das Frontend automatisch den nächsten möglichen Weg.

### 5.2 Erweiterungen

| Engine | Kategorie | Browser | Server | Zweck |
|---|---|---|---|---|
| **3D** | | | | |
| assimp | 3d | – (`assimpjs` seit 2023 ungepflegt; im Browser übernimmt three-exporters) | ✅ (`assimp` CLI) | OBJ, FBX, STL, PLY, 3DS, DAE, glTF/GLB, X3D u. v. m. |
| three-exporters | 3d | ✅ | – | three.js Loader/Exporter als leichter Fallback (GLB, OBJ, STL, PLY, USDZ-Export) |
| gltf-transform | 3d | ✅ | ✅ | glTF/GLB komprimieren: Draco, Meshopt, Textur → WebP/KTX2, Dedup, Simplify |
| blender | 3d | – | ✅ (auf Wunsch) | **Blender 4.5 LTS** im Hintergrundmodus (`--background --factory-startup --disable-autoexec --offline-mode`, Skripte aus .blend-Dateien nie ausgeführt, Timeout 10 min). Liest .blend, USD/USDA/USDC/USDZ, Alembic, GLB/glTF, OBJ, STL, PLY, FBX; schreibt dieselben außer glTF. Nicht im Image: Der Admin installiert es unter Verwaltung → Blender (offizieller Build von download.blender.org, 378 MB, SHA-256 fest, entpackt ~1,2 GB nach `/data/tools/blender/<Version>`). Nur Linux x64 (kein offizieller ARM-Build). Vorher meldet die Engine keine Formate, Priorität 5 (assimp bleibt vorn). |
| **Office & PDF** | | | | |
| libreoffice | document | – | ✅ | `soffice --headless` als drei Engines (`libreoffice-writer`, `-calc`, `-impress`): DOC/DOCX/ODT/RTF, XLS/XLSX/ODS/CSV, PPT/PPTX/ODP → PDF und untereinander. Wegwerf-Profil pro Lauf, Makros aus, externe Links blockiert |
| pdf-tools | pdf | – (Browser: Seite „PDF“ mit `pdf-lib` für Zusammenfügen/Aufteilen/Sortieren/Drehen, keine Engine) | ✅ | Eine Engine aus Ghostscript (`-dSAFER`, Kompression mit Presets screen/ebook/printer, Seite → PNG/JPG) und qpdf (verlustfreie Struktur-Optimierung). Kein gepflegtes qpdf-WASM-Paket verfügbar. |
| ocrmypdf | pdf | – | ✅ | Texterkennung (OCR) für gescannte PDFs: `ocrmypdf` 16 mit Tesseract 5 (Deutsch + Englisch, Debian-Pakete), unsichtbare Textebene, `--output-type pdf`. Nur über den Job-Modus `ocr` (Seite „PDF“ → „Text erkennbar machen“) und den Workflow-Schritt „Texterkennung (OCR)“, nie vom Router gewählt. Optionen: Sprache, Seiten drehen, Geraderücken, Umgang mit vorhandenem Text. |
| whisper | audio | – (kleines Modell im Browser: später) | ✅ | Spracherkennung mit **whisper.cpp 1.9.5** (im Docker-Build aus dem Quellcode, CPU-Varianten SSE4.2 … AVX-512/ARM werden zur Laufzeit gewählt). Ton/Video → SRT, VTT, TXT; ffmpeg macht vorher 16-kHz-Mono-WAV (Ausschnitt per `trimStart`/`trimEnd` möglich). Modelle (base/small/large-v3-turbo, quantisiert) lädt der Server beim ersten Gebrauch von Hugging Face nach `/data/models/whisper` und prüft Größe + SHA-256; der Admin wählt das Modell. |
| subtitle-extract | video | – | ✅ | Untertitel aus Videos (MKV, MP4, MOV, WebM, AVI, WMV, MPG) → SRT, VTT, ASS, TXT. Option „Woher kommen die Untertitel?“: *Automatisch* (eingebaute Textspur per ffprobe/ffmpeg, sonst Whisper), *Aus dem Video holen*, *Sprache erkennen*. Bild-Untertitel (PGS, DVD) werden erkannt und erklärt. Priorität 12 (vor Whisper); mit Ausschnitt nimmt der Router Whisper. |
| image-ai | image | – | ✅ | KI für Bilder mit **onnxruntime-node 1.31** (CPU): Hintergrund entfernen (ISNet general-use, Apache-2.0, 179 MB, aus dem rembg-Release) und Hochskalieren ×2/×4 (Real-ESRGAN realesr-general-x4v3, BSD-3, 4,9 MB, ONNX-Export mit flexibler Größe, in Kacheln). Modelle beim ersten Gebrauch nach `/data/models/image` (SHA-256 geprüft). Wird nie vom Router gewählt: Der Server setzt den KI-Schritt (Ergebnis PNG) vor den normalen Weg, wenn die Optionen `removeBackground`/`upscale` gesetzt sind. |
| pdfjs-render | pdf | ✅ | – | PDF → PNG/JPG (Seiten rendern) |
| **E-Books** | | | | |
| calibre | ebook | – | ✅ (nur Edition „full“) | `ebook-convert`: EPUB, MOBI, AZW3, FB2, PDF. Macht das Image ca. 850 MB größer, daher nur mit `CONBERT_EDITION=full` |
| **Bilder (Spezial)** | | | | |
| jsquash | image | ✅ | – | Squoosh-Codecs (MozJPEG, OxiPNG, WebP, AVIF, JXL) für beste Kompression |
| libheif | image | ✅ | ✅ | HEIC/HEIF/AVIF |
| potrace | vector | ✅ (`esm-potrace-wasm`) | ✅ | Alternative Vektorisierung (s/w) |
| inkscape | vector | – | ✅ | SVG ↔ PDF/EPS/EMF, SVG-Rendering |
| svgo | vector | ✅ (`svgo/browser`) | ✅ | **svgo 4.1**: SVG-Kompression im Tab „Komprimieren“ (mehrere Durchgänge, Kommentare/Metadaten/Editor-Daten raus, Nachkommastellen 5/3/1 je Stufe). Titel, Beschreibung und viewBox bleiben. Option „Editor-Daten behalten“ (Inkscape/Illustrator). Gleiche Einstellungen in Browser und Server (`svgoConfig` in `@conbert/core`). |
| **Sonstiges** | | | | |
| libarchive | archive | ✅ (`libarchive.js`; schreibt ZIP über `fflate`, TAR/TGZ, kein 7Z) | ✅ (`bsdtar` aus libarchive-tools) | ZIP, 7Z, TAR, GZ, RAR (nur lesen) umpacken; Schutz vor Archiv-Bomben (Einträge- und Größenlimit) |
| fonttools | font | – | ✅ | TTF/OTF ↔ WOFF/WOFF2, Subsetting |
| data-formats | data | ✅ | ✅ | JSON ↔ YAML ↔ TOML ↔ XML ↔ CSV ↔ XLSX (reine JS-Libs in `@conbert/core/data`, gleicher Code in Browser und Server) |
| subtitles | document | ✅ | ✅ | SRT ↔ WebVTT ↔ ASS (.ssa wird als ASS gelesen) und → TXT (nur der Text), Zeit verschieben (Expertenmodus). Reines TypeScript in `@conbert/core/subtitles`, liest UTF-8/UTF-16/Windows-1252; kursiv/fett/unterstrichen bleiben, ASS-Farben/Positionen gehen bei SRT/VTT verloren. |
| **Retro** | | | | |
| gba-video | video | – | ✅ | Video → `.gba`-Modul für den Game Boy Advance (Emulator oder Flashkarte). Eigener kleiner Player in C (beim Docker-Build mit devkitARM übersetzt), Conbert hängt die Videodaten an: ffmpeg skaliert und extrahiert, Encoder in TypeScript (256-Farben-Palette pro Szene mit geordnetem Dithering, nur geänderte 8×8-Blöcke, LZ77 im BIOS-Format), Ton als 8-Bit-PCM per DMA. Modul max. 32 MB → je nach Qualität grob 1–14 Minuten (gemessen an einem Animationsfilm; echte Kameraaufnahmen eher weniger); Conbert prüft das vorab und erklärt es |

Neue Engines immer zuerst als Eintrag in dieser Tabelle ergänzen, dann implementieren.
