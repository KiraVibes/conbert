# Changelog

All notable changes to Conbert. Versions follow [Semantic Versioning](https://semver.org/);
the Docker image tags match them (`0.1.0`, `0.1`, `latest`, and `-full` for the
full edition).

## [Unreleased]

### Fixed

- **Downloader:** “Then automatically …” (e.g. to MP3) on a download that is
  kept on the server but not added to the list now keeps the converted file in
  the server archive. Before, only the original (e.g. the MP4) stayed and the
  result was lost.

## [0.1.1] – 2026-11-16

### Fixed

- **Offline:** a tool that was never stored on the device no longer hangs at
  “Loading engine …” without a connection. Conbert now says that the tool
  isn't stored for offline use and how to change that.
- The same error no longer shows up twice on a file card.

### Added

- The installed app (home screen) offers on its start page to download
  everything for offline use once – with the size and a “Not now” button.
- Without a connection, the offline notice says how much is stored on the
  device and that unused tools only work again online.
- The installation guide explains how to prepare offline use on a phone.

### Changed

- The release workflow uses the current GitHub Actions (Node.js 24).

## [0.1.0] – 2026-11-16

The first public release.

### Converting and compressing

- Convert **in your browser** (files never leave your device) or **on your
  own server** (faster, more formats) – per file, or "Automatic" picks for you
  and says why.
- **Images** (PNG, JPG, WebP, AVIF, GIF, TIFF, JPEG XL, HEIC, PSD …), images to
  SVG, **audio and video** with automatic graphics-card acceleration (NVIDIA,
  Intel, AMD), **MIDI** to audio, **3D models** (GLB, glTF, OBJ, STL, FBX, 3MF,
  USDZ …), **documents** (Word, OpenDocument, Markdown, LaTeX, EPUB …),
  **office files and PDF** (LibreOffice, Ghostscript, qpdf), **e-books**
  (Calibre, full edition), **archives**, **fonts** and **data/tables**.
- Conversion chains of up to three steps when there is no direct way.
- A **Compress** tab with levels or a target size, showing how much you saved.
- **Preview** for nearly every file type, with a before/after comparison.
- Batch processing with a queue, progress and download as ZIP.

### Downloaders, storage and automation

- **Social media downloader** (yt-dlp, gallery-dl): videos, pictures, stories
  and whole profiles, with cookie management.
- **Booru downloader** with a mandatory block list and rating filter, tag
  search and subscriptions.
- **Storage locations**: save to and open from SMB/NAS shares, SFTP, FTP,
  WebDAV/Nextcloud, S3 and mounted folders (rclone).
- **Workflows**: download → convert → compress → save as an automatic chain.
- REST API with tokens and a small command line tool.

### FileWizard workshop and extras

- File X-ray (magic bytes, hex view, hashes), archives hidden in pictures,
  steganography, pictures in a spectrogram and more playful tools.
- PDF tools and OCR, metadata tools, speech to text (whisper.cpp), background
  removal and upscaling, similar-picture search, video trimming and GIFs, and a
  Game Boy Advance video player.

### For everyone

- Simple mode by default, an expert mode for all options; every option and
  format is explained in plain language (German and English).
- Purpose assistant ("for WhatsApp", "for printing" …), onboarding tour,
  glossary and FAQ.
- User accounts with a first-start setup page, or login via your reverse
  proxy; LDAP groups.
- Works offline as an installable app for converting on your device.
- Docker image for amd64 and arm64, in a standard and a full edition.
