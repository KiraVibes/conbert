import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  apiErrorSchema,
  createDownloadRequestSchema,
  createJobRequestSchema,
  downloadResponseSchema,
  enginesResponseSchema,
  healthResponseSchema,
  jobResponseSchema,
  probeDownloadRequestSchema,
  probeDownloadResponseSchema,
} from '@conbert/schemas';

/**
 * OpenAPI 3.1 description of the endpoints meant for scripts, generated from
 * the same Zod schemas the server validates with – so it can't drift. Tools
 * like n8n, Postman or Home Assistant can import it from /api/openapi.json.
 */

type Json = Record<string, unknown>;

const schema = (s: z.ZodType, io: 'input' | 'output' = 'output'): Json => {
  const json = z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Json;
  delete json['$schema'];
  return json;
};

const body = (s: z.ZodType): Json => ({
  required: true,
  content: { 'application/json': { schema: schema(s, 'input') } },
});
const ok = (description: string, s: z.ZodType): Json => ({
  description,
  content: { 'application/json': { schema: schema(s) } },
});
const binary = (description: string): Json => ({
  description,
  content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
});
const error = (description: string): Json => ok(description, apiErrorSchema);
const query = (name: string, description: string, required = false, type = 'string'): Json => ({
  name,
  in: 'query',
  required,
  description,
  schema: { type },
});
const idParam: Json = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

export function openApiDocument(version: string): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Conbert – FileWizard API',
      version,
      description:
        'Convert, compress and download files on your own Conbert server. Create a token ' +
        'in Conbert under Settings → API access and send it as "Authorization: Bearer <token>". ' +
        'Tokens can do everything you can, except managing tokens, users and passwords.',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Is the server up?',
          security: [],
          responses: { '200': ok('Status', healthResponseSchema) },
        },
      },
      '/api/engines': {
        get: {
          summary: 'Engines and the formats they read and write',
          responses: { '200': ok('Engines', enginesResponseSchema) },
        },
      },
      '/api/convert': {
        post: {
          summary: 'Convert a file in one request',
          description:
            'Send the file as the raw request body (any content type). Waits for the result ' +
            'and returns it; if it takes longer than "wait" seconds, the job comes back with ' +
            'status 202 – then poll GET /api/jobs/{id}.',
          parameters: [
            query('to', 'Target format, e.g. "jpg", "mp3", "pdf"', true),
            query('name', 'Original file name (used for the result name)'),
            query('mode', '"convert" (default), "compress" or "ocr"'),
            query('options', 'Engine options as JSON, e.g. {"quality":80}'),
            query('wait', 'Seconds to wait for the result (0–1800, default 600)', false, 'integer'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: {
            '200': binary('The converted file'),
            '202': ok('Still running – the job', jobResponseSchema),
            '400': error('Empty body or wrong parameters'),
            '413': error('File too large'),
            '422': error('No way to this format, or the conversion failed'),
          },
        },
      },
      '/api/files': {
        post: {
          summary: 'Upload a file (raw body) for a job',
          parameters: [query('name', 'Original file name')],
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: {
            '201': {
              description: 'Stored file',
              content: {
                'application/json': {
                  schema: schema(
                    z.object({
                      file: z.object({
                        id: z.string(),
                        name: z.string(),
                        ext: z.string(),
                        size: z.number(),
                      }),
                    }),
                  ),
                },
              },
            },
          },
        },
      },
      '/api/jobs': {
        post: {
          summary: 'Start a job for an uploaded file',
          requestBody: body(createJobRequestSchema),
          responses: {
            '201': ok('The new job', jobResponseSchema),
            '422': error('No way to this format on the server'),
          },
        },
      },
      '/api/jobs/{id}': {
        get: {
          summary: 'Job status and progress',
          parameters: [idParam],
          responses: { '200': ok('The job', jobResponseSchema) },
        },
        delete: {
          summary: 'Cancel a job',
          parameters: [idParam],
          responses: { '200': ok('The job', jobResponseSchema) },
        },
      },
      '/api/jobs/{id}/result': {
        get: {
          summary: 'Download the result',
          parameters: [idParam],
          responses: { '200': binary('The result'), '410': error('Not ready or already deleted') },
        },
      },
      '/api/downloader/probe': {
        post: {
          summary: 'What is behind a link? (video, picture, profile …)',
          requestBody: body(probeDownloadRequestSchema),
          responses: { '200': ok('Details', probeDownloadResponseSchema) },
        },
      },
      '/api/downloader/jobs': {
        post: {
          summary: 'Download from a link (Instagram, YouTube, TikTok …)',
          requestBody: body(createDownloadRequestSchema),
          responses: { '201': ok('The download', downloadResponseSchema) },
        },
      },
    },
  };
}

export function registerOpenApiRoutes(app: FastifyInstance, version: string): void {
  const document = openApiDocument(version);
  app.get('/api/openapi.json', async (_request, reply) =>
    reply.header('Cache-Control', 'no-cache').send(document),
  );
}
