# Cookies exportieren (für den Downloader)

Manche Inhalte sieht man nur, wenn man angemeldet ist: Instagram-Stories,
private Profile, altersbeschränkte YouTube-Videos, viele Reddit-Beiträge.
Damit Conbert sie laden kann, gibst du ihm **deine Anmeldung als Cookies** –
dein Passwort tippst du dabei nie in Conbert ein.

## Was sind Cookies?

Cookies sind kleine Notizen, die eine Webseite in deinem Browser ablegt. Daran
erkennt sie beim nächsten Besuch: „Du bist schon angemeldet.“ Exportierst du
diese Notizen als Datei (`cookies.txt`), kann Conbert damit so tun, als wärst
du angemeldet.

> **Wichtig:** Wer deine Cookies hat, kann sich als du anmelden – behandle die
> Datei wie ein Passwort. Conbert speichert sie verschlüsselt und zeigt sie nie
> wieder an. Lösch die Datei nach dem Hochladen von deinem Computer.

## Schritt für Schritt

1. **Erweiterung installieren:** „Get cookies.txt LOCALLY“
   - Chrome, Edge, Brave: im Chrome Web Store suchen
   - Firefox: auf addons.mozilla.org suchen

   Sie arbeitet nur auf deinem Gerät und schickt nichts weg. (Andere
   Erweiterungen gehen auch, solange sie das **Netscape-Format** speichern –
   die Datei beginnt dann mit `# Netscape HTTP Cookie File`.)

2. **Auf der Seite anmelden**, z. B. auf `instagram.com` – ganz normal mit
   deinem Konto.

3. **Exportieren:** Oben rechts auf das Symbol der Erweiterung klicken, dann
   auf **„Export“**. Es wird eine Datei wie `instagram.com_cookies.txt`
   gespeichert.

4. **In Conbert hochladen:** Einstellungen → **Herunterladen** → bei der
   passenden Plattform auf **„cookies.txt hochladen“** klicken.

5. **Datei löschen** – sie liegt jetzt verschlüsselt in Conbert.

## Gut zu wissen

- **Jede Seite braucht ihre eigene Datei.** Instagram-Cookies exportierst du
  auf instagram.com, Reddit-Cookies auf reddit.com usw.
- **Wann brauche ich sie?** Instagram und Reddit gehen inzwischen fast nur noch
  mit Cookies. YouTube, TikTok & Co. klappen meistens auch ohne – nur bei
  privaten oder altersbeschränkten Inhalten nicht.
- **Abmelden macht sie ungültig.** Meldest du dich auf der Seite ab (oder
  änderst dein Passwort), funktionieren die Cookies nicht mehr. Dann einfach
  neu exportieren und mit **„Ersetzen“** hochladen.
- **Schütze dein Konto.** Lädst du sehr viel auf einmal, kann eine Seite dein
  Konto vorübergehend sperren. Unter Einstellungen → Herunterladen stellst du
  deshalb eine **Pause zwischen Anfragen** ein. Für viele Downloads lieber ein
  Zweitkonto benutzen.
- **Pixiv** meldest du in Conbert direkt über „Mit Pixiv verbinden“ an – dafür
  brauchst du keine cookies.txt.
- **DeviantArt** braucht keine cookies.txt – Cookies würden dort nichts
  ändern. Ohne Einrichtung lädt Conbert nur öffentliche Werke, und große
  Galerien dauern lange, weil sich alle Nutzer von gallery-dl denselben
  DeviantArt-Zugang teilen. Besser: Unter Einstellungen → Herunterladen →
  **„DeviantArt-Zugang“** einmal einen eigenen Zugang einrichten (etwa
  5 Minuten, mit Anleitung). Meldest du dich dort zusätzlich bei DeviantArt
  an, kommen auch Werke für Erwachsene und private Werke.

## Wenn es nicht klappt

| Problem                                    | Was meistens hilft                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| „Für diesen Link ist eine Anmeldung nötig“ | Cookies für genau diese Seite hochladen (siehe oben).                                    |
| Trotz Cookies „Anmeldung nötig“            | Neu exportieren, während du auf der Seite angemeldet bist, und mit „Ersetzen“ hochladen. |
| Die Datei wird nicht angenommen            | Es muss eine **cookies.txt** im Netscape-Format sein, kein JSON.                         |
| Plötzlich scheitern alle Downloads         | Einstellungen → Herunterladen → **„Jetzt aktualisieren“** (die Seiten ändern sich oft).  |
