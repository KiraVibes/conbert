# Plays a .gba module in the mGBA emulator (headless), presses buttons and
# takes screenshots plus a recording of the sound. Manual check for changes
# to player.c:
#   docker build -t conbert-gba-check apps/server/gba-player/emulator-check
#   docker run --rm -v "$PWD/out:/w" conbert-gba-check /w/video.gba /w \
#     wait:3 shot:start key:Right wait:0.5 shot:forward
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends mgba-sdl xvfb imagemagick xauth xdotool \
 && rm -rf /var/lib/apt/lists/*
COPY shoot.sh /shoot.sh
ENTRYPOINT ["sh", "/shoot.sh"]
