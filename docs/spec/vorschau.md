# Spezifikation: Vorschau

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 7. Vorschau

Komponente `features/preview/` mit einem Renderer pro Kategorie:

| Kategorie | Renderer |
|---|---|
| Bild | `<img>`, Zoom/Pan; Vorher/Nachher-Slider |
| Vektor | sanitisiertes SVG (DOMPurify) |
| Audio | `<audio>` + Wellenform (`wavesurfer.js`) |
| Video | `<video>`; Thumbnail-Leiste |
| PDF | `pdf.js` |
| Dokument | Pandoc → HTML, sanitisiert, in sandboxed iframe |
| 3D | `three.js` + OrbitControls (oder `<model-viewer>`), Wireframe-Toggle, Polygon-/Vertex-Anzahl |
| Text/Daten | Code-Viewer mit Syntax-Highlighting (Shiki) |
| Archiv | Dateibaum |
| Font | Beispieltext in der Schrift |

Formate, die der Browser nicht direkt darstellen kann (z. B. TIFF, HEIC, FBX), werden für die Vorschau intern in ein darstellbares Format umgewandelt (PNG, GLB). Vorschau-Konvertierungen niedrig aufgelöst und gecacht.
