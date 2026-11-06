# Spezifikation: Externe Speicherziele & Quellen

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 10. Externe Speicherziele & Quellen

Ergebnisse sollen nicht nur heruntergeladen, sondern **direkt an einem anderen Ort gespeichert** werden können. Umgekehrt können Dateien von dort geladen werden.

### 10.1 Unterstützte Ziele
| Typ | Beispiel | Umsetzung |
|---|---|---|
| SMB/CIFS | Windows-Freigabe, Synology, QNAP, FritzBox-NAS | rclone (`smb`-Backend) |
| SFTP | Linux-Server, NAS | rclone (`sftp`) |
| FTP/FTPS | ältere NAS, Webspace | rclone (`ftp`) |
| WebDAV | Nextcloud, ownCloud | rclone (`webdav`) |
| S3-kompatibel | MinIO, AWS S3, Backblaze B2, Wasabi | rclone (`s3`) |
| Cloud | Google Drive, OneDrive, Dropbox | rclone (OAuth-Flow), Phase 2 der Storage-Features |
| Lokaler Pfad | in Docker gemountetes Volume / NFS-Mount | direktes Dateisystem |

**rclone** ist der einheitliche Adapter für alle Netzwerkziele (bewährt, viele Backends, ein Binary). Aufruf ausschließlich über `spawn` mit Argument-Array, Konfiguration per temporärer, nur für den Prozess lesbarer Config-Datei oder Umgebungsvariablen – nie Zugangsdaten in Kommandozeilenargumenten.

### 10.2 Storage-Interface
```ts
// packages/core/src/storage.ts
export interface StorageTarget {
  id: string;
  name: string;              // vom Nutzer vergeben: „NAS Wohnzimmer – Fotos“
  type: 'smb' | 'sftp' | 'ftp' | 'webdav' | 's3' | 'gdrive' | 'onedrive' | 'dropbox' | 'local';
  basePath: string;
  usage: { asTarget: boolean; asSource: boolean };
  conflictPolicy: 'rename' | 'overwrite' | 'skip';
  subfolderPattern?: string; // z. B. '{date}/{category}' oder '{platform}/{username}'
}
```
Server-Adapter in `apps/server/src/targets/` implementieren: `test()`, `list(path)`, `upload(localFile, remotePath)`, `download(remotePath)`.

### 10.3 Bedienung
- Einstellungen → „Speicherorte“ → „Neuen Speicherort hinzufügen“ als **Schritt-für-Schritt-Assistent**: Typ wählen (mit Icons und Erklärung „SMB = Netzwerkordner, z. B. auf deiner NAS“), Felder ausfüllen (jedes mit Beispiel-Platzhalter wie `\\192.168.1.10\Fotos` oder `smb://nas.local/Fotos`), **„Verbindung testen“**-Button mit verständlichem Ergebnis.
- Häufige Fehler verständlich erklären: „Zugriff verweigert – stimmen Benutzername und Passwort?“, „Server nicht erreichbar – ist das Gerät an und im selben Netzwerk?“
- **Ordner-Browser** zur Auswahl des Zielordners statt Pfad tippen.
- Pro Datei/Batch und im Downloader: Dropdown „Speichern unter: Herunterladen ⬇ / NAS Wohnzimmer / …“. Mehrere Ziele gleichzeitig möglich.
- Ein Ziel als **Standard** festlegbar (z. B. alle Social-Media-Downloads automatisch auf die NAS).
- Als Quelle: „Von Speicherort öffnen“ neben der Dropzone.
- Optional (spätere Phase): **Überwachter Ordner** – neue Dateien in einem Quellordner werden automatisch nach einem Preset konvertiert und ins Ziel gelegt.

### 10.4 Datenschutz-Hinweis im lokalen Modus
Wurde lokal konvertiert und das Ziel ist ein externer Speicherort, muss die Datei über den Server dorthin übertragen werden. Das UI weist einmalig verständlich darauf hin („Um auf deiner NAS zu speichern, wird die fertige Datei über deinen Server übertragen.“).

### 10.5 Plattform-Ordner, Medien-Index & Swipen (ergänzt 2026-10-30 auf Wunsch des Nutzers)

- **Plattform-Ordner:** Downloads landen in einem Ordner pro Plattform: `Instagram/<Konto>/`, `YouTube/<Kanal>/`, `SoundCloud/<Künstler>/`, `4chan/<Board>/<Thread>/`, andere Seiten unter `Web/`. Booru-Downloads verwenden den Namen der Seite: `Gelbooru/<Tags>/`. Ein eigenes Ordnermuster des Speicherorts bleibt davor; enthält es `{platform}`, setzt es die Plattform selbst.
- **Aufräumen:** Ältere Download-Ordner direkt im Speicherort schlägt Conbert anhand des eigenen Download-Verlaufs zum Verschieben vor (Vorschau, der Nutzer hakt ab). Unbekannte Ordner bleiben, wo sie sind.
- **Medien-Index:** Conbert merkt sich, welche Dateien auf dem Standard-Speicherort liegen (Abgleich per Knopf, täglich und direkt nach jedem Download). Der Abgleich **fügt nur hinzu oder aktualisiert** – fehlt eine Datei, bleibt ihr Eintrag. Dateinamen mit yt-dlp-ID oder Booru-Post-ID werden in die Download-Archive übernommen.
- **Nie wieder herunterladen:** Eine Datei, die per Name + Größe oder per Inhalt (SHA-256) im Index steht – gelöscht, in den Favoriten oder sonst wo vorhanden –, wird von Downloads und Abos nicht erneut gespeichert.
- **Swipen:** Zufällige Bilder, GIFs und Videos des Standard-Speicherorts (Ordnerauswahl: alles, Plattform, Kanal, Tag-Ordner). Links = löschen, rechts = behalten, oben = nach `Favoriten/<gleicher Pfad>`. Favoriten-Modus: links = zurück in den normalen Ordner, rechts = bleibt, oben = Premium (`Favoriten/Premium/<Pfad>`, goldener schimmernder Rahmen). Die letzten 5 Entscheidungen sind rückgängig machbar; ausgeführt wird erst, was aus diesem Fenster fällt (oder nach 1 Stunde ohne Swipen bzw. mit „Fertig“). Der Standard-Speicherort muss als Quelle und Ziel freigegeben sein.

