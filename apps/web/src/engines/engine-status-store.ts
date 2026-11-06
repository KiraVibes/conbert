import { create } from 'zustand';
import type { EngineStatus } from '@conbert/core';

export interface EngineStatusEntry {
  status: EngineStatus;
  /** Why the engine is in error/partial state (i18n base key). */
  messageKey?: string;
  /** Formats that are currently not available (partial status). */
  unavailableFormats?: string[];
}

interface EngineStatusState {
  engines: Record<string, EngineStatusEntry>;
  set: (id: string, entry: EngineStatusEntry) => void;
}

/** Reactive engine status for the UI. Engines report changes here. */
export const useEngineStatus = create<EngineStatusState>()((set) => ({
  engines: {},
  set: (id, entry) => set((s) => ({ engines: { ...s.engines, [id]: entry } })),
}));
