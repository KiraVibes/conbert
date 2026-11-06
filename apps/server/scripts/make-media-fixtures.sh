#!/bin/sh
# Generates the tiny audio, video and document fixtures for the server tests.
# Needs ffmpeg and pandoc – run it in the Docker test image:
#   docker build -f apps/server/Dockerfile --target test -t conbert-test .
#   docker run --rm -v "$PWD/apps/server/src/__fixtures__:/out" conbert-test sh /repo/apps/server/scripts/make-media-fixtures.sh
set -eu
OUT="${1:-/out}"
cd "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"

# Half a second of a 440 Hz tone, mono, 8 kHz – a few kilobytes each.
$FF -f lavfi -i "sine=frequency=440:duration=0.5:sample_rate=8000" -ac 1 sample.wav
$FF -i sample.wav -c:a libmp3lame -b:a 32k sample.mp3
$FF -i sample.wav -c:a flac sample.flac
$FF -i sample.wav -c:a libvorbis -q:a 0 sample.ogg
$FF -i sample.wav -ar 48000 -c:a libopus -b:a 16k sample.opus
$FF -i sample.wav -c:a aac -b:a 32k sample.m4a

# Half a second of a 64×64 test picture at 10 fps, with sound.
$FF -f lavfi -i "testsrc=size=64x64:rate=10:duration=0.5" -f lavfi -i "sine=frequency=440:duration=0.5" \
  -c:v libx264 -pix_fmt yuv420p -crf 35 -c:a aac -b:a 32k -shortest sample.mp4
$FF -i sample.mp4 -c:v libvpx-vp9 -b:v 50k -c:a libopus -b:a 16k sample.webm
$FF -i sample.mp4 -c copy sample.mkv

# A small document with a heading, emphasis, a list and a table.
cat > sample.md <<'MD'
# Conbert Testdokument

Ein Absatz mit **fettem** und *kursivem* Text – und Umlauten: äöü ß.

- Punkt eins
- Punkt zwei

| Format | Gut für |
|--------|---------|
| DOCX   | Briefe  |
MD
pandoc sample.md -o sample.docx
pandoc sample.md -o sample.odt
pandoc sample.md -s -o sample.html --metadata title="Conbert Testdokument"

ls -la
