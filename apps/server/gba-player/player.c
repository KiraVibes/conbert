/*
 * Conbert GBA video player.
 *
 * Plays the "CGBV" video that Conbert appends behind this program (see
 * apps/server/src/engines/gba/rom.ts and codec.ts). Picture: mode 4 (240 × 160,
 * 256 colours, two pages), scaled up with the BG2 affine registers. Sound:
 * signed 8-bit PCM streamed from the cartridge by DMA 1 into Direct Sound A.
 * Timer 0 sets the sample rate; timers 1 + 2 count the played samples, which
 * is the clock the picture follows. Icons and the progress bar are sprites
 * with their own palette, so they never change the video's colours.
 *
 * Buttons:
 *   START / A  pause and play (or play again at the end)
 *   ← / →      10 seconds back / forward
 *   L / R      1 minute back / forward
 *   B          back to the start
 *   SELECT     endless playback on / off
 */
#include <stdint.h>

typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int16_t s16;
typedef int32_t s32;
typedef uint64_t u64;

#define REG16(a) (*(volatile u16 *)(a))
#define REG32(a) (*(volatile u32 *)(a))

#define REG_DISPCNT REG16(0x04000000)
#define REG_VCOUNT REG16(0x04000006)
#define REG_BG2PA REG16(0x04000020)
#define REG_BG2PB REG16(0x04000022)
#define REG_BG2PC REG16(0x04000024)
#define REG_BG2PD REG16(0x04000026)
#define REG_BG2X REG32(0x04000028)
#define REG_BG2Y REG32(0x0400002C)
#define REG_SOUNDCNT_L REG16(0x04000080)
#define REG_SOUNDCNT_H REG16(0x04000082)
#define REG_SOUNDCNT_X REG16(0x04000084)
#define FIFO_A_ADDR 0x040000A0u
#define REG_DMA1SAD REG32(0x040000BC)
#define REG_DMA1DAD REG32(0x040000C0)
#define REG_DMA1CNT_H REG16(0x040000C6)
#define REG_DMA3SAD REG32(0x040000D4)
#define REG_DMA3DAD REG32(0x040000D8)
#define REG_DMA3CNT REG32(0x040000DC)
#define REG_TM0CNT_L REG16(0x04000100)
#define REG_TM0CNT_H REG16(0x04000102)
#define REG_TM1CNT_L REG16(0x04000104)
#define REG_TM1CNT_H REG16(0x04000106)
#define REG_TM2CNT_L REG16(0x04000108)
#define REG_TM2CNT_H REG16(0x0400010A)
#define REG_TM3CNT_L REG16(0x0400010C)
#define REG_TM3CNT_H REG16(0x0400010E)
#define REG_KEYINPUT REG16(0x04000130)
#define REG_WAITCNT REG16(0x04000204)

#define PAL_BG ((volatile u16 *)0x05000000)
#define PAL_OBJ ((volatile u16 *)0x05000200)
#define VRAM_PAGE0 0x06000000u
#define VRAM_PAGE1 0x0600A000u
/* In bitmap modes sprite tiles start at 0x06014000 = tile 512. */
#define OBJ_TILE_BASE 512u
#define OBJ_TILES ((volatile u32 *)0x06010000)
#define OAM ((volatile u16 *)0x07000000)

#define KEY_A 0x0001
#define KEY_B 0x0002
#define KEY_SELECT 0x0004
#define KEY_START 0x0008
#define KEY_RIGHT 0x0010
#define KEY_LEFT 0x0020
#define KEY_R 0x0100
#define KEY_L 0x0200

#define DISP_MODE4 0x0004
#define DISP_PAGE 0x0010
#define DISP_OBJ_1D 0x0040
#define DISP_BG2 0x0400
#define DISP_OBJ 0x1000

#define DMA_ENABLE 0x80000000u
#define DMA_32BIT 0x04000000u
#define DMA_SRC_FIXED 0x01000000u

#define FLAG_SOUND 1
#define FLAG_LOOP 2
#define FRAME_KEY 1
#define MAX_PIXELS (240 * 160)
#define BLOCK 8

typedef struct {
  char magic[4];
  u16 version, flags;
  u16 width, height;
  s16 pa, pd;
  s32 bg2x, bg2y;
  u32 fps_num, fps_den;
  u32 frame_count;
  u32 audio_rate;
  u32 audio_offset, audio_length;
  u32 frames_offset;
  u32 timer_reload;
  u32 index_offset, index_count;
} Header;

typedef struct {
  u32 frame, offset;
} IndexEntry;

/* End of this program in the cartridge (from the devkitARM linker script). */
extern u8 __rom_end__[];

/* Work memory in EWRAM: the current picture and the unpacked frame data. */
static u8 framebuffer[MAX_PIXELS] __attribute__((section(".sbss"), aligned(4)));
static u8 scratch[MAX_PIXELS + 1024] __attribute__((section(".sbss"), aligned(4)));

static const Header *video;
static const IndexEntry *keyframes;
static const u8 *next_record;
static u32 frame; /* next frame to decode; the one on screen is frame − 1 */
static const u16 *pending_palette;
static u32 blocks_x, blocks, bitmap_bytes;
static int has_sound;
static int sound_on;

/* ---------------------------------------------------------------- helpers */

/* BIOS LZ77 decompression into work RAM. */
static void lz77_uncomp_wram(const void *src, void *dst) {
  register const void *r0 __asm__("r0") = src;
  register void *r1 __asm__("r1") = dst;
#if defined(__thumb__)
  __asm__ volatile("swi 0x11" : "+r"(r0), "+r"(r1) : : "r2", "r3", "memory");
#else
  __asm__ volatile("swi 0x110000" : "+r"(r0), "+r"(r1) : : "r2", "r3", "memory");
#endif
}

static void dma3_copy32(const void *src, volatile void *dst, u32 words) {
  REG_DMA3SAD = (u32)src;
  REG_DMA3DAD = (u32)dst;
  REG_DMA3CNT = words | DMA_ENABLE | DMA_32BIT;
}

static void dma3_fill32(u32 value, volatile void *dst, u32 words) {
  static volatile u32 fill;
  fill = value;
  REG_DMA3SAD = (u32)&fill;
  REG_DMA3DAD = (u32)dst;
  REG_DMA3CNT = words | DMA_ENABLE | DMA_32BIT | DMA_SRC_FIXED;
}

static void wait_vblank(void) {
  while (REG_VCOUNT >= 160) {
  }
  while (REG_VCOUNT < 160) {
  }
}

static const Header *find_video(void) {
  u32 p = ((u32)__rom_end__ + 255u) & ~255u;
  for (u32 i = 0; i < 1024; i++, p += 256) {
    const Header *h = (const Header *)p;
    if (h->magic[0] == 'C' && h->magic[1] == 'G' && h->magic[2] == 'B' && h->magic[3] == 'V' &&
        h->version == 2) {
      return h;
    }
  }
  return 0;
}

/* -------------------------------------------------------------- the clock */

/* Samples played since the start: timers 1 and 2 count timer 0 overflows. */
static u32 samples_played(void) {
  u16 hi, lo, hi2;
  do {
    hi = REG_TM2CNT_L;
    lo = REG_TM1CNT_L;
    hi2 = REG_TM2CNT_L;
  } while (hi != hi2);
  return ((u32)hi << 16) | lo;
}

/* When frame f is due, in samples. */
static u32 frame_due(u32 f) {
  return (u32)(((u64)f * video->audio_rate * video->fps_den) / video->fps_num);
}

static void stop_sound(void) {
  REG_DMA1CNT_H = 0;
  REG_SOUNDCNT_X = 0;
  sound_on = 0;
}

static void stop_clock(void) {
  REG_TM0CNT_H = 0;
  REG_TM1CNT_H = 0;
  REG_TM2CNT_H = 0;
  stop_sound();
}

/*
 * Puts the clock (and the sound) at sample `pos`. The counters take their
 * reload values when they are switched on, so the position is loaded that
 * way – and the reload values go back to 0 for later overflows.
 */
static void set_clock(u32 pos, int running) {
  stop_clock();
  pos &= ~3u; /* the sound DMA reads whole words */
  if (has_sound && pos < video->audio_length) {
    REG_SOUNDCNT_X = 0x0080; /* sound on */
    REG_SOUNDCNT_L = 0;
    REG_SOUNDCNT_H = 0x0B04; /* Direct Sound A: 100 %, left + right, timer 0, reset FIFO */
    REG_DMA1SAD = (u32)video + video->audio_offset + pos;
    REG_DMA1DAD = FIFO_A_ADDR;
    REG_DMA1CNT_H = 0xB640; /* enable, FIFO timing, 32 bit, repeat, fixed destination */
    sound_on = 1;
  }
  REG_TM1CNT_L = (u16)(pos & 0xFFFF);
  REG_TM2CNT_L = (u16)(pos >> 16);
  REG_TM2CNT_H = 0x0084; /* count timer 1 overflows */
  REG_TM1CNT_H = 0x0084; /* count timer 0 overflows = samples */
  REG_TM1CNT_L = 0;
  REG_TM2CNT_L = 0;
  REG_TM0CNT_L = (u16)video->timer_reload;
  if (running) REG_TM0CNT_H = 0x0080; /* run at the sample rate */
}

static void run_clock(int running) {
  REG_TM0CNT_H = running ? 0x0080 : 0;
}

/* ------------------------------------------------------------- the picture */

static void apply_blocks(void) {
  const u8 *bitmap = scratch;
  const u32 *data = (const u32 *)(scratch + bitmap_bytes);
  u32 width = video->width;
  for (u32 b = 0; b < blocks; b++) {
    if (!(bitmap[b >> 3] & (1u << (b & 7)))) continue;
    u32 bx = b % blocks_x;
    u32 by = b / blocks_x;
    u32 *dst = (u32 *)(framebuffer + by * BLOCK * width + bx * BLOCK);
    for (u32 y = 0; y < BLOCK; y++) {
      dst[0] = *data++;
      dst[1] = *data++;
      dst += width / 4;
    }
  }
}

static void decode_next(void) {
  const u8 *rec = next_record;
  u32 size = *(const u32 *)rec;
  const u8 *payload = rec + 8;
  if (rec[5]) {
    pending_palette = (const u16 *)payload;
    payload += 512;
  }
  if (rec[4] == FRAME_KEY) {
    lz77_uncomp_wram(payload, framebuffer);
  } else {
    lz77_uncomp_wram(payload, scratch);
    apply_blocks();
  }
  next_record = rec + size;
  frame++;
}

static void show_frame(void) {
  u32 page = (REG_DISPCNT & DISP_PAGE) ? VRAM_PAGE0 : VRAM_PAGE1;
  u32 width = video->width;
  for (u32 y = 0; y < video->height; y++) {
    dma3_copy32(framebuffer + y * width, (volatile void *)(page + y * 240), width / 4);
  }
  wait_vblank();
  if (pending_palette) {
    dma3_copy32(pending_palette, PAL_BG, 128);
    PAL_BG[0] = 0; /* black around the picture */
    pending_palette = 0;
  }
  REG_DISPCNT ^= DISP_PAGE;
}

/* Jumps to frame `target`: from the keyframe before it, decode forward. */
static void seek(s32 target, int running) {
  if (target < 0) target = 0;
  if ((u32)target >= video->frame_count) target = (s32)video->frame_count - 1;
  stop_clock();
  u32 k = 0;
  while (k + 1 < video->index_count && keyframes[k + 1].frame <= (u32)target) k++;
  next_record = (const u8 *)video + keyframes[k].offset;
  frame = keyframes[k].frame;
  while (frame <= (u32)target) decode_next();
  show_frame();
  set_clock(frame_due((u32)target), running);
}

/* ------------------------------------------------- icons and progress bar */

enum { ICON_PLAY, ICON_PAUSE, ICON_FORWARD, ICON_BACK, ICON_START, ICON_LOOP_ON, ICON_LOOP_OFF, ICONS };
#define TILE_BAR_FULL (ICONS * 4)
#define TILE_BAR_EMPTY (ICONS * 4 + 1)
#define BAR_SPRITES 28

/* 16 × 16 pixel art: '#' white, 'o' black outline, '+' accent, '-' grey, '.' clear. */
static const char *const ICON_ART[ICONS - 1][16] = {
    {"................", "..oo............", "..o#oo..........", "..o###oo........",
     "..o#####oo......", "..o#######oo....", "..o#########oo..", "..o###########o.",
     "..o###########o.", "..o#########oo..", "..o#######oo....", "..o#####oo......",
     "..o###oo........", "..o#oo..........", "..oo............", "................"},
    {"................", "..oooo....oooo..", "..o##o....o##o..", "..o##o....o##o..",
     "..o##o....o##o..", "..o##o....o##o..", "..o##o....o##o..", "..o##o....o##o..",
     "..o##o....o##o..", "..o##o....o##o..", "..o##o....o##o..", "..o##o....o##o..",
     "..o##o....o##o..", "..o##o....o##o..", "..oooo....oooo..", "................"},
    {"................", "................", "................", ".oo.....oo......",
     ".o#o....o#o.....", ".o##o...o##o....", ".o###o..o###o...", ".o####o.o####o..",
     ".o#####oo#####o.", ".o####o.o####o..", ".o###o..o###o...", ".o##o...o##o....",
     ".o#o....o#o.....", ".oo.....oo......", "................", "................"},
    {"................", "................", "................", "......oo.....oo.",
     ".....o#o....o#o.", "....o##o...o##o.", "...o###o..o###o.", "..o####o.o####o.",
     ".o#####oo#####o.", "..o####o.o####o.", "...o###o..o###o.", "....o##o...o##o.",
     ".....o#o....o#o.", "......oo.....oo.", "................", "................"},
    {"................", "................", "..ooo......oo...", "..o#o.....o#o...",
     "..o#o....o##o...", "..o#o...o###o...", "..o#o..o####o...", "..o#o.o#####o...",
     "..o#oo######o...", "..o#o.o#####o...", "..o#o..o####o...", "..o#o...o###o...",
     "..o#o....o##o...", "..o#o.....o#o...", "..ooo......oo...", "................"},
    {"................", ".....oooooo.....", "....o++++++o.o..", "...o++oooo++o+o.",
     "..o++o....o++++o", "..o+o......o++o.", "..o+o.......oo..", "..o+o...........",
     "...........o+o..", "..oo.......o+o..", ".o++o......o+o..", "o++++o....o++o..",
     ".o+o++oooo++o...", "..o.o++++++o....", ".....oooooo.....", "................"},
};

static u8 art_colour(char c) {
  switch (c) {
    case '#': return 1;
    case 'o': return 2;
    case '+': return 3;
    case '-': return 4;
    default: return 0;
  }
}

/* Writes one 16 × 16 icon as four 4-bit tiles (1D sprite mapping). */
static void put_icon(u32 icon, const char *const art[16], int crossed) {
  for (u32 t = 0; t < 4; t++) {
    volatile u32 *tile = OBJ_TILES + (OBJ_TILE_BASE + icon * 4 + t) * 8;
    for (u32 y = 0; y < 8; y++) {
      u32 row = 0;
      for (u32 x = 0; x < 8; x++) {
        u32 px = (t & 1) * 8 + x;
        u32 py = (t >> 1) * 8 + y;
        u8 c = art_colour(art[py][px]);
        if (crossed) {
          if (c == 3) c = 4; /* grey loop */
          if (px == py || px == py + 1) c = (px == py) ? 1 : 2; /* white slash */
        }
        row |= (u32)c << (x * 4);
      }
      tile[y] = row;
    }
  }
}

static void put_bar_tile(u32 index, u8 colour) {
  volatile u32 *tile = OBJ_TILES + (OBJ_TILE_BASE + index) * 8;
  for (u32 y = 0; y < 8; y++) {
    u8 c = (y == 0 || y == 7) ? 2 : (y >= 2 && y <= 5) ? colour : 2;
    u32 row = 0;
    for (u32 x = 0; x < 8; x++) row |= (u32)c << (x * 4);
    tile[y] = row;
  }
}

static void hide_sprite(u32 n) {
  OAM[n * 4] = 0x0200;
}

static void osd_init(void) {
  PAL_OBJ[1] = 0x7FFF;                         /* white */
  PAL_OBJ[2] = 0x0842;                         /* almost black */
  PAL_OBJ[3] = 17 | (11 << 5) | (30 << 10);    /* Conbert purple */
  PAL_OBJ[4] = 12 | (12 << 5) | (12 << 10);    /* grey */
  for (u32 i = 0; i < ICONS - 1; i++) put_icon(i, ICON_ART[i], 0);
  put_icon(ICON_LOOP_OFF, ICON_ART[ICON_LOOP_ON], 1);
  put_bar_tile(TILE_BAR_FULL, 3);
  put_bar_tile(TILE_BAR_EMPTY, 4);
  for (u32 n = 0; n < 128; n++) hide_sprite(n);
}

/* Sprite 0: the icon (top right). Sprites 1–28: the progress bar (bottom). */
static void osd_show(int icon, int bar) {
  static int last_icon = -2, last_bar = -1;
  static u32 last_filled = 0xFFFFFFFFu;
  u32 shown = frame > 0 ? frame - 1 : 0;
  u32 filled = bar ? (u32)(((u64)(shown + 1) * BAR_SPRITES) / video->frame_count) : 0;
  /* Only touch the sprites when something changed. */
  if (icon == last_icon && bar == last_bar && filled == last_filled) return;
  last_icon = icon;
  last_bar = bar;
  last_filled = filled;
  if (icon < 0) {
    hide_sprite(0);
  } else {
    OAM[0] = 8;                                    /* y, square, 4-bit colours */
    OAM[1] = 216 | (1u << 14);                     /* x, 16 × 16 */
    OAM[2] = (u16)(OBJ_TILE_BASE + (u32)icon * 4); /* tile, priority 0 */
  }
  for (u32 i = 0; i < BAR_SPRITES; i++) {
    u32 n = 1 + i;
    if (!bar) {
      hide_sprite(n);
      continue;
    }
    OAM[n * 4] = 148;
    OAM[n * 4 + 1] = (u16)(8 + i * 8);
    OAM[n * 4 + 2] = (u16)(OBJ_TILE_BASE + (i < filled ? TILE_BAR_FULL : TILE_BAR_EMPTY));
  }
}

/* Timer 3 at 16 384 Hz – a clock for how long icons stay visible. */
#define OSD_TICKS 24576u /* 1.5 seconds */
static u16 osd_since;
static int osd_icon = -1;

static void osd_flash(int icon) {
  osd_icon = icon;
  osd_since = REG_TM3CNT_L;
}

static void error_screen(void) {
  REG_DISPCNT = 0x0080; /* forced blank → white screen */
  for (;;) {
  }
}

/* -------------------------------------------------------------------- main */

int main(void) {
  REG_WAITCNT = 0x4317; /* faster cartridge access with prefetch */
  REG_DISPCNT = 0x0080; /* blank while setting up */

  video = find_video();
  if (!video || video->width > 240 || video->height > 160 || video->width % BLOCK ||
      video->height % BLOCK || video->fps_num == 0 || video->fps_den == 0 ||
      video->audio_rate == 0 || video->index_count == 0 || video->frame_count == 0) {
    error_screen();
  }
  keyframes = (const IndexEntry *)((const u8 *)video + video->index_offset);
  blocks_x = video->width / BLOCK;
  blocks = blocks_x * (video->height / BLOCK);
  bitmap_bytes = ((blocks + 7) / 8 + 3) & ~3u;
  has_sound = (video->flags & FLAG_SOUND) != 0;
  int loop = (video->flags & FLAG_LOOP) != 0;

  for (u32 i = 0; i < 256; i++) PAL_BG[i] = 0;
  dma3_fill32(0, (volatile void *)VRAM_PAGE0, 0x14000 / 4); /* both pages */
  REG_BG2PA = (u16)video->pa;
  REG_BG2PB = 0;
  REG_BG2PC = 0;
  REG_BG2PD = (u16)video->pd;
  REG_BG2X = (u32)video->bg2x;
  REG_BG2Y = (u32)video->bg2y;
  osd_init();
  REG_TM3CNT_L = 0;
  REG_TM3CNT_H = 0x0083; /* run, prescaler 1024 */
  REG_DISPCNT = DISP_MODE4 | DISP_BG2 | DISP_OBJ | DISP_OBJ_1D;

  u32 end_samples = frame_due(video->frame_count);
  if (has_sound && video->audio_length > end_samples) end_samples = video->audio_length;
  s32 step_short = (s32)((10 * video->fps_num) / video->fps_den);
  s32 step_long = (s32)((60 * video->fps_num) / video->fps_den);

  u16 previous_keys = 0;
  int paused = 0;
  int finished = 0;
  seek(0, 1);

  for (;;) {
    u16 keys = (u16)(~REG_KEYINPUT & 0x03FF);
    u16 pressed = keys & (u16)~previous_keys;
    previous_keys = keys;
    s32 shown = (s32)frame - 1;

    if (pressed & KEY_SELECT) {
      loop = !loop;
      osd_flash(loop ? ICON_LOOP_ON : ICON_LOOP_OFF);
    }
    if (pressed & KEY_B) {
      finished = 0;
      seek(0, !paused);
      osd_flash(ICON_START);
    } else if (pressed & (KEY_START | KEY_A)) {
      if (finished) {
        finished = 0;
        paused = 0;
        seek(0, 1);
        osd_flash(ICON_PLAY);
      } else {
        paused = !paused;
        run_clock(!paused);
        osd_flash(paused ? ICON_PAUSE : ICON_PLAY);
      }
    } else if (pressed & (KEY_LEFT | KEY_RIGHT | KEY_L | KEY_R)) {
      s32 step = (pressed & (KEY_L | KEY_R)) ? step_long : step_short;
      int forward = (pressed & (KEY_RIGHT | KEY_R)) != 0;
      if (finished && forward) {
        osd_flash(ICON_FORWARD);
      } else {
        finished = 0;
        seek(forward ? shown + step : shown - step, !paused);
        osd_flash(forward ? ICON_FORWARD : ICON_BACK);
      }
    }

    /* Icons: a pressed action for a moment, the pause symbol while paused. */
    int flashing = osd_icon >= 0 && (u16)(REG_TM3CNT_L - osd_since) < OSD_TICKS;
    if (!flashing) osd_icon = -1;
    int icon = flashing ? osd_icon : (paused ? ICON_PAUSE : (finished ? ICON_PLAY : -1));
    osd_show(icon, paused || finished || flashing);

    if (paused || finished) continue;

    u32 now = samples_played();
    if (sound_on && now >= video->audio_length) stop_sound(); /* never play past the end */
    if (frame < video->frame_count && frame_due(frame) <= now) {
      decode_next();
      /* Behind? Decode the next one too instead of showing this one. */
      if (frame < video->frame_count && frame_due(frame) <= samples_played()) continue;
      show_frame();
    } else if (frame >= video->frame_count && now >= end_samples) {
      if (loop) {
        seek(0, 1);
      } else {
        stop_clock();
        finished = 1;
      }
    }
  }
}
