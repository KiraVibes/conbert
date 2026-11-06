import { GLTF_OPTIONS, MODEL_OPTIONS } from '@conbert/core';
import { THREE_READ, THREE_WRITE } from './three-formats';
import { createWorkerEngine } from './worker-engine';

/** three.js loaders and exporters in a Web Worker: 3D conversion without the server. */
export const three3dEngine = createWorkerEngine({
  meta: {
    id: 'three-3d',
    name: 'three.js 3D (Browser)',
    descriptionKey: 'engines.three3d.description',
    category: '3d',
    runtime: 'browser',
    formats: [...new Set([...THREE_READ, ...THREE_WRITE])].map((ext) => ({
      ext,
      canRead: THREE_READ.includes(ext),
      canWrite: THREE_WRITE.includes(ext),
    })),
    options: MODEL_OPTIONS,
    supportsCompression: false,
    priority: 10,
  },
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/three.worker.ts', import.meta.url), {
      type: 'module',
      name: 'three-3d',
    }),
});

/**
 * gltf-transform in the browser: glTF ↔ GLB and compression with Meshopt
 * (Draco needs the server – the router switches there by itself).
 */
export const gltfTransformBrowserEngine = createWorkerEngine({
  meta: {
    id: 'gltf-transform-wasm',
    name: 'glTF-Transform (Browser)',
    descriptionKey: 'engines.gltfTransform.description',
    category: '3d',
    runtime: 'browser',
    formats: ['glb', 'gltf'].map((ext) => ({ ext, canRead: true, canWrite: true })),
    options: GLTF_OPTIONS,
    supportsCompression: true,
    priority: 20,
  },
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/gltf.worker.ts', import.meta.url), {
      type: 'module',
      name: 'gltf-transform',
    }),
});
