import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import {
  keyDirectoryResponseSchema,
  myKeyResponseSchema,
  type SaveKeyRequest,
} from '@conbert/schemas';
import { apiDelete, apiGet, apiPatch, apiPut } from '@/lib/api';

export const MY_KEY_KEY = ['vault-key'] as const;
export const KEY_DIRECTORY_KEY = ['vault-directory'] as const;

export function useMyKey() {
  return useQuery({
    queryKey: MY_KEY_KEY,
    queryFn: ({ signal }) => apiGet('/api/keys/me', myKeyResponseSchema, { signal }),
    select: (data) => data.key,
  });
}

/** Public keys other users shared with everyone on this Conbert. */
export function useKeyDirectory() {
  return useQuery({
    queryKey: KEY_DIRECTORY_KEY,
    queryFn: ({ signal }) => apiGet('/api/keys/directory', keyDirectoryResponseSchema, { signal }),
    select: (data) => data.keys,
  });
}

export const saveKey = (body: SaveKeyRequest) =>
  apiPut('/api/keys/me', body, myKeyResponseSchema).then((r) => r.key);

export const shareKey = (shared: boolean) =>
  apiPatch('/api/keys/me', { shared }, myKeyResponseSchema).then((r) => r.key);

export const deleteKey = () => apiDelete('/api/keys/me');

/** The vault password needs some strength: scrypt slows guessing down, it can't stop it. */
export const MIN_VAULT_PASSWORD = 10;

interface VaultState {
  /** The opened private key – only in memory, gone after reload or "lock". */
  identity: string | null;
  open: (identity: string) => void;
  lock: () => void;
}

export const useVault = create<VaultState>()((set) => ({
  identity: null,
  open: (identity) => set({ identity }),
  lock: () => set({ identity: null }),
}));
