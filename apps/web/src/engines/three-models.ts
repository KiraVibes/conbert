import type { BufferGeometry } from 'three';
import { Group, ImageLoader, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ConversionError } from '@conbert/core';

/**
 * three.js loaders and exporters, used by the browser 3D engine (in a Web
 * Worker) and by the 3D preview (main thread). Files come as one buffer, so
 * textures referenced by separate files can't be loaded – the shape and
 * colours are kept.
 */

export { THREE_READ, THREE_WRITE } from './three-formats';

/** Draco decoder, served by Conbert itself (copied by scripts/copy-wasm.mjs). */
const DRACO_PATH = '/wasm/draco/';

const origin = () =>
  typeof self !== 'undefined' && 'location' in self ? self.location.origin : 'http://localhost';

// In a Web Worker there are no <img> elements: textures from separate files
// can't load anyway, so image requests end quietly instead of failing.
if (typeof document === 'undefined') {
  ImageLoader.prototype.load = function load(_url, _onLoad, _onProgress, onError) {
    onError?.(new Error('no images in a worker'));
    return undefined as unknown as HTMLImageElement;
  };
}

let draco: DRACOLoader | null = null;
function dracoLoader(): DRACOLoader {
  draco ??= new DRACOLoader().setDecoderPath(new URL(DRACO_PATH, origin()).href);
  return draco;
}

function asMesh(geometry: BufferGeometry): Group {
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  const group = new Group();
  const color = geometry.hasAttribute('color');
  group.add(
    new Mesh(
      geometry,
      new MeshStandardMaterial({ color: color ? 0xffffff : 0xb0b0b0, vertexColors: color }),
    ),
  );
  return group;
}

const text = (data: ArrayBuffer) => new TextDecoder().decode(data);

/** Loads a 3D file into a three.js object. */
export async function loadModel(data: ArrayBuffer, ext: string): Promise<Object3D> {
  try {
    switch (ext) {
      case 'glb':
      case 'gltf': {
        const loader = new GLTFLoader()
          .setDRACOLoader(dracoLoader())
          .setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.parseAsync(ext === 'glb' ? data : text(data), '');
        return gltf.scene;
      }
      case 'obj':
        return new OBJLoader().parse(text(data));
      case 'stl':
        return asMesh(new STLLoader().parse(data));
      case 'ply':
        return asMesh(new PLYLoader().parse(data));
      case 'fbx':
        return new FBXLoader().parse(data, '');
      case 'dae': {
        const collada = new ColladaLoader().parse(text(data), '');
        if (!collada) throw new Error('empty Collada file');
        return collada.scene;
      }
      case '3ds':
        return new TDSLoader().parse(data, '');
      case '3mf':
        return new ThreeMFLoader().parse(data);
      default:
        throw new ConversionError('errors.formatUnavailable', `three.js can't read .${ext}`);
    }
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new ConversionError(
      'errors.convertFailed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Writes a three.js object as the target format. */
export async function exportModel(
  object: Object3D,
  ext: string,
  options: Record<string, unknown>,
): Promise<Uint8Array> {
  const binary = options['modelBinary'] !== false;
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const result = await new GLTFExporter().parseAsync(object, { binary: ext === 'glb' });
      return result instanceof ArrayBuffer
        ? new Uint8Array(result)
        : new TextEncoder().encode(JSON.stringify(result));
    }
    case 'obj':
      return new TextEncoder().encode(new OBJExporter().parse(object));
    case 'stl': {
      const result = new STLExporter().parse(object, { binary });
      return typeof result === 'string'
        ? new TextEncoder().encode(result)
        : new Uint8Array(result.buffer as ArrayBuffer, result.byteOffset, result.byteLength);
    }
    case 'ply':
      return new Promise((resolve, reject) => {
        const result = new PLYExporter().parse(
          object,
          (out) =>
            resolve(typeof out === 'string' ? new TextEncoder().encode(out) : new Uint8Array(out)),
          { binary },
        );
        if (result === null)
          reject(new ConversionError('errors.convertFailed', 'PLY export failed'));
      });
    case 'usdz':
      return new USDZExporter().parseAsync(object);
    default:
      throw new ConversionError('errors.formatUnavailable', `three.js can't write .${ext}`);
  }
}

/** Triangles and points – shown in the 3D preview. */
export function modelStats(object: Object3D): {
  triangles: number;
  vertices: number;
  meshes: number;
} {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    meshes++;
    vertices += position.count;
    triangles += geometry.index ? geometry.index.count / 3 : position.count / 3;
  });
  return { triangles: Math.round(triangles), vertices, meshes };
}
