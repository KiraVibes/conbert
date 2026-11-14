import { useEffect, useState } from 'react';

/**
 * Runs one forensic job for the chosen file (again when `key` changes) and
 * keeps its result with the file it belongs to.
 */
export function useFileJob<T>(
  file: File | null,
  key: string,
  job: (file: File) => Promise<T>,
): { result: T | null; failed: boolean; busy: boolean } {
  const [state, setState] = useState<{ id: string; result?: T; failed?: boolean } | null>(null);
  const id = file ? `${file.name}|${file.size}|${file.lastModified}|${key}` : '';

  useEffect(() => {
    if (!file) return;
    let active = true;
    job(file)
      .then((result) => {
        if (active) setState({ id, result });
      })
      .catch((e: unknown) => {
        console.error(e);
        if (active) setState({ id, failed: true });
      });
    return () => {
      active = false;
    };
    // `job` is a new function on every render – the file and key decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const current = state?.id === id ? state : null;
  return {
    result: current?.result ?? null,
    failed: current?.failed ?? false,
    busy: file !== null && current === null,
  };
}
