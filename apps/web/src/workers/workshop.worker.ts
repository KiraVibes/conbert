import * as Comlink from 'comlink';
import {
  Decrypter,
  Encrypter,
  armor,
  generateX25519Identity,
  identityToRecipient,
} from 'age-encryption';
import {
  createBLAKE3,
  createCRC32,
  createMD5,
  createSHA1,
  createSHA256,
  createSHA512,
  type IHasher,
} from 'hash-wasm';
import {
  StegoError,
  WorkshopError,
  hideArchiveInPicture,
  makePolyglot,
  packZip,
  unlockZipEntry,
  blobReader,
  chiSquareProfile,
  decodeRaster,
  encodeBmp,
  encodePng,
  hideInRaster,
  lsbPlane,
  peekHidden,
  carrierCapacity,
  hideInCarrier,
  parseWav,
  peekCarrier,
  revealFromCarrier,
  wavCarrier,
  wavDuration,
  TONE_DEFAULTS,
  TONE_ROWS,
  averageBrightness,
  colorize,
  encodeWav,
  imageToSound,
  spectrogram,
  toGray,
  toneColumns,
  type Spectrogram,
  type ToneOptions,
  revealFromRaster,
  stegoCapacity,
  detectiveScan,
  entropyProfile,
  extractZipEntry,
  normalizeZip,
  parseStructure,
  privacyFromOffice,
  repairFile,
  searchBytes,
  sliceReader,
  type DetectiveReport,
  type EntropyProfile,
  type FileStructure,
  type HashAlgorithm,
  type HiddenContent,
  type HiddenInfo,
  type Raster,
  type StegoErrorCode,
  type PrivacyFinding,
  type RepairFix,
  type WorkshopErrorCode,
  type ZipEntry,
} from '@conbert/core';

/** Bytes, or the reason why not – errors keep their code across the worker boundary. */
export type BytesResult =
  { ok: true; data: Uint8Array } | { ok: false; code: WorkshopErrorCode; detail?: string };

async function bytesResult(work: () => Promise<Uint8Array>): Promise<BytesResult> {
  try {
    const data = await work();
    return Comlink.transfer({ ok: true, data }, [data.buffer]);
  } catch (error) {
    if (error instanceof WorkshopError) {
      return { ok: false, code: error.code, ...(error.details && { detail: error.details }) };
    }
    throw error;
  }
}

/** Why opening an age file failed – shown in plain words in the page. */
export type VaultError = 'wrong-password' | 'wrong-key' | 'not-age';
export type VaultResult<T> = { ok: true; value: T } | { ok: false; code: VaultError };

const ARMOR = '-----BEGIN AGE ENCRYPTED FILE-----';

/** Armored (text) or binary age file → a stream of the binary file. */
async function ageInput(blob: Blob): Promise<ReadableStream<Uint8Array>> {
  const head = await blob.slice(0, ARMOR.length).text();
  if (head === ARMOR) {
    const bytes = armor.decode(await blob.text());
    return new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
  }
  return blob.stream();
}

function vaultError(error: unknown, passphrase: boolean): VaultError {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid|header|version|armor|base64/i.test(message) && !/no identity/i.test(message)) {
    return 'not-age';
  }
  return passphrase ? 'wrong-password' : 'wrong-key';
}

/** age: key pairs, locking the private key, encrypting and decrypting files. */
const vault = {
  async newKey(): Promise<{ identity: string; publicKey: string }> {
    const identity = await generateX25519Identity();
    return { identity, publicKey: await identityToRecipient(identity) };
  },

  async publicKeyOf(identity: string): Promise<string | null> {
    return identityToRecipient(identity.trim()).catch(() => null);
  },

  /** Locks the private key with the vault password (scrypt) – as an armored text. */
  async lockKey(identity: string, password: string): Promise<string> {
    const e = new Encrypter();
    e.setPassphrase(password);
    return armor.encode(await e.encrypt(identity));
  },

  async unlockKey(locked: string, password: string): Promise<VaultResult<string>> {
    try {
      const d = new Decrypter();
      d.addPassphrase(password);
      const identity = await d.decrypt(armor.decode(locked.trim()), 'text');
      return { ok: true, value: identity.trim() };
    } catch (error) {
      return { ok: false, code: vaultError(error, true) };
    }
  },

  async encryptFile(
    blob: Blob,
    to: { recipients: string[] } | { passphrase: string },
  ): Promise<Blob> {
    const e = new Encrypter();
    if ('passphrase' in to) e.setPassphrase(to.passphrase);
    else for (const r of to.recipients) e.addRecipient(r);
    const out = await e.encrypt(blob.stream());
    return new Response(out).blob();
  },

  async decryptFile(
    blob: Blob,
    with_: { identity: string } | { passphrase: string },
  ): Promise<VaultResult<Blob>> {
    const passphrase = 'passphrase' in with_;
    try {
      const d = new Decrypter();
      if ('passphrase' in with_) d.addPassphrase(with_.passphrase);
      else d.addIdentity(with_.identity);
      const out = await d.decrypt(await ageInput(blob));
      return { ok: true, value: await new Response(out).blob() };
    } catch (error) {
      return { ok: false, code: vaultError(error, passphrase) };
    }
  },
};

const CREATE: Record<HashAlgorithm, () => Promise<IHasher>> = {
  md5: createMD5,
  sha1: createSHA1,
  sha256: createSHA256,
  sha512: createSHA512,
  crc32: () => createCRC32(),
  blake3: () => createBLAKE3(),
};

/** The workshop's heavy lifting, away from the page so it stays responsive. */
const api = {
  /** All checksums in one pass over the file (read once, fed to every hasher). */
  async hash(
    blob: Blob,
    algorithms: HashAlgorithm[],
    onProgress: (bytesDone: number) => void,
  ): Promise<Partial<Record<HashAlgorithm, string>>> {
    const hashers = await Promise.all(algorithms.map((a) => CREATE[a]()));
    for (const h of hashers) h.init();
    const reader = blob.stream().getReader();
    let done = 0;
    let reported = 0;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      for (const h of hashers) h.update(value);
      done += value.byteLength;
      // About every 1 % (and at least every 8 MB) – enough for a smooth bar.
      if (done - reported >= Math.min(8 * 1024 * 1024, blob.size / 100)) {
        reported = done;
        onProgress(done);
      }
    }
    onProgress(blob.size);
    return Object.fromEntries(algorithms.map((a, i) => [a, hashers[i]?.digest('hex') ?? '']));
  },

  entropy(blob: Blob): Promise<EntropyProfile> {
    return entropyProfile(blobReader(blob));
  },

  structure(blob: Blob, ext: string): Promise<FileStructure | null> {
    return parseStructure(blobReader(blob), ext);
  },

  scan(
    blob: Blob,
    ext: string | null,
    onProgress: (bytesDone: number) => void,
  ): Promise<DetectiveReport> {
    return detectiveScan(blobReader(blob), ext, onProgress);
  },

  /** Where the pattern appears next (or before `from` when going back); -1 = nowhere. */
  search(blob: Blob, pattern: Uint8Array, from: number, backwards: boolean): Promise<number> {
    return searchBytes(blobReader(blob), pattern, from, backwards);
  },

  /** One file out of an archive that sits at `offset` inside the blob. */
  extract(blob: Blob, offset: number, length: number, entry: ZipEntry): Promise<BytesResult> {
    return bytesResult(() => extractZipEntry(sliceReader(blobReader(blob), offset, length), entry));
  },

  /** An entry of a password-protected ZIP inside the file. */
  unlock(
    blob: Blob,
    offset: number,
    length: number,
    entry: { name: string; offset: number },
    password: string,
  ): Promise<BytesResult> {
    return bytesResult(async () => {
      const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
      return unlockZipEntry(await normalizeZip(bytes), entry, password);
    });
  },

  /** A part of the file on its own – an archive made openable on its own again. */
  carve(blob: Blob, offset: number, length: number, format: string | null): Promise<BytesResult> {
    return bytesResult(async () => {
      const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
      if (format !== 'zip') return bytes;
      return normalizeZip(bytes).catch(() => bytes);
    });
  },
};

/** Pictures bigger than this are scaled down for the analysis (memory, speed). */
const MAX_SIDE = 3000;

async function pixels(blob: Blob, width?: number, height?: number) {
  const bitmap = await createImageBitmap(blob);
  const scale = width ? 1 : Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = width ?? Math.max(1, Math.round(bitmap.width * scale));
  const h = height ?? Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const ratio = bitmap.width / bitmap.height;
  bitmap.close();
  return { canvas, data: ctx.getImageData(0, 0, w, h), ratio };
}

/** Checks, repairs and the forgery detector. */
const inspect = {
  async officePrivacy(blob: Blob): Promise<PrivacyFinding[]> {
    return privacyFromOffice(new Uint8Array(await blob.arrayBuffer()));
  },

  async repair(
    blob: Blob,
    name: string,
    detectedExt: string | null,
    cutAppended: boolean,
  ): Promise<{ fixes: RepairFix[]; file: Blob | null; name: string }> {
    const r = await repairFile(new Uint8Array(await blob.arrayBuffer()), name, detectedExt, {
      cutAppended,
    });
    return {
      fixes: r.fixes,
      file: r.bytes ? new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: blob.type }) : null,
      name: r.name,
    };
  },

  /**
   * How much the small preview inside the EXIF data differs from the picture:
   * 0 = the same, 100 = something else entirely. A cropped or edited photo
   * often still carries the old preview.
   */
  async compareThumbnail(
    picture: Blob,
    thumbnail: Blob,
  ): Promise<{ difference: number; shapeDiffers: boolean }> {
    const thumb = await pixels(thumbnail);
    const main = await pixels(picture, thumb.data.width, thumb.data.height);
    const a = thumb.data.data;
    const b = main.data.data;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      sum +=
        (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) +
          Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) +
          Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0))) /
        3;
    }
    const difference = Math.round((sum / (a.length / 4) / 255) * 100);
    return { difference, shapeDiffers: Math.abs(thumb.ratio / main.ratio - 1) > 0.04 };
  },

  /**
   * Error level analysis: the picture is saved again as JPEG and compared
   * with itself. Parts edited later were compressed a different number of
   * times and stand out brighter.
   */
  async ela(
    picture: Blob,
    quality: number,
    amplify: number,
  ): Promise<{ image: Blob; width: number; height: number; average: number; peak: number }> {
    const original = await pixels(picture);
    const { width, height } = original.data;
    const resaved = await original.canvas.convertToBlob({ type: 'image/jpeg', quality });
    const again = await pixels(resaved, width, height);
    const a = original.data.data;
    const b = again.data.data;
    const out = new ImageData(width, height);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < a.length; i += 4) {
      let level = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
        level = Math.max(level, d);
        out.data[i + c] = Math.min(255, d * amplify);
      }
      out.data[i + 3] = 255;
      sum += level;
      peak = Math.max(peak, level);
    }
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.putImageData(out, 0, 0);
    return {
      image: await canvas.convertToBlob({ type: 'image/png' }),
      width,
      height,
      average: Math.round((sum / (a.length / 4)) * 10) / 10,
      peak,
    };
  },
};

/** Pixels exactly as stored: own PNG/BMP reader, else the browser (no colour management). */
async function rasterOf(blob: Blob): Promise<{ raster: Raster; format: 'png' | 'bmp' | 'other' }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const own = decodeRaster(bytes);
  if (own) return { raster: own, format: bytes[0] === 0x42 ? 'bmp' : 'png' };
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
  let opaque = true;
  for (let i = 3; i < data.length && opaque; i += 4) opaque = data[i] === 255;
  if (!opaque)
    return {
      raster: { width: canvas.width, height: canvas.height, channels: 4, data },
      format: 'other',
    };
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i] ?? 0;
    rgb[j + 1] = data[i + 1] ?? 0;
    rgb[j + 2] = data[i + 2] ?? 0;
  }
  return {
    raster: { width: canvas.width, height: canvas.height, channels: 3, data: rgb },
    format: 'other',
  };
}

export interface StegoCover {
  width: number;
  height: number;
  format: 'png' | 'bmp' | 'other';
  transparent: boolean;
  /** Bytes that fit: [1 bit, 2 bits] × [open, with password]. */
  capacity: { plain: [number, number]; locked: [number, number] };
  hidden: HiddenInfo | null;
}

export type StegoResult<T> =
  { ok: true; value: T } | { ok: false; code: StegoErrorCode; detail?: string };

const stegoFailure = (e: unknown): { ok: false; code: StegoErrorCode; detail?: string } => {
  if (e instanceof StegoError) return { ok: false, code: e.code, detail: e.detail };
  return { ok: false, code: 'no-picture' };
};

/** Steganography: hide in and read from the lowest bits of the pixels. */
const stego = {
  async stegoCover(blob: Blob): Promise<StegoResult<StegoCover>> {
    try {
      const { raster, format } = await rasterOf(blob);
      return {
        ok: true,
        value: {
          width: raster.width,
          height: raster.height,
          format,
          transparent: raster.channels === 4,
          capacity: {
            plain: [stegoCapacity(raster, 1), stegoCapacity(raster, 2)],
            locked: [stegoCapacity(raster, 1, true), stegoCapacity(raster, 2, true)],
          },
          hidden: peekHidden(raster),
        },
      };
    } catch (e) {
      return stegoFailure(e);
    }
  },

  async stegoHide(
    cover: Blob,
    content: HiddenContent,
    password: string,
    bits: 1 | 2,
  ): Promise<StegoResult<{ file: Blob; ext: 'png' | 'bmp' }>> {
    try {
      const { raster, format } = await rasterOf(cover);
      const hidden = await hideInRaster(raster, content, { password: password || undefined, bits });
      // A 24-bit BMP stays a BMP; everything else becomes a PNG (lossless).
      const ext = format === 'bmp' && hidden.channels === 3 ? 'bmp' : 'png';
      const bytes = ext === 'bmp' ? encodeBmp(hidden) : encodePng(hidden);
      return {
        ok: true,
        value: {
          file: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: `image/${ext}` }),
          ext,
        },
      };
    } catch (e) {
      return stegoFailure(e);
    }
  },

  async stegoReveal(picture: Blob, password: string): Promise<StegoResult<HiddenContent>> {
    try {
      const { raster } = await rasterOf(picture);
      return { ok: true, value: await revealFromRaster(raster, password || undefined) };
    } catch (e) {
      return stegoFailure(e);
    }
  },

  /** Traces: the lowest bits as a picture, and the chi-square test along the picture. */
  async stegoTraces(picture: Blob): Promise<StegoResult<{ plane: Blob; chi: number[] }>> {
    try {
      const { raster } = await rasterOf(picture);
      const plane = lsbPlane(raster);
      const canvas = new OffscreenCanvas(raster.width, raster.height);
      canvas
        .getContext('2d')
        ?.putImageData(
          new ImageData(
            new Uint8ClampedArray(plane.buffer as ArrayBuffer),
            raster.width,
            raster.height,
          ),
          0,
          0,
        );
      return {
        ok: true,
        value: {
          plane: await canvas.convertToBlob({ type: 'image/png' }),
          chi: chiSquareProfile(raster),
        },
      };
    } catch (e) {
      return stegoFailure(e);
    }
  },
};

export interface AudioCover {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  float: boolean;
  seconds: number;
  /** Bytes that fit: [1 bit, 2 bits] × [open, with password]. */
  capacity: { plain: [number, number]; locked: [number, number] };
  hidden: HiddenInfo | null;
}

const audioFailure = (e: unknown): { ok: false; code: StegoErrorCode; detail?: string } => {
  if (e instanceof StegoError) return { ok: false, code: e.code, detail: e.detail };
  return { ok: false, code: 'no-audio' };
};

async function wavOf(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = parseWav(bytes);
  return { info, carrier: wavCarrier(bytes, info) };
}

/** Steganography in sound: the lowest bit of every sample of a WAV file. */
const audioStego = {
  async audioCover(wav: Blob): Promise<StegoResult<AudioCover>> {
    try {
      const { info, carrier } = await wavOf(wav);
      const slots = carrier.positions.length;
      return {
        ok: true,
        value: {
          channels: info.channels,
          sampleRate: info.sampleRate,
          bitsPerSample: info.bitsPerSample,
          float: info.float,
          seconds: wavDuration(info),
          capacity: {
            plain: [carrierCapacity(slots, 1), carrierCapacity(slots, 2)],
            locked: [carrierCapacity(slots, 1, true), carrierCapacity(slots, 2, true)],
          },
          hidden: peekCarrier(carrier),
        },
      };
    } catch (e) {
      return audioFailure(e);
    }
  },

  async audioHide(
    wav: Blob,
    content: HiddenContent,
    password: string,
    bits: 1 | 2,
  ): Promise<StegoResult<Blob>> {
    try {
      const { carrier } = await wavOf(wav);
      const data = await hideInCarrier(carrier, content, { password: password || undefined, bits });
      return {
        ok: true,
        value: new Blob([data as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
      };
    } catch (e) {
      return audioFailure(e);
    }
  },

  async audioReveal(wav: Blob, password: string): Promise<StegoResult<HiddenContent>> {
    try {
      const { carrier } = await wavOf(wav);
      return { ok: true, value: await revealFromCarrier(carrier, password || undefined) };
    } catch (e) {
      return audioFailure(e);
    }
  },
};

export interface SpectrogramPicture {
  picture: Blob;
  seconds: number;
  maxHz: number;
}

async function spectrogramPicture(spec: Spectrogram): Promise<SpectrogramPicture> {
  const canvas = new OffscreenCanvas(spec.width, spec.height);
  canvas
    .getContext('2d')
    ?.putImageData(new ImageData(colorize(spec), spec.width, spec.height), 0, 0);
  return {
    picture: await canvas.convertToBlob({ type: 'image/png' }),
    seconds: spec.seconds,
    maxHz: spec.maxHz,
  };
}

export type ToneResult =
  | { ok: true; value: { sound: Blob; spectrogram: SpectrogramPicture; inverted: boolean } }
  | { ok: false; code: 'no-picture' };

/** Picture in the spectrogram – and the spectrogram of any sound. */
const spectro = {
  async pictureToSound(
    picture: Blob,
    options: Pick<ToneOptions, 'seconds' | 'minHz' | 'maxHz'>,
    invert: 'auto' | boolean,
  ): Promise<ToneResult> {
    let gray;
    try {
      const columns = toneColumns(options.seconds);
      const bitmap = await createImageBitmap(picture, {
        resizeWidth: columns,
        resizeHeight: TONE_ROWS,
        resizeQuality: 'high',
      });
      const canvas = new OffscreenCanvas(columns, TONE_ROWS);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, columns, TONE_ROWS).data;
      gray = toGray(pixels, columns, TONE_ROWS);
      // Light pictures with dark drawings (a logo on white) sound better the other way round.
      if (invert === true || (invert === 'auto' && averageBrightness(gray) > 0.5)) {
        gray = toGray(pixels, columns, TONE_ROWS, true);
        invert = true;
      } else invert = false;
    } catch {
      return { ok: false, code: 'no-picture' };
    }
    const sampleRate = TONE_DEFAULTS.sampleRate;
    const samples = imageToSound(gray, { ...options, sampleRate });
    const wav = encodeWav(samples, sampleRate);
    return {
      ok: true,
      value: {
        sound: new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
        spectrogram: await spectrogramPicture(spectrogram(samples, sampleRate)),
        inverted: invert,
      },
    };
  },

  async soundSpectrogram(
    samples: Float32Array,
    sampleRate: number,
    fftSize: number,
  ): Promise<SpectrogramPicture> {
    return spectrogramPicture(spectrogram(samples, sampleRate, { fftSize }));
  },
};

/** What goes into the picture: files to pack (optionally with a password) or a ready archive. */
export type ArchiveSource =
  | { kind: 'files'; files: File[]; password: string }
  | { kind: 'archive'; archive: Blob; names?: string[] };

const archive = {
  /** Archive behind a picture (`inside` = false) or a ZIP inside a PNG/PDF (polyglot). */
  hideArchive(cover: Blob, source: ArchiveSource, inside: boolean): Promise<BytesResult> {
    return bytesResult(async () => {
      const content =
        source.kind === 'files'
          ? await packZip(
              await Promise.all(
                source.files.map(async (f) => ({
                  name: f.name,
                  data: new Uint8Array(await f.arrayBuffer()),
                })),
              ),
              source.password,
            )
          : new Uint8Array(await source.archive.arrayBuffer());
      const host = new Uint8Array(await cover.arrayBuffer());
      return inside
        ? makePolyglot(host, content)
        : hideArchiveInPicture(host, content, source.kind === 'archive' ? source.names : undefined);
    });
  },
};

export type WorkshopWorkerApi = typeof spectro &
  typeof archive &
  typeof api &
  typeof vault &
  typeof inspect &
  typeof stego &
  typeof audioStego;

Comlink.expose({
  ...api,
  ...vault,
  ...inspect,
  ...stego,
  ...audioStego,
  ...spectro,
  ...archive,
});
