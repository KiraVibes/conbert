# syntax=docker/dockerfile:1
# Conbert – FileWizard. Build from the repository root:
#   docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
# or
#   docker build -f apps/server/Dockerfile -t conbert .
# Server tests with all native tools (ffmpeg, ImageMagick, pandoc, vtracer):
#   pnpm test:docker

ARG NODE_VERSION=24
# Tools edition: "tools-standard" (default) or "tools-full" (adds Calibre for
# e-books; later Blender). docker-compose sets it from CONBERT_EDITION.
ARG TOOLS_STAGE=tools-standard
ARG PNPM_VERSION=12.15.0

# ---------- Build: install and build all packages ----------
FROM node:${NODE_VERSION}-trixie-slim AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

# Manifests first, so the dependency layer is cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/i18n/package.json packages/i18n/
COPY packages/schemas/package.json packages/schemas/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

# MIDI soundfont (~32 MB, pinned + checksum) in its own layer, so it is only
# downloaded again when the script changes. A failed download fails the build.
ENV CONBERT_REQUIRE_SOUNDFONT=1
COPY apps/web/scripts/fetch-soundfont.mjs apps/web/scripts/
RUN node apps/web/scripts/fetch-soundfont.mjs

COPY . .
ARG TARGETARCH
RUN pnpm build \
 && pnpm --filter @conbert/server deploy --prod /out/server \
 # ONNX Runtime ships programs for every system (~300 MB): keep Linux on this CPU only.
 && ort="$(find /out/server/node_modules -type d -path '*onnxruntime-node/bin/napi-v*' | head -n 1)" \
 && arch="$([ "${TARGETARCH:-amd64}" = arm64 ] && echo arm64 || echo x64)" \
 && find "$ort" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
 && find "$ort/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} + \
 && ls "$ort/linux/$arch"

# ---------- GBA player: the Game Boy Advance program behind .gba videos ----------
# The ROM is the same on every platform, so it is built on the build machine.
FROM --platform=$BUILDPLATFORM devkitpro/devkitarm:20260610@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5 AS gba-player
WORKDIR /src
COPY apps/server/gba-player/Makefile apps/server/gba-player/player.c ./
RUN make

# ---------- whisper.cpp: speech to text (no Debian package) ----------
# Built from the release source (checksum-verified). The CPU code comes in
# variants (SSE4.2 … AVX-512, ARM) that are picked at runtime, so the image
# also runs on small NAS CPUs. Models are not included – the server
# downloads the chosen one on first use.
FROM debian:trixie-slim AS whisper
ARG WHISPER_VERSION=1.9.5
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl cmake g++ make \
 && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    curl -fsSL -o /tmp/whisper.tgz \
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION}.tar.gz"; \
    echo "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720  /tmp/whisper.tgz" | sha256sum -c -; \
    tar -xzf /tmp/whisper.tgz -C /tmp; \
    cd "/tmp/whisper.cpp-${WHISPER_VERSION}"; \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=OFF \
      -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF \
      -DCMAKE_INSTALL_PREFIX=/opt/whisper -DCMAKE_INSTALL_RPATH=/opt/whisper/lib; \
    cmake --build build -j"$(nproc)"; \
    cmake --install build; \
    cp build/bin/libggml-cpu-*.so /opt/whisper/bin/; \
    rm -rf /opt/whisper/include /opt/whisper/lib/cmake /opt/whisper/lib/pkgconfig; \
    find /opt/whisper/bin -type f ! -name whisper-cli ! -name 'libggml-cpu-*.so' -delete

# ---------- Tools: native converters used by the server engines ----------
FROM node:${NODE_VERSION}-trixie-slim AS tools-standard
ARG TARGETARCH
# ImageMagick 7 + libde265 (HEIC), ffmpeg 7 (incl. NVENC/QSV/VAAPI encoders),
# assimp 5 (3D models), LibreOffice 25 without GUI (office documents),
# Ghostscript + qpdf (PDF), bsdtar/libarchive (archives), fonttools (fonts),
# ExifTool (keywords and source in booru pictures, without re-encoding),
# OCRmyPDF + Tesseract with German and English (searchable PDFs),
# xz-utils to unpack Blender when the admin installs it on demand,
# and free fonts so documents render with readable, metric-compatible text.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl imagemagick libheif-plugin-libde265 ffmpeg assimp-utils \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      ghostscript qpdf libarchive-tools python3-fonttools python3-brotli \
      fonts-liberation2 fonts-dejavu-core python3-venv libimage-exiftool-perl \
      ocrmypdf tesseract-ocr-deu tesseract-ocr-eng xz-utils \
 && rm -rf /var/lib/apt/lists/*
# pandoc from the official static release (data files built in – Debian's
# 3.1.11 can't run with --sandbox, which Conbert needs for safety).
ARG PANDOC_VERSION=3.12.1
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sum=d0c90410e90204c9ca83b8539fac5c7aed01fd537207e4585849f8abc5df20b8 ;; \
      arm64) sum=445d96fd08801fe636cab1158b4f017ee320ac3b7446328b4fe2f902117b19b9 ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/pandoc.tgz \
      "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${TARGETARCH:-amd64}.tar.gz"; \
    echo "${sum}  /tmp/pandoc.tgz" | sha256sum -c -; \
    tar -xzf /tmp/pandoc.tgz -C /tmp; \
    mv "/tmp/pandoc-${PANDOC_VERSION}/bin/pandoc" /usr/local/bin/pandoc; \
    rm -rf /tmp/pandoc.tgz "/tmp/pandoc-${PANDOC_VERSION}"; \
    pandoc --version >/dev/null
# vtracer 0.6.4 (stable) from the official release, verified by checksum.
ARG VTRACER_VERSION=0.6.4
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) arch=x86_64; sum=9290ba0c90e224d6d212836dff5491407c1718bcb72f80b2b5a4a01816df5e40 ;; \
      arm64) arch=aarch64; sum=cbd05ad4f491d12dd139ada61485ca1d24db9f981cbe1658632a083cd0ac1a71 ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/vtracer.tgz \
      "https://github.com/visioncortex/vtracer/releases/download/${VTRACER_VERSION}/vtracer-${arch}-unknown-linux-musl.tar.gz"; \
    echo "${sum}  /tmp/vtracer.tgz" | sha256sum -c -; \
    tar -xzf /tmp/vtracer.tgz -C /usr/local/bin vtracer; \
    rm /tmp/vtracer.tgz; \
    vtracer --help >/dev/null
# rclone (storage locations: SMB, SFTP, FTP, WebDAV, S3 …) from the official
# release, verified by checksum. bsdtar unpacks the zip.
# Not named RCLONE_*: rclone reads every RCLONE_* variable as a setting.
ARG CONBERT_RCLONE_RELEASE=v1.75.2
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sum=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702 ;; \
      arm64) sum=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10 ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/rclone.zip \
      "https://downloads.rclone.org/${CONBERT_RCLONE_RELEASE}/rclone-${CONBERT_RCLONE_RELEASE}-linux-${TARGETARCH:-amd64}.zip"; \
    echo "${sum}  /tmp/rclone.zip" | sha256sum -c -; \
    bsdtar -xf /tmp/rclone.zip -C /tmp; \
    mv "/tmp/rclone-${CONBERT_RCLONE_RELEASE}-linux-${TARGETARCH:-amd64}/rclone" /usr/local/bin/rclone; \
    rm -rf /tmp/rclone.zip "/tmp/rclone-${CONBERT_RCLONE_RELEASE}-linux-${TARGETARCH:-amd64}"; \
    rclone version >/dev/null
# Downloader: yt-dlp (videos) and gallery-dl (pictures, galleries, profiles)
# in their own Python environment. It belongs to the "node" user, so the
# admin can update both from the settings – platforms change often.
# yt-dlp[default] brings its helpers (incl. yt-dlp-ejs, which solves
# YouTube's JavaScript challenges with Node).
ARG CONBERT_YTDLP_RELEASE=2026.10.26
ARG CONBERT_GALLERYDL_RELEASE=1.32.18
RUN python3 -m venv /opt/conbert/downloader \
 && /opt/conbert/downloader/bin/pip install --no-cache-dir --disable-pip-version-check \
      "yt-dlp[default]==${CONBERT_YTDLP_RELEASE}" "gallery-dl==${CONBERT_GALLERYDL_RELEASE}" \
 && chown -R node:node /opt/conbert/downloader \
 && /opt/conbert/downloader/bin/yt-dlp --version \
 && /opt/conbert/downloader/bin/gallery-dl --version
ENV CONBERT_DOWNLOADER_BIN=/opt/conbert/downloader/bin
# Video player for .gba modules (see apps/server/gba-player).
COPY --from=gba-player /src/player.gba /opt/conbert/gba/player.gba
# whisper.cpp (speech to text); the CPU variants sit next to the program.
COPY --from=whisper /opt/whisper /opt/whisper
RUN ln -s /opt/whisper/bin/whisper-cli /usr/local/bin/whisper-cli \
 && whisper-cli --help >/dev/null
# Allow-list policy: only the formats Conbert uses (see docker/imagemagick/policy.xml).
COPY docker/imagemagick/policy.xml /etc/ImageMagick-7/policy.xml

# ---------- Full edition: Calibre for e-books (~850 MB) ----------
FROM tools-standard AS tools-full
RUN apt-get update \
 && apt-get install -y --no-install-recommends calibre \
 && rm -rf /var/lib/apt/lists/*

# ---------- Test: server tests against the real tools ----------
FROM ${TOOLS_STAGE} AS test
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
# A real Samba server for the SMB storage tests (test image only). SFTP,
# FTP, WebDAV and S3 test servers come from rclone itself (rclone serve).
RUN apt-get update \
 && apt-get install -y --no-install-recommends samba espeak-ng \
 && rm -rf /var/lib/apt/lists/*
# The smallest Whisper model plus a speech synthesizer (espeak-ng) for a real
# transcription test – test image only, the runtime downloads its model.
RUN curl -fsSL -o /opt/whisper/ggml-tiny-q5_1.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin \
 && echo "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7  /opt/whisper/ggml-tiny-q5_1.bin" | sha256sum -c -
ENV CONBERT_TEST_WHISPER_MODEL=/opt/whisper/ggml-tiny-q5_1.bin
# The small upscaling model (5 MB) for a real test of the picture AI.
RUN mkdir -p /opt/conbert/test-models \
 && curl -fsSL -o /opt/conbert/test-models/realesr-general-x4v3.onnx \
      https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx \
 && echo "1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112  /opt/conbert/test-models/realesr-general-x4v3.onnx" | sha256sum -c -
ENV CONBERT_TEST_IMAGE_MODELS=/opt/conbert/test-models
WORKDIR /repo
COPY --from=build /repo /repo
CMD ["pnpm", "exec", "vitest", "run", "--project", "server"]

# ---------- Runtime: server bundle, its prod deps and the web build ----------
FROM ${TOOLS_STAGE} AS runtime
ENV NODE_ENV=production \
    CONBERT_HOST=0.0.0.0 \
    CONBERT_PORT=3313 \
    CONBERT_DATA_DIR=/data \
    CONBERT_WEB_DIR=/app/web
WORKDIR /app

COPY --from=build /out/server /app/server
COPY --from=build /repo/apps/web/dist /app/web
# The command line tool, offered for download at /cli/conbert.mjs.
COPY --from=build /repo/packages/cli/dist/conbert.mjs /app/web/cli/conbert.mjs
# Guides, readable at /docs/<file> (linked on the help page and in Settings).
COPY --from=build /repo/docs/api.md /repo/docs/installation.md /repo/docs/speicherorte.md /repo/docs/cookies.md /app/web/docs/
COPY --from=build /repo/docs/en/api.md /repo/docs/en/installation.md /repo/docs/en/storage.md /repo/docs/en/cookies.md /app/web/docs/en/

# /storage: mount NAS shares or disks here for "local folder" locations.
RUN mkdir -p /data /storage && chown node:node /data /storage
# Starts as root just long enough to hand /data to the user Conbert runs as
# (PUID/PGID, default node = 1000:1000), then drops to that user. Needed when
# /data is a host folder that belongs to someone else (Unraid: 99:100).
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/conbert-entrypoint
ENTRYPOINT ["conbert-entrypoint"]

EXPOSE 3313
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CONBERT_PORT||3313)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.mjs"]
