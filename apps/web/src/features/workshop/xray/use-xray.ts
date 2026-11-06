import { useEffect, useState } from 'react';
import { identifyFile, type FileIdentity, type FileStructure } from '@conbert/core';
import { detectFileType } from '@/lib/detect-type';
import { readStructure } from '../workshop-worker';

export interface Xray {
  identity: FileIdentity | null;
  /** null = not a format the hex viewer can explain. */
  structure: FileStructure | null;
  /** The first bytes (for "how was it recognised?"). */
  head: Uint8Array;
  loading: boolean;
}

const HEAD_BYTES = 4096;
const EMPTY: Xray = { identity: null, structure: null, head: new Uint8Array(0), loading: false };

/** What a file really is and how it is built – read once, shared by all panels. */
export function useXray(file: File | null): Xray {
  const [result, setResult] = useState<{ file: File; xray: Xray } | null>(null);

  useEffect(() => {
    if (!file) return;
    let active = true;
    void (async () => {
      const [type, head] = await Promise.all([
        detectFileType(file),
        file
          .slice(0, HEAD_BYTES)
          .arrayBuffer()
          .then((b) => new Uint8Array(b)),
      ]);
      const identity = identifyFile({ name: file.name, detectedExt: type.detectedExt, head });
      const ext = identity.realExt ?? identity.nameExt;
      const structure = ext ? await readStructure(file, ext).catch(() => null) : null;
      if (active) setResult({ file, xray: { identity, structure, head, loading: false } });
    })();
    return () => {
      active = false;
    };
  }, [file]);

  if (!file) return EMPTY;
  return result?.file === file ? result.xray : { ...EMPTY, loading: true };
}
