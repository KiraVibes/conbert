import type { AfterDownload } from '@conbert/schemas';

/** Quick single actions – no saved workflow needed. */
export const QUICK_ACTIONS: Record<string, AfterDownload> = {
  'to-webp': {
    steps: [
      { kind: 'filter', rule: { category: ['image'] } },
      { kind: 'convert', outputExt: 'webp', options: {} },
    ],
  },
  'to-jpg': {
    steps: [
      { kind: 'filter', rule: { category: ['image'] } },
      { kind: 'convert', outputExt: 'jpg', options: {} },
    ],
  },
  'to-mp4': {
    steps: [
      { kind: 'filter', rule: { category: ['video'] } },
      { kind: 'convert', outputExt: 'mp4', options: {} },
    ],
  },
  'to-mp3': {
    steps: [
      { kind: 'filter', rule: { category: ['audio', 'video'] } },
      { kind: 'convert', outputExt: 'mp3', options: {} },
    ],
  },
  compress: { steps: [{ kind: 'compress', preset: 'balanced' }] },
};

/** The value as kept in the dialog: '' = nothing, 'quick:…' or 'wf:<id>'. */
export function afterFromValue(value: string): AfterDownload {
  if (value.startsWith('wf:')) return { workflowId: value.slice(3) };
  if (value.startsWith('quick:')) return QUICK_ACTIONS[value.slice(6)] ?? null;
  return null;
}
