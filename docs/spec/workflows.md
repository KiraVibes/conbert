# Spezifikation: Workflows & Benachrichtigungen

> Teil der Projekt-Anweisungen (ausgelagert aus CLAUDE.md, gleiche Verbindlichkeit). Lesen, wenn an diesem Bereich gearbeitet wird.

## 11. Workflows (Verarbeitungsketten)

Ein **Workflow** ist eine gespeicherte Abfolge von Schritten, die auf Dateien angewendet wird. Er verbindet Downloader, Konverter, Kompression und Speicherziele.

```ts
// packages/core/src/workflow.ts
export type WorkflowStep =
  | { kind: 'convert'; outputExt: string; options: Record<string, unknown> }
  | { kind: 'compress'; preset: string; options?: Record<string, unknown> }
  | { kind: 'filter'; rule: { category?: string[]; ext?: string[]; minWidth?: number; maxSizeMb?: number } }
  | { kind: 'edit'; action: 'resize' | 'crop' | 'rotate' | 'strip-metadata' | 'rename'; params: Record<string, unknown> }
  | { kind: 'ocr'; options: Record<string, unknown> }  // Texterkennung für PDFs (ocrmypdf), andere Dateien unverändert
  | { kind: 'save'; targetIds: string[]; subfolderPattern?: string }
  | { kind: 'workshop'; trick: string; params: Record<string, unknown> }  // Werkstatt-Trick (Abschnitt 12.1)
  | { kind: 'notify'; channelIds: string[] };

export interface Workflow {
  id: string;
  name: string;              // „Booru → WebP → NAS“
  descriptionKey?: string;
  steps: WorkflowStep[];
  keepOriginal: boolean;     // Original zusätzlich behalten?
  runtime: 'server';         // Workflows laufen immer serverseitig (auch bei Abos/Hot-Folders ohne offenen Browser)
}
```

Anforderungen:
- **Visueller Workflow-Editor**: Schritte als Karten untereinander, per Drag & Drop sortierbar, jeder Schritt mit Klartext-Beschreibung („Wandle alle Bilder in WebP um“). Kein Node-Graph – eine einfache Liste reicht und ist für Laien verständlicher.
- **Filter-Schritte**, damit gemischte Downloads sauber behandelt werden (z. B. nur Videos komprimieren, Bilder unverändert lassen).
- **Vorlagen** mitliefern: „Für Web optimieren“, „Fotos platzsparend archivieren“, „Videos fürs Handy“, „Booru-Sammlung als WebP auf NAS“.
- Workflows nutzbar in: Dateiliste („Workflow anwenden“), Downloader („Danach automatisch …“), Booru-Abos, überwachten Ordnern.
- **Testlauf** mit einer Beispieldatei, Ergebnis wird angezeigt, ohne etwas zu speichern.
- Workflows als JSON **exportieren/importieren** (zum Teilen oder als Backup).
- Bei Fehlern in einem Schritt: Datei markieren, restliche Dateien weiter verarbeiten, Fehlerbericht am Ende.

### 11.1 Benachrichtigungen
Kanäle konfigurierbar: Browser-Benachrichtigung, E-Mail (SMTP), ntfy, Gotify, Discord-/Telegram-Webhook. Auslöser: Batch fertig, Abo hat neue Treffer, Fehler, Speicherplatz knapp.
