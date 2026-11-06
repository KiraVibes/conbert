import { runProcess } from '../../lib/run-process';
import { VAAPI_DEVICE, type GpuKind } from '@conbert/core';

export interface HardwareInfo {
  /** The GPU encoder family that passed a real test encode, if any. */
  gpu: GpuKind | null;
  /** Hardware encoders ffmpeg was built with (not necessarily usable). */
  compiled: GpuKind[];
}

const FFMPEG = process.env['CONBERT_FFMPEG_PATH'] ?? 'ffmpeg';

/** A tiny test encode: succeeds only if the GPU is really reachable. */
function probeArgs(gpu: GpuKind): string[] {
  const source = ['-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=10:d=0.5'];
  const tail = ['-frames:v', '5', '-f', 'null', '-'];
  switch (gpu) {
    case 'nvenc':
      return ['-hide_banner', '-loglevel', 'error', ...source, '-c:v', 'h264_nvenc', ...tail];
    case 'qsv':
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        ...source,
        '-vf',
        'format=nv12',
        '-c:v',
        'h264_qsv',
        ...tail,
      ];
    case 'vaapi':
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-vaapi_device',
        VAAPI_DEVICE,
        ...source,
        '-vf',
        'format=nv12,hwupload',
        '-c:v',
        'h264_vaapi',
        ...tail,
      ];
  }
}

/**
 * Finds out which GPU can encode video. ffmpeg's encoder list only says what
 * was compiled in; in Docker the GPU must also be passed through, so each
 * candidate is tried with a real (tiny) encode. NVIDIA first, as it's fastest.
 */
export async function detectHardware(): Promise<HardwareInfo> {
  let encoders = '';
  try {
    encoders = (await runProcess(FFMPEG, ['-hide_banner', '-encoders'], { timeoutMs: 10_000 }))
      .stdout;
  } catch {
    return { gpu: null, compiled: [] };
  }
  const compiled = (['nvenc', 'qsv', 'vaapi'] as const).filter((kind) =>
    encoders.includes(`h264_${kind}`),
  );
  for (const kind of compiled) {
    try {
      await runProcess(FFMPEG, probeArgs(kind), { timeoutMs: 15_000 });
      return { gpu: kind, compiled: [...compiled] };
    } catch {
      // Not usable here – try the next one.
    }
  }
  return { gpu: null, compiled: [...compiled] };
}
