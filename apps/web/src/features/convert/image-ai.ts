import {
  IMAGE_AI_INPUTS,
  isSensibleTarget,
  listTargets,
  normalizeExt,
  readImageAi,
  type EngineDescriptor,
  type RouteDecision,
  type TargetOption,
} from '@conbert/core';

/**
 * AI work on pictures (background, upscaling) only runs on the server: first
 * the AI step (as PNG), then the normal way to the wanted format. The server
 * builds that route itself; the browser only needs to show it.
 */

export function imageAiEngine(
  engines: readonly EngineDescriptor[],
  serverAvailable: boolean,
): EngineDescriptor | null {
  const engine = engines.find((e) => e.id === 'image-ai' && e.runtime === 'server');
  return serverAvailable && engine && engine.status !== 'error' ? engine : null;
}

export function canUseImageAi(ext: string): boolean {
  return IMAGE_AI_INPUTS.includes(normalizeExt(ext));
}

export function wantsImageAi(options: Record<string, unknown>): boolean {
  return readImageAi(options) !== null;
}

/** Formats a picture can become after the AI step (PNG and what the server makes from it). */
export function imageAiTargets(
  engines: readonly EngineDescriptor[],
  inputExt: string,
): TargetOption[] {
  const fromPng = listTargets(engines, 'png', ['server']).filter(
    (t) => t.ext !== 'png' && isSensibleTarget(inputExt, t.ext),
  );
  return [{ ext: 'png', runtimes: ['server'], steps: 1 }, ...fromPng];
}

export function imageAiDecision(
  engines: readonly EngineDescriptor[],
  inputExt: string,
  targetExt: string,
  serverAvailable: boolean,
): RouteDecision {
  const engine = imageAiEngine(engines, serverAvailable);
  const possible =
    engine !== null &&
    canUseImageAi(inputExt) &&
    imageAiTargets(engines, inputExt).some((t) => t.ext === normalizeExt(targetExt));
  if (!possible) {
    return {
      route: null,
      reason: serverAvailable ? 'noRoute' : 'serverUnavailable',
      alternatives: [],
      warnings: [],
    };
  }
  return {
    route: {
      runtime: 'server',
      steps: [
        {
          engineId: 'image-ai',
          runtime: 'server',
          from: normalizeExt(inputExt),
          to: normalizeExt(targetExt),
          withOptions: true,
        },
      ],
    },
    reason: 'modeServer',
    alternatives: [],
    warnings: [],
  };
}
