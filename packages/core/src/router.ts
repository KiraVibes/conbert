import type { Category, EngineDescriptor, Runtime } from './engine';
import { getFormat, normalizeExt } from './formats';
import { canCompressInPlace } from './compression';
import { isSensibleTarget } from './target-rules';

/** What the user picked: on this device, on the server, or let the tool decide. */
export type ExecutionMode = 'local' | 'server' | 'auto';

/** The subset of an engine the router needs. Works for local engines and server descriptors. */
export type RoutableEngine = Pick<
  EngineDescriptor,
  'id' | 'runtime' | 'formats' | 'priority' | 'status'
> & {
  supportsCompression?: boolean;
  supportsTrim?: boolean;
  extraTargets?: EngineDescriptor['extraTargets'];
};

export interface RouteOptions {
  /** Compressing: the same format in and out is allowed (engines that can compress). */
  compress?: boolean;
  /**
   * Cutting out a part (trim.ts): only one step with an engine that can cut,
   * and the same format in and out is allowed.
   */
  trim?: boolean;
}

export interface RouteStep {
  engineId: string;
  runtime: Runtime;
  from: string;
  to: string;
  /** Gets the options although it isn't the last step (AI work before converting). */
  withOptions?: boolean;
}

/** A way to get from the input to the output format. One step = direct, more = chain. */
export interface Route {
  runtime: Runtime;
  steps: RouteStep[];
}

export const MAX_CHAIN_STEPS = 3;
export const DEFAULT_AUTO_SERVER_THRESHOLD_BYTES = 200 * 1024 * 1024;

type EdgeMap = Map<string, Map<string, RoutableEngine[]>>;

function usable(engine: RoutableEngine): boolean {
  return engine.status !== 'error';
}

/**
 * Engines that do a conversion the target rules would normally refuse
 * (e.g. audio → video with a waveform) – directly, in one step.
 */
function extraEngines(
  engines: readonly RoutableEngine[],
  from: string,
  to: string,
  runtime: Runtime,
): RoutableEngine[] {
  const fromCat = getFormat(from)?.category;
  const toCat = getFormat(to)?.category;
  if (!fromCat || !toCat) return [];
  return engines
    .filter(
      (e) =>
        e.runtime === runtime &&
        usable(e) &&
        (e.extraTargets ?? []).some((r) => r.from === fromCat && r.to === toCat) &&
        e.formats.some((f) => normalizeExt(f.ext) === from && f.canRead) &&
        e.formats.some((f) => normalizeExt(f.ext) === to && f.canWrite),
    )
    .sort((a, b) => b.priority - a.priority);
}

/** Builds the format graph of one runtime: from → to → engines (best first). */
function buildEdges(engines: readonly RoutableEngine[], runtime: Runtime): EdgeMap {
  const edges: EdgeMap = new Map();
  for (const engine of engines) {
    if (engine.runtime !== runtime || !usable(engine)) continue;
    const reads = engine.formats.filter((f) => f.canRead).map((f) => normalizeExt(f.ext));
    const writes = engine.formats.filter((f) => f.canWrite).map((f) => normalizeExt(f.ext));
    for (const from of reads) {
      let targets = edges.get(from);
      if (!targets) {
        targets = new Map();
        edges.set(from, targets);
      }
      for (const to of writes) {
        if (to === from) continue;
        const list = targets.get(to) ?? [];
        if (!list.some((e) => e.id === engine.id)) list.push(engine);
        targets.set(to, list);
      }
    }
  }
  for (const targets of edges.values()) {
    for (const list of targets.values()) list.sort((a, b) => b.priority - a.priority);
  }
  return edges;
}

interface PartialPath {
  score: number;
  steps: RouteStep[];
}

/**
 * All routes from `inputExt` to `outputExt` within one runtime, best first.
 * Direct conversions are returned with every capable engine as alternatives.
 * If there is no direct way, the shortest chain (max. 3 steps) with the
 * highest total engine priority is returned.
 */
export function findRoutes(
  engines: readonly RoutableEngine[],
  inputExt: string,
  outputExt: string,
  runtime: Runtime,
  options: RouteOptions = {},
): Route[] {
  const from = normalizeExt(inputExt);
  const to = normalizeExt(outputExt);
  if (options.trim) return trimRoutes(engines, from, to, runtime);
  if (from === to) return options.compress ? sameFormatRoutes(engines, from, runtime) : [];
  const routes = conversionRoutes(engines, from, to, runtime);
  return options.compress ? routes.map((r) => withCompression(engines, r)) : routes;
}

/**
 * Compressing into another format (OBJ → GLB): if the engine that writes the
 * target can't compress, an engine that can re-encodes the result.
 */
function withCompression(engines: readonly RoutableEngine[], route: Route): Route {
  const last = route.steps.at(-1);
  if (!last) return route;
  const engine = engines.find((e) => e.id === last.engineId && e.runtime === route.runtime);
  if (engine?.supportsCompression) return route;
  const [extra] = sameFormatRoutes(engines, last.to, route.runtime);
  return extra ? { ...route, steps: [...route.steps, ...extra.steps] } : route;
}

function conversionRoutes(
  engines: readonly RoutableEngine[],
  from: string,
  to: string,
  runtime: Runtime,
): Route[] {
  if (!isSensibleTarget(from, to)) {
    return extraEngines(engines, from, to, runtime).map((e) => ({
      runtime,
      steps: [{ engineId: e.id, runtime, from, to }],
    }));
  }
  const edges = buildEdges(engines, runtime);

  const direct = edges.get(from)?.get(to) ?? [];
  if (direct.length > 0) {
    return direct.map((e) => ({
      runtime,
      steps: [{ engineId: e.id, runtime, from, to }],
    }));
  }

  // Breadth-first over formats, keeping the best-scoring path per format.
  let frontier = new Map<string, PartialPath>([[from, { score: 0, steps: [] }]]);
  const seen = new Set<string>([from]);
  for (let depth = 1; depth <= MAX_CHAIN_STEPS; depth++) {
    const next = new Map<string, PartialPath>();
    for (const [node, path] of frontier) {
      for (const [target, list] of edges.get(node) ?? []) {
        if (seen.has(target)) continue;
        const best = list[0];
        if (!best) continue;
        const candidate: PartialPath = {
          score: path.score + best.priority,
          steps: [...path.steps, { engineId: best.id, runtime, from: node, to: target }],
        };
        const existing = next.get(target);
        if (!existing || candidate.score > existing.score) next.set(target, candidate);
      }
    }
    const hit = next.get(to);
    if (hit) return [{ runtime, steps: hit.steps }];
    for (const node of next.keys()) seen.add(node);
    frontier = next;
    if (frontier.size === 0) break;
  }
  return [];
}

/** Re-encoding in the same format (PNG → smaller PNG), best engine first. */
/**
 * Cutting: only the last step of a chain gets the options, so the part must
 * be cut in a single step by an engine that knows how.
 */
function trimRoutes(
  engines: readonly RoutableEngine[],
  from: string,
  to: string,
  runtime: Runtime,
): Route[] {
  if (from !== to && !isSensibleTarget(from, to)) return [];
  return engines
    .filter(
      (e) =>
        e.runtime === runtime &&
        usable(e) &&
        e.supportsTrim === true &&
        e.formats.some((f) => normalizeExt(f.ext) === from && f.canRead) &&
        e.formats.some((f) => normalizeExt(f.ext) === to && f.canWrite),
    )
    .sort((a, b) => b.priority - a.priority)
    .map((e) => ({ runtime, steps: [{ engineId: e.id, runtime, from, to }] }));
}

function sameFormatRoutes(
  engines: readonly RoutableEngine[],
  ext: string,
  runtime: Runtime,
): Route[] {
  if (!canCompressInPlace(ext)) return [];
  return engines
    .filter(
      (e) =>
        e.runtime === runtime &&
        usable(e) &&
        e.supportsCompression === true &&
        e.formats.some((f) => normalizeExt(f.ext) === ext && f.canRead) &&
        e.formats.some((f) => normalizeExt(f.ext) === ext && f.canWrite),
    )
    .sort((a, b) => b.priority - a.priority)
    .map((e) => ({ runtime, steps: [{ engineId: e.id, runtime, from: ext, to: ext }] }));
}

export interface TargetOption {
  ext: string;
  /** Runtimes that can produce this format. */
  runtimes: Runtime[];
  /** Fewest steps needed (1 = direct). */
  steps: number;
}

/**
 * Every output format reachable from `inputExt` (max. 3 steps) in the given
 * runtimes – only those that make sense for the input (see target-rules).
 */
export function listTargets(
  engines: readonly RoutableEngine[],
  inputExt: string,
  runtimes: readonly Runtime[],
  options: RouteOptions = {},
): TargetOption[] {
  const from = normalizeExt(inputExt);
  const result = new Map<string, TargetOption>();
  if (options.trim) {
    // Cutting: everything one engine that cuts can write, the own format first.
    for (const runtime of runtimes) {
      for (const engine of engines) {
        if (engine.runtime !== runtime || !usable(engine) || !engine.supportsTrim) continue;
        if (!engine.formats.some((f) => normalizeExt(f.ext) === from && f.canRead)) continue;
        for (const f of engine.formats) {
          const ext = normalizeExt(f.ext);
          if (!f.canWrite || (ext !== from && !isSensibleTarget(from, ext))) continue;
          const existing = result.get(ext);
          if (!existing) result.set(ext, { ext, runtimes: [runtime], steps: 1 });
          else if (!existing.runtimes.includes(runtime)) existing.runtimes.push(runtime);
        }
      }
    }
    const list = [...result.values()];
    return [...list.filter((t) => t.ext === from), ...list.filter((t) => t.ext !== from)];
  }
  for (const runtime of runtimes) {
    const edges = buildEdges(engines, runtime);
    const seen = new Set<string>([from]);
    let frontier = [from];
    for (let depth = 1; depth <= MAX_CHAIN_STEPS && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const target of edges.get(node)?.keys() ?? []) {
          if (seen.has(target)) continue;
          seen.add(target);
          next.push(target);
          const existing = result.get(target);
          if (existing) {
            if (!existing.runtimes.includes(runtime)) existing.runtimes.push(runtime);
            existing.steps = Math.min(existing.steps, depth);
          } else {
            result.set(target, { ext: target, runtimes: [runtime], steps: depth });
          }
        }
      }
      frontier = next;
    }
  }
  return [...result.values()].flatMap((t) => {
    if (isSensibleTarget(from, t.ext)) return [t];
    // Only where an engine does this kind of conversion properly, and only its runtimes.
    const able = runtimes.filter((r) => extraEngines(engines, from, t.ext, r).length > 0);
    return able.length > 0 ? [{ ext: t.ext, runtimes: able, steps: 1 }] : [];
  });
}

export interface RoutingContext {
  mode: ExecutionMode;
  /** Input size in bytes. */
  fileSize: number;
  /** Is the server reachable (and allowed to be used)? */
  serverAvailable: boolean;
  /** Does the server have a usable GPU for video? */
  serverHasGpu?: boolean;
  /** Above this size, "auto" prefers the server. Default 200 MB. */
  autoServerThresholdBytes?: number;
  /** Category of the input. Defaults to the format registry entry. */
  inputCategory?: Category;
  /** Compressing instead of converting (see RouteOptions). */
  compress?: boolean;
  /** Cutting out a part (see RouteOptions). */
  trim?: boolean;
}

/**
 * Why a runtime was chosen (or nothing). Rendered via i18n
 * ('routing.reasons.<id>') so the UI can always explain the decision.
 */
export type RouteReason =
  | 'modeLocal'
  | 'modeServer'
  | 'autoBrowser'
  | 'autoFileTooLarge'
  | 'autoServerOnly'
  | 'autoGpuVideo'
  | 'onlyOnServer'
  | 'onlyInBrowser'
  | 'serverUnavailable'
  | 'noRoute';

export const ROUTE_REASONS: readonly RouteReason[] = [
  'modeLocal',
  'modeServer',
  'autoBrowser',
  'autoFileTooLarge',
  'autoServerOnly',
  'autoGpuVideo',
  'onlyOnServer',
  'onlyInBrowser',
  'serverUnavailable',
  'noRoute',
];

export type RouteWarning = 'largeFileLocal';
export const ROUTE_WARNINGS: readonly RouteWarning[] = ['largeFileLocal'];

export interface RouteDecision {
  route: Route | null;
  reason: RouteReason;
  /** Other possible routes (other engines or the other runtime). */
  alternatives: Route[];
  warnings: RouteWarning[];
}

/** Picks the route for one file according to the chosen mode. */
export function decideRoute(
  engines: readonly RoutableEngine[],
  inputExt: string,
  outputExt: string,
  ctx: RoutingContext,
): RouteDecision {
  const threshold = ctx.autoServerThresholdBytes ?? DEFAULT_AUTO_SERVER_THRESHOLD_BYTES;
  const isLarge = ctx.fileSize > threshold;
  const routeOptions = { compress: ctx.compress === true, trim: ctx.trim === true };
  const browser = findRoutes(engines, inputExt, outputExt, 'browser', routeOptions);
  const server = findRoutes(engines, inputExt, outputExt, 'server', routeOptions);
  const reachableServer = ctx.serverAvailable ? server : [];

  const pick = (
    chosen: Route[],
    reason: RouteReason,
    others: Route[],
    warnings: RouteWarning[] = [],
  ): RouteDecision => ({
    route: chosen[0] ?? null,
    reason,
    alternatives: [...chosen.slice(1), ...others],
    warnings,
  });
  const none = (reason: RouteReason): RouteDecision => ({
    route: null,
    reason,
    alternatives: [],
    warnings: [],
  });
  const localWarnings: RouteWarning[] = isLarge ? ['largeFileLocal'] : [];

  switch (ctx.mode) {
    case 'local':
      if (browser.length > 0) return pick(browser, 'modeLocal', [], localWarnings);
      return none(server.length > 0 ? 'onlyOnServer' : 'noRoute');

    case 'server':
      if (!ctx.serverAvailable) return none('serverUnavailable');
      if (server.length > 0) return pick(server, 'modeServer', []);
      return none(browser.length > 0 ? 'onlyInBrowser' : 'noRoute');

    case 'auto': {
      if (browser.length === 0) {
        if (reachableServer.length > 0) return pick(reachableServer, 'autoServerOnly', []);
        return none(server.length > 0 ? 'serverUnavailable' : 'noRoute');
      }
      if (reachableServer.length > 0) {
        if (isLarge) return pick(reachableServer, 'autoFileTooLarge', browser);
        const category = ctx.inputCategory ?? getFormat(inputExt)?.category;
        if (ctx.serverHasGpu && category === 'video') {
          return pick(reachableServer, 'autoGpuVideo', browser);
        }
      }
      return pick(browser, 'autoBrowser', reachableServer, localWarnings);
    }
  }
}
