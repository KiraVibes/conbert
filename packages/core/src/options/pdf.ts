import type { EngineOption } from '../engine';

/** PDF compression (Ghostscript, or qpdf for "lossless"). */
export const PDF_COMPRESS_OPTIONS: EngineOption[] = [
  {
    key: 'pdfQuality',
    labelKey: 'options.pdfQuality.label',
    helpKey: 'options.pdfQuality.help',
    effectKey: 'options.pdfQuality.effect',
    advanced: false,
    type: 'select',
    default: 'ebook',
    choices: (['lossless', 'printer', 'ebook', 'screen'] as const).map((value) => ({
      value,
      labelKey: `options.pdfQuality.${value}`,
      helpKey: `options.pdfQuality.${value}Help`,
    })),
    appliesTo: ['pdf'],
  },
];

/** PDF pages as pictures. */
export const PDF_RENDER_OPTIONS: EngineOption[] = [
  {
    key: 'pdfPage',
    labelKey: 'options.pdfPage.label',
    helpKey: 'options.pdfPage.help',
    advanced: false,
    type: 'number',
    default: 1,
    min: 1,
    max: 500,
    step: 1,
    appliesTo: ['png', 'jpg'],
  },
  {
    key: 'pdfDpi',
    labelKey: 'options.pdfDpi.label',
    helpKey: 'options.pdfDpi.help',
    effectKey: 'options.pdfDpi.effect',
    advanced: true,
    type: 'select',
    default: '150',
    choices: ['72', '150', '300'].map((value) => ({ value, labelKey: `options.pdfDpi.d${value}` })),
    appliesTo: ['png', 'jpg'],
  },
];

export type PdfQuality = 'lossless' | 'printer' | 'ebook' | 'screen';

export function resolvePdfQuality(raw: Record<string, unknown>): PdfQuality {
  const q = raw['pdfQuality'];
  return q === 'lossless' || q === 'printer' || q === 'screen' ? q : 'ebook';
}

export function resolvePdfRender(raw: Record<string, unknown>): { page: number; dpi: number } {
  const page = Math.round(Number(raw['pdfPage']));
  const dpi = Number(raw['pdfDpi']);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    dpi: [72, 150, 300].includes(dpi) ? dpi : 150,
  };
}
