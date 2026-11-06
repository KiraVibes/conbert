import { mkdirSync } from 'node:fs';
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
async function resetPasswordCommand(username: string | undefined): Promise<void> {
  if (!username) {
    console.error('Usage: reset-password <username>');
    process.exit(2);
  }
  const config = loadConfig();
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
  mkdirSync(config.dataDir, { recursive: true });
  await initEngines(serverEngines);

  const pretty = config.env === 'development' && process.stdout.isTTY;
  const app = await buildApp({
    config,
    logger: {
      level: config.logLevel,
      ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
    },
    onSetupRequired: printSetupCode,
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
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
