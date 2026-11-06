import { describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers';

describe('OpenAPI', () => {
  it('describes the script endpoints without signing in', async () => {
    const app = await testApp();
    const res = await app.inject({ url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{
      openapi: string;
      paths: Record<string, Record<string, { requestBody?: unknown }>>;
      components: { securitySchemes: Record<string, unknown> };
    }>();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/convert', '/api/files', '/api/jobs', '/api/jobs/{id}/result']),
    );
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
    // Generated from the Zod schema: the job request knows its fields.
    expect(JSON.stringify(doc.paths['/api/jobs']?.['post']?.requestBody)).toContain('outputExt');
    await app.close();
  });
});
