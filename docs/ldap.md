# Gruppen, Rechte und Anmeldung über LDAP

Diese Anleitung ist für Admins. Sie erklärt,

- wie du mit **Gruppen** festlegst, wer welche Funktionen von Conbert nutzen darf,
- wie sich Personen mit ihrem **bestehenden Konto aus deinem Verzeichnis** (LDAP)
  anmelden – zum Beispiel aus Active Directory, OpenLDAP, lldap oder dem
  Benutzerverzeichnis deiner NAS,
- und wie du Gruppen von deinem **Reverse-Proxy** (Authelia, Authentik …)
  übernimmst.

Alles davon ist freiwillig. Ohne Einrichtung darf jedes Konto alles – genau wie
bisher.

---

## Inhalt

1. [Gruppen und Rechte in einer Minute](#1-gruppen-und-rechte-in-einer-minute)
2. [Welche Funktionen kann ich sperren?](#2-welche-funktionen-kann-ich-sperren)
3. [Beispiel: Nur die Familie darf Videos herunterladen](#3-beispiel-nur-die-familie-darf-videos-herunterladen)
4. [Was ist LDAP?](#4-was-ist-ldap)
5. [LDAP einrichten](#5-ldap-einrichten)
6. [Gruppen aus LDAP übernehmen](#6-gruppen-aus-ldap-übernehmen)
7. [Abgleich: Wer geht, wird gesperrt](#7-abgleich-wer-geht-wird-gesperrt)
8. [Gruppen vom Reverse-Proxy](#8-gruppen-vom-reverse-proxy)
9. [Häufige Probleme](#9-häufige-probleme)

---

## 1. Gruppen und Rechte in einer Minute

Du findest alles unter **Konto-Menü → Verwaltung → Gruppen**.

- Jede Person ist automatisch in der Gruppe **„Alle Nutzer“**. Was dort
  eingeschaltet ist, darf jeder.
- Weitere Gruppen **erlauben zusätzlich** etwas. Eine Funktion ist frei, sobald
  **mindestens eine** Gruppe der Person sie erlaubt.
- Pro Person kannst du unter **Verwaltung → Benutzer verwalten → „Gruppen & Rechte“** einzelne Funktionen **immer erlauben** oder **immer
  verbieten**. Das hat Vorrang vor allen Gruppen.
- **Administratoren dürfen immer alles.**

Gesperrte Bereiche verschwinden aus der Navigation. Ruft jemand sie trotzdem auf,
sieht er „Diese Funktion ist für dich gesperrt“.

## 2. Welche Funktionen kann ich sperren?

| Funktion                 | Was dazugehört                                                    |
| ------------------------ | ----------------------------------------------------------------- |
| Umwandeln & Komprimieren | Startseite und „Komprimieren“                                     |
| Umwandeln auf dem Server | Dateien zum Server schicken. Aus = nur noch auf dem eigenen Gerät |
| Herunterladen            | Videos/Bilder von YouTube, Instagram & Co., inklusive Abos        |
| Booru                    | Booru-Seiten, Tag-Suche, Booru-Abos                               |
| Workflows                | Eigene Verarbeitungsketten, „Danach automatisch …“                |
| Speicherorte             | NAS, SMB, Nextcloud, SFTP, S3 einrichten und nutzen               |
| Swipen & ähnliche Bilder | Bilder auf Speicherorten aufräumen                                |
| KI-Werkzeuge             | Whisper (Sprache → Text), Hintergrund entfernen, Vergrößern       |
| Werkstatt                | Die FileWizard-Werkstatt                                          |
| PDF-Werkzeuge            | Zusammenfügen, Teilen, Sortieren                                  |
| API-Schlüssel            | Zugangsschlüssel für Skripte anlegen                              |

**Wichtig:** Werkstatt, PDF-Werkzeuge und das Umwandeln _auf dem Gerät_ laufen
komplett im Browser. Conbert kann sie nur **ausblenden** – wer sich auskennt,
könnte sie trotzdem öffnen. Alles, was den Server benutzt (Server-Umwandlung,
Downloader, Booru, Workflows, Speicherorte, KI, API-Schlüssel), sperrt der Server
wirklich – auch für API-Schlüssel.

Abos und Workflows einer Person, der du die Funktion wegnimmst, ruhen
automatisch, bis du sie wieder erlaubst.

## 3. Beispiel: Nur die Familie darf Videos herunterladen

1. **Verwaltung → Gruppen → „Alle Nutzer“ bearbeiten** (Stift) und
   „Herunterladen“ ausschalten. Speichern.
2. **Gruppe anlegen**: Name „Familie“, „Herunterladen“ einschalten, unten die
   Mitglieder anhaken. Speichern.
3. Fertig. Wer nicht in „Familie“ ist, sieht „Herunterladen“ nicht mehr.

## 4. Was ist LDAP?

LDAP ist ein **Verzeichnis**: eine zentrale Liste mit Benutzerkonten,
Passwörtern und Gruppen. Firmen nutzen dafür meist **Active Directory**, zu
Hause oft **lldap**, **OpenLDAP**, **Authentik** oder den LDAP-Server einer
**Synology/QNAP-NAS**.

Ist LDAP in Conbert eingerichtet, prüft Conbert Benutzername und Passwort bei
deinem Verzeichnis. Beim ersten Anmelden bekommt die Person automatisch ein
Conbert-Konto. Ihr Passwort bleibt im Verzeichnis – Conbert speichert es nicht.

Lokale Conbert-Konten (z. B. dein Admin-Konto aus der Einrichtung)
funktionieren weiter, auch wenn das Verzeichnis gerade nicht erreichbar ist.
Gibt es ein lokales Konto mit demselben Namen wie im Verzeichnis, gewinnt immer
das lokale Konto – LDAP übernimmt es nie.

## 5. LDAP einrichten

**Verwaltung → Anmeldung über LDAP.** Klick zuerst auf eine **Vorlage**
(„OpenLDAP / lldap“ oder „Active Directory“), dann trag ein:

| Feld                      | Was hinein muss                         | Beispiel lldap                            | Beispiel Active Directory      |
| ------------------------- | --------------------------------------- | ----------------------------------------- | ------------------------------ |
| Adresse des Servers       | `ldap://` oder `ldaps://` + Name + Port | `ldap://lldap:3890`                       | `ldaps://dc01.firma.local:636` |
| Dienstkonto (Bind-DN)     | Konto, mit dem Conbert sucht            | `uid=conbert,ou=people,dc=example,dc=com` | `conbert@firma.local`          |
| Passwort des Dienstkontos | dessen Passwort                         |                                           |                                |
| Suchbasis für Benutzer    | wo die Konten liegen                    | `ou=people,dc=example,dc=com`             | `dc=firma,dc=local`            |
| Suchbasis für Gruppen     | wo die Gruppen liegen                   | `ou=groups,dc=example,dc=com`             | leer lassen                    |

### Wie finde ich die Suchbasis (Base DN)?

- **lldap:** steht in deiner Konfiguration als `LLDAP_LDAP_BASE_DN`, z. B.
  `dc=example,dc=com`. Benutzer liegen unter `ou=people,…`, Gruppen unter
  `ou=groups,…`.
- **Active Directory:** aus dem Domänennamen: `firma.local` →
  `dc=firma,dc=local`.
- **Synology:** Systemsteuerung → Domäne/LDAP bzw. LDAP Server → „Base DN“.

### Testen

Unter **Verbindung testen** kannst du die Einstellungen ausprobieren, **bevor**
du speicherst. Trag dort optional ein Test-Konto ein: Conbert zeigt dann, ob die
Anmeldung klappt und in welchen Gruppen die Person ist.

Danach **„Anmeldung über LDAP einschalten“** und **Speichern**.

### Verschlüsselung

- `ldaps://` (meist Port 636) ist von Anfang an verschlüsselt – empfohlen.
- Bei `ldap://` schalte **StartTLS** ein, wenn dein Server es kann.
- Selbst ausgestelltes Zertifikat? Füge unter **Erweitert → Eigenes
  CA-Zertifikat** das Stammzertifikat ein. Nur zum Ausprobieren kannst du
  „Zertifikat des Servers prüfen“ ausschalten.

### Nur bestimmte Personen zulassen

Zwei Wege:

1. **„Nur Mitglieder importierter Gruppen dürfen sich anmelden“** einschalten
   und die passenden Gruppen übernehmen (siehe nächster Abschnitt). Am
   einfachsten.
2. Den **Benutzerfilter** erweitern, z. B.
   `(&(objectClass=person)(uid={{username}})(memberOf=cn=conbert,ou=groups,dc=example,dc=com))`.

## 6. Gruppen aus LDAP übernehmen

**Verwaltung → Gruppen → „Aus LDAP übernehmen“.** Such die Gruppen, hak sie an
und übernimm sie. Danach legst du bei jeder Gruppe (Stift) fest, welche
Funktionen sie erlaubt.

- Die Mitglieder trägt Conbert **selbst** ein – bei jeder Anmeldung und bei
  jedem Abgleich. Du musst dort nichts anhaken (die Namen stehen mit „aus LDAP“
  in der Liste).
- Du kannst zusätzlich Personen **von Hand** in eine Gruppe aufnehmen; die
  bleiben auch beim Abgleich drin.
- **„Mitglieder sind Administratoren“**: Wer im Verzeichnis in dieser Gruppe
  ist, wird in Conbert automatisch Admin – und verliert das wieder, wenn er die
  Gruppe verlässt. Der letzte Admin wird nie entfernt.
- Gruppen in Gruppen (verschachtelt) werden nicht aufgelöst. Nimm die Person
  direkt in die Gruppe auf.

## 7. Abgleich: Wer geht, wird gesperrt

Conbert gleicht sich regelmäßig mit dem Verzeichnis ab (Standard: alle
6 Stunden, einstellbar; Knopf **„Jetzt abgleichen“**):

- Gruppenmitgliedschaften und Anzeigenamen werden aktualisiert.
- Konten, die es im Verzeichnis **nicht mehr gibt**, werden in Conbert
  **gesperrt** und überall abgemeldet. Ihre Dateien bleiben, bis du das Konto
  löschst. Taucht die Person wieder auf, kann sie sich wieder anmelden.

## 8. Gruppen vom Reverse-Proxy

Meldet dein Reverse-Proxy die Personen an (siehe
[Installation](installation.md)), kann er auch ihre Gruppen mitschicken:

```bash
# .env neben docker-compose.yml
CONBERT_AUTH_PROXY_HEADER=Remote-User
CONBERT_TRUSTED_PROXIES=172.18.0.1
CONBERT_PROXY_GROUPS_HEADER=Remote-Groups
```

- **Authelia** schickt `Remote-Groups` (durch Kommas getrennt).
- **Authentik** schickt `X-authentik-groups` (durch `|` getrennt).

Trag dann bei der passenden Conbert-Gruppe unter **„Gruppenname beim
Reverse-Proxy“** den Namen ein, den der Proxy schickt (z. B. `family`). Groß-
und Kleinschreibung spielt keine Rolle. Ändert sich die Gruppe beim Proxy, gilt
das in Conbert beim nächsten Seitenaufruf.

Der Header zählt – wie der Benutzername – nur von den Adressen in
`CONBERT_TRUSTED_PROXIES`.

## 9. Häufige Probleme

**„Der LDAP-Server ist nicht erreichbar.“**
Adresse oder Port falsch, oder Conbert läuft in Docker und kann den Namen nicht
auflösen. Liegt lldap im selben docker-compose, nimm den Dienstnamen
(`ldap://lldap:3890`), sonst die IP-Adresse.

**„Conbert konnte sich nicht mit dem Dienstkonto anmelden.“**
Bind-DN oder Passwort stimmen nicht. Bei Active Directory klappt oft
`name@firma.local` statt des langen DN.

**Test sagt „Diesen Benutzer gibt es nicht“.**
Suchbasis oder Benutzerfilter passen nicht. Probier die Vorlage für dein
Verzeichnis. Bei Active Directory muss das Attribut `sAMAccountName` heißen.

**Jemand kann sich nicht anmelden, obwohl das Passwort stimmt.**
Ist „Nur Mitglieder importierter Gruppen“ an? Dann muss die Person in einer
übernommenen Gruppe sein. Gibt es ein **lokales** Conbert-Konto mit demselben
Namen? Dann gilt dessen Passwort.

**Mein Passwort lässt sich in Conbert nicht ändern.**
Bei LDAP-Konten ist das richtig – ändere es im Verzeichnis.
