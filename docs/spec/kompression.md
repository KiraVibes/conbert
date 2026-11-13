# Spezifikation: Kompression mit Zielgröße

> Ergänzt Abschnitt 6 der CLAUDE.md (Kompression). Lesen, wenn an der Zielgröße gearbeitet wird.

## Bedienung

- Stufe **„Zielgröße“** im Tab „Komprimieren“, im einfachen Modus sichtbar, für **alle** komprimierbaren Kategorien.
- Eingabe als Zahl mit Einheit **KB oder MB** (1 MB = 1024 KB, Komma oder Punkt). Gespeichert wird `targetMb` (Datei-Karte, Verlauf, Zweck-Assistent). Kleine Ziele (< 1 MB) starten in KB.
- ⓘ-Hilfe erklärt: höchstens so groß, so nah wie möglich dran.
- Ist die Datei im selben Format schon kleiner als das Ziel, bleibt das Original unverändert (Hinweis „schon kleiner“).
- Nach dem Lauf: „Ziel: höchstens X · erreicht: Y“. Bei Überschreitung ein Hinweis in Klartext (Bild/Video/Audio: größeres Ziel oder moderneres Format; andere Formate: kleinste Stufe erreicht, keine genaue Größe möglich).
- Regel aus Abschnitt 6 bleibt: Ist das Ergebnis größer als das Original, wird das Original behalten.

## Ablauf (`compressToSize` in `packages/core/src/compression.ts`)

Gleiche Logik im Browser (`run-conversion.ts`) und auf dem Server (`queue/runner.ts`, nur letzter Schritt, Modus `compress`). Ergebnis ist immer der größte Versuch ≤ Ziel; passt keiner, der kleinste.

| Kategorie | Genauigkeit | Vorgehen |
|---|---|---|
| Bild, verlustbehaftet (JPG, WebP, AVIF …) | genau | Binärsuche über die Qualität (5–95, 6 Versuche). Passt selbst die kleinste nicht: Qualität 60 und Auflösung verkleinern (`scalePercent`, Schätzung über √(Ziel/Größe), bis zu 6 Versuche, Abbruch ab 93 % des Ziels, mindestens 3 %). |
| Bild, verlustfrei (PNG, GIF, BMP …) | genau | Ein Versuch (PNG mit Farbpalette); zu groß → nur Auflösung verkleinern wie oben. |
| Video, Audio | genau | Bitrate aus Dauer und Ziel (`bitratesForTarget`, 92 % Sicherheitsabstand für Container/Ratensteuerung). Ergebnis zu groß oder unter 85 % des Ziels → bis zu 2 Korrekturläufe mit angepasstem `targetBytes`; gleiche Größe wie vorher → Bitrate-Grenze erreicht, Abbruch. |
| PDF, 3D, Schriften, SVG, Archive | Stufen | Stufen von „Maximale Qualität“ bis „Maximal klein“ (`sizeLadder`, doppelte Stufen entfallen); die erste, die passt, gewinnt. Hinweis schon vor dem Start. |

`scalePercent` ist eine interne Bild-Option (nicht in der Optionsliste): sharp, ImageMagick (CLI + WASM) und libvips verkleinern Breite und Höhe auf diesen Prozentsatz; animierte Bilder werden in libvips nicht skaliert.

Auf dem Server bleiben nur die Datei des gewählten Versuchs im Job-Ordner, die übrigen werden sofort gelöscht.

## Grenzen

- Workflow-Schritt „Komprimieren“ kennt nur die drei Stufen, keine Zielgröße.
- Animierte GIFs: Qualität wirkt nicht; nur Auflösung (nicht in libvips).
