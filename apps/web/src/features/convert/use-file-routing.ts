import { useMemo } from 'react';
import {
  conversionWarnings,
  decideRoute,
  listTargets,
  readTrim,
  type ConversionWarning,
  type RouteDecision,
  type TargetOption,
} from '@conbert/core';
import { runtimesFor, useAvailableEngines } from '@/engines/use-engines';
import { useSettings } from '@/features/settings/settings-store';
import type { FileItem } from './files-store';
import { imageAiDecision, imageAiTargets, wantsImageAi } from './image-ai';

export interface FileRouting {
  targets: TargetOption[];
  decision: RouteDecision | null;
  warnings: ConversionWarning[];
  thresholdBytes: number;
}

/** Valid targets, the chosen route and warnings for one file card. */
export function useFileRouting(item: FileItem): FileRouting {
  const { engines, serverAvailable, serverHasGpu } = useAvailableEngines();
  const thresholdMb = useSettings((s) => s.autoServerThresholdMb);
  const thresholdBytes = thresholdMb * 1024 * 1024;

  // Cutting allows only engines that can cut – and the file's own format.
  const trim = readTrim(item.options) !== null;
  const ai = item.task === 'convert' && wantsImageAi(item.options);
  return useMemo(() => {
    // AI work: on the server only, with its own route (see image-ai.ts).
    if (ai) {
      const targets = item.ext ? imageAiTargets(engines, item.ext) : [];
      const decision = item.targetExt
        ? imageAiDecision(engines, item.ext, item.targetExt, serverAvailable)
        : null;
      const warnings = item.targetExt ? conversionWarnings(item.ext, item.targetExt) : [];
      return { targets, decision, warnings, thresholdBytes };
    }
    const targets = item.ext
      ? listTargets(engines, item.ext, runtimesFor(item.mode, serverAvailable), { trim })
      : [];
    if (!item.targetExt) return { targets, decision: null, warnings: [], thresholdBytes };
    const decision = decideRoute(engines, item.ext, item.targetExt, {
      mode: item.mode,
      fileSize: item.file.size,
      serverAvailable,
      serverHasGpu,
      autoServerThresholdBytes: thresholdBytes,
      trim,
    });
    const warnings = conversionWarnings(item.ext, item.targetExt);
    return { targets, decision, warnings, thresholdBytes };
  }, [
    engines,
    serverAvailable,
    serverHasGpu,
    item.ext,
    item.mode,
    item.targetExt,
    item.file.size,
    thresholdBytes,
    trim,
    ai,
  ]);
}
