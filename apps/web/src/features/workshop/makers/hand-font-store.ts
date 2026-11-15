/**
 * The handwriting font built last in this tab, so "Brief in Handschrift"
 * can use it right away. Only in memory – gone after a reload.
 */
export interface RememberedFont {
  name: string;
  otf: ArrayBuffer;
}

let last: RememberedFont | null = null;

export function rememberHandFont(font: RememberedFont): void {
  last = font;
}

export function rememberedHandFont(): RememberedFont | null {
  return last;
}
