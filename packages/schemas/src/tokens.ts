import { z } from 'zod';

export const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "cbt_ab12…" – enough to tell tokens apart, useless for logging in. */
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

// --- POST /api/tokens ---
export const createTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** null = never expires. */
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
});
export type CreateTokenRequest = z.input<typeof createTokenRequestSchema>;

export const createTokenResponseSchema = z.object({
  token: apiTokenSchema,
  /** Shown exactly once. */
  secret: z.string(),
});

export const tokenListSchema = z.object({ tokens: z.array(apiTokenSchema) });
