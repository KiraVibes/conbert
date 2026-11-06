import { z } from 'zod';
import { MAX_LOCKED_KEY_LENGTH } from '@conbert/core';

/** PUT /api/keys/me – the public key and the private key, locked in the browser. */
export const saveKeyRequestSchema = z.object({
  publicKey: z.string().trim().min(10).max(3100),
  lockedIdentity: z.string().trim().min(50).max(MAX_LOCKED_KEY_LENGTH),
  shared: z.boolean().default(false),
});
export type SaveKeyRequest = z.input<typeof saveKeyRequestSchema>;

/** PATCH /api/keys/me – only whether others may encrypt for me. */
export const shareKeyRequestSchema = z.object({ shared: z.boolean() });

export const myKeySchema = z.object({
  publicKey: z.string(),
  lockedIdentity: z.string(),
  shared: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MyKey = z.infer<typeof myKeySchema>;
export const myKeyResponseSchema = z.object({ key: myKeySchema.nullable() });

/** Public keys other users chose to share. */
export const sharedKeySchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  publicKey: z.string(),
});
export type SharedKey = z.infer<typeof sharedKeySchema>;
export const keyDirectoryResponseSchema = z.object({ keys: z.array(sharedKeySchema) });
