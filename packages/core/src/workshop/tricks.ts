/**
 * The FileWizard workshop: playful but useful file tricks. Each trick has a
 * card (title, teaser, "how it works") under `workshop.tricks.<id>.*`.
 */

export type WorkshopGroup = 'xray' | 'forensics' | 'hide' | 'protect' | 'fun' | 'tools';

export interface WorkshopTrick {
  id: string;
  group: WorkshopGroup;
}

/** Tricks that are ready (more follow step by step in Phase 10). */
export const WORKSHOP_TRICKS: readonly WorkshopTrick[] = [
  { id: 'identify', group: 'xray' },
  { id: 'hex', group: 'xray' },
  { id: 'hashes', group: 'xray' },
  { id: 'entropy', group: 'xray' },
  { id: 'detective', group: 'hide' },
  { id: 'stego', group: 'hide' },
  { id: 'audiostego', group: 'hide' },
  { id: 'archiveimage', group: 'hide' },
  { id: 'polyglot', group: 'hide' },
  { id: 'spectrogram', group: 'hide' },
  { id: 'metasecret', group: 'hide' },
  { id: 'ela', group: 'forensics' },
  { id: 'thumbcheck', group: 'forensics' },
  { id: 'vault', group: 'protect' },
  { id: 'privacy', group: 'protect' },
  { id: 'treasure', group: 'protect' },
  { id: 'ciphers', group: 'hide' },
  { id: 'invisible', group: 'hide' },
  { id: 'ascii', group: 'fun' },
  { id: 'pixelart', group: 'fun' },
  { id: 'emojimosaic', group: 'fun' },
  { id: 'ringtone', group: 'fun' },
  { id: 'audiovideo', group: 'fun' },
  { id: 'thumbprank', group: 'fun' },
  { id: 'glitch', group: 'fun' },
  { id: 'deepfry', group: 'fun' },
  { id: 'qr', group: 'fun' },
  { id: 'favicon', group: 'fun' },
  { id: 'repair', group: 'tools' },
  { id: 'encode', group: 'tools' },
  { id: 'split', group: 'tools' },
  { id: 'testfiles', group: 'tools' },
  { id: 'compare', group: 'xray' },
  { id: 'extractimages', group: 'tools' },
  { id: 'scanner', group: 'tools' },
];

export const WORKSHOP_GROUPS: readonly WorkshopGroup[] = [
  'xray',
  'forensics',
  'hide',
  'protect',
  'fun',
  'tools',
];

export function workshopTrickKeys(id: string): string[] {
  const base = `workshop.tricks.${id}`;
  return [`${base}.title`, `${base}.teaser`, `${base}.how`];
}

export function isWorkshopTrick(id: string): boolean {
  return WORKSHOP_TRICKS.some((t) => t.id === id);
}

/** Workshop tricks a workflow can run on the server. */
export const WORKFLOW_TRICKS = ['fix-extension', 'strip-appended', 'repair', 'encrypt'] as const;
export type WorkflowTrick = (typeof WORKFLOW_TRICKS)[number];
