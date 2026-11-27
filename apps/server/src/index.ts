import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from './app';
import { resetPassword } from './auth/reset-password';
import { openDatabase } from './db';
import { ConfigError, dataPaths, loadConfig } from './config';
import { initEngines, serverEngines } from './engines';

function printSetupCode(code: string): void {
  // Printed directly (not via the logger) so it shows up at any log level.
  const line = '─'.repeat(52);
  process.stdout.write(
    [
      '',
      `┌${line}┐`,
      '│  Conbert is not set up yet.                        │',
      '│  Open Conbert in your browser and enter this code: │',
      `│      ${code}                                     │`,
      `└${line}┘`,
      '',
    ].join('\n'),
  );
}

/**
 * `node server/dist/index.mjs reset-password <username>`: prints a new random
 * password for that account (e.g. the only admin forgot theirs).
 */
/**
 * `docker exec` runs as root: act as the owner of the data folder, so no
 * root-owned files end up in it that the server can't open later.
 */
function actAsDataOwner(dataDir: string): void {
  if (process.getuid?.() !== 0 || !existsSync(dataDir)) return;
  const { uid, gid } = statSync(dataDir);
  if (uid === 0) return;
  process.setgroups?.([]);
  process.setgid?.(gid);
  process.setuid?.(uid);
}

/** Stops with a clear message when Conbert may not write its data folder. */
function checkDataDir(dataDir: string): void {
  const database = path.join(dataDir, 'conbert.db');
  const paths = [dataDir, database, `${database}-wal`, `${database}-shm`];
  try {
    mkdirSync(dataDir, { recursive: true });
    for (const file of paths) if (existsSync(file)) accessSync(file, constants.W_OK);
  } catch {
    const blocked = paths.find((file) => {
      try {
        if (existsSync(file)) accessSync(file, constants.W_OK);
        return false;
      } catch {
        return true;
      }
    });
    const owner = (file: string | undefined) => {
      try {
        const st = statSync(file ?? dataDir);
        return `${st.uid}:${st.gid}`;
      } catch {
        return 'unknown';
      }
    };
    const me = `${process.getuid?.() ?? '?'}:${process.getgid?.() ?? '?'}`;
    throw new ConfigError(
      [
        `Conbert can't write to ${blocked ?? dataDir}.`,
        `Conbert runs as user ${me}, but it belongs to ${owner(blocked)}.`,
        'Fix it in one of these ways:',
        '  - Start the container as root (the default, no "user:" setting) and set PUID and PGID',
        '    to the owner of your data folder. On Unraid that is PUID=99 and PGID=100.',
        `  - Or give the folder to Conbert on the host: chown -R ${me} <your data folder>`,
      ].join('\n'),
    );
  }
}

async function resetPasswordCommand(username: string | undefined): Promise<void> {
  if (!username) {
    console.error('Usage: reset-password <username>');
    process.exit(2);
  }
  const config = loadConfig();
  actAsDataOwner(config.dataDir);
  checkDataDir(config.dataDir);
  const db = openDatabase(dataPaths(config).database, config.migrationsDir);
  const password = await resetPassword(db, username);
  if (!password) {
    console.error(`There is no account named "${username}".`);
    process.exit(1);
  }
  process.stdout.write(
    `New password for "${username}": ${password}
Sign in with it and change it under Settings → Account.
`,
  );
  process.exit(0);
}

async function main(): Promise<void> {
  if (process.argv[2] === 'reset-password') return resetPasswordCommand(process.argv[3]);
  const config = loadConfig();
  actAsDataOwner(config.dataDir);
  checkDataDir(config.dataDir);
  await initEngines(serverEngines);

  const pretty = config.env === 'development' && process.stdout.isTTY;
  const app = await buildApp({
    config,
    logging: {
      // The container's output keeps CONBERT_LOG_LEVEL; the admin's log file
      // follows the detail chosen in the admin area.
      console: {
        level: config.logLevel,
        stream: pretty ? (await import('pino-pretty')).default({ colorize: true }) : process.stdout,
      },
      file: true,
    },
    onSetupRequired: printSetupCode,
  });
  app.log.info({ area: 'system', version: process.env['npm_package_version'] }, 'server started');

  const shutdown = async (signal: string) => {
    app.log.info({ area: 'system', signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('Conbert server failed to start:', error);
  }
  process.exit(1);
});
