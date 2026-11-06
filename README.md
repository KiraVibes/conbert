# Conbert – FileWizard

Self-hosted web app to convert and compress files – right in your browser or
on your own server. Every option is explained in plain language.

> **Status:** Phase 12 (polish) is in progress. Conbert converts, in the
> browser or on the server, with user accounts:
>
> - **Images** – PNG, JPG, WebP, AVIF, GIF, TIFF, JPEG XL, BMP, ICO, TGA,
>   JPEG 2000; PSD and iPhone photos (HEIC) as input; images → SVG
>   (vectorizing, server only)
> - **Audio & video** – MP3, WAV, FLAC, Ogg, Opus, M4A, AAC, AIFF, MP4, WebM,
>   MKV, MOV, AVI, WMV, MPG, GIF; on the server with automatic graphics-card
>   acceleration (NVIDIA, Intel, AMD) when available
> - **MIDI → audio** (bundled GeneralUser GS soundfont) and soundfonts
>   (SF2, SF3, DLS)
> - **Game Boy Advance** – any video as a playable `.gba` module (emulator
>   or flash cart), roughly 1–14 minutes depending on quality, with pause,
>   skipping, restart and endless playback on the buttons
> - **3D models** – GLB, glTF, OBJ, STL, PLY, FBX, Collada, 3DS, 3MF, X3D, USDZ;
>   compressing glTF/GLB (Meshopt, Draco, smaller textures, less detail) and a
>   3D preview
> - **Documents** – Word, OpenDocument, RTF, Markdown, HTML, LaTeX, reStructuredText,
>   Org, EPUB (via pandoc); on the server also Word/PowerPoint/Excel old and
>   new, OpenDocument → PDF and back where it makes sense (LibreOffice)
> - **PDF** – make PDFs smaller (Ghostscript/qpdf), save a page as PNG/JPG
> - **E-books** – EPUB, MOBI, AZW3 (Kindle), FB2 (Calibre, full edition only)
> - **Archives** – ZIP, 7Z, TAR, TAR.GZ, RAR (read only); repack or compress harder
> - **Fonts** – TTF, OTF, WOFF, WOFF2, with a smaller character subset on request
> - **Data & tables** – CSV, Excel, ODS, JSON, YAML, TOML, XML
>
> Every file has a preview (pictures, sound with waveform, video, PDF,
> documents, text, tables, archive contents, fonts) with a before/after comparison, and a **Compress** tab makes
> files smaller (levels or a target size in MB). Results can be downloaded one
> by one or all at once as a ZIP – or saved straight to your **NAS, SFTP
> server, Nextcloud/WebDAV, S3 or a mounted folder**, and opened from there
> ([guide, German](docs/speicherorte.md)). A **downloader** fetches videos,
> pictures and profiles from YouTube, TikTok, Instagram, X, Reddit & more
> (yt-dlp, gallery-dl) straight into the list. Scripts, Home Assistant, n8n
> and a small CLI can use Conbert through an API with tokens
> ([guide, German](docs/api.md)). For more – booru, workflows, the
> workshop and the rest – see
> the specification in [`docs/spec/`](docs/spec/) (German).

## Quick start with Docker

```bash
docker compose up --build -d
```

Then open <http://localhost:3313>. On first start, Conbert asks for a
one-time setup code to create the administrator account. Find it with:

```bash
docker compose logs conbert
```

New to Docker? The step-by-step guide [docs/installation.md](docs/installation.md)
(German) covers installing Docker on a NAS, the `CONBERT_SECRET` key, HTTPS,
resource limits for small machines, updates, backups and a forgotten admin
password. For the downloader's cookies see [docs/cookies.md](docs/cookies.md).

**Good to know:** the fastest image engine for converting _on this device_
(libvips) needs a secure context: `http://localhost` or `https://` (e.g.
behind a reverse proxy). On plain `http://192.168.x.x` Conbert switches to
the other browser engines or to the server and tells you why. The first
conversion of a kind downloads its engine once (up to ~60 MB for documents);
after that the browser caches it.

The Docker build downloads the GeneralUser GS soundfont (~32 MB, used for
MIDI) from its official repository, pinned and checksum-verified.

### Editions

The standard image covers everything except Kindle/FB2 e-books. For those,
Conbert can include Calibre (about 850 MB more). Put this in your `.env` and
rebuild:

```ini
CONBERT_EDITION=full
```

Then run `docker compose up --build -d` again. Your data stays.

## Development

Requirements: Node.js 24, pnpm 12, Docker (for the Valkey job queue).

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # job queue on localhost:6379
pnpm dev            # server on :3313, web dev server on :3314
pnpm test           # unit tests (Vitest)
pnpm test:e2e       # end-to-end tests (Playwright, Chromium)
pnpm lint && pnpm typecheck
pnpm build && pnpm start   # production build on :3313
```

| Path               | What it is                                                   |
| ------------------ | ------------------------------------------------------------ |
| `apps/web`         | React + Vite frontend, browser engines (WASM in Web Workers) |
| `apps/server`      | Fastify API server, serves the web build in production       |
| `packages/core`    | Engine interface, format registry, router                    |
| `packages/i18n`    | All texts in German and English (with help-text checks)      |
| `packages/schemas` | Zod schemas shared by web and server                         |

## License

Conbert is free software under the [GNU Affero General Public License v3.0 or later](LICENSE).
If you run a modified version for other people over a network, you have to offer them its source code.

Third-party licenses: [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
