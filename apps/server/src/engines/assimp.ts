import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  MODEL_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readGltf, writeGltf } from '@conbert/core/gltf';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * assimp (Open Asset Import Library) – reads dozens of 3D formats and writes
 * the common ones. Untrusted files: always with a timeout and as separate
 * process, file types are forced via the extension of an internal copy.
 */
const ASSIMP = process.env['CONBERT_ASSIMP_PATH'] ?? 'assimp';
const TIMEOUT_MS = 5 * 60 * 1000;

const READ = ['obj', 'stl', 'ply', 'glb', 'gltf', 'fbx', 'dae', '3ds', '3mf', 'x3d'];
/** assimp export format ids. OBJ without .mtl: one file in, one file out. */
const EXPORT: Record<string, (binary: boolean) => string> = {
  glb: () => 'glb2',
  gltf: () => 'glb2', // written as GLB, then embedded into one .gltf file
  obj: () => 'objnomtl',
  stl: (binary) => (binary ? 'stlb' : 'stl'),
  ply: (binary) => (binary ? 'plyb' : 'ply'),
  dae: () => 'collada',
  fbx: () => 'fbx',
  '3ds': () => '3ds',
  '3mf': () => '3mf',
  x3d: () => 'x3d',
};

let status: EngineStatus = 'uninitialized';

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'assimp needs a file path and workDir');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  const format = EXPORT[to];
  if (!READ.includes(from) || !format) {
    throw new ConversionError('errors.formatUnavailable', `assimp: .${from} → .${to}`);
  }
  await mkdir(req.workDir, { recursive: true });
  const id = randomUUID();
  // assimp picks the importer by extension – the upload has none.
  const input = path.join(req.workDir, `${id}-in.${from}`);
  const exported = path.join(req.workDir, `${id}-out.${to === 'gltf' ? 'glb' : to}`);
  const output = path.join(req.workDir, `${id}.${to}`);
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    await copyFile(req.input, input);
    // -tri: STL/3MF only know triangles; harmless for the others.
    await runProcess(
      ASSIMP,
      ['export', input, exported, `-f${format(req.options['modelBinary'] !== false)}`, '-tri'],
      {
        timeoutMs: TIMEOUT_MS,
        signal: req.signal,
        cwd: req.workDir,
      },
    );
    if (to === 'gltf') {
      const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
      const doc = await readGltf(io, new Uint8Array(await readFile(exported)), 'glb');
      await writeFile(output, await writeGltf(io, doc, 'gltf'));
    } else {
      await copyFile(exported, output);
    }
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ConversionError) throw error;
    const details =
      error instanceof ProcessError
        ? error.result.stderr.trim() || error.result.stdout.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError('errors.convertFailed', details);
  } finally {
    await rm(input, { force: true });
    if (exported !== output) await rm(exported, { force: true });
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

const WRITE = Object.keys(EXPORT);

export const assimpEngine: Engine = {
  id: 'assimp',
  name: 'Assimp',
  descriptionKey: 'engines.assimp.description',
  category: '3d',
  runtime: 'server',
  formats: [...new Set([...READ, ...WRITE])].map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: READ.includes(ext),
    canWrite: WRITE.includes(ext),
  })),
  options: MODEL_OPTIONS,
  supportsCompression: false,
  priority: 10,
  async init() {
    try {
      await runProcess(ASSIMP, ['version'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
