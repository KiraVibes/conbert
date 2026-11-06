import { nearestColor, type Pixels } from './fun-image';

/**
 * Emoji-Mosaik: a picture rebuilt from emojis. Every square of the picture
 * becomes the emoji whose colour comes closest. The emojis' colours are
 * measured where they are drawn (each device has its own emoji font), so
 * this module only gets them as numbers.
 */

// prettier-ignore
export const EMOJI_SETS = {
  colors: [
    '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪',
    '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍',
  ],
  nature: [
    '🌲', '🌳', '🌴', '🌵', '🍀', '🌿', '🌻', '🌹', '🌸', '🌺', '🌼', '🍁',
    '🍂', '🌊', '🔥', '⛄', '☁️', '🌙', '⭐', '🌈', '🪨', '🌑', '🌕', '❄️',
  ],
  food: [
    '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🥝', '🥑', '🥦', '🥕',
    '🌽', '🍆', '🍞', '🧀', '🍫', '🍩', '🍪', '🍰', '🥥', '🍄', '🍅', '🍑',
  ],
  animals: [
    '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷',
    '🐸', '🐵', '🐔', '🐧', '🐤', '🦄', '🐝', '🐞', '🦋', '🐢', '🐙', '🦀',
    '🐬', '🐳', '🐟', '🦩',
  ],
  faces: [
    '😀', '😊', '😍', '😎', '😡', '🥶', '🤢', '😈', '👽', '💀', '🤖', '🎃',
    '👻', '😱', '🥵', '🤡', '😺', '🙈', '💩', '🌚', '🌝',
  ],
} as const satisfies Record<string, readonly string[]>;

export type EmojiSet = keyof typeof EMOJI_SETS | 'mix';
export const EMOJI_SET_IDS = ['colors', 'nature', 'food', 'animals', 'faces', 'mix'] as const;

export function emojisOf(set: EmojiSet): string[] {
  if (set === 'mix') return [...new Set(Object.values(EMOJI_SETS).flat())];
  return [...EMOJI_SETS[set]];
}

export const MOSAIC_MIN_COLUMNS = 10;
export const MOSAIC_MAX_COLUMNS = 120;
/** Very tall pictures are cut off below this many rows. */
export const MOSAIC_MAX_ROWS = 360;

export type Rgb = readonly [number, number, number];

export interface EmojiMosaic {
  columns: number;
  rows: number;
  /** Index into the emoji list per cell, row by row; -1 = see-through (left empty). */
  cells: Int16Array;
}

/**
 * The emoji per square. `colors[i]` is the average colour of emoji i.
 * Squares that are mostly see-through stay empty.
 */
export function emojiMosaic(img: Pixels, columns: number, colors: readonly Rgb[]): EmojiMosaic {
  const cols = Math.max(1, Math.min(columns, img.width));
  const cell = img.width / cols;
  const rows = Math.max(1, Math.min(MOSAIC_MAX_ROWS, Math.round(img.height / cell)));
  const cellH = img.height / rows;
  const cells = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cell);
      const x1 = Math.max(x0 + 1, Math.floor((c + 1) * cell));
      const y0 = Math.floor(r * cellH);
      const y1 = Math.max(y0 + 1, Math.floor((r + 1) * cellH));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const a = (img.data[i + 3] ?? 0) / 255;
          red += (img.data[i] ?? 0) * a;
          green += (img.data[i + 1] ?? 0) * a;
          blue += (img.data[i + 2] ?? 0) * a;
          alpha += a;
          count++;
        }
      }
      const index = r * cols + c;
      if (alpha < count / 2) {
        cells[index] = -1;
        continue;
      }
      const best = nearestColor(colors, red / alpha, green / alpha, blue / alpha);
      cells[index] = colors.indexOf(best);
    }
  }
  return { columns: cols, rows, cells };
}

/** U+3000, a space as wide as an emoji (written as a code, prettier would turn it into the raw character). */
const WIDE_SPACE = String.fromCharCode(0x3000);
const TRAILING_SPACE = new RegExp(`${WIDE_SPACE}+$`);

/** The mosaic as text, one line per row (empty squares as a wide space). */
export function mosaicText(mosaic: EmojiMosaic, emojis: readonly string[]): string {
  const lines: string[] = [];
  for (let r = 0; r < mosaic.rows; r++) {
    let line = '';
    for (let c = 0; c < mosaic.columns; c++) {
      const index = mosaic.cells[r * mosaic.columns + c] ?? -1;
      line += index < 0 ? WIDE_SPACE : (emojis[index] ?? WIDE_SPACE);
    }
    lines.push(line.replace(TRAILING_SPACE, ''));
  }
  return lines.join('\n');
}

/**
 * Average colour of a drawn emoji (RGBA pixels of its square). Thin edges
 * count less than solid colour, see-through pixels not at all. Null when
 * nothing was drawn (the device has no such emoji).
 */
export function averageColor(data: ArrayLike<number>): Rgb | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = (data[i + 3] ?? 0) / 255;
    if (a < 0.1) continue;
    red += (data[i] ?? 0) * a;
    green += (data[i + 1] ?? 0) * a;
    blue += (data[i + 2] ?? 0) * a;
    weight += a;
  }
  if (weight < 1) return null;
  return [Math.round(red / weight), Math.round(green / weight), Math.round(blue / weight)];
}
