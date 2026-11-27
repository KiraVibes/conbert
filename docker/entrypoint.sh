#!/bin/sh
# Conbert's container start. Runs as root only long enough to make sure the
# data folder belongs to the user Conbert runs as, then drops to that user.
#
# PUID / PGID: the user and group Conbert runs as (default 1000:1000, the
# image's "node" user). On Unraid and many NAS systems shares belong to
# 99:100 (nobody:users) - set PUID=99 and PGID=100 there.
#
# Started with --user / "user:" already: nothing to do, Conbert just runs.
set -eu

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
case "$PUID:$PGID" in
  *[!0-9:]* | :* | *:)
    echo "conbert: PUID and PGID must be numbers (got PUID=$PUID PGID=$PGID)" >&2
    exit 1
    ;;
esac
if [ "$PUID" = 0 ]; then
  echo "conbert: PUID=0 would run Conbert as root - use the owner of your data folder instead" >&2
  exit 1
fi

DATA="${CONBERT_DATA_DIR:-/data}"
# Only Conbert's own folders - never the mounted shares below /storage.
for dir in "$DATA" /opt/conbert/downloader /home/node; do
  mkdir -p "$dir"
  if [ "$(stat -c '%u:%g' "$dir")" != "$PUID:$PGID" ]; then
    echo "conbert: handing $dir over to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$dir"
  fi
done

# Keep extra groups given to the container (e.g. "video"/"render" for the
# graphics card), but never root's own group.
groups="$(id -G | tr ' ' '\n' | grep -vx 0 | paste -sd, - || true)"
if [ -n "$groups" ]; then
  set -- --groups="$groups" "$@"
else
  set -- --clear-groups "$@"
fi

export HOME=/home/node
exec setpriv --reuid="$PUID" --regid="$PGID" --inh-caps=-all "$@"
