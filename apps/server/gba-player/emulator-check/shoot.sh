# usage: shoot.sh module.gba output-dir step...
#   wait:<seconds>   let the video play
#   shot:<name>      save the GBA screen (2×) as <name>.png
#   key:<key>        press a button – mGBA keys: x = A, z = B, a = L, s = R,
#                    Return = START, BackSpace = SELECT, Left/Right/Up/Down
# The sound is recorded to audio.raw (s16le stereo 44.1 kHz).
ROM=$1
OUT=$2
shift 2
Xvfb :99 -screen 0 640x480x24 >/dev/null 2>&1 &
sleep 1
export DISPLAY=:99 SDL_AUDIODRIVER=disk SDL_DISKAUDIOFILE="$OUT/audio.raw"
/usr/games/mgba -2 "$ROM" >/tmp/mgba.log 2>&1 &
sleep 1
for step in "$@"; do
  arg=${step#*:}
  case "$step" in
    wait:*) sleep "$arg" ;;
    shot:*) import -window root -crop 480x320+80+80 "$OUT/$arg.png" ;;
    key:*)
      win=$(xdotool search --class mgba | head -1)
      xdotool keydown --window "$win" "$arg"
      sleep 0.15
      xdotool keyup --window "$win" "$arg"
      ;;
  esac
done
