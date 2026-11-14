import type { Engine } from '@conbert/core';
import { ffmpegAudioEngine, ffmpegVideoEngine } from './ffmpeg';
import { archivesEngine } from './archives';
import { audioVideoEngine } from './audio-video';
import { assimpEngine } from './assimp';
import { blenderEngine } from './blender';
import { calibreEngine } from './calibre';
import { dataServerEngine } from './data';
import { subtitlesServerEngine } from './subtitles';
import { subtitleExtractEngine } from './subtitle-extract';
import { fonttoolsEngine } from './fonttools';
import { gbaVideoEngine } from './gba';
import { gltfTransformServerEngine } from './gltf-transform';
import { imagemagickEngine } from './imagemagick';
import {
  libreofficeCalcEngine,
  libreofficeImpressEngine,
  libreofficeWriterEngine,
} from './libreoffice';
import { pandocEngine } from './pandoc';
import { pdfToolsEngine } from './pdf-tools';
import { ocrEngine } from './ocr';
import { whisperEngine } from './whisper';
import { imageAiEngine } from './image-ai';
import { sharpEngine } from './sharp';
import { svgoEngine } from './svgo';
import { vtracerEngine } from './vtracer';

/** Server engines (native binaries / libraries), one file per engine. */
export const serverEngines: readonly Engine[] = [
  sharpEngine,
  imagemagickEngine,
  ffmpegAudioEngine,
  ffmpegVideoEngine,
  audioVideoEngine,
  pandocEngine,
  vtracerEngine,
  gbaVideoEngine,
  assimpEngine,
  gltfTransformServerEngine,
  blenderEngine,
  libreofficeWriterEngine,
  libreofficeCalcEngine,
  libreofficeImpressEngine,
  pdfToolsEngine,
  ocrEngine,
  whisperEngine,
  imageAiEngine,
  calibreEngine,
  archivesEngine,
  fonttoolsEngine,
  dataServerEngine,
  subtitlesServerEngine,
  subtitleExtractEngine,
  svgoEngine,
];

/** Checks every engine once at startup so /api/engines reports real formats and status. */
export async function initEngines(engines: readonly Engine[]): Promise<void> {
  await Promise.all(engines.map((e) => e.init().catch(() => undefined)));
}
