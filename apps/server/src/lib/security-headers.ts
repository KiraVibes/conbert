import type { FastifyInstance } from 'fastify';

/**
 * Headers sent with every response.
 *
 * COOP/COEP make the page "cross-origin isolated", which is required for
 * SharedArrayBuffer – and therefore for multi-threaded WASM engines
 * (wasm-vips, ffmpeg.wasm).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
  });
}
