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

/** Most contacts one account may keep – a contact book, not a key server. */
export const MAX_CONTACTS = 500;

/** POST /api/keys/contacts – a person and their public age key. */
export const createContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  publicKey: z.string().trim().min(10).max(3100),
  note: z.string().trim().max(500).optional(),
});
export type CreateContactRequest = z.input<typeof createContactRequestSchema>;

/** PATCH /api/keys/contacts/:id – rename or change the note (the key stays). */
export const updateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type UpdateContactRequest = z.input<typeof updateContactRequestSchema>;

export const contactSchema = z.object({
  id: z.string(),
  name: z.string(),
  publicKey: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;
export const contactResponseSchema = z.object({ contact: contactSchema });
export const contactListSchema = z.object({ contacts: z.array(contactSchema) });
