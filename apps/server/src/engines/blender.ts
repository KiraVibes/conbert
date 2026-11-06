import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  type ConvertRequest,
  type Engine,
  type FormatSupport,
} from '@conbert/core';
import type { BlenderInstaller } from '../blender/installer';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * Blender in background mode for the formats assimp can't handle: .blend,
 * USD (usd/usda/usdc/usdz) and Alembic. Installed by the admin on demand –
 * until then the engine reports no formats, so the router never picks it.
 * Untrusted files: factory settings, no scripts from .blend files, offline,
 * timeout, separate process.
 */
const TIMEOUT_MS = 10 * 60 * 1000;

export const BLENDER_READ = [
  'blend',
  'usd',
  'usda',
  'usdc',
  'usdz',
  'abc',
  'glb',
  'gltf',
  'obj',
  'stl',
  'ply',
  'fbx',
];
// No .gltf: Blender 4.5 only writes GLB or separate files (GLB → glTF is one more step).
export const BLENDER_WRITE = [
  'blend',
  'usd',
  'usda',
  'usdc',
  'usdz',
  'abc',
  'glb',
  'obj',
  'stl',
  'ply',
  'fbx',
];

const FORMATS: FormatSupport[] = [...new Set([...BLENDER_READ, ...BLENDER_WRITE])].map((ext) => ({
  ext,
  mime: getFormat(ext)?.mime ?? '',
  canRead: BLENDER_READ.includes(ext),
  canWrite: BLENDER_WRITE.includes(ext),
}));

/** Runs inside Blender: import by extension, export by extension. */
export const BLENDER_SCRIPT = String.raw`import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
src, dst, src_ext, dst_ext = args[0], args[1], args[2], args[3]

if src_ext == "blend":
    # Never run scripts stored in the file.
    bpy.ops.wm.open_mainfile(filepath=src, load_ui=False, use_scripts=False)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src_ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=src)
    elif src_ext == "obj":
        bpy.ops.wm.obj_import(filepath=src)
    elif src_ext == "stl":
        bpy.ops.wm.stl_import(filepath=src)
    elif src_ext == "ply":
        bpy.ops.wm.ply_import(filepath=src)
    elif src_ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=src)
    elif src_ext in ("usd", "usda", "usdc", "usdz"):
        bpy.ops.wm.usd_import(filepath=src)
    elif src_ext == "abc":
        bpy.ops.wm.alembic_import(filepath=src)
    else:
        raise SystemExit("unsupported input: " + src_ext)

if not any(o.type in ("MESH", "CURVE", "SURFACE", "META", "FONT") for o in bpy.data.objects):
    print("CONBERT_EMPTY_SCENE")
    raise SystemExit(4)

if dst_ext == "glb":
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
elif dst_ext == "obj":
    bpy.ops.wm.obj_export(filepath=dst, export_materials=False)
elif dst_ext == "stl":
    bpy.ops.wm.stl_export(filepath=dst)
elif dst_ext == "ply":
    bpy.ops.wm.ply_export(filepath=dst)
elif dst_ext == "fbx":
    bpy.ops.export_scene.fbx(filepath=dst)
elif dst_ext in ("usd", "usda", "usdc", "usdz"):
    bpy.ops.wm.usd_export(filepath=dst)
elif dst_ext == "abc":
    bpy.ops.wm.alembic_export(filepath=dst)
elif dst_ext == "blend":
    bpy.ops.wm.save_as_mainfile(filepath=dst, compress=True, copy=True)
else:
    raise SystemExit("unsupported output: " + dst_ext)
`;

let installer: BlenderInstaller | null = null;
let ready = false;

async function refresh(): Promise<void> {
  ready = installer !== null && (await installer.installed());
}

/** Set once at startup (app.ts). */
export function configureBlender(value: BlenderInstaller): void {
  installer = value;
  value.onChange(() => void refresh());
  void refresh();
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'blender needs a file path and workDir');
  }
  if (!installer || !(await installer.installed())) {
    throw new ConversionError('errors.blenderMissing');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  if (!BLENDER_READ.includes(from) || !BLENDER_WRITE.includes(to)) {
    throw new ConversionError('errors.formatUnavailable', `blender: .${from} → .${to}`);
  }
  await mkdir(req.workDir, { recursive: true });
  const id = randomUUID();
  // Importers pick the file type by extension – the upload has none.
  const input = path.join(req.workDir, `${id}-in.${from}`);
  const output = path.join(req.workDir, `${id}.${to}`);
  const script = path.join(req.workDir, `${id}-convert.py`);
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    await copyFile(req.input, input);
    await writeFile(script, BLENDER_SCRIPT);
    await runProcess(
      installer.binary(),
      [
        '--background',
        '--factory-startup',
        '--disable-autoexec',
        '--offline-mode',
        '--python-exit-code',
        '3',
        '--python',
        script,
        '--',
        input,
        output,
        from,
        to,
      ],
      {
        timeoutMs: TIMEOUT_MS,
        signal: req.signal,
        cwd: req.workDir,
        // Blender writes its config and caches below HOME – keep them in the job folder.
        env: { ...process.env, HOME: req.workDir },
      },
    );
    if (!(await stat(output).catch(() => null))?.size) {
      throw new ConversionError('errors.convertFailed', 'blender wrote no file');
    }
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ConversionError) throw error;
    if (error instanceof ProcessError) {
      const out = `${error.result.stdout}\n${error.result.stderr}`;
      if (out.includes('CONBERT_EMPTY_SCENE')) throw new ConversionError('errors.modelEmpty');
      throw new ConversionError('errors.convertFailed', out.trim().slice(-2000) || error.message);
    }
    throw new ConversionError('errors.convertFailed', String(error));
  } finally {
    await rm(input, { force: true });
    await rm(script, { force: true });
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const blenderEngine: Engine = {
  id: 'blender',
  name: 'Blender',
  descriptionKey: 'engines.blender.description',
  category: '3d',
  runtime: 'server',
  // Empty until the admin installed Blender, so routes never lead here before.
  get formats() {
    return ready ? FORMATS : [];
  },
  options: [],
  supportsCompression: false,
  // assimp (10) stays first where both can do it.
  priority: 5,
  init: refresh,
  status: () => (ready ? 'ready' : 'uninitialized'),
  convert,
};
