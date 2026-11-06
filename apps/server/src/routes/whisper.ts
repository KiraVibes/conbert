import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DEFAULT_WHISPER_MODEL, whisperModel, type WhisperModelId } from '@conbert/core';
import { setWhisperModelSchema, whisperModelIdSchema, type WhisperStatus } from '@conbert/schemas';
import { requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';
import type { Db } from '../db';
import { appSettings } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { whisperSetup } from '../whisper/setup';

const KEY = 'whisper.model';

/** The model the admin chose for everyone (default: "small"). */
export function readWhisperModel(db: Db): WhisperModelId {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const model = whisperModel(row?.value);
  return (model?.id as WhisperModelId | undefined) ?? DEFAULT_WHISPER_MODEL;
}

export function registerWhisperRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  const status = async (): Promise<WhisperStatus> => ({
    available: ctx.engines.some((e) => e.id === 'whisper' && e.status() !== 'error'),
    defaultModel: readWhisperModel(ctx.db),
    models: await whisperSetup().models.status(),
  });

  app.get('/api/whisper', async () => status());

  app.put('/api/whisper/default', admin, async (request) => {
    const { model } = setWhisperModelSchema.parse(request.body);
    ctx.db
      .insert(appSettings)
      .values({ key: KEY, value: model })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: model } })
      .run();
    return status();
  });

  app.post('/api/whisper/models/:id/download', admin, async (request, reply) => {
    const id = whisperModelIdSchema.parse((request.params as { id: string }).id);
    whisperSetup().models.start(id);
    return reply.status(202).send(await status());
  });

  app.delete('/api/whisper/models/:id', admin, async (request) => {
    const id = whisperModelIdSchema.parse((request.params as { id: string }).id);
    const current = (await status()).models.find((m) => m.id === id);
    if (current?.downloading !== null) throw new HttpError(409, 'DOWNLOAD_RUNNING');
    await whisperSetup().models.remove(id);
    return status();
  });
}
