import { exportModel, loadModel } from '@/engines/three-models';
import { exposeEngine } from './expose-engine';

const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
  data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? (data.buffer as ArrayBuffer)
    : (data.slice().buffer as ArrayBuffer);

exposeEngine({
  init: () => Promise.resolve({ unavailableFormats: [] }),
  async convert(input, inputExt, outputExt, options, onProgress) {
    onProgress(10, 'reading');
    const model = await loadModel(toArrayBuffer(input), inputExt);
    onProgress(60, 'converting');
    return exportModel(model, outputExt, options);
  },
});
