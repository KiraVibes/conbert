import { ConversionError } from '@conbert/core';
import { uploadToServer } from '@/engines/server-convert';

// --- Password (server) ---------------------------------------------------------

/** Locks a PDF with a password, or takes a known password off – qpdf on the server. */
export async function pdfPassword(
  bytes: Uint8Array,
  name: string,
  action: 'protect' | 'unlock',
  password: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
  const fileId = await uploadToServer(blob, name, signal, () => undefined);
  let response: Response;
  try {
    response = await fetch('/api/pdf/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, action, password }),
      ...(signal && { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ConversionError('errors.network', String(error));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { messageKey?: string; details?: string };
    } | null;
    throw new ConversionError(
      data?.error?.messageKey ?? 'errors.pdfBroken',
      data?.error?.details ?? `HTTP ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
