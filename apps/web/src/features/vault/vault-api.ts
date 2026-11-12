import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import {
  contactListSchema,
  contactResponseSchema,
  keyDirectoryResponseSchema,
  myKeyResponseSchema,
  type CreateContactRequest,
  type SaveKeyRequest,
  type UpdateContactRequest,
} from '@conbert/schemas';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';

export const MY_KEY_KEY = ['vault-key'] as const;
export const KEY_DIRECTORY_KEY = ['vault-directory'] as const;
export const CONTACTS_KEY = ['vault-contacts'] as const;

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

/** The own contact book: people (by name) and their public age keys. */
export function useContacts() {
  return useQuery({
    queryKey: CONTACTS_KEY,
    queryFn: ({ signal }) => apiGet('/api/keys/contacts', contactListSchema, { signal }),
    select: (data) => data.contacts,
  });
}

export const createContact = (body: CreateContactRequest) =>
  apiPost('/api/keys/contacts', body, contactResponseSchema).then((r) => r.contact);

export const updateContact = (id: string, body: UpdateContactRequest) =>
  apiPatch(`/api/keys/contacts/${id}`, body, contactResponseSchema).then((r) => r.contact);

export const deleteContact = (id: string) => apiDelete(`/api/keys/contacts/${id}`);

/** "age1qyqs…x7k2m" – long enough to tell keys apart, short enough for a list. */
export function shortKey(key: string): string {
  return key.length > 24 ? `${key.slice(0, 12)}…${key.slice(-6)}` : key;
}

/** A private age key pasted where a public one belongs. */
export const isSecretKey = (text: string) => /AGE-SECRET-KEY-/i.test(text);

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
