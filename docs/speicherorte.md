# Speicherorte einrichten

Conbert kann fertige Dateien direkt auf deiner NAS, einem Server oder in deiner
eigenen Cloud ablegen – und Dateien von dort öffnen. Das richtest du einmal ein
unter **Einstellungen → Speicherorte → „Speicherort hinzufügen“**. Mit
„Verbindung testen“ siehst du sofort, ob alles stimmt.

Passwörter und Schlüssel speichert Conbert **verschlüsselt** und zeigt sie nie
wieder an. Jeder Speicherort gehört genau einem Benutzer.

> **Wichtig:** Conbert läuft auf deinem Server, nicht auf deinem PC. Der
> **Server** muss die NAS erreichen können. Läuft beides im selben Heimnetz,
> passt das fast immer.

## Netzwerkordner (SMB) – NAS, FritzBox, Windows-PC

Du brauchst die **Adresse des freigegebenen Ordners**. Conbert versteht alle
üblichen Schreibweisen:

- `\\192.168.1.10\Fotos` (wie im Windows-Explorer)
- `smb://nas.local/Fotos` (wie im Finder auf dem Mac)

Der Teil nach dem Gerät (`Fotos`) ist die **Freigabe**. Ohne ihn geht es nicht.

**Wie finde ich die Adresse?**

- **Windows:** Explorer öffnen → links „Netzwerk“ → deine NAS doppelklicken.
  Die Ordner, die du jetzt siehst, sind die Freigaben. Oben in die
  Adresszeile klicken – dort steht z. B. `\\DISKSTATION\Fotos`.
- **Mac:** Finder → Gehe zu → „Mit Server verbinden …“. Die Adresse beginnt
  mit `smb://`.
- **Synology:** DSM → Systemsteuerung → Gemeinsamer Ordner. Der Name dort ist
  die Freigabe; die IP-Adresse steht unter Systemsteuerung → Netzwerk.
- **FritzBox:** Die Adresse ist meist `\\fritz.box\FRITZ.NAS`. SMB muss unter
  Heimnetz → Speicher (NAS) eingeschaltet sein.
- **QNAP:** QTS → Systemsteuerung → Freigabeordner. Die IP-Adresse steht unter
  Netzwerk & virtueller Switch.
- **Unraid:** Reiter „Shares“ – der Name dort ist die Freigabe. Unter „SMB
  Security Settings“ muss „Export“ auf „Yes“ stehen. Läuft Conbert auf
  derselben Unraid-Maschine, ist ein **Ordner auf dem Server** (siehe unten)
  einfacher.

Klappt der Name (`nas.local`, `DISKSTATION`) nicht, nimm die **IP-Adresse**:
Docker-Container kennen die Namen im Heimnetz oft nicht.

## SFTP-Server

Server-Adresse, Benutzername und Passwort – wie bei einer SSH-Anmeldung. Im
**Expertenmodus** kannst du statt des Passworts einen privaten SSH-Schlüssel
(ohne Passphrase) einfügen. Bei Synology gibt es einen „Startordner“, z. B.
`/volume1`, damit du an alle Freigaben kommst.

## Nextcloud / WebDAV

Die WebDAV-Adresse findest du in Nextcloud unten links unter
**Dateien-Einstellungen → WebDAV**. Sie sieht so aus:
`https://cloud.example.com/remote.php/dav/files/DEIN-NAME/`

Nimm am besten ein **App-Passwort**: Nextcloud → Einstellungen → Sicherheit →
„Neues App-Passwort erstellen“. So musst du dein echtes Passwort nicht
hinterlegen und kannst den Zugang jederzeit wieder sperren.

## S3-Speicher (MinIO, Amazon S3, Backblaze B2, Wasabi …)

Du brauchst Server-Adresse (Endpoint, bei Amazon leer lassen), den Namen des
**Buckets** sowie Access Key ID und Secret Access Key. Der Bucket muss schon
existieren – Conbert legt keinen an.

## Ordner auf dem Server

Ein Ordner deiner Festplatte (oder ein NFS-Mount) kann direkt eingebunden
werden. Dafür in `docker-compose.yml` unter `volumes:` eine Zeile ergänzen –
**immer unter `/storage`**:

```yaml
volumes:
  - conbert-data:/data
  - /mnt/festplatte/fotos:/storage/fotos
```

Danach `docker compose up -d`. Im Assistenten erscheint dann „Ordner auf dem
Server“ mit `/storage`. Andere Ordner (z. B. `/etc` oder Conberts eigene Daten)
sind gesperrt, auch über Verknüpfungen.

## Automatisch speichern

Unter **Einstellungen → Speicherorte → „Jede Umwandlung automatisch
speichern“** wählst du einen Speicherort. Dann landet jedes fertige Ergebnis
zusätzlich dort – auch wenn es auf deinem Gerät umgewandelt wurde. Auf der
Karte siehst du, ob und wohin es gespeichert wurde. Herunterladen kannst du die
Datei trotzdem.

## Wer muss die NAS erreichen – mein PC oder Conbert?

**Immer Conbert** (also der Server bzw. Docker-Container). Auch wenn du „Auf
diesem Gerät“ umwandelst, schickt dein Browser das fertige Ergebnis an deinen
Conbert-Server, und der legt es auf der NAS ab. Dein PC braucht keinen Zugang
zur NAS.

## Der Schlüssel für die Passwörter (`CONBERT_SECRET`)

Ohne eigene Einstellung erzeugt Conbert beim ersten Start einen zufälligen
Schlüssel in seinem Daten-Ordner. Das funktioniert – besser ist aber ein
eigener Schlüssel in der Datei `.env`, damit Schlüssel und Passwörter nicht
nebeneinander liegen:

```ini
CONBERT_SECRET=hier-mindestens-16-zufällige-Zeichen
```

Einen guten Schlüssel erzeugt z. B. `openssl rand -base64 32`. **Bewahre ihn
gut auf.** Ändert er sich, kann Conbert die gespeicherten Passwörter nicht mehr
lesen – du musst sie dann einmal neu eingeben.

## Häufige Fehler

| Meldung                                         | Was meistens hilft                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| „Der Speicherort antwortet nicht“               | Ist das Gerät an? IP-Adresse statt Namen verwenden. Firewall prüfen.                    |
| „Die Anmeldung hat nicht geklappt“              | Benutzername und Passwort prüfen; bei Nextcloud ein App-Passwort nehmen.                |
| „Diesen Ordner gibt es dort nicht“              | Name der Freigabe bzw. des Buckets genau so schreiben wie auf dem Gerät.                |
| „Der Zugriff wurde verweigert“                  | Dem Benutzer auf der NAS Schreibrechte für den Ordner geben.                            |
| „Die verschlüsselte Verbindung wurde abgelehnt“ | Bei FTPS mit eigenem Zertifikat im Expertenmodus „Zertifikat nicht prüfen“ einschalten. |
