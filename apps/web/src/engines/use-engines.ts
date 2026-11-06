import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  describeEngine,
  type EngineDescriptor,
  type ExecutionMode,
  type Runtime,
} from '@conbert/core';
import { enginesResponseSchema, type Hardware } from '@conbert/schemas';
import { apiGet } from '@/lib/api';
import { useServerHealth } from '@/lib/use-server-health';
import { useEngineStatus } from './engine-status-store';
import { browserEngines } from './registry';

function useServerEnginesQuery() {
  const health = useServerHealth();
  return useQuery({
    queryKey: ['engines'],
    queryFn: ({ signal }) => apiGet('/api/engines', enginesResponseSchema, { signal }),
    enabled: health.isSuccess,
    staleTime: 60_000,
  });
}

/** Engines the server reports via GET /api/engines. Empty while offline. */
export function useServerEngines(): EngineDescriptor[] {
  return useServerEnginesQuery().data?.engines ?? EMPTY;
}

/** GPU info of the server (null while unknown). */
export function useServerHardware(): Hardware | null {
  return useServerEnginesQuery().data?.hardware ?? null;
}

const EMPTY: EngineDescriptor[] = [];

export interface AvailableEngines {
  /** Browser and server engines combined – input for the router. */
  engines: EngineDescriptor[];
  serverAvailable: boolean;
  /** The server can encode video on a GPU ("Automatic" prefers it for videos). */
  serverHasGpu: boolean;
}

/** Combines local (browser) engines with the ones the server reports. */
export function useAvailableEngines(): AvailableEngines {
  const health = useServerHealth();
  const serverEngines = useServerEngines();
  const statuses = useEngineStatus((s) => s.engines);
  const engines = useMemo(
    () => [
      ...browserEngines.map((engine) => ({
        ...describeEngine(engine),
        status: statuses[engine.id]?.status ?? engine.status(),
      })),
      ...serverEngines,
    ],
    [serverEngines, statuses],
  );
  // The server counts only if it can actually run jobs right now.
  const serverAvailable = health.isSuccess && health.data.queue !== 'unavailable';
  const serverHasGpu = (useServerHardware()?.gpu ?? null) !== null;
  return { engines, serverAvailable, serverHasGpu };
}

/** Which runtimes may be used for target listing in a given mode. */
export function runtimesFor(mode: ExecutionMode, serverAvailable: boolean): Runtime[] {
  if (mode === 'local') return ['browser'];
  if (mode === 'server') return serverAvailable ? ['server'] : [];
  return serverAvailable ? ['browser', 'server'] : ['browser'];
}
