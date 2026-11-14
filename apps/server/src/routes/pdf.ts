import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pdfPasswordRequestSchema } from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { HttpError } from '../lib/http-error';
import { ProcessError, runProcess } from '../lib/run-process';
import { getOwnFile } from '../storage/uploads';

const QPDF = process.env['CONBERT_QPDF_PATH'] ?? 'qpdf';
const TIMEOUT_MS = 2 * 60 * 1000;

/**
 * qpdf reads its arguments from a file ("@args"): that way the password
 * never shows up in the process list (`ps`) or in logs.
 */
export function protectArgs(password: string, input: string, output: string): string[] {
  // AES-256 (PDF 2.0 / Acrobat X); the owner password is the same, so whoever
  // knows it may also print and copy – there are no extra restrictions.
  return ['--encrypt', password, password, '256', '--', input, output];
}

export function unlockArgs(password: string, input: string, output: string): string[] {
  return [`--password=${password}`, '--decrypt', input, output];
}

/** Lock a PDF with a password or take a known password off (qpdf on the server). */
export function registerPdfRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/pdf/password', async (request, reply) => {
    const body = pdfPasswordRequestSchema.parse(request.body);
    const user = currentUser(request);
    const file = getOwnFile(ctx, user.id, body.fileId);
    const dir = path.join(dataPaths(ctx.config).tmp, `pdf-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    try {
      const output = path.join(dir, 'out.pdf');
      const argFile = path.join(dir, 'args');
      const args =
        body.action === 'protect'
          ? protectArgs(body.password, file.path, output)
          : unlockArgs(body.password, file.path, output);
      // One argument per line; the schema refuses passwords with line breaks.
      await writeFile(argFile, `${args.join('\n')}\n`, { mode: 0o600 });
      try {
        await runProcess(QPDF, [`@${argFile}`], { timeoutMs: TIMEOUT_MS });
      } catch (error) {
        // Exit code 3 = finished with warnings – the file is fine.
        const code = error instanceof ProcessError ? error.result.code : null;
        if (code !== 3) {
          const details = error instanceof ProcessError ? error.result.stderr.slice(-500) : '';
          if (/invalid password/i.test(details)) throw new HttpError(422, 'PDF_WRONG_PASSWORD');
          throw new HttpError(422, 'PDF_BROKEN', details.replaceAll(body.password, '•••'));
        }
      }
      await rm(argFile, { force: true });
      const bytes = await readFile(output);
      return reply.type('application/pdf').header('Cache-Control', 'no-store').send(bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
