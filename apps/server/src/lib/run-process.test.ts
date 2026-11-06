import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROCESS_NICE, ProcessError, isSystemKill, runProcess } from './run-process';

/** A small Node program as the external tool. */
const node = (code: string) => [process.execPath, ['-e', code]] as const;

describe('runProcess', () => {
  it('keeps a big answer complete when asked to, umlauts included', async () => {
    // ~600 KB of JSON written in small pieces, so characters get split between chunks.
    const [cmd, args] = node(`
      const text = JSON.stringify({ title: 'Äpfel & Bären', items: Array.from({ length: 20000 }, (_, i) => 'Eintrag ' + i + ' – ü') });
      for (let i = 0; i < text.length; i += 333) process.stdout.write(text.slice(i, i + 333));
    `);
    const result = await runProcess(cmd, args, { maxStdoutBytes: 32 * 1024 * 1024 });
    const parsed = JSON.parse(result.stdout) as { title: string; items: string[] };
    expect(parsed.title).toBe('Äpfel & Bären');
    expect(parsed.items).toHaveLength(20000);
    expect(parsed.items.at(-1)).toBe('Eintrag 19999 – ü');
  });

  it('keeps only the end of long output by default', async () => {
    const [cmd, args] = node(`process.stdout.write('a'.repeat(200000) + 'ENDE')`);
    const result = await runProcess(cmd, args);
    expect(result.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.stdout.endsWith('ENDE')).toBe(true);
  });

  it('reports errors with the end of stderr', async () => {
    const [cmd, args] = node(`process.stderr.write('kaputt: ÄÖÜ'); process.exit(3)`);
    const error = await runProcess(cmd, args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessError);
    expect((error as ProcessError).result).toMatchObject({ code: 3, stderr: 'kaputt: ÄÖÜ' });
  });
});

const unix = process.platform !== 'win32';

/**
 * true while a process with this id still runs. A killed process whose
 * parent is gone stays a "zombie" until PID 1 reaps it – that counts as ended.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    // /proc/<pid>/stat: "<pid> (<name>) <state> …"
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return false;
  }
}

describe.runIf(unix)('runProcess limits (Unix)', () => {
  it('runs programs with the lower converter priority', async () => {
    const [cmd, args] = node(`process.stdout.write(String(require('os').getPriority()))`);
    const { stdout } = await runProcess(cmd, args);
    expect(Number(stdout)).toBe(PROCESS_NICE);
  });

  it('ends helper processes too when the time is up', async () => {
    // The tool starts a helper (like LibreOffice does) and both hang.
    const [cmd, args] = node(`
      const { spawn } = require('child_process');
      const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(String(helper.pid));
      setInterval(() => {}, 1000);
    `);
    let helperPid = 0;
    const error = await runProcess(cmd, args, {
      timeoutMs: 1500,
      onStdout: (chunk) => {
        helperPid = Number(chunk);
      },
    }).catch((e: unknown) => e);
    expect((error as ProcessError).reason).toBe('timeout');
    expect(helperPid).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(helperPid)).toBe(false);
  });

  it('ends helper processes left behind after a normal exit', async () => {
    const [cmd, args] = node(`
      const { spawn } = require('child_process');
      const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: false });
      helper.unref();
      process.stdout.write(String(helper.pid));
    `);
    const { stdout } = await runProcess(cmd, args);
    const helperPid = Number(stdout);
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(helperPid)).toBe(false);
  });
});

describe.runIf(unix)('runProcess when the system stops a program', () => {
  it('marks the error so the job can explain it', async () => {
    // Stands in for the out-of-memory killer: the program is killed from outside.
    const [cmd, args] = node(`process.kill(process.pid, 'SIGKILL')`);
    const error = await runProcess(cmd, args).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProcessError);
    expect(isSystemKill((error as ProcessError).result.stderr)).toBe(true);
  });

  it('does not mark normal failures', async () => {
    const [cmd, args] = node(`process.exit(1)`);
    const error = await runProcess(cmd, args).catch((e: unknown) => e);
    expect(isSystemKill((error as ProcessError).result.stderr)).toBe(false);
  });
});
