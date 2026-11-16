# Was Conbert kann – alle Bereiche und Werkzeuge

Ein Überblick über alle Teile von Conbert. Jede Option in der App hat ihre
eigene ⓘ-Erklärung; diese Seite ist für den großen Überblick.

## Bereiche der App

| Bereich            | Was er macht                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Umwandeln**      | Dateien hineinziehen und ein Ziel-Format wählen – auf deinem Gerät oder auf dem Server. „Wofür brauchst du die Datei?“ wählt Format und Einstellungen für dich (WhatsApp, E-Mail, Drucken …). |
| **Komprimieren**   | Dateien kleiner machen – meist im selben Format, z. B. damit sie in eine E-Mail passen oder weniger Platz brauchen. Stufen oder Zielgröße in MB.                                              |
| **KI-Werkzeuge**   | Sprache zu Text und Untertitel (Whisper), Bild-Hintergrund entfernen, Bilder hochskalieren. Laufen auf dem Server; die Modelle werden bei der ersten Nutzung geladen.                         |
| **Archiv**         | Alles, was du umgewandelt oder komprimiert hast, zum erneuten Herunterladen. Bleibt nur in deinem Browser, nie auf dem Server.                                                                |
| **PDF**            | PDFs zusammenfügen, aufteilen oder aufräumen: Seiten sortieren, drehen und löschen. Auch Fotos werden zu Seiten. Alles passiert auf deinem Gerät.                                             |
| **Herunterladen**  | Link von YouTube, TikTok, Instagram, X, Pixiv, 4chan & Co. einfügen. Conbert zeigt vorher, was es findet; die Dateien landen in deiner Liste.                                                 |
| **Booru**          | Bilder von Safebooru, Gelbooru, Konachan & Co. laden – per Link oder als Suche nach Tags, mit Sperrliste und Rating-Filter.                                                                   |
| **Abos**           | Neue Beiträge von Profilen, Kanälen oder Tag-Suchen werden automatisch geholt.                                                                                                                |
| **Swipe**          | Downloads sortieren wie bei Tinder: links löschen, rechts behalten, nach oben in die Favoriten. Findet auch ähnliche Bilder.                                                                  |
| **Workflows**      | Ketten wie „in WebP umwandeln → verkleinern → auf dem NAS speichern“, die von selbst auf dem Server laufen, auch wenn der Browser zu ist.                                                     |
| **Werkstatt**      | Verspielte, aber nützliche Datei-Tricks mit Erklärung, wie sie funktionieren – alle Werkzeuge stehen unten. Alles läuft auf deinem Gerät.                                                     |
| **Speicherorte**   | Speichern auf und Öffnen von NAS/SMB-Freigaben, SFTP, FTP, WebDAV/Nextcloud, S3 und eingebundenen Ordnern ([Anleitung](speicherorte.md)).                                                     |
| **API & CLI**      | Zugangsschlüssel für Skripte, Home Assistant, n8n und das kleine Kommandozeilen-Werkzeug `conbert` ([Anleitung](api.md)).                                                                     |
| **Administration** | Konten, Gruppen und Rechte, Anmeldung über LDAP oder einen Reverse Proxy ([Anleitung](ldap.md)).                                                                                              |

## Die FileWizard-Werkstatt

Alle Werkstatt-Werkzeuge laufen in deinem Browser – deine Dateien verlassen
dein Gerät nicht. In der App hat jedes Werkzeug eine Erklärung „Wie funktioniert das?“.

<!-- tools:start -->

### Datei-Röntgen (7)

Schau in eine Datei hinein: was sie wirklich ist, wie sie aufgebaut ist und ob sie unverändert ist.

| Werkzeug                          | Was es macht                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Was ist diese Datei wirklich?** | Die Endung kann lügen, die ersten Bytes nicht. Hokuspokus – Tarnung aufgeflogen!                      |
| **Hex-Ansicht**                   | Jedes einzelne Byte sehen – farbig erklärt, auch bei riesigen Dateien.                                |
| **Prüfsummen**                    | Ein Fingerabdruck für deine Datei: Ist der Download unversehrt?                                       |
| **Datei-Entropie**                | Wie „zufällig“ sind die Bytes? Zeigt, wo Bilder, Text und Verschlüsseltes stecken.                    |
| **Datei-Landkarte**               | Jede Datei als buntes Bild ihrer Bytes: Text, Nullen und gepackte Daten sieht man als eigene Gebiete. |
| **Warum so groß?**                | Zerlegt eine Datei und zeigt, was den Platz frisst – mit Tipps und Knöpfen zum Verkleinern.           |
| **Vergleichen**                   | Leg zwei Dateien nebeneinander und sieh genau, was sich unterscheidet.                                |

### Datei-Forensik (15)

Spuren lesen wie ein Ermittler: Was eine Datei über ihre Herkunft, Bearbeitung und Geschichte verrät.

| Werkzeug                    | Was es macht                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Fälschungs-Detektor**     | Wurde hier etwas hineinretuschiert? Die Fehlerlevel-Analyse macht Bearbeitungen sichtbar.                                     |
| **Vorschau-Prüfer**         | Zeigt das versteckte Vorschaubild in einem Foto dasselbe wie das Foto selbst? Oft verrät es das Original vor dem Zuschneiden. |
| **Abgeschnitten?**          | Steckt im zugeschnittenen Screenshot noch der Rest des Originals? Conbert holt ihn zurück.                                    |
| **JPG-Herkunft**            | Kamera, Bildbearbeitung oder Messenger? Die Kompressionstabellen eines Fotos verraten, wer es zuletzt gespeichert hat.        |
| **Kopierte Bereiche**       | Wurde ein Teil des Bildes kopiert, um etwas zu verdecken oder zu verdoppeln? Conbert findet es.                               |
| **Forensik-Lupe**           | Filter, die Bearbeitungen sichtbar machen: Bildrauschen, Kanten und Helligkeitsbänder.                                        |
| **Schwärzung echt?**        | Liegt unter den schwarzen Balken einer PDF noch der Text? Conbert findet ihn.                                                 |
| **Frühere Fassungen**       | Viele PDFs tragen ihre alten Fassungen in sich. Conbert holt sie wieder heraus.                                               |
| **Gefahren-Check**          | Kann ich diese Datei gefahrlos öffnen? Conbert prüft auf getarnte Programme, Makros, PDF-Skripte und Archiv-Tricks.           |
| **Programm-Inspektor**      | Was steckt in dieser .exe? Erstellungsdatum, Signatur, Packer und was das Programm alles darf.                                |
| **Text-Finder**             | Lesbarer Text in jeder Datei – Webadressen, E-Mails, IP-Adressen, Dateipfade und Krypto-Adressen hervorgehoben.               |
| **Zeitleiste**              | Alle Datums- und Zeitangaben einer Datei der Reihe nach – und Hinweise, wo sie nicht zusammenpassen.                          |
| **Schnitt-Detektor**        | Wurde diese Aufnahme geschnitten? Sprünge im Hintergrundrauschen, Klicks und das Netzbrummen verraten es.                     |
| **Versteckter Text im PDF** | Findet Text, den Menschen nicht sehen, Maschinen aber lesen: weiß auf weiß, winzig oder neben der Seite.                      |
| **E-Mail-Prüfer**           | Ist diese Mail echt? Zeigt, woher sie wirklich kommt, ob der Absender bestätigt ist und wohin die Links in Wahrheit führen.   |

### Verstecken & Aufdecken (10)

Botschaften und Dateien unsichtbar verstecken – und Verstecktes wiederfinden.

| Werkzeug                         | Was es macht                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Detektiv-Scan**                | Durchsucht jede Datei nach Verstecktem – und holt es heraus. Elementar, mein lieber Watson!                     |
| **Steganografie**                | Eine geheime Nachricht unsichtbar in den Pixeln eines Bildes verstecken – und wieder hervorzaubern.             |
| **Audio-Steganografie**          | Eine geheime Nachricht oder Datei unhörbar in einem Musikstück verstecken – und wieder herausholen.             |
| **Archiv im Bild**               | Verstecke deine geheimen Dateien als blinden Passagier in einem harmlosen Bild.                                 |
| **Polyglot-Dateien**             | Zwei Dateien in einer: Ein Bild oder PDF und ein ZIP-Archiv verschmelzen nahtlos miteinander.                   |
| **Bild im Spektrogramm**         | Ein Bild in Töne verwandeln, die man im Spektrogramm wieder sieht – und jede Tondatei als Spektrogramm ansehen. |
| **Geheimbotschaft in Metadaten** | Eine Nachricht in die Kommentarfelder eines Fotos, PDFs oder Songs schreiben – und solche Felder auslesen.      |
| **Geheimschrift**                | Caesar, Vigenère, Morse, Braille & Co. – schreiben, abspielen und knacken wie ein Detektiv.                     |
| **Unsichtbarer Text**            | Eine Nachricht unsichtbar in einen normalen Satz packen – und versteckte Zeichen in kopierten Texten aufspüren. |
| **Daten im Video**               | Verpacke eine beliebige Datei in ein Video aus schwarzen und weißen Kästchen – und hol sie wieder heraus.       |

### Schützen (5)

Dateien so verschlüsseln, dass nur die richtigen Menschen sie öffnen können.

| Werkzeug                      | Was es macht                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Verschlüsseln für …**       | Ein Schloss, zu dem nur ausgewählte Menschen den Schlüssel haben. Sesam, öffne dich – aber nur für dich!                             |
| **Was verrät meine Datei?**   | Wo ein Foto entstand, mit welcher Kamera, wer am Dokument schrieb – sieh nach, bevor du es teilst.                                   |
| **Was verrät dein Dokument?** | Autorennamen, Firma, Vorlagenpfad, Kommentare, gelöschter Text: Was Word, Excel & Co. heimlich mitschicken – und eine saubere Kopie. |
| **Schatzkarte**               | Zerreiß ein Geheimnis in Teile – erst wenn genug davon zusammenkommen, taucht es wieder auf.                                         |
| **Passwort-Paket**            | Dateien in eine einzige Datei packen, die sich beim Empfänger nur mit Passwort öffnet – in jedem Browser, ohne Programm.             |

### Spaß mit Bildern, Audio & Video (19)

Effekte und Spielereien für Bilder, Töne und Videos.

| Werkzeug                      | Was es macht                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **ASCII-Art**                 | Dein Bild, gezeichnet nur mit Buchstaben und Zeichen – als Text, Webseite oder Bild.                                                      |
| **Pixel-Art**                 | Mach aus einem Foto ein Bild wie auf dem Game Boy, NES oder C64.                                                                          |
| **Emoji-Mosaik**              | Bau dein Foto aus lauter Emojis nach – als Bild oder als Text zum Verschicken.                                                            |
| **Klingelton-Maker**          | Schneid deinen Lieblingsteil aus einem Song – mit sanftem Ein- und Ausblenden.                                                            |
| **Audio zu Video**            | Mach aus einem Lied oder Podcast ein Video mit Wellenform und Cover – für YouTube, Instagram & TikTok.                                    |
| **Vorschau-Streich**          | Ein Foto, das in der kleinen Vorschau ganz anders aussieht als beim Öffnen. Die Katze wird zur Gurke!                                     |
| **Datei anhören**             | Wie klingt eine JPG, eine ZIP oder eine .exe? Jedes Byte wird zu einem Ton.                                                               |
| **Morse-Code**                | Text in Punkte und Striche verwandeln – als Ton, als Lichtblinken und zurück, per Mikrofon. Oder einfach etwas sagen und es wird gemorst. |
| **Bild als Funk-Ton (SSTV)**  | Verwandle ein Bild in einen Ton, wie ihn Funkamateure und die ISS senden – und mach aus solchen Tönen wieder Bilder.                      |
| **Sticker-Macher**            | Ein Bild als WhatsApp- oder Telegram-Sticker: freigestellt, mit weißem Rand, genau 512 × 512.                                             |
| **Glitch-Art**                | Kaputt, aber schön: Störungen wie bei einer beschädigten Datei – absichtlich.                                                             |
| **Deep-Fry & JPEG-Tod**       | Meme-Look mit knalligen Farben – und ein Bild, das so oft gespeichert wird, bis es zerfällt.                                              |
| **QR-Codes**                  | QR-Codes für Links, WLAN-Zugang oder Kontakte erstellen – gern mit Logo – und Codes aus Bildern lesen.                                    |
| **Icon- & Favicon-Generator** | Ein Bild rein, alle Icons raus: favicon.ico, App-Icons für iPhone und Android, macOS-Icon und Manifest.                                   |
| **Lithophanie & Relief**      | Ein Foto als 3D-Druck, der gegen das Licht gehalten das Bild zeigt – oder ein Logo als erhabenes Relief.                                  |
| **Handschrift als Schrift**   | Vorlage ausdrucken, ausfüllen, fotografieren – und deine Handschrift wird eine echte Schrift für Word & Co.                               |
| **Brief in Handschrift**      | Schreib einen Brief mit deiner eigenen Handschrift-Schrift – mit kleinen Unregelmäßigkeiten, damit er echt aussieht.                      |
| **Klangbild**                 | Eine Sprachnachricht, ein Lied oder das erste „Mama“ als schönes Wellenform-Poster zum Ausdrucken.                                        |
| **Magic-Eye-Bild**            | Ein Bild aus bunten Punkten, in dem eine 3D-Form versteckt ist – sichtbar nur mit dem richtigen Blick.                                    |

### Datei-Werkzeuge (12)

Kleine Helfer: Dateien teilen, kodieren und reparieren.

| Werkzeug                   | Was es macht                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Datei-Reparatur**        | Kaputte Prüfsummen, abgeschnittene Bilder, falsche Endung – Reparo!                                                                                |
| **Kodieren & Dekodieren**  | Base64, Hex, URL-Kodierung und Data-URIs – für Text und ganze Dateien, in beide Richtungen.                                                        |
| **Datei-Splitter**         | Zerleg eine große Datei in Teile – und setz Teile wieder zusammen.                                                                                 |
| **Testdateien**            | Erzeug Dateien in genau der Größe, die du brauchst – oder Testbild, Testton, Test-PDF und Testvideo.                                               |
| **Bilder herausholen**     | Hol alle Fotos und Grafiken aus Word, PowerPoint, PDF, EPUB & Co. – in Originalqualität.                                                           |
| **Dokument-Scanner**       | Fotografier Briefe, Quittungen oder Formulare – Conbert macht daraus gerade, saubere Seiten und ein PDF.                                           |
| **Papier-Backup**          | Eine kleine Datei als ausdruckbare QR-Codes – Passwörter, Schlüssel, wichtige Notizen überleben so jeden Festplattencrash.                         |
| **Kontaktabzug**           | Ein Video als ein einziges Bild: gleichmäßig verteilte Szenen mit Zeitangaben – oder als Spritesheet für Spiele.                                   |
| **Farbpalette**            | Die Hauptfarben eines Bildes als Farbcodes – zum Kopieren oder als Palette für Design-Programme.                                                   |
| **Kamera-Uhr korrigieren** | Falsche Aufnahmezeit? Verschiebe das Datum vieler Fotos und Videos auf einmal – z. B. wenn die Kamera-Uhr nach dem Urlaub eine Stunde falsch ging. |
| **Comic-Macher**           | Ein Ordner voller Bilder wird zum Comic (CBZ) oder E-Book (EPUB) – für Comic-Reader, Tolino, Kindle-Apps & Co.                                     |
| **Stapel-Umbenennen**      | Viele Dateien auf einmal umbenennen – z. B. „2024-07-14_Pixel-8_01.jpg“ mit Aufnahmedatum und Kamera aus den EXIF-Daten.                           |

<!-- tools:end -->
