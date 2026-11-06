/** Name for a converted file: "photo.final.PNG" + "webp" → "photo.final.webp". */
export function outputFileName(inputName: string, ext: string): string {
  const dot = inputName.lastIndexOf('.');
  const base = dot > 0 ? inputName.slice(0, dot) : inputName;
  return `${base}.${ext}`;
}
