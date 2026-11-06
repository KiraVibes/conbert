import { z } from 'zod';
import { apiErrorSchema, type ApiError } from '@conbert/schemas';

/** An API call failed. `messageKey` points to a three-part error text in @conbert/i18n. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly messageKey: string,
    readonly details?: string,
    readonly code?: string,
  ) {
    super(`API request failed (${status}): ${messageKey}`);
    this.name = 'ApiRequestError';
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Called whenever the server says the session is gone (401). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

const emptySchema = z.unknown();

async function request<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
  init?: RequestInit,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiRequestError(0, 'errors.network', String(error));
  }
  const data: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    const err: ApiError['error'] | undefined = parsed.success ? parsed.data.error : undefined;
    if (response.status === 401) unauthorizedListeners.forEach((l) => l());
    throw new ApiRequestError(
      response.status,
      err?.messageKey ?? 'errors.internal',
      err?.details ?? response.statusText,
      err?.code,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiRequestError(response.status, 'errors.badResponse', parsed.error.message);
  }
  return parsed.data;
}

/** Fetches JSON from the Conbert API and validates it against a Zod schema. */
export function apiGet<S extends z.ZodType>(path: string, schema: S, init?: RequestInit) {
  return request('GET', path, schema, undefined, init);
}

export function apiPost<S extends z.ZodType = typeof emptySchema>(
  path: string,
  body: unknown,
  schema?: S,
): Promise<z.infer<S>> {
  return request('POST', path, schema ?? emptySchema, body) as Promise<z.infer<S>>;
}

export function apiPut<S extends z.ZodType = typeof emptySchema>(
  path: string,
  body: unknown,
  schema?: S,
): Promise<z.infer<S>> {
  return request('PUT', path, schema ?? emptySchema, body) as Promise<z.infer<S>>;
}

export function apiPatch<S extends z.ZodType = typeof emptySchema>(
  path: string,
  body: unknown,
  schema?: S,
): Promise<z.infer<S>> {
  return request('PATCH', path, schema ?? emptySchema, body) as Promise<z.infer<S>>;
}

export function apiDelete(path: string, body?: unknown): Promise<unknown> {
  return request('DELETE', path, emptySchema, body);
}
