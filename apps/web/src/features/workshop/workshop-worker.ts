import * as Comlink from 'comlink';
import type {
  DetectiveReport,
  EntropyProfile,
  FileStructure,
  HashAlgorithm,
  HiddenContent,
  ZipEntry,
} from '@conbert/core';
import type {
  ArchiveSource,
  AudioCover,
  SpectrogramPicture,
  ToneResult,
  StegoCover,
  StegoResult,
  BytesResult,
  VaultError,
  VaultResult,
  WorkshopWorkerApi,
} from '@/workers/workshop.worker';

export type {
  ArchiveSource,
  AudioCover,
  SpectrogramPicture,
  ToneResult,
  BytesResult,
  StegoCover,
  StegoResult,
  VaultError,
  VaultResult,
};

function spawn(): { api: Comlink.Remote<WorkshopWorkerApi>; stop: () => void } {
  const worker = new Worker(new URL('../../workers/workshop.worker.ts', import.meta.url), {
    type: 'module',
    name: 'workshop',
  });
  const api = Comlink.wrap<WorkshopWorkerApi>(worker);
  return {
    api,
    stop: () => {
      api[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}

/** One shared worker for the quick jobs (structure, entropy). */
let shared: ReturnType<typeof spawn> | null = null;
function sharedApi(): Comlink.Remote<WorkshopWorkerApi> {
  shared ??= spawn();
  return shared.api;
}

export function readStructure(file: Blob, ext: string): Promise<FileStructure | null> {
  return sharedApi().structure(file, ext);
}

export function readEntropy(file: Blob): Promise<EntropyProfile> {
  return sharedApi().entropy(file);
}

export function runScan(
  file: Blob,
  ext: string | null,
  onProgress: (bytesDone: number) => void,
): Promise<DetectiveReport> {
  return sharedApi().scan(file, ext, Comlink.proxy(onProgress));
}

export function extractEntry(
  file: Blob,
  offset: number,
  length: number,
  entry: ZipEntry,
): Promise<BytesResult> {
  return sharedApi().extract(file, offset, length, entry);
}

export function unlockEntry(
  file: Blob,
  offset: number,
  length: number,
  entry: ZipEntry,
  password: string,
): Promise<BytesResult> {
  return sharedApi().unlock(
    file,
    offset,
    length,
    { name: entry.name, offset: entry.offset },
    password,
  );
}

export function carvePart(
  file: Blob,
  offset: number,
  length: number,
  format: string | null,
): Promise<BytesResult> {
  return sharedApi().carve(file, offset, length, format);
}

export interface HashJob {
  result: Promise<Partial<Record<HashAlgorithm, string>>>;
  /** Stops at once (the worker is thrown away). */
  cancel: () => void;
}

/** Checksums get their own worker, so cancelling a 4 GB file is instant. */
export function computeHashes(
  file: Blob,
  algorithms: HashAlgorithm[],
  onProgress: (bytesDone: number) => void,
): HashJob {
  const { api, stop } = spawn();
  let stopped = false;
  // A released proxy throws when touched again, so stop only once.
  const stopOnce = () => {
    if (stopped) return;
    stopped = true;
    stop();
  };
  const result = api.hash(file, algorithms, Comlink.proxy(onProgress)).finally(stopOnce);
  return { result, cancel: stopOnce };
}

export function searchFile(
  file: Blob,
  pattern: Uint8Array,
  from: number,
  backwards: boolean,
): Promise<number> {
  return sharedApi().search(file, pattern, from, backwards);
}

/** age in the worker: scrypt and encryption take a moment and must not freeze the page. */
export const vaultWorker = {
  newKey: () => sharedApi().newKey(),
  publicKeyOf: (identity: string) => sharedApi().publicKeyOf(identity),
  lockKey: (identity: string, password: string) => sharedApi().lockKey(identity, password),
  unlockKey: (locked: string, password: string) => sharedApi().unlockKey(locked, password),
  encryptFile: (file: Blob, to: { recipients: string[] } | { passphrase: string }) =>
    sharedApi().encryptFile(file, to),
  decryptFile: (file: Blob, with_: { identity: string } | { passphrase: string }) =>
    sharedApi().decryptFile(file, with_),
};

/** Privacy check, repair and the forgery detector – all in the worker. */
export const inspectWorker = {
  officePrivacy: (file: Blob) => sharedApi().officePrivacy(file),
  repair: (file: Blob, name: string, detectedExt: string | null, cutAppended: boolean) =>
    sharedApi().repair(file, name, detectedExt, cutAppended),
  compareThumbnail: (picture: Blob, thumbnail: Blob) =>
    sharedApi().compareThumbnail(picture, thumbnail),
  ela: (picture: Blob, quality: number, amplify: number) =>
    sharedApi().ela(picture, quality, amplify),
};

/** Steganography – decoding, hiding and the password key all take a moment. */
export const stegoWorker = {
  cover: (picture: Blob) => sharedApi().stegoCover(picture),
  hide: (cover: Blob, content: HiddenContent, password: string, bits: 1 | 2) =>
    sharedApi().stegoHide(cover, content, password, bits),
  reveal: (picture: Blob, password: string) => sharedApi().stegoReveal(picture, password),
  traces: (picture: Blob) => sharedApi().stegoTraces(picture),
};

/** Steganography in WAV audio (other formats are turned into WAV first). */
export const audioStegoWorker = {
  cover: (wav: Blob) => sharedApi().audioCover(wav),
  hide: (wav: Blob, content: HiddenContent, password: string, bits: 1 | 2) =>
    sharedApi().audioHide(wav, content, password, bits),
  reveal: (wav: Blob, password: string) => sharedApi().audioReveal(wav, password),
};

/** Picture in the spectrogram, and the spectrogram of a sound. */
export const spectroWorker = {
  pictureToSound: (
    picture: Blob,
    options: { seconds: number; minHz: number; maxHz: number },
    invert: 'auto' | boolean,
  ) => sharedApi().pictureToSound(picture, options, invert),
  spectrogram: (samples: Float32Array, sampleRate: number, fftSize: number) =>
    sharedApi().soundSpectrogram(Comlink.transfer(samples, [samples.buffer]), sampleRate, fftSize),
};

/** Archive in a picture and polyglot files. */
export const archiveWorker = {
  hide: (cover: Blob, source: ArchiveSource, inside: boolean) =>
    sharedApi().hideArchive(cover, source, inside),
};
