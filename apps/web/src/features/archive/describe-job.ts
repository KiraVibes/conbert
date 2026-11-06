import type { EngineDescriptor, EngineOption } from '@conbert/core';

export type OptionValue =
  { kind: 'text'; text: string } | { kind: 'key'; key: string } | { kind: 'switch'; on: boolean };

export interface OptionRow {
  key: string;
  labelKey: string;
  value: OptionValue;
}

/**
 * The settings of a job as label/value pairs for the history. Only the last
 * engine of a route gets the person's options, so its definitions win;
 * settings no engine knows any more are left out.
 */
export function describeOptions(
  engines: readonly EngineDescriptor[],
  engineIds: readonly string[],
  options: Record<string, unknown>,
): OptionRow[] {
  const ordered = [
    ...[...engineIds].reverse().flatMap((id) => engines.filter((e) => e.id === id)),
    ...engines,
  ];
  const find = (key: string): EngineOption | undefined => {
    for (const engine of ordered) {
      const option = engine.options.find((o) => o.key === key);
      if (option) return option;
    }
    return undefined;
  };
  const rows: OptionRow[] = [];
  for (const [key, raw] of Object.entries(options)) {
    const option = find(key);
    if (!option || raw === undefined || raw === null || raw === '') continue;
    const choice = option.choices?.find((c) => c.value === String(raw));
    const value: OptionValue = choice
      ? { kind: 'key', key: choice.labelKey }
      : typeof raw === 'boolean'
        ? { kind: 'switch', on: raw }
        : { kind: 'text', text: String(raw) };
    rows.push({ key, labelKey: option.labelKey, value });
  }
  return rows;
}

/** Engine names of a route ("libvips → ffmpeg"); unknown ids show as they are. */
export function routeNames(
  engines: readonly EngineDescriptor[],
  engineIds: readonly string[],
): string {
  return engineIds.map((id) => engines.find((e) => e.id === id)?.name ?? id).join(' → ');
}
