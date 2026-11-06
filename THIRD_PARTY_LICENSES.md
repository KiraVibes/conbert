# Third-party licenses

Conbert ships or loads the following third-party software. This list covers
everything that ends up in the Docker image or in the browser at runtime
(build and test tools are not listed). It is updated whenever an engine or a
runtime dependency is added.

> Conbert itself is licensed under the GNU Affero General Public License
> v3.0 or later (see [`LICENSE`](LICENSE)). It is compatible with the (L)GPL
> libraries listed here.

## Browser engines (WebAssembly, served from `/wasm`)

### wasm-vips 0.0.19 – MIT

libvips compiled to WebAssembly. Bundles these native libraries
(versions from `wasm-vips/versions.json`):

| Library            | Version | License                                                       |
| ------------------ | ------- | ------------------------------------------------------------- |
| libvips            | 8.18.7  | LGPL-2.1-or-later                                             |
| GLib               | 2.90.0  | LGPL-2.1-or-later                                             |
| libffi             | 3.8.0   | MIT                                                           |
| libheif (AVIF)     | 1.23.5  | LGPL-3.0-or-later                                             |
| libaom (AV1)       | 3.15.1  | BSD-2-Clause + AOM Patent License 1.0                         |
| libjxl             | 0.12.0  | BSD-3-Clause                                                  |
| Highway            | 1.4.0   | Apache-2.0 / BSD-3-Clause                                     |
| Brotli             | 1.2.0   | MIT                                                           |
| mozjpeg            | 0826579 | IJG + BSD-3-Clause + zlib                                     |
| libpng             | 1.6.58  | libpng-2.0                                                    |
| libwebp            | 1.6.0   | BSD-3-Clause                                                  |
| libtiff            | 4.7.2   | libtiff (BSD-like)                                            |
| cgif               | 0.5.4   | MIT                                                           |
| libexif            | 0.6.26  | LGPL-2.1-or-later                                             |
| Little CMS         | 2.19.1  | MIT                                                           |
| Expat              | 2.8.5   | MIT                                                           |
| zlib-ng            | 2.3.3   | Zlib                                                          |
| libultrahdr        | 2.0.2   | Apache-2.0                                                    |
| resvg (SVG)        | 0.48.1  | Apache-2.0 / MIT                                              |
| imagequant         | 2.4.1   | BSD-2-Clause (lovell/libimagequant fork of v2.4.1, see below) |
| Emscripten runtime | 6.0.10  | MIT / UIUC                                                    |

LGPL note: the LGPL libraries are loaded as separate, unmodified WebAssembly
files (`/wasm/wasm-vips/*.wasm`) and can be replaced by the user.

### magick-wasm 0.0.45 – Apache-2.0

ImageMagick 7.1.2 compiled to WebAssembly (`/wasm/magick/magick.wasm`).
ImageMagick itself uses the ImageMagick License (Apache-2.0 style). The build
bundles libheif + libde265 (LGPL-3.0-or-later; HEVC may be patent-encumbered
in some countries), libjpeg-turbo, libpng, libwebp, libtiff, OpenJPEG,
libjxl, libraw, zlib and others under their own permissive or LGPL licenses.

### ffmpeg.wasm – `@ffmpeg/core` 0.12.10 GPL-2.0-or-later, `@ffmpeg/ffmpeg` 0.12.15 and `@ffmpeg/util` 0.12.2 MIT

The single-threaded core (`/wasm/ffmpeg/ffmpeg-core.{js,wasm}`) is FFmpeg
built with GPL components (x264, x265, libvpx, LAME, Opus, Vorbis, …), so
the core as a whole is GPL-2.0-or-later. It is served as a separate,
unmodified file.

### pandoc-wasm 1.1.0 – GPL-2.0-or-later

The official pandoc WebAssembly build (pandoc 3.10), served as
`/wasm/pandoc/pandoc.wasm`. Uses `@bjorn3/browser_wasi_shim` 0.4.2
(MIT OR Apache-2.0).

### mediabunny 1.62.1 and @mediabunny/mp3-encoder 1.62.1 – MPL-2.0

Uses the browser's WebCodecs. The MP3 encoder extension embeds LAME
(LGPL-2.0-or-later) compiled to WebAssembly.

### spessasynth_core 4.3.22 – Apache-2.0

MIDI synthesizer and soundfont reader/writer. Uses `stb-vorbis` 0.0.6
(Apache-2.0; based on Sean Barrett's public-domain stb_vorbis) for SF3.

### GeneralUser GS 2.0.3 soundfont – GeneralUser GS License v2.0

By S. Christian Collins (<https://www.schristiancollins.com>), downloaded at
build time from the official repository
(<https://github.com/mrbumpy409/GeneralUser-GS>, pinned commit, SHA-256
checked) and served by Conbert as `/soundfonts/GeneralUser-GS.sf2`. The
license allows free use, also in software projects, modification and
redistribution; it asks not to link directly to the author's download files
but to provide an own copy – which Conbert does.

### pdf.js (pdfjs-dist 6.4.299) – Apache-2.0

PDF previews. Served from `/wasm/pdfjs/`: Adobe character maps (BSD-3-Clause,
Adobe), the standard PDF fonts (Foxit fonts, BSD-style, and Liberation fonts,
SIL OFL 1.1), and image decoders compiled to WebAssembly – JBIG2 (from
PDFium, BSD-3-Clause), OpenJPEG (BSD-2-Clause) and qcms colour management
(MIT); their license texts are copied next to the files.

### three.js 0.186.1 – MIT

3D conversion in the browser (loaders and exporters, in a Web Worker) and
the 3D preview. The Draco decoder from three.js (`draco_decoder.*`,
Apache-2.0, Google) is served from `/wasm/draco/`.

### glTF-Transform 4.5.1 – MIT, meshoptimizer 1.3.0 – MIT

glTF/GLB optimisation in the browser and on the server (meshoptimizer's
WebAssembly is embedded in its JavaScript).

### libarchive.js 2.0.2 – MIT (wraps libarchive, BSD-2-Clause)

Opens ZIP, 7Z, RAR, TAR and TAR.GZ in the browser and writes TAR.GZ. The
WebAssembly build of libarchive and its worker are served from
`/wasm/libarchive/`. libarchive bundles zlib (Zlib), bzip2 (bzip2-1.0.6),
liblzma (public domain / 0BSD) and its RAR reader (BSD-2-Clause, unRAR-free).

### Data formats (in the browser and on the server, via `@conbert/core/data`)

| Package          | Version | License      |
| ---------------- | ------- | ------------ |
| yaml             | 2.9.1   | ISC          |
| smol-toml        | 1.9.1   | BSD-3-Clause |
| fast-xml-parser  | 5.11.2  | MIT          |
| papaparse        | 5.7.0   | MIT          |
| read-excel-file  | 9.3.12  | MIT          |
| write-excel-file | 4.1.1   | MIT          |

### ExifTool 13.42 as WebAssembly (metadata tab) – @uswriting/exiftool 1.0.9 and @6over3/zeroperl-ts 1.0.10, Apache-2.0

Reads and writes metadata in the browser (Web Worker). ExifTool itself (Phil Harvey) and the Perl interpreter it runs on (zeroperl, Perl 5 compiled to WebAssembly) are under the same terms as Perl: Artistic License or GPL-1.0-or-later. The runtime is served from `/wasm/exiftool/`.

## Web app (bundled JavaScript)

| Package                                                                   | License                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------- |
| React, React DOM 19                                                       | MIT                                                |
| Radix UI (`radix-ui`)                                                     | MIT                                                |
| shadcn/ui components and `shadcn/tailwind.css`                            | MIT                                                |
| cn                                                                        | MIT                                                |
| class-variance-authority                                                  | Apache-2.0                                         |
| lucide-react                                                              | ISC                                                |
| sonner                                                                    | MIT                                                |
| tw-animate-css                                                            | MIT                                                |
| Tailwind CSS 4 (build output)                                             | MIT                                                |
| Geist font (`@fontsource-variable/geist`)                                 | OFL-1.1                                            |
| Zustand                                                                   | MIT                                                |
| TanStack Query                                                            | MIT                                                |
| i18next, react-i18next, i18next-browser-languagedetector                  | MIT                                                |
| Comlink                                                                   | Apache-2.0                                         |
| fflate (ZIP download)                                                     | MIT                                                |
| DOMPurify (cleans SVG/HTML previews)                                      | MPL-2.0 OR Apache-2.0                              |
| wavesurfer.js (audio waveform)                                            | BSD-3-Clause                                       |
| Shiki (text highlighting, incl. TextMate grammars/themes)                 | MIT (grammars under their own MIT/Apache licenses) |
| file-type                                                                 | MIT                                                |
| Zod                                                                       | MIT                                                |
| pdf-lib 1.17.1 (PDF properties in the workshop) and its parts pako, tslib | MIT, pako MIT AND Zlib, tslib 0BSD                 |
| qrcode 1.5.4 (QR codes in the workshop) and its part dijkstrajs           | MIT                                                |
| jsQR 1.4.0 (reading QR codes in the workshop)                             | Apache-2.0                                         |
| @zip.js/zip.js 2.24.0 (AES-256 ZIPs in the workshop)                      | BSD-3-Clause                                       |

## Server

| Package                                                       | License                     |
| ------------------------------------------------------------- | --------------------------- |
| Node.js runtime (Docker base image `node:24-trixie-slim`)     | MIT and others (see image)  |
| Fastify, @fastify/static, @fastify/cookie, @fastify/websocket | MIT                         |
| Zod                                                           | MIT                         |
| Drizzle ORM                                                   | Apache-2.0                  |
| better-sqlite3 (bundles SQLite)                               | MIT (SQLite: public domain) |
| BullMQ, ioredis, msgpackr                                     | MIT                         |
| @tus/server, @tus/file-store (server), tus-js-client (web)    | MIT                         |
| file-type                                                     | MIT                         |
| sharp                                                         | Apache-2.0                  |
| glTF-Transform, meshoptimizer                                 | MIT                         |
| draco3dgltf (Draco encoder/decoder, WebAssembly)              | Apache-2.0                  |

### Native libraries bundled with sharp (prebuilt libvips 8.18.7)

libvips and GLib (LGPL-2.1-or-later), libheif (LGPL-3.0-or-later), libaom
(BSD-2-Clause), librsvg, cairo, pango, fribidi, harfbuzz (LGPL / MPL / MIT),
libxml2, expat, libffi (MIT), mozjpeg, libpng, libwebp, libtiff, cgif,
Little CMS, zlib-ng, libexif (LGPL-2.1), libimagequant (BSD-2-Clause, see
below). They ship as separate shared libraries inside the
`@img/sharp-libvips-*` packages and can be replaced.

### Programs in the Docker image (Debian 13 packages)

| Program                                                 | License                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| ImageMagick 7                                           | ImageMagick License (Apache-2.0 style)                                    |
| libheif + libde265 (HEIC decoding)                      | LGPL-3.0-or-later – note: HEVC may be patent-encumbered in some countries |
| OpenJPEG (JPEG 2000)                                    | BSD-2-Clause                                                              |
| FFmpeg 7.1 (Debian build)                               | GPL-2.0-or-later (built with GPL components such as x264/x265)            |
| assimp 5.4.3 (assimp-utils)                             | BSD-3-Clause                                                              |
| LibreOffice (Writer, Calc, Impress, no GUI)             | MPL-2.0                                                                   |
| Ghostscript                                             | AGPL-3.0-or-later                                                         |
| qpdf                                                    | Apache-2.0                                                                |
| libarchive / bsdtar (libarchive-tools)                  | BSD-2-Clause                                                              |
| fontTools + Brotli (python3-fonttools, python3-brotli)  | MIT                                                                       |
| Liberation fonts 2, DejaVu fonts (for LibreOffice)      | OFL-1.1 / Bitstream Vera License (DejaVu)                                 |
| Calibre (**full edition only**, `CONBERT_EDITION=full`) | GPL-3.0-or-later                                                          |

### Programs in the Docker image (official release binaries, checksum-pinned)

| Program                                                                       | License          |
| ----------------------------------------------------------------------------- | ---------------- |
| pandoc 3.12.1                                                                 | GPL-2.0-or-later |
| vtracer 0.6.4                                                                 | MIT              |
| rclone v1.75.2 (storage locations: SMB, SFTP, FTP, WebDAV, S3, local folders) | MIT              |

### GBA video player (inside every .gba module Conbert creates)

Conbert's own player (`apps/server/gba-player/player.c`) is compiled with
devkitARM (`devkitpro/devkitarm` Docker image, build stage only). The module
contains devkitARM's GBA startup code (`gba_crt0`), parts of newlib (BSD-style
licenses) and libgcc (GPL with the GCC Runtime Library Exception). libgba is
not used. The image is only used to build; nothing of it ships otherwise.

### Job queue (separate container)

| Program                          | License      |
| -------------------------------- | ------------ |
| Valkey 9 (`valkey/valkey` image) | BSD-3-Clause |

### Downloader (Python environment /opt/conbert/downloader, updatable from the settings)

| Program                                                    | License                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| yt-dlp 2026.10.26 with yt-dlp-ejs                          | Unlicense (public domain)                                            |
| gallery-dl 1.32.18                                         | GPL-2.0-only                                                         |
| requests, urllib3, certifi, charset-normalizer, idna       | Apache-2.0 / MIT / MPL-2.0 / MIT / BSD-3-Clause                      |
| brotli, mutagen, pycryptodomex, websockets (yt-dlp extras) | MIT / GPL-2.0-or-later / BSD-2-Clause + Public Domain / BSD-3-Clause |
| Python 3 (Debian python3-venv)                             | PSF-2.0                                                              |

### Test image only (never shipped)

| Program                                       | License          |
| --------------------------------------------- | ---------------- |
| Samba (real SMB server for the storage tests) | GPL-3.0-or-later |

### libimagequant 2.4.1 (inside wasm-vips and sharp) – BSD-2-Clause

Both use the [lovell/libimagequant](https://github.com/lovell/libimagequant)
fork of version 2.4.1, the last release under the BSD-2-Clause license
(newer upstream versions are GPL-3.0). Its notice:

```text
© 1997-2002 by Greg Roelofs; based on an idea by Stefan Schneider.
© 2009-2014 by Kornel Lesiński.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

© 1989, 1991 by Jef Poskanzer.

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose and without fee is hereby granted, provided
that the above copyright notice appear in all copies and that both that
copyright notice and this permission notice appear in supporting
documentation.  This software is provided "as is" without express or
implied warranty.
```
