import type { EngineDescriptor } from '@conbert/core';
import { useAvailableEngines } from '@/engines/use-engines';

/** The OCR engine on the server, if it is reachable and works. */
export function useOcrEngine(): EngineDescriptor | null {
  const { engines, serverAvailable } = useAvailableEngines();
  const engine = engines.find((e) => e.id === 'ocrmypdf' && e.runtime === 'server');
  return serverAvailable && engine && engine.status !== 'error' ? engine : null;
}
