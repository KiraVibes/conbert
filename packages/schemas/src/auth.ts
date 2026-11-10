import { z } from 'zod';
import { authSourceSchema, featureSchema, permissionOverridesSchema } from './permissions';

export const PASSWORD_MIN_LENGTH = 10;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,32}$/, 'username: 2–32 characters, letters, digits, . _ -');

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(1024);

export const roleSchema = z.enum(['admin', 'user']);
export type Role = z.infer<typeof roleSchema>;

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
  /** false for users that only sign in through the reverse proxy. */
  hasPassword: z.boolean(),
  createdAt: z.string(),
  /** Admin list only: the user locked the booru age ratings with a PIN. */
  booruPin: z.boolean().optional(),
  /** Where the account comes from: Conbert itself, LDAP or the reverse proxy. */
  authSource: authSourceSchema,
  /** The functions this user may use (after groups and own settings). */
  permissions: z.array(featureSchema),
  /** Admin list only. */
  groups: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  /** Admin list only: the user's own allow/deny per function. */
  permissionOverrides: permissionOverridesSchema.optional(),
  /** Admin list only: LDAP no longer knows this user; they can't sign in. */
  disabled: z.boolean().optional(),
});
export type UserDto = z.infer<typeof userSchema>;

export const authModeSchema = z.enum(['local', 'proxy']);
export type AuthMode = z.infer<typeof authModeSchema>;

// --- GET /api/auth/status ---
export const authStatusResponseSchema = z.object({
  setupRequired: z.boolean(),
  authMode: authModeSchema,
  /** The server is configured for reverse-proxy login (env variables set). */
  proxyAvailable: z.boolean(),
  /** A trusted proxy sent a user for this request (only during setup). */
  proxyUser: z.string().nullable(),
  /** Sign-in with a directory account (LDAP) is switched on. */
  ldap: z.boolean().optional(),
  user: userSchema.nullable(),
});
export type AuthStatusResponse = z.infer<typeof authStatusResponseSchema>;

const setupCodeSchema = z.string().trim().min(1).max(64);

// --- POST /api/auth/setup ---
export const setupRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('local'),
    setupCode: setupCodeSchema,
    username: usernameSchema,
    displayName: z.string().trim().max(64).optional(),
    password: passwordSchema,
  }),
  z.object({
    mode: z.literal('proxy'),
    setupCode: setupCodeSchema,
  }),
]);
export type SetupRequest = z.infer<typeof setupRequestSchema>;

// --- POST /api/auth/login ---
export const loginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userResponseSchema = z.object({ user: userSchema });
export type UserResponse = z.infer<typeof userResponseSchema>;

// --- POST /api/auth/password ---
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
});

// --- /api/users (admin) ---
export const usersResponseSchema = z.object({ users: z.array(userSchema) });
export type UsersResponse = z.infer<typeof usersResponseSchema>;

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().max(64).optional(),
  password: passwordSchema,
  role: roleSchema.default('user'),
});
export type CreateUserRequest = z.input<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    displayName: z.string().trim().max(64).nullable().optional(),
    role: roleSchema.optional(),
    password: passwordSchema.optional(),
    /** Replaces the user's own allow/deny settings. */
    permissionOverrides: permissionOverridesSchema.optional(),
    /** Replaces the hand-picked groups (LDAP/proxy memberships stay). */
    groupIds: z.array(z.string().min(1).max(64)).max(1000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>;

// --- /api/settings (per user) ---
/** Opaque UI settings object; the web app validates its own fields. */
export const userSettingsSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 64 * 1024, 'settings too large');
export const settingsResponseSchema = z.object({ settings: userSettingsSchema });
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
