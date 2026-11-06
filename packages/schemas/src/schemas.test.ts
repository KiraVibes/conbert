import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  engineDescriptorSchema,
  enginesResponseSchema,
  healthResponseSchema,
} from './index';

const descriptor = {
  id: 'sharp',
  name: 'sharp (libvips)',
  descriptionKey: 'engines.sharp.description',
  category: 'image',
  runtime: 'server',
  formats: [{ ext: 'png', mime: 'image/png', canRead: true, canWrite: true }],
  options: [
    {
      key: 'quality',
      labelKey: 'options.quality.label',
      helpKey: 'options.quality.help',
      advanced: false,
      type: 'number',
      default: 80,
      min: 1,
      max: 100,
    },
  ],
  supportsCompression: true,
  priority: 20,
  status: 'ready',
};

describe('engineDescriptorSchema', () => {
  it('accepts a valid descriptor', () => {
    expect(engineDescriptorSchema.parse(descriptor)).toEqual(descriptor);
  });

  it('rejects unknown categories and runtimes', () => {
    expect(engineDescriptorSchema.safeParse({ ...descriptor, category: 'smell' }).success).toBe(
      false,
    );
    expect(engineDescriptorSchema.safeParse({ ...descriptor, runtime: 'cloud' }).success).toBe(
      false,
    );
  });

  it('rejects extensions with dots or uppercase letters', () => {
    const bad = { ...descriptor, formats: [{ ext: '.PNG', canRead: true, canWrite: true }] };
    expect(engineDescriptorSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a help text key for every option', () => {
    const [option] = descriptor.options;
    const bad = { ...descriptor, options: [{ ...option, helpKey: '' }] };
    expect(engineDescriptorSchema.safeParse(bad).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('validates the health response', () => {
    const ok = { status: 'ok', name: 'conbert', version: '0.1.0', uptimeSeconds: 3 };
    expect(healthResponseSchema.parse(ok)).toEqual(ok);
    expect(healthResponseSchema.safeParse({ ...ok, uptimeSeconds: -1 }).success).toBe(false);
  });

  it('validates the engines response', () => {
    expect(enginesResponseSchema.parse({ engines: [descriptor] }).engines).toHaveLength(1);
    expect(enginesResponseSchema.parse({ engines: [] }).engines).toEqual([]);
  });

  it('validates API errors', () => {
    const err = { error: { code: 'NOT_FOUND', messageKey: 'errors.notFound.what' } };
    expect(apiErrorSchema.parse(err)).toEqual(err);
    expect(apiErrorSchema.safeParse({ error: { code: 'X' } }).success).toBe(false);
  });
});
