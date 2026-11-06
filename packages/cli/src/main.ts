import { defaultConfigDir, run } from './cli';

const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  configDir: defaultConfigDir(process.env),
  fetch,
  cwd: process.cwd(),
});
process.exit(code);
