import { describe, expect, it } from 'vitest';
import {
  defaultOptions,
  describeEngine,
  engineI18nKeys,
  optionsFor,
  type Engine,
  type EngineOption,
} from './engine';

const options: EngineOption[] = [
  {
    key: 'quality',
    labelKey: 'options.quality.label',
    helpKey: 'options.quality.help',
    effectKey: 'options.quality.effect',
    advanced: false,
    type: 'number',
    default: 80,
    appliesTo: ['jpg', 'webp'],
  },
  {
    key: 'strip',
    labelKey: 'options.strip.label',
    helpKey: 'options.strip.help',
    advanced: false,
    type: 'boolean',
    default: true,
  },
  {
    key: 'mode',
    labelKey: 'options.mode.label',
    helpKey: 'options.mode.help',
    advanced: true,
    type: 'select',
    default: 'a',
    choices: [
      { value: 'a', labelKey: 'options.mode.a', helpKey: 'options.mode.aHelp' },
      { value: 'b', labelKey: 'options.mode.b' },
    ],
  },
];

const fakeEngine: Engine = {
  id: 'fake',
  name: 'Fake',
  descriptionKey: 'engines.fake.description',
  category: 'image',
  runtime: 'browser',
  formats: [{ ext: 'png', canRead: true, canWrite: true }],
  options,
  supportsCompression: true,
  priority: 1,
  init: () => Promise.resolve(),
  status: () => 'ready',
  convert: () => Promise.resolve('out'),
};

describe('engine helpers', () => {
  it('filters options by output format', () => {
    expect(optionsFor(options, 'png').map((o) => o.key)).toEqual(['strip', 'mode']);
    expect(optionsFor(options, 'webp').map((o) => o.key)).toEqual(['quality', 'strip', 'mode']);
  });

  it('builds default option values', () => {
    expect(defaultOptions(options, 'jpg')).toEqual({ quality: 80, strip: true, mode: 'a' });
  });

  it('collects every i18n key of an engine', () => {
    expect(engineI18nKeys(fakeEngine)).toEqual([
      'engines.fake.description',
      'options.quality.label',
      'options.quality.help',
      'options.quality.effect',
      'options.strip.label',
      'options.strip.help',
      'options.mode.label',
      'options.mode.help',
      'options.mode.a',
      'options.mode.aHelp',
      'options.mode.b',
    ]);
  });

  it('describes an engine without functions', () => {
    const d = describeEngine(fakeEngine);
    expect(d.status).toBe('ready');
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(Object.values(d).some((v) => typeof v === 'function')).toBe(false);
  });
});
