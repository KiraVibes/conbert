import { beforeEach, describe, expect, it } from 'vitest';
import { describeEngine, type Engine } from '@conbert/core';
import { describeOptions, routeNames } from './describe-job';
import {
  JOB_LOG_DAYS,
  JOB_LOG_MAX,
  loadJobLog,
  trimRecords,
  useJobLog,
  type JobRecord,
} from './job-log';

const DAY = 24 * 60 * 60 * 1000;

function record(patch: Partial<JobRecord> = {}): JobRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    task: 'convert',
    sourceName: 'photo.png',
    sourceExt: 'png',
    sourceSize: 100,
    targetExt: 'webp',
    mode: 'auto',
    runtime: 'browser',
    engineIds: ['vips'],
    options: {},
    status: 'done',
    ...patch,
  };
}

describe('job log', () => {
  beforeEach(() => {
    localStorage.clear();
    useJobLog.setState({ records: [] });
  });

  it('keeps the newest entries, at most the limit and only recent ones', () => {
    const now = Date.now();
    const many = Array.from({ length: JOB_LOG_MAX + 5 }, (_, i) =>
      record({ createdAt: now - i * 1000 }),
    );
    const old = record({ createdAt: now - (JOB_LOG_DAYS + 1) * DAY });
    const kept = trimRecords([old, ...many], now);
    expect(kept).toHaveLength(JOB_LOG_MAX);
    expect(kept[0]?.createdAt).toBe(now);
    expect(kept).not.toContain(old);
  });

  it('loads only valid entries of the given account', () => {
    const good = record();
    localStorage.setItem('conbert-joblog-u1', JSON.stringify([good, { id: 1 }, 'junk']));
    localStorage.setItem('conbert-joblog-u2', JSON.stringify([record()]));
    expect(loadJobLog('u1')).toEqual([good]);
    expect(loadJobLog('nobody')).toEqual([]);
    localStorage.setItem('conbert-joblog-broken', '{nope');
    expect(loadJobLog('broken')).toEqual([]);
  });

  it('adds new entries on top and removes single ones', () => {
    const a = record({ createdAt: 1_000 + Date.now() - DAY });
    const b = record();
    useJobLog.getState().add(a);
    useJobLog.getState().add(b);
    expect(useJobLog.getState().records.map((r) => r.id)).toEqual([b.id, a.id]);
    useJobLog.getState().remove(b.id);
    expect(useJobLog.getState().records.map((r) => r.id)).toEqual([a.id]);
  });
});

const engine: Engine = {
  id: 'vips',
  name: 'libvips',
  descriptionKey: 'engines.libvips.description',
  category: 'image',
  runtime: 'browser',
  formats: [],
  options: [
    {
      key: 'quality',
      labelKey: 'options.quality.label',
      helpKey: 'options.quality.help',
      advanced: false,
      type: 'number',
      default: 80,
    },
    {
      key: 'lossless',
      labelKey: 'options.lossless.label',
      helpKey: 'options.lossless.help',
      advanced: true,
      type: 'boolean',
      default: false,
    },
    {
      key: 'effort',
      labelKey: 'options.effort.label',
      helpKey: 'options.effort.help',
      advanced: true,
      type: 'select',
      default: 'normal',
      choices: [{ value: 'fast', labelKey: 'options.effort.fast' }],
    },
  ],
  supportsCompression: true,
  priority: 1,
  init: () => Promise.resolve(),
  status: () => 'ready',
  convert: () => Promise.resolve(new Blob()),
};

describe('describeOptions', () => {
  it('explains each setting with the label and value texts of the engine', () => {
    const rows = describeOptions([describeEngine(engine)], ['vips'], {
      quality: 42,
      lossless: true,
      effort: 'fast',
      unknown: 1,
      title: '',
    });
    expect(rows).toEqual([
      { key: 'quality', labelKey: 'options.quality.label', value: { kind: 'text', text: '42' } },
      { key: 'lossless', labelKey: 'options.lossless.label', value: { kind: 'switch', on: true } },
      {
        key: 'effort',
        labelKey: 'options.effort.label',
        value: { kind: 'key', key: 'options.effort.fast' },
      },
    ]);
  });

  it('names the engines of a route', () => {
    expect(routeNames([describeEngine(engine)], ['vips', 'gone'])).toBe('libvips → gone');
  });
});
