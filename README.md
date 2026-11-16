<p align="center">
  <img src="docs/assets/conbert-logo.svg" width="160" height="160" alt="Conbert logo: a purple wizard hat with a golden spark">
</p>

<h1 align="center">Conbert</h1>

<p align="center">
  <strong>FileWizard</strong> – convert and compress almost any file,<br>
  right in your browser or on your own server.
</p>

<p align="center">
  <a href="https://github.com/KiraVibes/conbert/releases"><img src="https://img.shields.io/github/v/release/KiraVibes/conbert?color=7c3aed" alt="Latest release"></a>
  <a href="https://github.com/KiraVibes/conbert/pkgs/container/conbert"><img src="https://img.shields.io/badge/docker-ghcr.io%2Fkiravibes%2Fconbert-7c3aed?logo=docker&logoColor=white" alt="Docker image"></a>
  <img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-7c3aed" alt="Platforms: amd64 and arm64">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" alt="License: AGPL-3.0"></a>
</p>

Self-hosted web app to convert and compress files – right in your browser or
on your own server. Every option is explained in plain language.

> **Status:** 0.1.0, the first public release. Conbert converts, in the
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
> ([guide](docs/en/api.md)).
>
> **Everything at a glance:** all areas of the app and the 68 tools of the
> FileWizard workshop, each with a short description –
> [**list of all tools**](docs/en/tools.md) ([German](docs/werkzeuge.md)).

## Quick start with Docker

Conbert comes as a ready-built image for amd64 and arm64 (e.g. Raspberry Pi
4/5). You only need [`docker-compose.yml`](docker-compose.yml):

```bash
mkdir conbert && cd conbert
curl -fsSLO https://raw.githubusercontent.com/KiraVibes/conbert/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/KiraVibes/conbert/main/.env.example   # optional settings
docker compose up -d
```

Then open <http://localhost:3313>. On first start, Conbert asks for a
one-time setup code to create the administrator account. Find it with:

```bash
docker compose logs conbert
```

New to Docker? The step-by-step guide ([English](docs/en/installation.md),
[German](docs/installation.md)) covers installing Docker on a NAS, the `CONBERT_SECRET` key, HTTPS,
resource limits for small machines, updates, backups and a forgotten admin
password. For the downloader's cookies see [docs/cookies.md](docs/cookies.md).

**Good to know:** the fastest image engine for converting _on this device_
(libvips) needs a secure context: `http://localhost` or `https://` (e.g.
behind a reverse proxy). On plain `http://192.168.x.x` Conbert switches to
the other browser engines or to the server and tells you why. The first
conversion of a kind downloads its engine once (up to ~60 MB for documents);
after that the browser caches it.

Updating: `docker compose pull && docker compose up -d`. Your data stays.

### Image tags

| Tag                      | What you get                                                        |
| ------------------------ | ------------------------------------------------------------------- |
| `latest`                 | Newest release, standard edition                                    |
| `full`                   | Newest release plus Calibre for Kindle/FB2 e-books (~850 MB larger) |
| `0.1.0`, `0.1`           | A fixed version (standard)                                          |
| `0.1.0-full`, `0.1-full` | A fixed version (full)                                              |

Choose one in your `.env`, e.g. `CONBERT_IMAGE_TAG=full`. What changed in each
version: [CHANGELOG.md](CHANGELOG.md).

### Building the image yourself

```bash
git clone https://github.com/KiraVibes/conbert.git && cd conbert
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
```

`CONBERT_EDITION=full` in `.env` builds the full edition. The build downloads
the GeneralUser GS soundfont (~32 MB, used for MIDI) from its official
repository, pinned and checksum-verified.

## Configuration

### Settings in `.env`

Put a file named `.env` next to `docker-compose.yml` (the template is
[`.env.example`](.env.example)). Everything is optional. After a change, run
`docker compose up -d` again.

| Variable                      | Default            | What it does                                                                                                                                                  |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONBERT_PORT`                | `3313`             | Port on your machine. Inside the container Conbert always listens on 3313.                                                                                    |
| `CONBERT_IMAGE_TAG`           | `latest`           | Which image to download: `latest`, `full` (with Calibre) or a fixed version like `0.1.0` (see [Image tags](#image-tags)).                                     |
| `CONBERT_SECRET`              | random, in `/data` | Key that encrypts stored passwords (NAS, SFTP, cookies …). At least 16 characters, e.g. `openssl rand -base64 32`. Keep it safe.                              |
| `CONBERT_SETUP_CODE`          | random, in the log | One-time code for creating the admin account on first start (at least 8 characters).                                                                          |
| `CONBERT_MAX_UPLOAD_MB`       | `2048`             | Largest file that can be uploaded to the server, in MB.                                                                                                       |
| `CONBERT_CLEANUP_MINUTES`     | `60`               | Uploads and results are deleted this many minutes after the job ends.                                                                                         |
| `CONBERT_JOB_CONCURRENCY`     | `2`                | How many server jobs run at the same time. More is faster but needs more memory (a 4K video can take 1–2 GB).                                                 |
| `CONBERT_MEMORY_LIMIT`        | `0` (no limit)     | Most memory the container may use, e.g. `4g`. If a conversion needs more, only that one stops – with a clear message.                                         |
| `CONBERT_CPUS`                | `0` (no limit)     | Most CPU cores the container may use, e.g. `2` or `1.5`.                                                                                                      |
| `CONBERT_PIDS_LIMIT`          | `4096`             | Most processes and threads at once (stops runaway programs).                                                                                                  |
| `CONBERT_LOG_LEVEL`           | `info`             | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.                                                                                               |
| `CONBERT_AUTH_PROXY_HEADER`   | –                  | Let your reverse proxy handle the login: the header with the user name, e.g. `Remote-User` (see [Login via the reverse proxy](#login-via-the-reverse-proxy)). |
| `CONBERT_TRUSTED_PROXIES`     | –                  | Addresses of the reverse proxy, e.g. `172.18.0.1,10.0.0.0/8`. The login header only counts from these.                                                        |
| `CONBERT_PROXY_GROUPS_HEADER` | –                  | Optional header with the user's groups (Authelia: `Remote-Groups`, Authentik: `X-authentik-groups`).                                                          |
| `CONBERT_EDITION`             | `standard`         | Only when you build the image yourself: `standard` or `full`.                                                                                                 |

LDAP / Active Directory is set up in the app itself (Administration → Sign-in through LDAP),
see [docs/en/ldap.md](docs/en/ldap.md).

### Options in `docker-compose.yml`

These are switched on by editing [`docker-compose.yml`](docker-compose.yml);
the file has them as comments.

**Folders from your server or NAS** – for the storage location “Folder on the
server”. Always mount below `/storage`:

```yaml
services:
  conbert:
    volumes:
      - conbert-data:/data
      - /mnt/disk/photos:/storage/photos
      - /volume1/media:/storage/media # e.g. a Synology share
```

SMB, SFTP, FTP, WebDAV/Nextcloud and S3 don't need a mount – add them in the
app under Settings → Storage locations ([guide](docs/en/storage.md)).

**Graphics card for faster videos** – Conbert detects it on start
(Settings → Engines shows the result).

```yaml
services:
  conbert:
    # Intel / AMD (VA-API, Quick Sync)
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - video
      - render
    # NVIDIA (needs the NVIDIA Container Toolkit on the host)
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, video]
```

**Your data** lives in the Docker volume `conbert-data` (accounts, settings,
storage locations, history). Back it up together with your `.env` – see
_Backing up_ in the [installation guide](docs/en/installation.md).

## Reverse proxy and HTTPS

Conbert works on `http://<IP>:3313`, but browsers only allow some features on
`https://` (or `http://localhost`): converting _on this device_ with the
fastest engine, offline use and installing Conbert as an app. A reverse proxy
gives Conbert an HTTPS address like `https://conbert.example.com`.

Whatever proxy you use, it has to:

- pass on the **real `Host` header** – otherwise Conbert refuses sign-in and
  uploads (protection against cross-site requests),
- let **WebSockets** through (live progress),
- allow **big uploads** and **long requests** (up to your `CONBERT_MAX_UPLOAD_MB`).

Ready-made templates are in [`docs/reverse-proxy/`](docs/reverse-proxy/).

<details>
<summary><strong>Caddy</strong> – gets the certificate by itself</summary>

[`docs/reverse-proxy/Caddyfile`](docs/reverse-proxy/Caddyfile)

```caddy
conbert.example.com {
	reverse_proxy conbert:3313 {
		flush_interval -1
	}
}
```

Use `conbert:3313` when Caddy runs in the same Docker network as Conbert,
otherwise `<IP of the Conbert machine>:3313`.

</details>

<details>
<summary><strong>Nginx</strong> – with certbot for the certificate</summary>

[`docs/reverse-proxy/nginx.conf`](docs/reverse-proxy/nginx.conf)

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name conbert.example.com;

    # Conbert checks the upload size itself.
    client_max_body_size 0;

    location / {
        proxy_pass http://192.168.1.10:3313;
        proxy_http_version 1.1;

        # Pass on the real host – otherwise sign-in and uploads are refused.
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (progress)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Stream big files, wait for long conversions
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Then `sudo certbot --nginx -d conbert.example.com` adds HTTPS.

</details>

<details>
<summary><strong>Traefik</strong> – as a compose override with labels</summary>

[`docs/reverse-proxy/docker-compose.traefik.yml`](docs/reverse-proxy/docker-compose.traefik.yml) –
put it next to `docker-compose.yml` and start with
`docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d`.

```yaml
services:
  conbert:
    ports: !reset []
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.conbert.rule=Host(`conbert.example.com`)
      - traefik.http.routers.conbert.entrypoints=websecure
      - traefik.http.routers.conbert.tls.certresolver=letsencrypt
      - traefik.http.services.conbert.loadbalancer.server.port=3313
    networks:
      - default
      - traefik

networks:
  traefik:
    external: true
```

Traefik v3 cancels requests after 60 seconds by default. For long uploads,
start Traefik with
`--entrypoints.websecure.transport.respondingTimeouts.readTimeout=0`.

</details>

<details>
<summary><strong>Nginx Proxy Manager, Synology and others</strong></summary>

- **Nginx Proxy Manager:** new proxy host → forward to `conbert` (or the IP)
  port `3313`, switch on **Websockets Support**, request an SSL certificate.
  Under _Advanced_ add:
  ```nginx
  client_max_body_size 0;
  proxy_request_buffering off;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  ```
- **Synology:** Control Panel → Login Portal → Advanced → Reverse Proxy. Target
  `localhost:3313`; under _Custom header_ choose **Create → WebSocket**.

</details>

### Login via the reverse proxy

If your proxy already signs people in (Authelia, Authentik, oauth2-proxy …),
Conbert can take the user from a header. Set this in `.env`, then open
Conbert through the proxy and choose “Through my reverse proxy” on the setup
page:

```ini
CONBERT_AUTH_PROXY_HEADER=Remote-User
CONBERT_TRUSTED_PROXIES=172.18.0.1        # address of the proxy as Conbert sees it
CONBERT_PROXY_GROUPS_HEADER=Remote-Groups # optional
```

The header is ignored on requests from any other address, so nobody can
pretend to be someone else by sending it directly.

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
